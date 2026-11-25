import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import sharp from 'sharp';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { getSettings } from '../services/settings.js';
import { withPortalIdentity } from '../utils/roles.js';

const router = Router();

// Only a reference is stored on the user row. The processed image itself lives
// in a dedicated directory and is served through this authenticated router.
const PROFILE_DIR = process.env.PROFILE_UPLOAD_DIR
  ? path.resolve(process.env.PROFILE_UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads', 'profiles');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 512;
const PHOTO_NAME = /^profiles\/(\d+)-([0-9a-f-]{36})\.webp$/i;

function badRequest(res, message) {
  return res.status(400).json({ message });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function detectImageType(buffer) {
  const starts = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if (buffer.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (buffer.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (buffer.length >= 12 && starts(0x52, 0x49, 0x46, 0x46)
    && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeImage(value) {
  const raw = typeof value === 'string' ? value : value?.data;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw httpError(400, 'Choose an image before saving.');
  }
  const dataUrl = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
  const declaredType = dataUrl ? dataUrl[1].toLowerCase() : null;
  const base64 = (dataUrl ? dataUrl[2] : raw).replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw httpError(400, 'The selected image could not be read.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw httpError(400, 'The selected image is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw httpError(400, 'Profile photos must be 5 MB or smaller.');
  }
  const detectedType = detectImageType(buffer);
  if (!detectedType || (declaredType && declaredType !== detectedType)) {
    throw httpError(400, 'Only JPG, PNG and WebP images are supported.');
  }
  return buffer;
}

async function processImage(buffer) {
  try {
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw httpError(400, 'The selected image is corrupt or unsupported.');
    }
    // Re-encode from decoded pixels so user-supplied metadata, scripts and file
    // names can never reach storage. The square crop prevents distorted avatars.
    return await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, 'The selected image is corrupt or unsupported.');
  }
}

function photoPath(reference, userId) {
  const match = typeof reference === 'string' ? reference.match(PHOTO_NAME) : null;
  if (!match || Number(match[1]) !== Number(userId)) return null;
  return path.join(PROFILE_DIR, `${match[1]}-${match[2]}.webp`);
}

async function removePhotoFile(reference, userId) {
  const target = photoPath(reference, userId);
  if (!target) return;
  try {
    await unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not remove previous profile photo for user ${userId}: ${error.message}`);
    }
  }
}

async function currentProfile(userId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
      u.department_id AS departmentId, d.name AS department,
      u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
      u.profile_photo AS profilePhoto
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function mapProfile(row) {
  if (!row) return null;
  const identity = withPortalIdentity(row);
  return {
    id: row.id,
    name: row.name,
    username: null,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    roleLabel: identity.roleLabel,
    active: Boolean(row.active),
    departmentId: row.departmentId ?? null,
    department: row.department || '',
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    profilePhoto: row.profilePhoto || null,
    profilePhotoUrl: row.profilePhoto ? `/api/profile/photo/${row.id}` : null
  };
}

async function saveProfilePhoto(userId, buffer) {
  await mkdir(PROFILE_DIR, { recursive: true });
  let filename;
  let target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    filename = `${userId}-${randomUUID()}.webp`;
    target = path.join(PROFILE_DIR, filename);
    try {
      await writeFile(target, buffer, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt === 2) throw error;
    }
  }
  return `profiles/${filename}`;
}

router.get('/', async (req, res, next) => {
  try {
    const row = await currentProfile(req.user.id);
    if (!row) return res.status(404).json({ message: 'Your account could not be found.' });
    return res.json({ user: mapProfile(row) });
  } catch (error) { return next(error); }
});

router.patch('/', async (req, res, next) => {
  try {
    const row = await currentProfile(req.user.id);
    if (!row) return res.status(404).json({ message: 'Your account could not be found.' });

    const name = String(req.body.name ?? '').trim();
    const phone = String(req.body.phone ?? '').trim();
    if (!name || name.length > 150 || phone.length > 50) {
      return badRequest(res, 'Enter a valid name and phone number.');
    }
    // Role, department, email, active state and every permission field are
    // deliberately excluded. They remain under Administrator account management.
    await pool.execute('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone || null, req.user.id]);
    await writeAudit(pool, req.user.id, 'profile_updated', 'user', String(req.user.id), {
      fields: ['name', 'phone']
    });
    return res.json({ message: 'Personal details saved.', user: mapProfile(await currentProfile(req.user.id)) });
  } catch (error) { return next(error); }
});

router.post('/password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    const account = rows[0];
    if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      return badRequest(res, 'Your current password is incorrect.');
    }
    const settings = await getSettings();
    const minimum = Number(settings.password_min_length) || 12;
    if (newPassword.length < minimum) {
      return badRequest(res, `Your new password must be at least ${minimum} characters.`);
    }
    if (newPassword === currentPassword) {
      return badRequest(res, 'Choose a password different from your current password.');
    }
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 12), req.user.id]);
    await writeAudit(pool, req.user.id, 'password_changed', 'user', String(req.user.id), {});
    return res.json({ message: 'Password changed successfully.' });
  } catch (error) { return next(error); }
});

router.post('/photo', async (req, res, next) => {
  try {
    const row = await currentProfile(req.user.id);
    if (!row) return res.status(404).json({ message: 'Your account could not be found.' });
    const buffer = decodeImage(req.body.photo);
    const processed = await processImage(buffer);
    const reference = await saveProfilePhoto(req.user.id, processed);
    await pool.execute('UPDATE users SET profile_photo = ? WHERE id = ?', [reference, req.user.id]);
    await removePhotoFile(row.profilePhoto, req.user.id);
    await writeAudit(pool, req.user.id, 'profile_photo_uploaded', 'user', String(req.user.id), {
      format: 'webp', bytes: processed.length
    });
    return res.status(201).json({
      message: 'Profile photo saved successfully.',
      user: mapProfile(await currentProfile(req.user.id))
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

router.delete('/photo', async (req, res, next) => {
  try {
    const row = await currentProfile(req.user.id);
    if (!row) return res.status(404).json({ message: 'Your account could not be found.' });
    if (row.profilePhoto) {
      await pool.execute('UPDATE users SET profile_photo = NULL WHERE id = ?', [req.user.id]);
      await removePhotoFile(row.profilePhoto, req.user.id);
      await writeAudit(pool, req.user.id, 'profile_photo_removed', 'user', String(req.user.id), {});
    }
    return res.json({
      message: row.profilePhoto ? 'Profile photo removed successfully.' : 'No profile photo was set.',
      user: mapProfile(await currentProfile(req.user.id))
    });
  } catch (error) { return next(error); }
});

// A photo is identity metadata, not a private document. Authenticated users may
// view photos of themselves, their own Department colleagues, or any account
// when acting as an Administrator. No public/static file path is exposed.
router.get('/photo/:userId', async (req, res, next) => {
  try {
    const targetId = Number(req.params.userId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(404).json({ message: 'Profile photo not found.' });
    }
    const [rows] = await pool.execute(
      `SELECT id, role, department_id AS departmentId, profile_photo AS profilePhoto, active
       FROM users WHERE id = ? LIMIT 1`,
      [targetId]
    );
    const target = rows[0];
    if (!target || !target.active || !target.profilePhoto) {
      return res.status(404).json({ message: 'Profile photo not found.' });
    }
    const sameDepartment = target.departmentId != null
      && Number(target.departmentId) === Number(req.user.departmentId);
    const allowed = Number(target.id) === Number(req.user.id)
      || req.user.role === 'admin'
      || sameDepartment;
    if (!allowed) return res.status(404).json({ message: 'Profile photo not found.' });

    const targetPath = photoPath(target.profilePhoto, target.id);
    if (!targetPath) return res.status(404).json({ message: 'Profile photo not found.' });
    let image;
    try {
      image = await readFile(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ message: 'Profile photo not found.' });
      throw error;
    }
    // Profile photos are identity metadata and change without a route change;
    // never let a browser serve a stale cached image after an update/removal.
    return res.set('Cache-Control', 'private, no-store').type('image/webp').send(image);
  } catch (error) { return next(error); }
});

export default router;

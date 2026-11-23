import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { dateFilterClause, parseDateFilter } from '../utils/dates.js';
import { USER_ROLES } from '../utils/roles.js';
import { clearSettingsCache, getSettings, saveSettings, SETTINGS_DEFAULTS } from '../services/settings.js';

const router = Router();
const ROLES = USER_ROLES;
const DEPARTMENT_ASSIGNED_ROLES = ['supervisor', 'requestor', 'storekeeper'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_ROWS = 500;

router.use(allowRoles('admin'));

router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    let database = 'connected';
    try { await pool.execute('SELECT 1'); } catch { database = 'disconnected'; }
    const health = {
      server: 'running',
      database,
      environment: process.env.NODE_ENV || 'development',
      applicationVersion: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor(process.uptime())
    };
    return res.json({ settings, defaults: SETTINGS_DEFAULTS, health });
  } catch (error) { return next(error); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const result = await saveSettings(req.body.settings || req.body, req.user.id);
    return res.json({ message: 'Settings saved successfully.', ...result });
  } catch (error) {
    if (error.message?.startsWith('Unknown setting') || error.message?.startsWith('Invalid') ||
      error.message?.includes('must be') || error.message?.includes('Choose one')) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
});

router.post('/settings/reset', async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body.keys) ? req.body.keys : Object.keys(SETTINGS_DEFAULTS);
    const unknown = keys.find((key) => !(key in SETTINGS_DEFAULTS));
    if (unknown) return res.status(400).json({ message: `Unknown setting: ${unknown}` });
    const result = await saveSettings(
      Object.fromEntries(keys.map((key) => [key, SETTINGS_DEFAULTS[key]])),
      req.user.id
    );
    clearSettingsCache();
    return res.json({ message: 'Selected settings reset to defaults.', ...result });
  } catch (error) { return next(error); }
});

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    active: Boolean(row.active),
    departmentId: row.departmentId ?? null,
    department: row.department || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt
  };
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

async function emailTaken(connection, email, exceptId = null) {
  const [rows] = await connection.execute(
    'SELECT id FROM users WHERE email = ? AND (? IS NULL OR id <> ?) LIMIT 1',
    [email, exceptId, exceptId]
  );
  return rows.length > 0;
}

async function departmentExists(connection, id) {
  if (id === null) return true;
  const [rows] = await connection.execute('SELECT id FROM departments WHERE id = ? LIMIT 1', [id]);
  return rows.length > 0;
}

async function activeAdminCount(connection) {
  const [[result]] = await connection.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = TRUE");
  return Number(result.total);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function wantsReplacement(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function departmentAssignmentError(role, departmentId, active = true) {
  if (active && DEPARTMENT_ASSIGNED_ROLES.includes(role) && !departmentId) {
    const label = role === 'supervisor' ? 'A Supervisor' : role === 'requestor' ? 'A Requester' : 'A Stock Keeper';
    return `${label} must be assigned to a Department.`;
  }
  return null;
}

async function otherActiveSupervisors(connection, departmentId, exceptId = null) {
  if (!departmentId) return [];
  const [rows] = await connection.execute(
    `SELECT id, name, email FROM users
      WHERE role = 'supervisor' AND active = TRUE AND department_id = ?
        AND (? IS NULL OR id <> ?)
      ORDER BY id`,
    [departmentId, exceptId, exceptId]
  );
  return rows;
}

async function replaceActiveSupervisors(connection, departmentId, exceptId, actorId) {
  const existing = await otherActiveSupervisors(connection, departmentId, exceptId);
  for (const supervisor of existing) {
    await connection.execute('UPDATE users SET active = FALSE WHERE id = ?', [supervisor.id]);
    await writeAudit(connection, actorId, 'supervisor_replaced', 'user', String(supervisor.id), {
      email: supervisor.email, departmentId, replacedBy: actorId
    });
  }
  return existing;
}

function temporaryPassword() {
  return randomBytes(18).toString('base64url');
}

router.get('/users', async (req, res, next) => {
  try {
    const columns = { created: 'u.created_at', login: 'u.last_login_at', updated: 'u.updated_at' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'created' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
        u.created_at AS createdAt, u.updated_at AS updatedAt,
        u.last_login_at AS lastLoginAt,
        u.department_id AS departmentId, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE 1 = 1 ${clause}
       ORDER BY u.id`,
      params
    );
    return res.json({ users: users.map(mapUser) });
  } catch (error) { return next(error); }
});

router.get('/audit-logs', async (req, res, next) => {
  try {
    const filter = parseDateFilter(req.query, { created: 'a.created_at' }, { defaultField: 'created' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    let clause = dateFilterClause(filter, { created: 'a.created_at' }, params);
    const action = String(req.query.action || '').trim().slice(0, 100);
    const entityType = String(req.query.entityType || '').trim().slice(0, 80);
    if (action) {
      clause += ' AND a.action = ?';
      params.push(action);
    }
    if (entityType) {
      clause += ' AND a.entity_type = ?';
      params.push(entityType);
    }
    const [logs] = await pool.query(
      `SELECT a.id, a.user_id AS userId, a.action, a.entity_type AS entityType,
        a.entity_id AS entityId, a.details,
        a.previous_status AS previousStatus, a.new_status AS newStatus,
        a.created_at AS createdAt, u.name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE 1 = 1 ${clause}
       ORDER BY a.created_at DESC, a.id DESC LIMIT 500`,
      params
    );
    return res.json({ logs });
  } catch (error) { return next(error); }
});

router.get('/departments', async (_req, res, next) => {
  try {
    const [departments] = await pool.query(
      `SELECT d.id, d.name, d.description, d.created_at AS createdAt,
        COUNT(u.id) AS userCount,
        (SELECT COUNT(*) FROM requisitions r WHERE r.department_id = d.id) AS requisitionCount,
        (SELECT COUNT(*) FROM store_requests s WHERE s.department_id = d.id) AS storeRequestCount
       FROM departments d LEFT JOIN users u ON u.department_id = d.id
       GROUP BY d.id ORDER BY d.name`
    );
    return res.json({ departments });
  } catch (error) { return next(error); }
});

router.get('/departments/:id/users', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid department identifier.');
  try {
    const [[department]] = await pool.execute(
      `SELECT d.id, d.name, d.description,
        (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS userCount
       FROM departments d WHERE d.id = ? LIMIT 1`,
      [id]
    );
    if (!department) return res.status(404).json({ message: 'Department not found.' });
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.created_at AS createdAt,
        u.department_id AS departmentId, d.name AS department
       FROM users u JOIN departments d ON d.id = u.department_id
       WHERE u.department_id = ? ORDER BY u.name, u.id`,
      [id]
    );
    return res.json({ department: { ...department, userCount: Number(department.userCount) }, users: users.map(mapUser) });
  } catch (error) { return next(error); }
});

router.post('/departments', async (req, res, next) => {
  const name = text(req.body.name, 100);
  const description = text(req.body.description, 255) || null;
  if (!name) return badRequest(res, 'Department name is required.');
  try {
    const [existing] = await pool.execute('SELECT id FROM departments WHERE name = ? LIMIT 1', [name]);
    if (existing.length) return badRequest(res, 'A department with that name already exists.');
    const [result] = await pool.execute('INSERT INTO departments (name, description) VALUES (?, ?)', [name, description]);
    await writeAudit(pool, req.user.id, 'department_created', 'department', String(result.insertId), { name });
    return res.status(201).json({ id: result.insertId, name, description });
  } catch (error) { return next(error); }
});

router.patch('/departments/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  const name = req.body.name === undefined ? undefined : text(req.body.name, 100);
  const description = req.body.description === undefined ? undefined : (text(req.body.description, 255) || null);
  if (!id) return badRequest(res, 'Invalid department identifier.');
  if (name === undefined && description === undefined) return badRequest(res, 'No department changes were supplied.');
  if (name === '') return badRequest(res, 'Department name is required.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, name, description FROM departments WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Department not found.' });
    }
    const nextName = name === undefined ? existing[0].name : name;
    const [duplicate] = await connection.execute('SELECT id FROM departments WHERE name = ? AND id <> ? LIMIT 1', [nextName, id]);
    if (duplicate.length) {
      await connection.rollback();
      return badRequest(res, 'A department with that name already exists.');
    }
    await connection.execute('UPDATE departments SET name = ?, description = ? WHERE id = ?', [
      nextName, description === undefined ? existing[0].description : description, id
    ]);
    await writeAudit(connection, req.user.id, 'department_updated', 'department', String(id), { from: existing[0].name, to: nextName });
    await connection.commit();
    return res.json({ id, name: nextName });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.delete('/departments/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid department identifier.');
  const reassignTo = req.body.reassignTo === undefined || req.body.reassignTo === null || req.body.reassignTo === ''
    ? null : parseId(req.body.reassignTo);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, name FROM departments WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Department not found.' });
    }
    const [[usage]] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE department_id = ?) AS users,
        (SELECT COUNT(*) FROM requisitions WHERE department_id = ?) AS requisitions,
        (SELECT COUNT(*) FROM store_requests WHERE department_id = ?) AS storeRequests`,
      [id, id, id]
    );
    const assigned = Number(usage.users) + Number(usage.requisitions) + Number(usage.storeRequests);
    if (assigned > 0) {
      if (!reassignTo || reassignTo === id) {
        await connection.rollback();
        return badRequest(res, `This department has ${usage.users} user(s), ${usage.requisitions} requisition(s) and ${usage.storeRequests} store request(s). Reassign them to another department before deleting.`);
      }
      if (!(await departmentExists(connection, reassignTo))) {
        await connection.rollback();
        return badRequest(res, 'The reassignment department does not exist.');
      }
      await connection.execute('UPDATE users SET department_id = ? WHERE department_id = ?', [reassignTo, id]);
      await connection.execute('UPDATE requisitions SET department_id = ? WHERE department_id = ?', [reassignTo, id]);
      await connection.execute('UPDATE store_requests SET department_id = ? WHERE department_id = ?', [reassignTo, id]);
    }
    await connection.execute('DELETE FROM departments WHERE id = ?', [id]);
    await writeAudit(connection, req.user.id, 'department_deleted', 'department', String(id), {
      name: existing[0].name, reassignedTo: assigned ? reassignTo : null
    });
    await connection.commit();
    return res.json({ deleted: true, reassigned: assigned > 0 ? reassignTo : null });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.post('/users', async (req, res, next) => {
  const name = text(req.body.name, 150);
  const email = text(req.body.email, 190).toLowerCase();
  const phone = text(req.body.phone, 50) || null;
  const password = String(req.body.password || '');
  const role = text(req.body.role, 40);
  const departmentId = req.body.departmentId === undefined || req.body.departmentId === null || req.body.departmentId === ''
    ? null : parseId(req.body.departmentId);
  const replaceSupervisor = wantsReplacement(req.body.replaceSupervisor);
  if (!name || !EMAIL_PATTERN.test(email) || password.length < 12 || !ROLES.includes(role)) {
    return badRequest(res, 'Enter a name, valid email, 12-character password, and valid role.');
  }
  if (departmentId === null && req.body.departmentId !== undefined && req.body.departmentId !== null && req.body.departmentId !== '') {
    return badRequest(res, 'Invalid department.');
  }
  const assignmentError = departmentAssignmentError(role, departmentId);
  if (assignmentError) return badRequest(res, assignmentError);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (await emailTaken(connection, email)) {
      await connection.rollback();
      return badRequest(res, 'An account with that email already exists.');
    }
    if (!(await departmentExists(connection, departmentId))) {
      await connection.rollback();
      return badRequest(res, 'The selected department does not exist.');
    }
    let replacedSupervisor = false;
    if (role === 'supervisor') {
      const conflict = await otherActiveSupervisors(connection, departmentId);
      if (conflict.length && !replaceSupervisor) {
        await connection.rollback();
        return badRequest(res, `${conflict[0].name} is already the active Supervisor for this Department. Enable “Replace existing Supervisor” to replace them.`);
      }
      if (conflict.length) {
        await replaceActiveSupervisors(connection, departmentId, null, req.user.id);
        replacedSupervisor = true;
      }
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await connection.execute(
      'INSERT INTO users (department_id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [departmentId, name, email, phone, passwordHash, role]
    );
    await writeAudit(connection, req.user.id, 'user_created', 'user', String(result.insertId), {
      email, role, departmentId, replacedSupervisor
    });
    await connection.commit();
    return res.status(201).json({ id: result.insertId, email, role, departmentId, replacedSupervisor });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch('/users/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid user identifier.');
  const name = req.body.name === undefined ? undefined : text(req.body.name, 150);
  const email = req.body.email === undefined ? undefined : text(req.body.email, 190).toLowerCase();
  const phone = req.body.phone === undefined ? undefined : (text(req.body.phone, 50) || null);
  const role = req.body.role === undefined ? undefined : text(req.body.role, 40);
  const departmentId = req.body.departmentId === undefined ? undefined
    : (req.body.departmentId === null || req.body.departmentId === '' ? null : parseId(req.body.departmentId));
  const replaceSupervisor = wantsReplacement(req.body.replaceSupervisor);
  if (name === '' || (email !== undefined && !EMAIL_PATTERN.test(email)) || (role !== undefined && !ROLES.includes(role))) {
    return badRequest(res, 'Enter a valid name, email, and role.');
  }
  if (departmentId === undefined ? false : departmentId === null && req.body.departmentId !== null && req.body.departmentId !== '') {
    return badRequest(res, 'Invalid department.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT * FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }
    const current = existing[0];
    const nextEmail = email === undefined ? current.email : email;
    const nextRole = role === undefined ? current.role : role;
    if (nextEmail !== current.email && await emailTaken(connection, nextEmail, id)) {
      await connection.rollback();
      return badRequest(res, 'An account with that email already exists.');
    }
    if (current.role === 'admin' && current.active && nextRole !== 'admin' && await activeAdminCount(connection) <= 1) {
      await connection.rollback();
      return badRequest(res, 'The last active administrator cannot be demoted.');
    }
    const nextDepartmentId = departmentId === undefined ? current.department_id : departmentId;
    if (!(await departmentExists(connection, nextDepartmentId))) {
      await connection.rollback();
      return badRequest(res, 'The selected department does not exist.');
    }
    const assignmentError = departmentAssignmentError(nextRole, nextDepartmentId, Boolean(current.active));
    if (assignmentError) {
      await connection.rollback();
      return badRequest(res, assignmentError);
    }
    let replacedSupervisor = false;
    if (nextRole === 'supervisor' && current.active) {
      const conflict = await otherActiveSupervisors(connection, nextDepartmentId, id);
      if (conflict.length && !replaceSupervisor) {
        await connection.rollback();
        return badRequest(res, `${conflict[0].name} is already the active Supervisor for this Department. Enable “Replace existing Supervisor” to replace them.`);
      }
      if (conflict.length) {
        await replaceActiveSupervisors(connection, nextDepartmentId, id, req.user.id);
        replacedSupervisor = true;
      }
    }
    await connection.execute(
      'UPDATE users SET name = ?, email = ?, phone = ?, role = ?, department_id = ? WHERE id = ?',
      [name === undefined ? current.name : name, nextEmail,
        phone === undefined ? current.phone : phone, nextRole, nextDepartmentId, id]
    );
    await writeAudit(connection, req.user.id, 'user_updated', 'user', String(id), {
      email: nextEmail, role: nextRole, departmentId: nextDepartmentId, replacedSupervisor
    });
    await connection.commit();
    return res.json({ id, email: nextEmail, role: nextRole, departmentId: nextDepartmentId, replacedSupervisor });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid user identifier.');
  const active = req.body.active === true || req.body.active === 'true';
  const replaceSupervisor = wantsReplacement(req.body.replaceSupervisor);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, email, role, active, department_id AS departmentId FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }
    if (existing[0].active && !active && existing[0].role === 'admin' && await activeAdminCount(connection) <= 1) {
      await connection.rollback();
      return badRequest(res, 'The last active administrator cannot be deactivated.');
    }
    let replacedSupervisor = false;
    if (active) {
      const assignmentError = departmentAssignmentError(existing[0].role, existing[0].departmentId);
      if (assignmentError) {
        await connection.rollback();
        return badRequest(res, assignmentError);
      }
      if (existing[0].role === 'supervisor') {
        const conflict = await otherActiveSupervisors(connection, existing[0].departmentId, id);
        if (conflict.length && !replaceSupervisor) {
          await connection.rollback();
          return badRequest(res, `${conflict[0].name} is already the active Supervisor for this Department. Enable “Replace existing Supervisor” to replace them.`);
        }
        if (conflict.length) {
          await replaceActiveSupervisors(connection, existing[0].departmentId, id, req.user.id);
          replacedSupervisor = true;
        }
      }
    }
    await connection.execute('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await writeAudit(connection, req.user.id, active ? 'user_activated' : 'user_deactivated', 'user', String(id), {
      email: existing[0].email, replacedSupervisor
    });
    await connection.commit();
    return res.json({ id, active, replacedSupervisor });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.delete('/users/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid user identifier.');
  if (Number(req.user.id) === id) return badRequest(res, 'You cannot delete your own account.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, email, role, active FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }
    if (existing[0].role === 'admin' && existing[0].active && await activeAdminCount(connection) <= 1) {
      await connection.rollback();
      return badRequest(res, 'The last active administrator cannot be deleted.');
    }
    // Soft deletion preserves all historical purchase, approval, and audit references.
    await connection.execute('UPDATE users SET active = FALSE WHERE id = ?', [id]);
    await writeAudit(connection, req.user.id, 'user_deleted', 'user', String(id), {
      email: existing[0].email, softDeleted: true
    });
    await connection.commit();
    return res.json({ deleted: true, softDeleted: true });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.post('/users/:id/reset-password', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid user identifier.');
  const supplied = String(req.body.password || '');
  let password = supplied;
  if (password && password.length < 12) return badRequest(res, 'A temporary password must be at least 12 characters.');
  if (!password) password = temporaryPassword();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id, email, role, active FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
    await writeAudit(connection, req.user.id, 'password_reset', 'user', String(id), {
      email: existing[0].email, generated: !supplied
    });
    await connection.commit();
    return res.json({ id, email: existing[0].email, temporaryPassword: supplied ? undefined : password });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.get('/users/:id/activity', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Invalid user identifier.');
  try {
    const [[account]] = await pool.execute(
      'SELECT id, name, email, role, active, created_at AS createdAt FROM users WHERE id = ? LIMIT 1', [id]
    );
    if (!account) return res.status(404).json({ message: 'User not found.' });
    const [activity] = await pool.query(
      `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
        a.details, a.created_at AS createdAt
       FROM audit_logs a
       WHERE a.user_id = ? OR (a.entity_type = 'user' AND a.entity_id = ?)
       ORDER BY a.id DESC LIMIT 100`,
      [id, String(id)]
    );
    return res.json({ account, activity });
  } catch (error) { return next(error); }
});

async function validateBulkUsers(rows, connection) {
  const [departments] = await connection.execute('SELECT id, name FROM departments ORDER BY name');
  const [supervisors] = await connection.execute(
    `SELECT id, name, department_id AS departmentId FROM users
      WHERE role = 'supervisor' AND active = TRUE ORDER BY id`
  );
  const incoming = Array.isArray(rows) ? rows : [];
  if (!incoming.length) return { rows: [], validCount: 0, invalidCount: 0, departments };
  if (incoming.length > MAX_BULK_ROWS) return { tooMany: true, limit: MAX_BULK_ROWS, rows: [], validCount: 0, invalidCount: 0, departments };

  const results = incoming.slice(0, MAX_BULK_ROWS).map((raw, index) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const firstName = text(source.firstName ?? source['First Name'] ?? source['first name'], 80);
    const lastName = text(source.lastName ?? source['Last Name'] ?? source['last name'], 80);
    const name = [firstName, lastName].filter(Boolean).join(' ') || text(source.name, 150);
    const email = text(source.email ?? source.Email, 190).toLowerCase();
    const role = text(source.role ?? source.Role, 40).toLowerCase();
    const departmentName = text(source.department ?? source.Department, 100);
    const phone = text(source.phone ?? source['Phone Number'] ?? source['phone number'] ?? source.phoneNumber, 50);
    const department = departments.find((item) => item.name.toLowerCase() === departmentName.toLowerCase());
    const errors = [];
    if (!name) errors.push('Missing name');
    if (!EMAIL_PATTERN.test(email)) errors.push('Invalid email');
    if (!ROLES.includes(role)) errors.push('Invalid role');
    if (!department) errors.push('Invalid department');
    if (DEPARTMENT_ASSIGNED_ROLES.includes(role) && !department) {
      errors.push('A Supervisor or Requester must have a Department');
    }
    if (role === 'supervisor' && department) {
      const existing = supervisors.find((item) => Number(item.departmentId) === department.id);
      if (existing) errors.push(`Department already has an active Supervisor (${existing.name})`);
    }
    return {
      row: index + 1, name, email, role, phone,
      department: department?.name || departmentName,
      departmentId: department?.id || null,
      valid: errors.length === 0,
      errors
    };
  });

  const seen = new Map();
  for (const result of results) {
    if (!EMAIL_PATTERN.test(result.email)) continue;
    if (seen.has(result.email)) {
      result.valid = false;
      result.errors.push(`Duplicate email in file (row ${seen.get(result.email)})`);
    } else {
      seen.set(result.email, result.row);
    }
  }
  for (const result of results) {
    if (result.valid && await emailTaken(connection, result.email)) {
      result.valid = false;
      result.errors.push('Email already registered');
    }
  }
  const seenSupervisorDepartments = new Set();
  for (const result of results) {
    if (!result.valid || result.role !== 'supervisor' || !result.departmentId) continue;
    if (seenSupervisorDepartments.has(result.departmentId)) {
      result.valid = false;
      result.errors.push('Multiple Supervisors for the same Department in this file');
    } else {
      seenSupervisorDepartments.add(result.departmentId);
    }
  }
  return {
    rows: results,
    validCount: results.filter((result) => result.valid).length,
    invalidCount: results.filter((result) => !result.valid).length,
    departments
  };
}

router.post('/users/bulk/validate', async (req, res, next) => {
  try {
    const report = await validateBulkUsers(req.body.users, pool);
    if (report.tooMany) return badRequest(res, `A maximum of ${report.limit} users can be imported at once.`);
    return res.json(report);
  } catch (error) { return next(error); }
});

router.post('/users/bulk', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const report = await validateBulkUsers(req.body.users, connection);
    if (report.tooMany) return badRequest(res, `A maximum of ${report.limit} users can be imported at once.`);
    const valid = report.rows.filter((result) => result.valid);
    const imported = [];
    const failed = report.rows.filter((result) => !result.valid);
    if (valid.length) {
      await connection.beginTransaction();
      for (const record of valid) {
        const password = temporaryPassword();
        const passwordHash = await bcrypt.hash(password, 12);
        const [result] = await connection.execute(
          'INSERT INTO users (department_id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
          [record.departmentId, record.name, record.email, record.phone || null, passwordHash, record.role]
        );
        imported.push({ id: result.insertId, row: record.row, name: record.name, email: record.email, temporaryPassword: password });
        await writeAudit(connection, req.user.id, 'user_imported', 'user', String(result.insertId), {
          email: record.email, role: record.role, departmentId: record.departmentId
        });
      }
      await writeAudit(connection, req.user.id, 'bulk_import_completed', 'user', 'bulk', {
        imported: imported.length, failed: failed.length
      });
      await connection.commit();
    }
    return res.json({ total: report.rows.length, imported, failed });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    return next(error);
  } finally { connection.release(); }
});

export default router;

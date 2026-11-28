import { useEffect, useRef, useState } from 'react';
import {
  Building2, Camera, CheckCircle2, ImagePlus, KeyRound, Loader2, Mail, Pencil,
  Phone, ShieldCheck, Trash2, UserRound, X, XCircle
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import UserAvatar from '../ui/UserAvatar.jsx';
import { api } from '../../services/api.js';
import { dateTimeLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';
import {
  KeyValue, PageHeader, PortalBadge, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 512;

function readableSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectImageType(bytes) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46)
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadImageElement(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The selected image could not be opened.'));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Validate the real bytes, then produce a square, re-encoded avatar before
// upload. The backend repeats every check; this keeps the request small and
// gives immediate, specific feedback in the browser.
async function prepareImage(file) {
  if (!file) throw new Error('Choose an image first.');
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG and WebP images are supported.');
  }
  if (file.size === 0) throw new Error('The selected image is empty.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Profile photos must be 5 MB or smaller.');

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = detectImageType(header);
  if (!detected || detected !== file.type) {
    throw new Error('The file does not appear to be a valid image.');
  }

  const image = await loadImageElement(file);
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) throw new Error('The selected image is corrupt.');
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the image.');
  const side = Math.min(width, height);
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  image.close?.();
  let blob = await canvasToBlob(canvas, 'image/webp', 0.86);
  if (!blob) blob = await canvasToBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('The image could not be prepared for upload.');
  return new File([blob], `profile.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function Notice({ message }) {
  if (!message) return null;
  const error = message.tone === 'error';
  return <p role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${error ? 'border-brand bg-white text-black' : 'border-brand bg-white text-black'}`}>
    {error ? <XCircle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
    {message.text}
  </p>;
}

export default function PortalProfile({ user, summary, portal, onUpdated, inModal = false }) {
  const [profile, setProfile] = useState(user || null);
  const [selected, setSelected] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({ name: user?.name || '', phone: user?.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const inputRef = useRef(null);
  const previewRef = useRef('');

  useEffect(() => {
    let active = true;
    api('/profile')
      .then((result) => {
        if (!active || !result.user) return;
        setProfile(result.user);
        setDetails({ name: result.user.name || '', phone: result.user.phone || '' });
        onUpdated?.(result.user);
      })
      .catch(() => { /* The session's own user record remains usable. */ });
    return () => { active = false; };
  }, [onUpdated]);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function applyUser(nextUser, text) {
    if (nextUser) {
      setProfile((current) => ({ ...(current || {}), ...nextUser }));
      onUpdated?.(nextUser);
      window.dispatchEvent(new CustomEvent('pims:profile-photo-updated', { detail: { userId: nextUser.id } }));
    }
    setNotice({ tone: 'success', text });
  }

  function clearSelection() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    setPreviewUrl('');
    setSelected(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setNotice(null);
    if (!file) return;
    try {
      const prepared = await prepareImage(file);
      clearSelection();
      const url = URL.createObjectURL(prepared);
      previewRef.current = url;
      setPreviewUrl(url);
      setSelected(prepared);
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    }
  }

  async function savePhoto() {
    if (!selected) return;
    setBusy('photo');
    setNotice(null);
    try {
      const data = await fileToDataUrl(selected);
      const result = await api('/profile/photo', {
        method: 'POST',
        body: JSON.stringify({ photo: { data, mimeType: selected.type } })
      });
      clearSelection();
      applyUser(result.user, result.message || 'Profile photo saved successfully.');
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  async function removePhoto() {
    setBusy('remove');
    setNotice(null);
    try {
      const result = await api('/profile/photo', { method: 'DELETE' });
      clearSelection();
      applyUser(result.user, result.message || 'Profile photo removed successfully.');
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    setBusy('details');
    setNotice(null);
    try {
      const result = await api('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: details.name, phone: details.phone })
      });
      applyUser(result.user, result.message || 'Personal details saved.');
      setEditingDetails(false);
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setNotice(null);
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setNotice({ tone: 'error', text: 'The new passwords do not match.' });
      return;
    }
    setBusy('password');
    try {
      const result = await api('/profile/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice({ tone: 'success', text: result.message || 'Password changed successfully.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  const department = summary?.department || {};
  const hasPhoto = Boolean(profile?.profilePhoto);
  const role = profile?.roleLabel || roleLabel(profile?.role);

  return <>
    {!inModal && <PageHeader
      eyebrow="Account"
      title="My profile"
      description="Manage your personal details, profile photo and account security. Protected role and access settings remain with an Administrator."
    />}

    <div className="space-y-5">
      <Notice message={notice} />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <PageCard title="Profile photo">
          <div className="flex flex-col items-center p-5 text-center">
            <UserAvatar
              user={profile}
              size="h-28 w-28"
              textSize="text-3xl"
              className="border border-brand shadow-sm"
              fallbackClassName="bg-white text-black"
            />
            <h3 className="display-font mt-4 text-lg font-extrabold">{profile?.name || 'User'}</h3>
            <p className="mt-1 text-xs text-black">{role}</p>
            <p className="mt-0.5 truncate text-[11px] text-black">{profile?.email || '—'}</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <PortalBadge tone={profile?.active === false ? 'amber' : 'indigo'}>
                {profile?.active === false ? 'Inactive' : 'Active'}
              </PortalBadge>
              {profile?.department || department.name
                ? <span className="text-[11px] text-black">{profile?.department || department.name}</span>
                : null}
            </div>

            <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              onChange={choosePhoto} className="hidden" aria-label="Select profile photo" />
            <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}
                className={primaryButtonClass()}>
                {hasPhoto ? <Camera size={14} /> : <ImagePlus size={14} />}
                {hasPhoto ? 'Change Photo' : 'Upload Photo'}
              </button>
              <button type="button" onClick={removePhoto} disabled={!hasPhoto || Boolean(busy)}
                className={secondaryButtonClass()}>
                <Trash2 size={14} />Remove Photo
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-black">JPG, PNG or WebP · Maximum 5 MB · Square crop at 512 × 512</p>

            {busy === 'photo' && <div className="mt-4 w-full" role="status">
              <div className="mb-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-black">
                <Loader2 size={12} className="animate-spin" />Uploading…
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full border border-brand bg-white">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-reference" />
              </div>
            </div>}
            {busy === 'remove' && <p role="status" className="mt-4 flex items-center gap-1.5 text-[11px] text-black"><Loader2 size={12} className="animate-spin" />Removing photo…</p>}

            {selected && <div className="mt-5 w-full rounded-xl border border-brand bg-white p-3">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-black">Preview</div>
              <img src={previewUrl} alt="Selected profile photo preview" className="mx-auto mt-3 h-28 w-28 rounded-full border border-brand object-cover" />
              <p className="mt-2 truncate text-[11px] font-semibold">{selected.name} · {readableSize(selected.size)}</p>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" onClick={savePhoto} disabled={Boolean(busy)} className={primaryButtonClass()}>
                  {busy === 'photo' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Save Photo
                </button>
                <button type="button" onClick={clearSelection} disabled={Boolean(busy)} className={secondaryButtonClass()}>
                  <X size={14} />Cancel
                </button>
              </div>
            </div>}
          </div>
        </PageCard>

        <div className="space-y-5">
          <PageCard title="Personal information" description="Only your name and phone number can be changed here."
            action={!editingDetails && <button type="button" onClick={() => setEditingDetails(true)} className={secondaryButtonClass()}>
              <Pencil size={13} />Edit details
            </button>}>
            {editingDetails ? <form onSubmit={saveDetails} className="space-y-4 p-5">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-black">Full name</span>
                <input value={details.name} onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))}
                  maxLength={150} required className="field" />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-black">Phone number</span>
                <input value={details.phone} onChange={(event) => setDetails((current) => ({ ...current, phone: event.target.value }))}
                  maxLength={50} placeholder="—" className="field" />
              </label>
              <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                <button type="button" onClick={() => {
                  setEditingDetails(false);
                  setDetails({ name: profile?.name || '', phone: profile?.phone || '' });
                }} className={secondaryButtonClass()}>Cancel</button>
                <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass()}>
                  {busy === 'details' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Save changes
                </button>
              </div>
            </form> : <dl className="grid gap-5 p-5 sm:grid-cols-2">
              <KeyValue label="Full name">{profile?.name || '—'}</KeyValue>
              <KeyValue label="Username">{profile?.username || '—'}</KeyValue>
              <KeyValue label="Email address"><span className="flex items-center gap-1.5"><Mail size={12} className="text-black" />{profile?.email || '—'}</span></KeyValue>
              <KeyValue label="Phone number"><span className="flex items-center gap-1.5"><Phone size={12} className="text-black" />{profile?.phone || '—'}</span></KeyValue>
              <KeyValue label="Role">{role}</KeyValue>
              <KeyValue label="Department"><span className="flex items-center gap-1.5"><Building2 size={12} className="text-black" />{profile?.department || department.name || '—'}</span></KeyValue>
              <KeyValue label="Account status">
                <PortalBadge tone={profile?.active === false ? 'amber' : 'indigo'}>{profile?.active === false ? 'Inactive' : 'Active'}</PortalBadge>
              </KeyValue>
            </dl>}
          </PageCard>

          <PageCard title="Account information">
            <dl className="grid gap-5 p-5 sm:grid-cols-2">
              <KeyValue label="Account created">{profile?.createdAt ? dateTimeLabel(profile.createdAt) : 'Not available'}</KeyValue>
              <KeyValue label="Last login">{profile?.lastLoginAt ? dateTimeLabel(profile.lastLoginAt) : 'Not available'}</KeyValue>
              <KeyValue label="Account ID">{profile?.id ?? '—'}</KeyValue>
              <KeyValue label="Account status">{profile?.active === false ? 'Inactive' : 'Active'}</KeyValue>
            </dl>
          </PageCard>

          <PageCard title="Security" description="Change your password without displaying any credential or hash.">
            <form onSubmit={changePassword} className="grid gap-4 p-5 sm:grid-cols-3">
              <label className="block sm:col-span-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-black">Current password</span>
                <input type="password" autoComplete="current-password" value={passwordForm.currentPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                  required className="field" />
              </label>
              <label className="block sm:col-span-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-black">New password</span>
                <input type="password" autoComplete="new-password" minLength={12} value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                  required className="field" />
              </label>
              <label className="block sm:col-span-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-black">Confirm new password</span>
                <input type="password" autoComplete="new-password" minLength={12} value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                  required className="field" />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4 sm:col-span-3">
                <span className="flex items-start gap-2 text-[11px] leading-4 text-black">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  Use at least 12 characters. Your role, permissions and administrative privileges are not changed here.
                </span>
                <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass()}>
                  {busy === 'password' ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                  Change Password
                </button>
              </div>
            </form>
          </PageCard>

          <div className="flex items-start gap-3 rounded-xl border border-brand bg-white p-5 text-xs leading-5 text-black">
            <UserRound size={18} className="mt-0.5 shrink-0" />
            <p>Your access is determined by your assigned role and Department. Contact an Administrator if any protected detail needs correction.</p>
          </div>
        </div>
      </div>
    </div>
  </>;
}

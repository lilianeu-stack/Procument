import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { apiBlob } from '../../services/api.js';

export function initialsFor(name) {
  const initials = String(name || '')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || null;
}

// One avatar presentation for sidebars, headers, account menus, messages and
// the Profile page. Photos are fetched through the authenticated API and shown
// with a stable square crop; no private file path is ever placed in the DOM.
export default function UserAvatar({
  user, userId, name, className = '', imageClassName = '',
  size = 'h-10 w-10', textSize = 'text-xs', rounded = 'rounded-full',
  fallbackClassName = 'bg-white text-black'
}) {
  const id = Number(user?.id ?? userId) || null;
  const displayName = name || user?.name || '';
  const [photoUrl, setPhotoUrl] = useState('');
  const urlRef = useRef('');

  useEffect(() => {
    if (!id) {
      setPhotoUrl('');
      return undefined;
    }
    let active = true;
    let requestVersion = 0;
    const release = () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
    };
    const load = async () => {
      const version = ++requestVersion;
      try {
        // A changing query and no-store ensure replacements/removals are never
        // hidden by a cached response from an earlier photo.
        const blob = await apiBlob(`/profile/photo/${id}?v=${Date.now()}`, { cache: 'no-store' });
        if (!active || version !== requestVersion) return;
        release();
        urlRef.current = URL.createObjectURL(blob);
        setPhotoUrl(urlRef.current);
      } catch {
        if (active && version === requestVersion) {
          release();
          setPhotoUrl('');
        }
      }
    };
    const refresh = (event) => {
      if (!event.detail?.userId || Number(event.detail.userId) === id) void load();
    };
    void load();
    window.addEventListener('pims:profile-photo-updated', refresh);
    return () => {
      active = false;
      requestVersion += 1;
      release();
      window.removeEventListener('pims:profile-photo-updated', refresh);
    };
  }, [id]);

  const initials = initialsFor(displayName);
  return <span className={`relative grid shrink-0 place-items-center overflow-hidden ${rounded} ${size} ${fallbackClassName} ${className}`}>
    {photoUrl
      ? <img src={photoUrl} alt="" className={`h-full w-full object-cover ${imageClassName}`} />
      : initials
        ? <span className={`font-extrabold ${textSize}`}>{initials}</span>
        : <UserRound size={Math.max(14, Math.round(parseFloat(size.match(/h-(\d+)/)?.[1] || 10) * 0.45))} aria-hidden="true" />}
  </span>;
}

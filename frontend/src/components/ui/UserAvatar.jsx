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
// The photo marker comes from the authenticated user or the message/contact
// record, so accounts without a photo render initials without a 404 request.
export default function UserAvatar({
  user, userId, name, photo, className = '', imageClassName = '',
  size = 'h-10 w-10', textSize = 'text-xs', rounded = 'rounded-full',
  fallbackClassName = 'bg-white text-black'
}) {
  const id = Number(user?.id ?? userId) || null;
  const displayName = name || user?.name || '';
  const photoMarker = photo === undefined ? user?.profilePhoto : photo;
  const hasPhoto = Boolean(photoMarker);
  const [photoUrl, setPhotoUrl] = useState('');
  const urlRef = useRef('');

  useEffect(() => {
    const release = () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
    };

    if (!id || !hasPhoto) {
      release();
      setPhotoUrl('');
      return undefined;
    }

    let active = true;
    const version = encodeURIComponent(String(photoMarker || ''));
    void (async () => {
      try {
        const blob = await apiBlob(`/profile/photo/${id}?v=${version}`, { cache: 'no-store' });
        if (!active) return;
        release();
        urlRef.current = URL.createObjectURL(blob);
        setPhotoUrl(urlRef.current);
      } catch {
        if (!active) return;
        release();
        setPhotoUrl('');
      }
    })();

    return () => {
      active = false;
      release();
    };
  }, [id, hasPhoto, photoMarker]);

  const initials = initialsFor(displayName);
  return <span className={`relative grid shrink-0 place-items-center overflow-hidden ${rounded} ${size} ${fallbackClassName} ${className}`}>
    {photoUrl
      ? <img src={photoUrl} alt="" className={`h-full w-full object-cover ${imageClassName}`} />
      : initials
        ? <span className={`font-extrabold ${textSize}`}>{initials}</span>
        : <UserRound size={Math.max(14, Math.round(parseFloat(size.match(/h-(\d+)/)?.[1] || 10) * 0.45))} aria-hidden="true" />}
  </span>;
}

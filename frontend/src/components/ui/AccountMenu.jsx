import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { roleLabel } from '../../utils/access.js';
import UserAvatar from './UserAvatar.jsx';

// One account control for every authenticated shell. The trigger only opens
// this menu; profile navigation and logout happen exclusively through the
// explicit actions below, so a photo/name click can never sign a user out.
export default function AccountMenu({ user, onProfile, onLogout }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  const name = user?.name || 'Account';
  const email = user?.email || '';
  const role = user?.roleLabel || roleLabel(user?.role);
  const department = user?.department || user?.departmentName || '';

  useEffect(() => {
    if (!open) return undefined;
    const closeWhenOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('click', closeWhenOutside);
    document.addEventListener('focusin', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('click', closeWhenOutside);
      document.removeEventListener('focusin', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    setOpen(false);
    try {
      await Promise.resolve(onLogout());
    } catch {
      setOpen(true);
    } finally {
      setSigningOut(false);
    }
  }

  return <div className="relative" ref={rootRef}>
    <button type="button" onClick={() => setOpen((value) => !value)}
      aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      className="flex items-center gap-2 rounded-lg border border-transparent bg-white px-1.5 py-1 text-left transition-colors hover:border-brand hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
      <UserAvatar user={user} size="h-8 w-8" textSize="text-[10px]" className="border border-brand" />
      <span className="hidden min-w-0 text-left sm:block">
        <span className="block max-w-[140px] truncate text-[11px] font-bold leading-tight">{name}</span>
        <span className="block max-w-[140px] truncate text-[9px] uppercase tracking-wide text-muted">{role}</span>
      </span>
      <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>

    {open && <div id={menuId} role="menu" aria-label="Account profile menu"
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-[284px] overflow-hidden rounded-xl border border-strong bg-white shadow-dashboard">
      <div className="border-b border-subtle bg-white px-4 py-3">
        <div className="flex items-start gap-3">
          <UserAvatar user={user} size="h-11 w-11" textSize="text-xs" className="border border-brand" />
          <div className="min-w-0 pt-0.5">
            <div className="truncate text-[13px] font-bold leading-tight" title={name}>{name}</div>
            {email && <div className="mt-1 truncate text-[11px] text-muted" title={email}>{email}</div>}
            <div className="mt-1.5 truncate text-[10px] font-bold uppercase tracking-wide text-muted">{role}</div>
            {department && <div className="truncate text-[11px] text-muted" title={department}>{department}</div>}
          </div>
        </div>
      </div>
      <div className="p-1.5">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onProfile(); }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
          <UserRound size={15} aria-hidden="true" />
          <span>My Profile</span>
        </button>
        <div className="my-1 border-t border-subtle" aria-hidden="true" />
        <button type="button" role="menuitem" disabled={signingOut} onClick={() => void handleLogout()}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:opacity-60">
          <LogOut size={15} aria-hidden="true" />
          <span>{signingOut ? 'Signing out…' : 'Logout'}</span>
        </button>
      </div>
    </div>}
  </div>;
}

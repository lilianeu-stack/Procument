import { useState } from 'react';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu, UserRound } from 'lucide-react';
import { dateLabel } from '../../utils/format.js';
import { PROFILE_PAGE, roleLabel } from '../../utils/access.js';
import UserAvatar from '../ui/UserAvatar.jsx';

const portalStyles = {
  supervisor: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Supervisor Portal' },
  requester: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Requester Portal' },
  stockkeeper: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Stock Keeper Portal' }
};

export default function SharedHeader({
  page, portal, user, notifications = [], open, refreshing,
  onToggle, onNotification, onMenu, onLogout, onProfile
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const style = portalStyles[portal] || portalStyles.supervisor;
  const unread = notifications.filter((notice) => !notice.isRead).length;

  return <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-subtle bg-white px-5 backdrop-blur sm:px-8">
    <div className="flex items-center gap-3">
      <button className="text-muted lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="hidden items-center gap-2 text-[11px] text-muted sm:flex">
        <span className={`rounded-md px-2 py-1 font-bold ${style.badge}`}>{style.label}</span>
        <ChevronRight size={13} />
        <span className="font-bold text-ink">{page}</span>
      </div>
      <span className="font-bold sm:hidden">{page}</span>
      {refreshing && <span className="hidden text-[10px] text-muted md:inline">Refreshing…</span>}
    </div>

    <div className="flex items-center gap-3">
      <div className={`hidden items-center gap-2 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-muted xl:flex`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {roleLabel(user?.role)} · {user?.department || 'No department'}
      </div>
      <div className="relative">
        <button aria-label="Notifications" onClick={onToggle} className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
          <Bell size={17} />
          {unread > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-reference ring-2 ring-white" />}
        </button>
        {open && <div className="absolute right-0 top-11 z-50 w-[320px] rounded-xl border border-strong bg-white p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-bold">Notifications</span>
            <span className="text-[10px] text-muted">{unread} unread</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length ? notifications.map((notice) => (
              <button key={notice.id} onClick={() => onNotification(notice)} className={`mb-1 block w-full rounded-lg p-2 text-left transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus ${notice.isRead ? '' : 'bg-white'}`}>
                <span className="block text-xs font-bold">{notice.title}</span>
                <span className="mt-1 block text-[11px] leading-4 text-muted">{notice.body}</span>
                <span className="mt-1 block text-[9px] text-muted">{dateLabel(notice.createdAt)}</span>
              </button>
            )) : <p className="py-8 text-center text-xs text-muted">You’re all caught up.</p>}
          </div>
        </div>}
      </div>
      <div className="hidden h-7 w-px bg-white sm:block" />
      <div className="relative">
        <button type="button" onClick={() => setAccountOpen((value) => !value)}
          aria-label="Account menu" aria-expanded={accountOpen}
          className="flex items-center gap-2 rounded-lg p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
          <UserAvatar user={user} size="h-8 w-8" textSize="text-[10px]" className="border border-brand" />
          <div className="hidden text-left lg:block">
            <div className="text-[11px] font-bold leading-tight">{user?.name}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted">{roleLabel(user?.role)}</div>
          </div>
          <ChevronDown size={14} className="text-muted" />
        </button>
        {accountOpen && <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-strong bg-white p-2 shadow-dashboard">
          <div className="px-2 py-2">
            <div className="truncate text-xs font-bold">{user?.name}</div>
            <div className="truncate text-[10px] text-muted">{user?.email}</div>
          </div>
          <button type="button" onClick={() => { setAccountOpen(false); onProfile(); }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
            <UserRound size={14} />Profile
          </button>
          <button type="button" onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
            <LogOut size={14} />Sign out
          </button>
        </div>}
      </div>
    </div>
  </header>;
}

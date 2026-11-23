import { Bell, ChevronDown, ChevronRight, LogOut, Menu } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { dateLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';

const portalStyles = {
  supervisor: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  requester: { badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' }
};

export default function SharedHeader({
  page, portal, user, notifications = [], open, refreshing,
  onToggle, onNotification, onMenu, onLogout
}) {
  const style = portalStyles[portal] || portalStyles.supervisor;
  const unread = notifications.filter((notice) => !notice.isRead).length;

  return <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/95 px-5 backdrop-blur sm:px-8">
    <div className="flex items-center gap-3">
      <button className="text-muted lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="hidden items-center gap-2 text-[11px] text-muted sm:flex">
        <BrandLogo variant="topbar" />
        <ChevronRight size={13} />
        <span className={`rounded-md px-2 py-1 font-bold ${style.badge}`}>
          {portal === 'supervisor' ? 'Supervisor Portal' : 'Requester Portal'}
        </span>
        <ChevronRight size={13} />
        <span className="font-bold text-ink">{page}</span>
      </div>
      <span className="font-bold sm:hidden">{page}</span>
      {refreshing && <span className="hidden text-[10px] text-muted md:inline">Refreshing…</span>}
    </div>

    <div className="flex items-center gap-3">
      <div className={`hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-semibold text-muted xl:flex`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {roleLabel(user?.role)} · {user?.department || 'No department'}
      </div>
      <div className="relative">
        <button aria-label="Notifications" onClick={onToggle} className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-slate-100">
          <Bell size={17} />
          {unread > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-white" />}
        </button>
        {open && <div className="absolute right-0 top-11 z-50 w-[320px] rounded-xl border border-slate-100 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-bold">Notifications</span>
            <span className="text-[10px] text-muted">{unread} unread</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length ? notifications.map((notice) => (
              <button key={notice.id} onClick={() => onNotification(notice)} className={`mb-1 block w-full rounded-lg p-2 text-left ${notice.isRead ? 'hover:bg-slate-50' : 'bg-brand-light/50 hover:bg-brand-light'}`}>
                <span className="block text-xs font-bold">{notice.title}</span>
                <span className="mt-1 block text-[11px] leading-4 text-muted">{notice.body}</span>
                <span className="mt-1 block text-[9px] text-muted">{dateLabel(notice.createdAt)}</span>
              </button>
            )) : <p className="py-8 text-center text-xs text-muted">You’re all caught up.</p>}
          </div>
        </div>}
      </div>
      <div className="hidden h-7 w-px bg-slate-200 sm:block" />
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[10px] font-extrabold text-ink">{user?.initials || 'HH'}</span>
        <div className="hidden text-left lg:block">
          <div className="text-[11px] font-bold leading-tight">{user?.name}</div>
          <div className="text-[9px] uppercase tracking-wide text-muted">{roleLabel(user?.role)}</div>
        </div>
        <ChevronDown size={14} className="text-muted" />
        <button onClick={onLogout} aria-label="Sign out" title="Sign out" className="ml-1 text-muted hover:text-rose-600"><LogOut size={15} /></button>
      </div>
    </div>
  </header>;
}

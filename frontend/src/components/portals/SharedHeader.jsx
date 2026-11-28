import { ChevronRight, Menu } from 'lucide-react';
import { roleLabel } from '../../utils/access.js';
import AccountMenu from '../ui/AccountMenu.jsx';
import NotificationCenter from '../../notifications/NotificationCenter.jsx';

const portalStyles = {
  supervisor: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Supervisor Portal' },
  requester: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Requester Portal' },
  stockkeeper: { badge: 'bg-white text-black', dot: 'bg-reference', label: 'Stock Keeper Portal' }
};

export default function SharedHeader({
  page, portal, user, notifications = [], counts = {}, open, refreshing, busy,
  onToggle, onNotification, onMenu, onLogout, onProfile,
  onMarkNotificationRead, onMarkAllNotificationsRead, onDeleteNotification, onViewAllNotifications
}) {
  const style = portalStyles[portal] || portalStyles.supervisor;

  return <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-subtle bg-white px-5 backdrop-blur sm:px-8">
    <div className="flex items-center gap-3">
      <button className="text-black lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="hidden items-center gap-2 text-[11px] text-black sm:flex">
        <span className={`rounded-md px-2 py-1 font-bold ${style.badge}`}>{style.label}</span>
        <ChevronRight size={13} />
        <span className="font-bold text-black">{page}</span>
      </div>
      <span className="font-bold sm:hidden">{page}</span>
      {refreshing && <span className="hidden text-[10px] text-black md:inline">Refreshing…</span>}
    </div>

    <div className="flex items-center gap-3">
      <div className={`hidden items-center gap-2 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-black xl:flex`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {roleLabel(user?.role)} · {user?.department || 'No department'}
      </div>
      <NotificationCenter
        open={open}
        onToggle={onToggle}
        notifications={notifications}
        counts={counts}
        busy={Boolean(busy || refreshing)}
        onNotification={onNotification}
        onMarkRead={onMarkNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
        onDelete={onDeleteNotification}
        onViewAll={onViewAllNotifications}
      />
      <div className="hidden h-7 w-px bg-white sm:block" />
      <AccountMenu user={user} onProfile={onProfile} onLogout={onLogout} />
    </div>
  </header>;
}

import { Menu } from 'lucide-react';
import AccountMenu from '../ui/AccountMenu.jsx';
import NotificationCenter from '../../notifications/NotificationCenter.jsx';

export default function Topbar({
  page, user, notifications = [], counts = {}, onToggle, onNotification, onMenu, onLogout, onProfile, open,
  onMarkNotificationRead, onMarkAllNotificationsRead, onDeleteNotification, onViewAllNotifications, busy
}) {
  return <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-subtle bg-white px-5 backdrop-blur sm:px-8">
    <div className="flex items-center gap-3">
      <button className="text-black lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="hidden items-center gap-2 text-[11px] text-black sm:flex">
        <span className="font-bold text-black">{page}</span>
      </div>
      <span className="font-bold sm:hidden">{page}</span>
    </div>
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-black sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-success" />All systems normal</div>
      <NotificationCenter
        open={open}
        onToggle={onToggle}
        notifications={notifications}
        counts={counts}
        busy={busy}
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

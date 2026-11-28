import { useState } from 'react';
import SharedHeader from './SharedHeader.jsx';
import { PROFILE_PAGE } from '../../utils/access.js';
import { formatDate } from '../../utils/format.js';

export default function PortalLayout({
  sidebar: Sidebar, portal, user, page, counts = {}, notifications,
  mobileNav, notificationsOpen, refreshing, hidePageHeading = false,
  onNavigate, onNotification, onToggleNotifications,
  onMarkNotificationRead, onMarkAllNotificationsRead, onDeleteNotification, onViewAllNotifications,
  notificationBusy, onOpenMenu, onCloseMenu, onLogout, children
}) {
  const [collapsed, setCollapsed] = useState(false);

  return <div className="min-h-screen bg-canvas">
    <Sidebar
      page={page}
      counts={counts}
      open={mobileNav}
      collapsed={collapsed}
      onNavigate={onNavigate}
      onClose={onCloseMenu}
      onToggleCollapse={() => setCollapsed((value) => !value)}
    />
    <main className={`min-h-screen ${collapsed ? 'lg:pl-20' : 'lg:pl-[248px]'}`}>
      <SharedHeader
        page={page}
        portal={portal}
        user={user}
        notifications={notifications}
        counts={counts}
        open={notificationsOpen}
        refreshing={refreshing}
        busy={notificationBusy}
        onToggle={onToggleNotifications}
        onNotification={onNotification}
        onMarkNotificationRead={onMarkNotificationRead}
        onMarkAllNotificationsRead={onMarkAllNotificationsRead}
        onDeleteNotification={onDeleteNotification}
        onViewAllNotifications={onViewAllNotifications}
        onMenu={onOpenMenu}
        onLogout={onLogout}
        onProfile={() => onNavigate(PROFILE_PAGE)}
      />
      <div className="w-full max-w-none px-5 pb-10 pt-7 sm:px-8">
        {!hidePageHeading && <div className="mb-6">
          <div className="mb-1 text-[11px] font-semibold text-black">
            {formatDate(new Date())}
          </div>
          <h1 className="display-font text-[25px] font-extrabold tracking-tight">{page}</h1>
        </div>}
        {children}
      </div>
    </main>
  </div>;
}

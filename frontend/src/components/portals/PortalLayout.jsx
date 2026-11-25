import { useState } from 'react';
import SharedHeader from './SharedHeader.jsx';
import { PROFILE_PAGE } from '../../utils/access.js';
import { formatDate } from '../../utils/format.js';

export default function PortalLayout({
  sidebar: Sidebar, portal, user, page, notifications,
  mobileNav, notificationsOpen, refreshing, hidePageHeading = false,
  onNavigate, onNotification, onToggleNotifications,
  onOpenMenu, onCloseMenu, onLogout, children
}) {
  const [collapsed, setCollapsed] = useState(false);

  return <div className="min-h-screen bg-canvas">
    <Sidebar
      page={page}
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
        open={notificationsOpen}
        refreshing={refreshing}
        onToggle={onToggleNotifications}
        onNotification={onNotification}
        onMenu={onOpenMenu}
        onLogout={onLogout}
        onProfile={() => onNavigate(PROFILE_PAGE)}
      />
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-7 sm:px-8">
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

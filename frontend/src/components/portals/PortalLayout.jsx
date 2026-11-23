import { useState } from 'react';
import SharedHeader from './SharedHeader.jsx';
import { roleLabel } from '../../utils/access.js';

export default function PortalLayout({
  sidebar: Sidebar, portal, user, page, summary, notifications,
  mobileNav, notificationsOpen, refreshing,
  onNavigate, onNotification, onToggleNotifications,
  onOpenMenu, onCloseMenu, onLogout, children
}) {
  const [collapsed, setCollapsed] = useState(false);
  const departmentName = summary?.department?.name || user?.department || 'No Department assigned';

  return <div className="min-h-screen bg-canvas">
    <Sidebar
      user={user}
      page={page}
      open={mobileNav}
      collapsed={collapsed}
      onNavigate={onNavigate}
      onClose={onCloseMenu}
      onToggleCollapse={() => setCollapsed((value) => !value)}
      onLogout={onLogout}
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
      />
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-7 sm:px-8">
        <div className="mb-6">
          <div className="mb-1 text-[11px] font-semibold text-brand">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 className="display-font text-[25px] font-extrabold tracking-tight">{page}</h1>
          <p className="mt-1 text-xs text-muted">
            {roleLabel(user?.role)} · {departmentName}
          </p>
        </div>
        {children}
      </div>
    </main>
  </div>;
}

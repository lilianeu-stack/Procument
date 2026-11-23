import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function AppLayout({ user, page, notifications, mobileNav, notificationsOpen, portalLabel = 'Administrator Portal', onNavigate, onNotification, onToggleNotifications, onOpenMenu, onCloseMenu, onLogout, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return <div className="min-h-screen bg-canvas">
    <Sidebar user={user} page={page} open={mobileNav} collapsed={sidebarCollapsed}
      onNavigate={onNavigate} onClose={onCloseMenu} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} onLogout={onLogout} />
    <main className={`min-h-screen ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-[248px]'}`}>
      <Topbar page={page} user={user} notifications={notifications} open={notificationsOpen} onToggle={onToggleNotifications} onMenu={onOpenMenu} onNotification={onNotification} onLogout={onLogout} />
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-7 sm:px-8">
        <div className="mb-6">
          <div className="mb-2 w-fit rounded-full bg-brand-light px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.14em] text-brand">{portalLabel}</div>
          <div className="mb-1 text-[11px] font-semibold text-brand">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="display-font text-[25px] font-extrabold tracking-tight">{page === 'Overview' ? `Good morning, ${user.name.split(' ')[0]}` : page === 'Users' ? 'Users Management' : page}</h1>
          <p className="mt-1 text-xs text-muted">{page === 'Overview' ? 'Here’s what’s happening across your organization.' : 'Manage and track your organization’s procurement activity.'}</p>
        </div>
        {children}
      </div>
    </main>
  </div>;
}

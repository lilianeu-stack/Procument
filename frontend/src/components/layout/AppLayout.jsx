import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import { PROFILE_PAGE, RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';
import { DISPLAY_TIMEZONE } from '../../utils/dates.js';

const overviewDate = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export default function AppLayout({ user, page, counts = {}, notifications, mobileNav, notificationsOpen, refreshing, portalLabel = 'Administrator Portal', onNavigate, onNotification, onToggleNotifications, onOpenMenu, onCloseMenu, onLogout, onRefresh, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isOverview = page === 'Overview';

  return <div className="min-h-screen bg-canvas">
    <Sidebar user={user} page={page} counts={counts} open={mobileNav} collapsed={sidebarCollapsed}
      onNavigate={onNavigate} onClose={onCloseMenu} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} />
    <main className={`min-h-screen ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-[248px]'}`}>
      <Topbar page={page} user={user} notifications={notifications} open={notificationsOpen} onToggle={onToggleNotifications} onMenu={onOpenMenu} onNotification={onNotification} onLogout={onLogout} onProfile={() => onNavigate(PROFILE_PAGE)} />
      <div className="w-full max-w-none px-5 pb-10 pt-7 sm:px-8">
        {page !== RECEIVED_REQUESTS_PAGE && page !== 'RFQs' && (isOverview ? <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-[.14em] text-black">
              <span>{portalLabel}</span><span aria-hidden="true" className="text-black">·</span>
              <time dateTime={new Date().toISOString()}>{overviewDate.format(new Date())}</time>
            </div>
            <h1 className="display-font text-[30px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[34px]">Overview</h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-black">Monitor requests, purchase orders, suppliers, and stock at a glance.</p>
          </div>
          {onRefresh && <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-brand bg-white px-4 py-2.5 text-xs font-bold text-black transition hover:bg-accent-tint hover:border-accent-border hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>}
        </header> : <div className="mb-6">
          <div className="mb-2 w-fit rounded-full bg-white px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.14em] text-black">{portalLabel}</div>
          <h1 className="display-font text-[25px] font-extrabold tracking-tight">{page === 'Users' ? 'Users Management' : page}</h1>
          <p className="mt-1 text-xs text-black">{page === 'Goods receipts'
            ? 'Review deliveries received against purchase orders and direct stock sources.'
            : page === 'Invoices'
              ? 'Review supplier invoices against purchase orders, received goods, and payment status.'
              : page === 'Suppliers'
                ? 'Manage supplier contacts, ratings, and approval status.'
                : page === 'Stock overview'
                  ? 'Monitor stock on hand, reorder thresholds, and item costs.'
                    : page === 'Stock movements'
                      ? 'Review recorded receipts, issues, and inventory balance changes.'
                      : page === 'Store requests'
                        ? 'Submit internal stock requests and track their approval and issue status.'
                          : page === 'Users'
                            ? 'Manage accounts, departments, and access across the organization.'
                              : page === PROFILE_PAGE
                                ? 'Manage your personal details, photo, and account security.'
              : 'Manage and track your organization’s procurement activity.'}</p>
        </div>)}
        {children}
      </div>
    </main>
  </div>;
}

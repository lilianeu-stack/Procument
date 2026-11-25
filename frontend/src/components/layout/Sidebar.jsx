import {
  Activity, ArrowDownToLine, Boxes, BriefcaseBusiness, ChevronLeft, ChevronRight,
  FileText, Inbox, LayoutDashboard, LogOut, Settings, ShoppingCart, Truck, Users
} from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { canAccessPage, PURCHASE_ORDERS_PAGE, RECEIVED_REQUESTS_PAGE, SETTINGS_PAGE } from '../../utils/access.js';

const groups = [
  { section: 'WORKSPACE', links: [
    { name: 'Overview', icon: LayoutDashboard },
    { name: RECEIVED_REQUESTS_PAGE, icon: Inbox },
    { name: 'RFQs', icon: FileText },
    { name: PURCHASE_ORDERS_PAGE, icon: ShoppingCart },
    { name: 'Goods receipts', icon: ArrowDownToLine },
    { name: 'Invoices', icon: BriefcaseBusiness },
    { name: 'Suppliers', icon: Truck }
  ] },
  { section: 'INVENTORY', links: [
    { name: 'Stock overview', icon: Boxes },
    { name: 'Stock movements', icon: Activity },
    { name: 'Store requests', icon: ArrowDownToLine }
  ] },
  { section: 'ADMINISTRATION', links: [
    { name: 'Users', icon: Users },
    { name: SETTINGS_PAGE, icon: Settings }
  ] }
];

export default function Sidebar({ user, page, open, collapsed, onNavigate, onClose, onToggleCollapse, onLogout }) {
  return <>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-brand bg-white pb-4 pt-5 shadow-dashboard transition-transform ${collapsed ? 'px-4 lg:w-20 lg:px-2' : 'px-4'} lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-5 flex items-center border-b border-subtle pb-5 ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
        <BrandLogo light compact={collapsed} />
        <button type="button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus lg:grid">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus lg:hidden" onClick={onClose} aria-label="Close navigation">×</button>
      </div>
      <nav aria-label="Main navigation" className="scrollbar-hide flex-1 space-y-6 overflow-y-auto px-1">
        {groups.map((group) => {
          const links = group.links.filter(({ name }) => canAccessPage(user.role, name));
          if (!links.length) return null;
          return <div key={group.section}>
            <div className={`mb-2 px-3 text-[9px] font-extrabold tracking-[.16em] text-muted ${collapsed ? 'lg:hidden' : ''}`}>{group.section}</div>
            <div className="space-y-1">
              {links.map(({ name, icon: Icon }) => <button key={name} type="button" onClick={() => { onNavigate(name); onClose(); }}
                aria-label={name} aria-current={page === name ? 'page' : undefined} title={collapsed ? name : undefined}
                className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${page === name ? 'bg-reference text-black shadow-sm' : 'text-muted hover:bg-hover hover:text-black'}`}>
                <Icon size={17} strokeWidth={1.8} /><span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{name}</span>
                {page === name && <span className={`h-1.5 w-1.5 rounded-full bg-success ${collapsed ? 'lg:hidden' : ''}`} aria-hidden="true" />}
              </button>)}
            </div>
          </div>;
        })}
      </nav>
      <div className={`rounded-xl border border-brand bg-hover p-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className="mb-1.5 flex items-center gap-2 text-[9px] font-extrabold tracking-[.12em] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-success" />SYSTEM STATUS</div>
        <div className="text-[11px] font-semibold text-black">All systems operational</div>
      </div>
      <div className={`mt-4 flex items-center gap-3 border-t border-subtle px-1 pt-4 ${collapsed ? 'lg:flex-col lg:gap-2 lg:px-0' : ''}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-reference text-xs font-extrabold text-black">{user.initials}</div>
        <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="truncate text-xs font-bold text-black">{user.name}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted">{user.roleLabel || user.role} · {user.department || 'Hope Haven'}</div>
        </div>
        <button type="button" onClick={onLogout} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus" title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
    {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-black/20 lg:hidden" />}
  </>;
}

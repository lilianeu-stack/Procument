import {
  Activity, ArrowDownToLine, Boxes, BriefcaseBusiness, ChevronLeft, ChevronRight,
  FileText, Inbox, LayoutDashboard, LogOut, Settings, Truck, Users
} from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { canAccessPage, RECEIVED_REQUESTS_PAGE, SETTINGS_PAGE } from '../../utils/access.js';

const groups = [
  { section: 'WORKSPACE', links: [
    { name: 'Overview', icon: LayoutDashboard },
    { name: RECEIVED_REQUESTS_PAGE, icon: Inbox },
    { name: 'RFQs', icon: FileText },
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
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[#172a39] pb-4 pt-6 transition-transform ${collapsed ? 'px-4 lg:w-20 lg:px-2' : 'px-4'} lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-9 flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
        <BrandLogo light compact={collapsed} />
        <button type="button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white lg:grid">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button className="text-slate-400 lg:hidden" onClick={onClose} aria-label="Close navigation">×</button>
      </div>
      <nav className="scrollbar-hide flex-1 space-y-7 overflow-y-auto">
        {groups.map((group) => {
          const links = group.links.filter(({ name }) => canAccessPage(user.role, name));
          if (!links.length) return null;
          return <div key={group.section}>
            <div className={`mb-2 px-3 text-[9px] font-extrabold tracking-[.18em] text-slate-500 ${collapsed ? 'lg:hidden' : ''}`}>{group.section}</div>
            <div className="space-y-1">
              {links.map(({ name, icon: Icon }) => <button key={name} onClick={() => { onNavigate(name); onClose(); }}
                aria-label={name} title={collapsed ? name : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${page === name ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
                <Icon size={16} strokeWidth={1.8} /><span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{name}</span>
              </button>)}
            </div>
          </div>;
        })}
        <div>
          <div className={`mb-2 px-3 text-[9px] font-extrabold tracking-[.18em] text-slate-500 ${collapsed ? 'lg:hidden' : ''}`}>HELP</div>
          <button aria-label="Help" title={collapsed ? 'Help' : undefined} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold text-slate-400 hover:bg-white/5 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <FileText size={16} /><span className={collapsed ? 'lg:hidden' : ''}>Help</span>
          </button>
        </div>
      </nav>
      <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />SYSTEM OPERATIONAL</div>
        <div className="text-[10px] text-slate-400">Your workspace is up to date.</div>
      </div>
      <div className={`mt-4 flex items-center gap-3 border-t border-white/10 px-2 pt-4 ${collapsed ? 'lg:flex-col lg:gap-2 lg:px-0' : ''}`}>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-200 text-xs font-extrabold text-[#173b39]">{user.initials}</div>
        <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="truncate text-xs font-bold text-white">{user.name}</div>
          <div className="mt-0.5 truncate text-[10px] capitalize text-slate-400">{user.role} · {user.department || 'Hope Haven'}</div>
        </div>
        <button onClick={onLogout} className="text-slate-400 hover:text-white" title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
    {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" />}
  </>;
}

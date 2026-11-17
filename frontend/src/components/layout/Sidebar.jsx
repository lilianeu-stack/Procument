import {
  Activity, ArrowDownToLine, Boxes, BriefcaseBusiness, ClipboardCheck,
  ClipboardList, FileText, LayoutDashboard, LogOut, ScrollText, Settings,
  ShoppingCart, Truck, Users
} from 'lucide-react';
import { canAccessPage } from '../../utils/access.js';

const groups = [
  { section: 'WORKSPACE', links: [
    { name: 'Overview', icon: LayoutDashboard },
    { name: 'Requisitions', icon: ClipboardList },
    { name: 'Approvals', icon: ClipboardCheck },
    { name: 'Purchase orders', icon: ShoppingCart },
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
    { name: 'Audit logs', icon: ScrollText }
  ] }
];

function Logo() {
  return <div className="flex items-center gap-3">
    <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><Boxes size={20} /></div>
    <div className="leading-tight">
      <div className="display-font text-[15px] font-extrabold tracking-tight text-white">hope haven</div>
      <div className="mt-1 text-[9px] font-bold tracking-[.19em] text-slate-400">PROCUREMENT & STORES</div>
    </div>
  </div>;
}

export default function Sidebar({ user, page, pendingCount, open, onNavigate, onClose, onLogout }) {
  return <>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[#172a39] px-4 pb-4 pt-6 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-9 flex items-center justify-between px-2">
        <Logo />
        <button className="text-slate-400 lg:hidden" onClick={onClose} aria-label="Close navigation">×</button>
      </div>
      <nav className="scrollbar-hide flex-1 space-y-7 overflow-y-auto">
        {groups.map((group) => {
          const links = group.links.filter(({ name }) => canAccessPage(user.role, name));
          if (!links.length) return null;
          return <div key={group.section}>
            <div className="mb-2 px-3 text-[9px] font-extrabold tracking-[.18em] text-slate-500">{group.section}</div>
            <div className="space-y-1">
              {links.map(({ name, icon: Icon }) => <button key={name} onClick={() => { onNavigate(name); onClose(); }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition ${page === name ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
                <Icon size={16} strokeWidth={1.8} /><span className="flex-1">{name}</span>
                {name === 'Approvals' && pendingCount > 0 && <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">{pendingCount}</span>}
              </button>)}
            </div>
          </div>;
        })}
        <div>
          <div className="mb-2 px-3 text-[9px] font-extrabold tracking-[.18em] text-slate-500">HELP</div>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold text-slate-400 hover:bg-white/5"><Settings size={16} />Settings</button>
        </div>
      </nav>
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />SYSTEM OPERATIONAL</div>
        <div className="text-[10px] text-slate-400">Your workspace is up to date.</div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-200 text-xs font-extrabold text-[#173b39]">{user.initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-white">{user.name}</div>
          <div className="mt-0.5 truncate text-[10px] capitalize text-slate-400">{user.role} · {user.department || 'Hope Haven'}</div>
        </div>
        <button onClick={onLogout} className="text-slate-400 hover:text-white" title="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
    {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" />}
  </>;
}

import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { roleLabel } from '../../utils/access.js';

export default function PortalSidebarFrame({
  accent, portalLabel, groups, user, page, open, collapsed,
  onNavigate, onClose, onToggleCollapse, onLogout
}) {
  return <>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col pb-4 pt-6 transition-transform ${accent.aside} ${collapsed ? 'px-4 lg:w-20 lg:px-2' : 'px-4'} lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-9 flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
        <BrandLogo light compact={collapsed} />
        <button type="button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden h-8 w-8 place-items-center rounded-lg hover:bg-white/10 lg:grid ${accent.mutedText}`}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button className={accent.mutedText} onClick={onClose} aria-label="Close navigation">×</button>
      </div>

      <div className={`mb-4 px-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.14em] ${accent.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
          {portalLabel}
        </div>
      </div>

      <nav className="scrollbar-hide flex-1 space-y-7 overflow-y-auto">
        {groups.map((group) => {
          const links = group.links;
          if (!links.length) return null;
          return <div key={group.section}>
            <div className={`mb-2 px-3 text-[9px] font-extrabold tracking-[.18em] ${accent.sectionText} ${collapsed ? 'lg:hidden' : ''}`}>{group.section}</div>
            <div className="space-y-1">
              {links.map(({ name, label, icon: Icon }) => <button key={name} onClick={() => { onNavigate(name); onClose(); }}
                aria-label={label || name} title={collapsed ? (label || name) : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${page === name ? accent.active : `${accent.mutedText} ${accent.hover}`}`}>
                <Icon size={16} strokeWidth={1.8} />
                <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{label || name}</span>
                {page === name && <span className={`h-1.5 w-1.5 rounded-full ${accent.dot} ${collapsed ? 'lg:hidden' : ''}`} />}
              </button>)}
            </div>
          </div>;
        })}
      </nav>

      <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className={`mb-2 flex items-center gap-2 text-[10px] font-bold ${accent.statusText}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />DEPARTMENT VIEW
        </div>
        <div className={`text-[10px] ${accent.mutedText}`}>Scoped to your assigned Department.</div>
      </div>

      <div className={`mt-4 flex items-center gap-3 border-t border-white/10 px-2 pt-4 ${collapsed ? 'lg:flex-col lg:gap-2 lg:px-0' : ''}`}>
        <span className={`grid h-9 w-9 place-items-center rounded-full text-xs font-extrabold ${accent.profile}`}>
          {user?.initials || 'HH'}
        </span>
        <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="truncate text-xs font-bold text-white">{user?.name || 'User'}</div>
          <div className={`mt-0.5 truncate text-[10px] ${accent.mutedText}`}>{roleLabel(user?.role)} · {user?.department || 'No Department'}</div>
        </div>
        <button onClick={onLogout} className={accent.mutedText || 'text-slate-400 hover:text-white'} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
    {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" />}
  </>;
}

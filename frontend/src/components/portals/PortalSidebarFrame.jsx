import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { roleLabel } from '../../utils/access.js';

export default function PortalSidebarFrame({
  accent, portalLabel, groups, user, page, open, collapsed,
  onNavigate, onClose, onToggleCollapse, onLogout
}) {
  return <>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-brand pb-4 pt-5 shadow-dashboard transition-transform ${accent.aside} ${collapsed ? 'px-4 lg:w-20 lg:px-2' : 'px-4'} lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-5 flex items-center border-b border-subtle pb-5 ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
        <BrandLogo light compact={collapsed} />
        <button type="button" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus lg:grid ${accent.mutedText}`}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button type="button" className={`grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus lg:hidden ${accent.mutedText}`} onClick={onClose} aria-label="Close navigation">×</button>
      </div>

      <div className={`mb-4 px-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[9px] font-extrabold uppercase tracking-[.12em] ${accent.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
          {portalLabel}
        </div>
      </div>

      <nav aria-label="Main navigation" className="scrollbar-hide flex-1 space-y-6 overflow-y-auto px-1">
        {groups.map((group) => {
          const links = group.links;
          if (!links.length) return null;
          return <div key={group.section}>
            <div className={`mb-2 px-3 text-[9px] font-extrabold tracking-[.16em] ${accent.sectionText} ${collapsed ? 'lg:hidden' : ''}`}>{group.section}</div>
            <div className="space-y-1">
              {links.map(({ name, label, icon: Icon }) => <button key={name} onClick={() => { onNavigate(name); onClose(); }}
                type="button" aria-label={label || name} aria-current={page === name ? 'page' : undefined} title={collapsed ? (label || name) : undefined}
                className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${page === name ? accent.active : `${accent.mutedText} ${accent.hover}`}`}>
                <Icon size={17} strokeWidth={1.8} />
                <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{label || name}</span>
                {page === name && <span className={`h-1.5 w-1.5 rounded-full bg-success ${collapsed ? 'lg:hidden' : ''}`} aria-hidden="true" />}
              </button>)}
            </div>
          </div>;
        })}
      </nav>

      <div className={`rounded-xl border border-brand bg-hover p-3 ${collapsed ? 'lg:hidden' : ''}`}>
        <div className={`mb-2 flex items-center gap-2 text-[10px] font-bold ${accent.statusText}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-success" />DEPARTMENT VIEW
        </div>
        <div className={`text-[10px] ${accent.mutedText}`}>Scoped to your assigned Department.</div>
      </div>

      <div className={`mt-4 flex items-center gap-3 border-t border-subtle px-2 pt-4 ${collapsed ? 'lg:flex-col lg:gap-2 lg:px-0' : ''}`}>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${accent.profile}`}>
          {user?.initials || 'HH'}
        </span>
        <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="truncate text-xs font-bold text-black">{user?.name || 'User'}</div>
          <div className={`mt-0.5 truncate text-[10px] ${accent.mutedText}`}>{roleLabel(user?.role)} · {user?.department || 'No Department'}</div>
        </div>
        <button type="button" onClick={onLogout} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus ${accent.mutedText || 'text-black'}`} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
    {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-black/20 lg:hidden" />}
  </>;
}

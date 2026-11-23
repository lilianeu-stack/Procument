import {
  ArrowLeft, Bell, Building2, ClipboardCheck, ClipboardList,
  FilePlus2, History, UserRound, UsersRound
} from 'lucide-react';
import SharedUserProfile from './SharedUserProfile.jsx';
import { dateLabel } from '../../utils/format.js';

const pageMeta = {
  'Department Overview': { icon: Building2, description: 'Department-level procurement overview and reserved metrics.' },
  'My Department': { icon: Building2, description: 'Details and account information for your assigned Department.' },
  Requesters: { icon: UsersRound, description: 'Requesters assigned to your Department.' },
  'Procurement Requests': { icon: ClipboardList, description: 'Procurement requests raised within your Department.' },
  Approvals: { icon: ClipboardCheck, description: 'Department-level approval review area.' },
  'My Procurement Requests': { icon: ClipboardList, description: 'Purchase requests you have submitted.' },
  'Create Purchase Request': { icon: FilePlus2, description: 'The purchase request builder for your Department.' },
  'My Request History': { icon: History, description: 'A history of your submitted procurement requests.' }
};

export default function PortalPlaceholder({ portal, page, user, summary, notifications = [], onNavigate }) {
  const meta = pageMeta[page] || { icon: ClipboardList, description: 'This area is reserved for the next development phase.' };
  const Icon = page === 'Notifications' ? Bell : page === 'My Profile' ? UserRound : meta.icon;
  const department = summary?.department;
  const dashboardPage = portal === 'supervisor' ? 'Supervisor Dashboard' : 'Requester Dashboard';

  return <div className="space-y-5">
    <button onClick={() => onNavigate(dashboardPage)} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline">
      <ArrowLeft size={14} /> Back to {dashboardPage}
    </button>

    <section className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
      <div className={`flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between ${portal === 'supervisor' ? 'bg-emerald-50/60' : 'bg-indigo-50/60'}`}>
        <div className="flex items-start gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${portal === 'supervisor' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
            <Icon size={22} />
          </span>
          <div>
            <h2 className="display-font text-xl font-extrabold tracking-tight">{page}</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted">{meta.description}</p>
          </div>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-amber-700">
          Placeholder · next phase
        </span>
      </div>

      <div className="grid gap-5 p-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <div>
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-muted shadow-sm"><Icon size={24} /></span>
            <p className="mt-4 text-sm font-bold">Nothing to show yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">
              The navigation and page structure are ready. Functional content for {page} will be added in a later phase.
            </p>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-100 bg-white p-4">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[.14em] text-muted">Your context</div>
            <SharedUserProfile user={user} portal={portal} />
            <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-muted">Department</dt><dd className="font-bold text-right">{department?.name || user?.department || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Department ID</dt><dd className="font-bold">{department?.id ?? user?.departmentId ?? '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Portal</dt><dd className="font-bold capitalize">{portal}</dd></div>
            </dl>
          </div>

          {page === 'Notifications' && <div className="rounded-xl border border-slate-100 bg-white p-4">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[.14em] text-muted">Notifications</div>
            {notifications.length ? <div className="max-h-64 space-y-2 overflow-y-auto">
              {notifications.map((notice) => <div key={notice.id} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-bold">{notice.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-muted">{notice.body}</div>
                <div className="mt-1 text-[9px] text-muted">{dateLabel(notice.createdAt)}</div>
              </div>)}
            </div> : <p className="py-6 text-center text-xs text-muted">You’re all caught up.</p>}
          </div>}

          {page === 'My Profile' && <div className="rounded-xl border border-slate-100 bg-white p-4">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[.14em] text-muted">Account details</div>
            <dl className="space-y-2 text-xs">
              {[['Name', user?.name], ['Email', user?.email], ['Role', user?.roleLabel], ['Status', 'Active']].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="font-bold text-right">{value || '—'}</dd></div>
              ))}
            </dl>
          </div>}
        </aside>
      </div>
    </section>
  </div>;
}

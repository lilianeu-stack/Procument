import { useEffect, useState } from 'react';
import {
  ArrowRight, Bell, Boxes, CheckCircle2, ClipboardCheck, ClipboardList,
  Clock3, FilePlus2, History, Inbox, MessageSquare, Plus, ShieldCheck, UsersRound, XCircle
} from 'lucide-react';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, LoadingState, TableScroll, TextLink, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';
import { requisitionDisplayReference } from '../../utils/requisitionDisplay.js';

function WorkspaceStatCard({ label, value, note, icon: Icon, page, onClick, accent = 'emerald' }) {
  const accents = {
    emerald: 'border-reference/25 bg-reference/10 text-black',
    amber: 'border-amber-500/20 bg-amber-50 text-black',
    blue: 'border-sky-500/20 bg-sky-50 text-black',
    red: 'border-red-500/20 bg-red-50 text-black',
    indigo: 'border-slate-400/20 bg-slate-50 text-black',
    slate: 'border-brand bg-white text-black'
  };
  return <button type="button" onClick={onClick} className="group min-h-[168px] rounded-2xl border border-brand bg-white p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)] transition duration-200 hover:-translate-y-0.5 hover:border-accent-border hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
    <div className="flex items-start justify-between gap-3">
      <div className="pt-1 text-[11px] font-extrabold uppercase leading-4 tracking-[.08em] text-black">{label}</div>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${accents[accent] || accents.slate}`}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
    </div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <div>
        <div className="display-font text-[32px] font-extrabold leading-none tracking-[-0.03em]">{value ?? '—'}</div>
        <div className="mt-2 max-w-[180px] text-[11px] leading-4 text-black">{note}</div>
      </div>
      {page && <ArrowRight size={16} className="mb-1 shrink-0 text-black transition group-hover:translate-x-0.5 group-hover:text-black" />}
    </div>
  </button>;
}

function useRecentRequests(portalApi, portal, enabled = true) {
  const [state, setState] = useState({ requests: [], loading: true, error: '' });
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ requests: [], loading: false, error: '' });
      return undefined;
    }
    let active = true;
    const getter = portal === 'supervisor' ? portalApi.getSupervisorRequests : portalApi.getRequesterRequests;
    getter({ page: 1, limit: 6, status: '' })
      .then((response) => { if (active) setState({ requests: response.requisitions || [], loading: false, error: '' }); })
      .catch((exception) => { if (active) setState({ requests: [], loading: false, error: exception.message || 'Recent requests could not be loaded.' }); });
    return () => { active = false; };
  }, [portalApi, portal, token, enabled]);
  return { ...state, reload: () => setToken((value) => value + 1) };
}

function Hero({ portal, user, departmentName }) {
  const isSupervisor = portal === 'supervisor';
  const HeroIcon = isSupervisor ? ShieldCheck : FilePlus2;
  return <section className="relative overflow-hidden rounded-2xl border border-brand bg-white px-6 py-7 text-black shadow-[0_1px_2px_rgba(0,0,0,.02)] sm:px-8">
    <div className="absolute -right-16 -top-28 h-72 w-72 rounded-full border border-reference/20" />
    <div className="absolute -bottom-32 right-28 h-64 w-64 rounded-full border border-reference/10" />
    <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-2xl">
        <span className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-black">
          <span className="h-2 w-2 rounded-full bg-reference ring-4 ring-reference/10" />
          {isSupervisor ? 'Department Supervisor Portal' : 'Requester Portal'}
        </span>
        <h2 className="display-font mt-3 text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-[32px]">
          Good day, {user?.name?.split(' ')[0] || 'there'}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-black">
          {isSupervisor
            ? 'Review Department requests, guide your Requesters and keep an eye on stock — all from one workspace.'
            : 'Create purchase requests, follow their progress and stay connected with your Department Supervisor.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-black">
          <span>{departmentName}</span>
          <span className="h-1 w-1 rounded-full bg-black/25" />
          <span>{roleLabel(user?.role)}</span>
        </div>
      </div>
      <div className="hidden h-20 w-20 shrink-0 place-items-center rounded-2xl border border-reference/25 bg-reference/10 sm:grid">
        <HeroIcon size={34} strokeWidth={1.5} />
      </div>
    </div>
  </section>;
}

export default function RoleBasedDashboard({
  portal, user, summary, notifications = [], onNavigate, portalApi, onOpenNotification
}) {
  const isSupervisor = portal === 'supervisor';
  const department = summary?.department || {};
  const stats = summary?.stats || {};
  const departmentName = department.name || user?.department || 'No Department assigned';
  const recent = useRecentRequests(portalApi, portal, !isSupervisor);
  const unreadNotifications = stats.unreadNotifications ?? notifications.filter((item) => !item.isRead).length ?? 0;
  const unreadMessages = stats.unreadMessages ?? 0;
  const requestsPage = isSupervisor ? 'Procurement Requests' : 'My Procurement Requests';
  const messagesPage = isSupervisor ? 'Department Messages' : 'Messages';

  const cards = isSupervisor ? [
    { label: 'Requesters', value: stats.requesters ?? department.requesterCount ?? '—', note: 'Active in your Department', icon: UsersRound, tone: 'emerald', page: 'Requesters' },
    { label: 'Submitted', value: stats.submitted ?? '—', note: 'Requests submitted', icon: ClipboardList, tone: 'blue', page: requestsPage },
    { label: 'Pending approvals', value: stats.pending ?? '—', note: 'Awaiting your decision', icon: ClipboardCheck, tone: 'amber', page: 'Approvals' },
    { label: 'Approved', value: stats.approved ?? '—', note: 'Supervisor-approved requests', icon: CheckCircle2, tone: 'indigo', page: requestsPage },
    { label: 'Rejected', value: stats.rejected ?? '—', note: 'Rejected by Supervisor', icon: XCircle, tone: 'red', page: requestsPage },
    { label: 'Forwarded', value: stats.forwarded ?? '—', note: 'With Procurement', icon: ArrowRight, tone: 'indigo', page: requestsPage },
    { label: 'Stock items', value: stats.stockItems ?? '—', note: `${stats.lowStock ?? 0} low · ${stats.outOfStock ?? 0} out`, icon: Boxes, tone: 'blue', page: 'Stock Overview' },
    { label: 'Unread', value: unreadMessages + unreadNotifications, note: `${unreadMessages} messages · ${unreadNotifications} notices`, icon: Bell, tone: 'amber', page: 'Notifications' }
  ] : [
    { label: 'My requests', value: stats.total ?? '—', note: 'All requests you created', icon: ClipboardList, tone: 'indigo', page: requestsPage },
    { label: 'Pending approval', value: stats.pending ?? '—', note: 'With your Supervisor', icon: Clock3, tone: 'amber', page: requestsPage, query: { status: 'Pending Supervisor Approval' } },
    { label: 'Approved', value: stats.approved ?? '—', note: 'Approved or forwarded', icon: CheckCircle2, tone: 'emerald', page: requestsPage, query: { status: 'Approved by Supervisor' } },
    { label: 'Rejected', value: stats.rejected ?? '—', note: 'Rejected by Supervisor', icon: XCircle, tone: 'red', page: requestsPage, query: { status: 'Rejected by Supervisor' } },
    { label: 'Awaiting review', value: stats.underReview ?? '—', note: 'Under Procurement Review', icon: Inbox, tone: 'blue', page: requestsPage, query: { status: 'Under Procurement Review' } },
    { label: 'Information required', value: stats.informationRequired ?? '—', note: 'Needs your response', icon: ClipboardCheck, tone: 'amber', page: requestsPage, query: { status: 'Information Required' } },
    { label: 'Unread messages', value: unreadMessages, note: 'From your Supervisor', icon: MessageSquare, tone: 'indigo', page: messagesPage },
    { label: 'Unread notices', value: unreadNotifications, note: 'Notifications', icon: Bell, tone: 'emerald', page: 'Notifications' }
  ];

  // Supervisor overview is intentionally cards-only: no hero, tables, notice
  // list or footer beneath the metrics.
  if (isSupervisor) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {cards.map((card) => <WorkspaceStatCard
      key={card.label}
      {...card}
      accent={card.tone}
      onClick={() => onNavigate(card.page, card.query)}
    />)}
  </div>;

  return <div className="space-y-6">
    <Hero portal={portal} user={user} departmentName={departmentName} />

    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-black">
            {isSupervisor ? 'Department overview' : 'My workspace'}
          </div>
          <h3 className="display-font mt-1 text-lg font-extrabold tracking-tight">
            {isSupervisor ? 'Operational snapshot' : 'Request activity'}
          </h3>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-black">Select a card to view details</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <WorkspaceStatCard
          key={card.label}
          {...card}
          accent={card.tone}
          onClick={() => onNavigate(card.page, card.query)}
        />)}
      </div>
    </section>

    {!isSupervisor && <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand bg-white px-5 py-4">
      <div>
        <div className="text-sm font-extrabold">Quick actions</div>
        <div className="mt-0.5 text-[11px] text-black">Create and manage your purchasing activity.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onNavigate('Create Purchase Request')} className={primaryButtonClass()}>
          <Plus size={14} />Create purchase request
        </button>
        <button type="button" onClick={() => onNavigate('My Request History')} className={secondaryButtonClass()}>
          <History size={14} />View history
        </button>
        <button type="button" onClick={() => onNavigate(messagesPage)} className={secondaryButtonClass()}>
          <MessageSquare size={14} />Messages{unreadMessages > 0 ? ` (${unreadMessages})` : ''}
        </button>
      </div>
    </section>}

    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="overflow-hidden rounded-2xl border border-brand bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-5">
          <div>
            <h3 className="text-sm font-extrabold">{isSupervisor ? 'Recent Department requests' : 'My recent requests'}</h3>
            <p className="mt-1 text-xs text-black">Latest activity across your workspace.</p>
          </div>
          <TextLink onClick={() => onNavigate(requestsPage)} className="inline-flex items-center gap-1">View all <ArrowRight size={13} /></TextLink>
        </header>
        {recent.loading ? <LoadingState label="Loading recent requests…" /> : recent.error ? <ErrorState message={recent.error} onRetry={recent.reload} /> :
          !recent.requests.length ? <EmptyState title="No requests yet" description="Requests will appear here as soon as they are created." /> :
            <TableScroll minWidth={720}>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-subtle bg-white text-[10px] uppercase tracking-[.06em] text-black">
                  <tr>{['Reference', isSupervisor ? 'Requester' : 'Title', 'Submitted', 'Cost', 'Status'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {recent.requests.slice(0, 6).map((request) => <tr key={request.id} className="transition hover:bg-accent-tint">
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-black">
                      <TextLink onClick={() => onNavigate(requestsPage, { request: request.id })}>{requisitionDisplayReference(request)}</TextLink>
                    </td>
                    <td className="max-w-[230px] truncate px-4 py-3">{isSupervisor ? request.requester : request.title}</td>
                    <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
                  </tr>)}
                </tbody>
              </table>
            </TableScroll>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-brand bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-subtle px-5 py-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-extrabold">Unread notifications</h3>
            {unreadNotifications > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-reference px-1 text-[10px] font-extrabold">
              {unreadNotifications}
            </span>}
          </div>
          <TextLink onClick={() => onNavigate('Notifications')}>View all</TextLink>
        </header>
        {unreadNotifications ? <div className="divide-y">
          {notifications.filter((item) => !item.isRead).slice(0, 4).map((notice) => <button key={notice.id} type="button"
            onClick={() => onOpenNotification?.(notice)} className="block w-full border-l-2 border-transparent px-5 py-4 text-left transition hover:border-reference hover:bg-accent-tint">
            <div className="text-xs font-extrabold">{notice.title}</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-black">{notice.body}</div>
          </button>)}
        </div> : <EmptyState title="All caught up" description="No unread notifications right now." />}
      </section>
    </div>

    <p className="text-[11px] text-black">
      Need help? {isSupervisor ? 'Approval decisions and stock views are restricted to your Department.' : 'Your requests are visible only to you and your Department Supervisor.'}
    </p>
  </div>;
}

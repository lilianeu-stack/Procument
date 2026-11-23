import { useEffect, useState } from 'react';
import {
  ArrowRight, Bell, Boxes, CheckCircle2, ClipboardCheck, ClipboardList,
  Clock3, FilePlus2, History, Inbox, MessageSquare, ShieldCheck, UsersRound, XCircle
} from 'lucide-react';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, LoadingState, StatCard, TableScroll, TextLink, primaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';

function useRecentRequests(portalApi, portal) {
  const [state, setState] = useState({ requests: [], loading: true, error: '' });
  const [token, setToken] = useState(0);
  useEffect(() => {
    let active = true;
    const getter = portal === 'supervisor' ? portalApi.getSupervisorRequests : portalApi.getRequesterRequests;
    getter({ page: 1, limit: 6, status: '' })
      .then((response) => { if (active) setState({ requests: response.requisitions || [], loading: false, error: '' }); })
      .catch((exception) => { if (active) setState({ requests: [], loading: false, error: exception.message || 'Recent requests could not be loaded.' }); });
    return () => { active = false; };
  }, [portalApi, portal, token]);
  return { ...state, reload: () => setToken((value) => value + 1) };
}

function Hero({ portal, user, departmentName }) {
  const isSupervisor = portal === 'supervisor';
  const hero = isSupervisor
    ? 'bg-gradient-to-br from-[#123d3a] via-[#175a50] to-[#23806d]'
    : 'bg-gradient-to-br from-[#223b66] via-[#2f5392] to-[#4a76bd]';
  const HeroIcon = isSupervisor ? ShieldCheck : FilePlus2;
  return <section className={`relative overflow-hidden rounded-2xl px-6 py-8 text-white shadow-card sm:px-9 ${hero}`}>
    <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
    <div className="absolute -bottom-28 right-24 h-56 w-56 rounded-full border border-white/10" />
    <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.14em]">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          {isSupervisor ? 'Department Supervisor Portal' : 'Requester Portal'}
        </span>
        <h2 className="display-font mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
          Welcome, {user?.name?.split(' ')[0] || 'there'}.
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/80">
          {isSupervisor
            ? 'Review Department requests, guide your Requesters and keep an eye on stock — all from one workspace.'
            : 'Create purchase requests, follow their progress and stay connected with your Department Supervisor.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-lg bg-white/10 px-3 py-2">{departmentName}</span>
          <span className="rounded-lg bg-white/10 px-3 py-2">{roleLabel(user?.role)}</span>
          <span className="rounded-lg bg-white/10 px-3 py-2">{isSupervisor ? 'Department Supervisor' : 'Requester'}</span>
        </div>
      </div>
      <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border border-white/20 bg-white/10">
        <HeroIcon size={42} strokeWidth={1.4} />
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
  const recent = useRecentRequests(portalApi, portal);
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
    { label: 'Pending approval', value: stats.pending ?? '—', note: 'With your Supervisor', icon: Clock3, tone: 'amber', page: requestsPage },
    { label: 'Approved', value: stats.approved ?? '—', note: 'Approved or forwarded', icon: CheckCircle2, tone: 'emerald', page: requestsPage },
    { label: 'Rejected', value: stats.rejected ?? '—', note: 'Rejected by Supervisor', icon: XCircle, tone: 'red', page: requestsPage },
    { label: 'Awaiting review', value: stats.underReview ?? '—', note: 'Under Procurement Review', icon: Inbox, tone: 'blue', page: requestsPage },
    { label: 'Information required', value: stats.informationRequired ?? '—', note: 'Needs your response', icon: ClipboardCheck, tone: 'amber', page: requestsPage },
    { label: 'Unread messages', value: unreadMessages, note: 'From your Supervisor', icon: MessageSquare, tone: 'indigo', page: messagesPage },
    { label: 'Unread notices', value: unreadNotifications, note: 'Notifications', icon: Bell, tone: 'emerald', page: 'Notifications' }
  ];

  return <div className="space-y-6">
    <Hero portal={portal} user={user} departmentName={departmentName} />

    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{isSupervisor ? 'Department snapshot' : 'My workspace'}</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted">Click a card to open the related page</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <StatCard key={card.label} {...card} onClick={() => onNavigate(card.page)} />)}
      </div>
    </section>

    {!isSupervisor && <section className="flex flex-wrap gap-3">
      <button type="button" onClick={() => onNavigate('Create Purchase Request')} className={primaryButtonClass()}>
        <FilePlus2 size={14} />Create purchase request
      </button>
      <button type="button" onClick={() => onNavigate('My Request History')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold hover:bg-slate-50">
        <History size={14} />View request history
      </button>
      <button type="button" onClick={() => onNavigate(messagesPage)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold hover:bg-slate-50">
        <MessageSquare size={14} />Open messages{unreadMessages > 0 ? ` (${unreadMessages})` : ''}
      </button>
    </section>}

    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold">{isSupervisor ? 'Recent Department requests' : 'My recent requests'}</h3>
            <p className="mt-1 text-xs text-muted">Latest activity across your workspace.</p>
          </div>
          <TextLink onClick={() => onNavigate(requestsPage)}>View all <ArrowRight size={13} className="inline" /></TextLink>
        </header>
        {recent.loading ? <LoadingState label="Loading recent requests…" /> : recent.error ? <ErrorState message={recent.error} onRetry={recent.reload} /> :
          !recent.requests.length ? <EmptyState title="No requests yet" description="Requests will appear here as soon as they are created." /> :
            <TableScroll minWidth={720}>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                  <tr>{['Reference', isSupervisor ? 'Requester' : 'Title', 'Submitted', 'Cost', 'Status'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.requests.slice(0, 6).map((request) => <tr key={request.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-brand">
                      <TextLink onClick={() => onNavigate(requestsPage, { request: request.id })}>{request.reference}</TextLink>
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

      <section className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold">Unread notifications</h3>
          <TextLink onClick={() => onNavigate('Notifications')}>View all</TextLink>
        </header>
        {unreadNotifications ? <div className="divide-y">
          {notifications.filter((item) => !item.isRead).slice(0, 4).map((notice) => <button key={notice.id} type="button"
            onClick={() => onOpenNotification(notice)} className="block w-full px-5 py-3 text-left hover:bg-slate-50">
            <div className="text-xs font-bold">{notice.title}</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{notice.body}</div>
          </button>)}
        </div> : <EmptyState title="All caught up" description="No unread notifications right now." />}
      </section>
    </div>

    <p className="text-[11px] text-muted">
      Need help? {isSupervisor ? 'Approval decisions and stock views are restricted to your Department.' : 'Your requests are visible only to you and your Department Supervisor.'}
    </p>
  </div>;
}

import { useEffect, useState } from 'react';
import {
  ArrowRight, Bell, Building2, CheckCircle2, ClipboardCheck, ClipboardList,
  Clock3, FilePlus2, History, Inbox, MessageSquare, UserRound, XCircle
} from 'lucide-react';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, LoadingState, TableScroll, TextLink,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel, formatLongDate } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';
import { APPROVED_STATUS_FILTER } from '../../utils/status.js';

const REQUESTS_PAGE = 'My Procurement Requests';
const HISTORY_PAGE = 'My Request History';
const MESSAGES_PAGE = 'Messages';
const NOTIFICATIONS_PAGE = 'Notifications';

function firstName(name) {
  const value = String(name || '').trim();
  return value ? value.split(/\s+/)[0] : 'there';
}

function InfoCard({ icon: Icon, label, value, testId }) {
  return <div data-testid={testId} className="flex min-w-0 items-center gap-3 rounded-xl border border-brand bg-white px-3.5 py-2.5">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand bg-white text-black/60">
      <Icon size={16} strokeWidth={1.8} />
    </span>
    <span className="min-w-0">
      <span className="block text-[9px] font-bold uppercase leading-3 tracking-[.1em] text-muted">{label}</span>
      <span className="mt-0.5 block truncate text-xs font-extrabold leading-4">{value}</span>
    </span>
  </div>;
}

function WorkspaceCard({ label, value, note, icon: Icon, onClick, testId }) {
  return <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    aria-label={`${label}: ${value}. ${note}`}
    className="group flex min-h-[158px] w-full flex-col justify-between rounded-2xl border border-brand bg-white p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)] transition duration-200 hover:border-accent-border hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
  >
    <div className="flex items-start justify-between gap-3">
      <span className="pt-0.5 text-[11px] font-extrabold uppercase leading-4 tracking-[.08em] text-black/55">{label}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand bg-white text-black/60 transition group-hover:border-accent-border group-hover:text-accent-text">
        <Icon size={16} strokeWidth={1.8} />
      </span>
    </div>
    <div className="mt-6">
      <span data-testid={`${testId}-value`} className="display-font block text-[30px] font-extrabold leading-none tracking-[-0.03em]">{value}</span>
      <span className="mt-2 block text-[11px] leading-4 text-muted">{note}</span>
    </div>
  </button>;
}

function QuickAction({ icon: Icon, label, onClick, primary = false, testId }) {
  const className = primary
    ? primaryButtonClass('w-full min-h-[58px] justify-start px-4')
    : secondaryButtonClass('w-full min-h-[58px] justify-start px-4');
  return <button type="button" data-testid={testId} onClick={onClick} className={className}>
    <Icon size={16} strokeWidth={1.9} />
    <span>{label}</span>
  </button>;
}

function useRecentRequests(portalApi, initial) {
  const [state, setState] = useState(() => ({
    requests: initial?.requisitions || [],
    loading: !initial,
    error: ''
  }));
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (reloadToken === 0 && initial) {
      setState({ requests: initial.requisitions || [], loading: false, error: '' });
      return () => { active = false; };
    }

    setState((current) => ({ ...current, loading: true, error: '' }));
    portalApi.getRequesterRequests({ page: 1, limit: 6, status: '' })
      .then((response) => {
        if (active) setState({ requests: response.requisitions || [], loading: false, error: '' });
      })
      .catch((exception) => {
        if (active) setState({
          requests: [], loading: false,
          error: exception.message || 'Recent requests could not be loaded.'
        });
      });
    return () => { active = false; };
  }, [portalApi, initial, reloadToken]);

  return { ...state, reload: () => setReloadToken((value) => value + 1) };
}

export default function RequesterDashboard({
  user, summary, notifications = [], portalApi, onNavigate,
  onOpenNotification, initialRequests = null
}) {
  const stats = summary?.stats || {};
  const departmentName = summary?.department?.name || user?.department || 'No Department assigned';
  const roleName = user?.roleLabel || roleLabel(user?.role);
  const recent = useRecentRequests(portalApi, initialRequests);
  const unreadNoticeCount = Number(stats.unreadNotifications ?? 0) || 0;
  const noticeItems = notifications.filter((item) => !item.isRead).slice(0, 5);
  const statValue = (key) => stats[key] ?? '—';

  const cards = [
    {
      label: 'My requests', value: statValue('total'), note: 'All requests you created.',
      icon: ClipboardList, page: REQUESTS_PAGE, testId: 'stat-my-requests'
    },
    {
      label: 'Pending approval', value: statValue('pending'), note: 'With your Supervisor.',
      icon: Clock3, page: REQUESTS_PAGE,
      query: { status: 'Pending Supervisor Approval' }, testId: 'stat-pending-approval'
    },
    {
      label: 'Approved', value: statValue('approved'), note: 'Approved or forwarded.',
      icon: CheckCircle2, page: REQUESTS_PAGE,
      query: { status: APPROVED_STATUS_FILTER }, testId: 'stat-approved'
    },
    {
      label: 'Rejected', value: statValue('rejected'), note: 'Rejected by Supervisor.',
      icon: XCircle, page: REQUESTS_PAGE,
      query: { status: 'Rejected by Supervisor' }, testId: 'stat-rejected'
    },
    {
      label: 'Awaiting review', value: statValue('underReview'), note: 'Under Procurement Review.',
      icon: Inbox, page: REQUESTS_PAGE,
      query: { status: 'Under Procurement Review' }, testId: 'stat-awaiting-review'
    },
    {
      label: 'Information required', value: statValue('informationRequired'), note: 'Needs your response.',
      icon: ClipboardCheck, page: REQUESTS_PAGE,
      query: { status: 'Information Required' }, testId: 'stat-information-required'
    },
    {
      label: 'Unread messages', value: stats.unreadMessages ?? '—', note: 'From your Supervisor.',
      icon: MessageSquare, page: MESSAGES_PAGE, testId: 'stat-unread-messages'
    },
    {
      label: 'Unread notices', value: stats.unreadNotifications ?? '—', note: 'Notifications.',
      icon: Bell, page: NOTIFICATIONS_PAGE, testId: 'stat-unread-notices'
    }
  ];

  return <div data-testid="requester-dashboard" className="space-y-6">
    <section className="overflow-hidden rounded-2xl border border-brand bg-white shadow-[0_1px_2px_rgba(0,0,0,.03)]">
      <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p data-testid="dashboard-date" className="text-[11px] font-semibold text-muted">{formatLongDate()}</p>
          <h1 data-testid="dashboard-title" className="display-font mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[32px]">Requester Dashboard</h1>
          <p data-testid="dashboard-context" className="mt-2 text-xs text-muted">{roleName} · {departmentName}</p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:w-auto">
          <InfoCard icon={Building2} label="Assigned department" value={departmentName} testId="user-department" />
          <InfoCard icon={UserRound} label="Your role" value={roleName} testId="user-role" />
        </div>
      </div>
      <div className="border-t border-subtle px-6 py-6 sm:px-8">
        <h2 data-testid="welcome-title" className="display-font text-xl font-extrabold tracking-tight sm:text-2xl">Welcome, {firstName(user?.name)}.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-black/65">
          Create purchase requests, follow their progress and stay connected with your Department Supervisor.
        </p>
      </div>
    </section>

    <section aria-labelledby="workspace-heading">
      <div className="mb-4">
        <h2 id="workspace-heading" className="display-font text-lg font-extrabold tracking-tight">My workspace</h2>
        <p className="mt-1 text-xs text-muted">Click a card to open the related page</p>
      </div>
      <div data-testid="workspace-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <WorkspaceCard
          key={card.label}
          {...card}
          onClick={() => onNavigate(card.page, card.query)}
        />)}
      </div>
    </section>

    <section aria-labelledby="quick-actions-heading" className="rounded-2xl border border-brand bg-white p-5">
      <div className="mb-4">
        <h2 id="quick-actions-heading" className="display-font text-sm font-extrabold">Quick actions</h2>
        <p className="mt-1 text-[11px] text-muted">Start a request or continue where you left off.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickAction
          icon={FilePlus2}
          label="Create purchase request"
          onClick={() => onNavigate('Create Purchase Request')}
          primary
          testId="quick-create-request"
        />
        <QuickAction
          icon={History}
          label="View request history"
          onClick={() => onNavigate(HISTORY_PAGE)}
          testId="quick-request-history"
        />
        <QuickAction
          icon={MessageSquare}
          label="Open messages"
          onClick={() => onNavigate(MESSAGES_PAGE)}
          testId="quick-open-messages"
        />
      </div>
    </section>

    <div data-testid="dashboard-panels" className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-brand bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle px-5 py-5">
          <div>
            <h2 className="display-font text-sm font-extrabold">My recent requests</h2>
            <p className="mt-1 text-xs text-muted">Latest activity across your workspace.</p>
          </div>
          <TextLink onClick={() => onNavigate(REQUESTS_PAGE)}>View all <ArrowRight size={13} /></TextLink>
        </header>
        {recent.loading ? <LoadingState label="Loading recent requests…" /> : recent.error ?
          <ErrorState message={recent.error} onRetry={recent.reload} /> :
          !recent.requests.length ? <EmptyState
            title="No requests yet"
            description="Requests will appear here as soon as they are created."
          /> : <TableScroll minWidth={620} label="My recent requests">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-subtle bg-white text-[10px] uppercase tracking-[.06em] text-muted">
                <tr>
                  {['Reference', 'Title', 'Submitted', 'Cost', 'Status'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-5 py-3 font-bold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {recent.requests.slice(0, 6).map((request) => <tr key={request.id} data-testid="recent-request-row">
                  <td className="whitespace-nowrap px-5 py-3 font-bold text-black">
                    <TextLink onClick={() => onNavigate(REQUESTS_PAGE, { request: request.id })} title="View request">
                      {request.reference}
                    </TextLink>
                  </td>
                  <td className="max-w-[220px] px-5 py-3">
                    <span className="block truncate" title={request.title || ''}>{request.title || '—'}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-bold">{currency(request.total)}</td>
                  <td className="whitespace-nowrap px-5 py-3"><StatusBadge value={request.status} /></td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>}
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-brand bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-subtle px-5 py-5">
          <div className="flex items-center gap-2">
            <h2 className="display-font text-sm font-extrabold">Unread notifications</h2>
            {unreadNoticeCount > 0 && <span data-testid="unread-notice-count" className="grid h-5 min-w-5 place-items-center rounded-full border border-brand bg-white px-1 text-[10px] font-extrabold">
              {unreadNoticeCount}
            </span>}
          </div>
          <TextLink onClick={() => onNavigate(NOTIFICATIONS_PAGE)}>View all <ArrowRight size={13} /></TextLink>
        </header>
        {noticeItems.length ? <div className="divide-y divide-subtle">
          {noticeItems.map((notice) => <button
            key={notice.id}
            type="button"
            data-testid="unread-notification"
            onClick={() => onOpenNotification?.(notice)}
            className="block w-full px-5 py-4 text-left transition hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          >
            <span className="flex items-start gap-3">
              <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-reference ring-4 ring-reference/10" />
              <span className="min-w-0">
                <span className="block text-xs font-extrabold">{notice.title}</span>
                {notice.body && <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted">{notice.body}</span>}
                <span className="mt-2 block text-[10px] text-muted">{dateTimeLabel(notice.createdAt)}</span>
              </span>
            </span>
          </button>)}
        </div> : <EmptyState title="All caught up" description="No unread notifications right now." />}
      </section>
    </div>
  </div>;
}

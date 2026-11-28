import {
  CheckCircle2, ClipboardList, Clock3, Inbox, XCircle
} from 'lucide-react';
import { APPROVED_STATUS_FILTER } from '../../utils/status.js';

const REQUESTS_PAGE = 'My Procurement Requests';

function WorkspaceCard({ label, value, note, icon: Icon, onClick, testId }) {
  return <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    aria-label={`${label}: ${value}. ${note}`}
    className="group flex min-h-[158px] w-full flex-col justify-between rounded-2xl border border-brand bg-white p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)] transition duration-200 hover:border-accent-border hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
  >
    <div className="flex items-start justify-between gap-3">
      <span className="pt-0.5 text-[11px] font-extrabold uppercase leading-4 tracking-[.08em] text-black">{label}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand bg-white text-black transition group-hover:border-accent-border group-hover:text-black">
        <Icon size={16} strokeWidth={1.8} />
      </span>
    </div>
    <div className="mt-6">
      <span data-testid={`${testId}-value`} className="display-font block text-[30px] font-extrabold leading-none tracking-[-0.03em]">{value}</span>
      <span className="mt-2 block text-[11px] leading-4 text-black">{note}</span>
    </div>
  </button>;
}

export default function RequesterDashboard({ summary, onNavigate }) {
  const stats = summary?.stats || {};
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
  ];

  // Requester overview is intentionally cards-only: no hero, quick actions,
  // recent-request table, notification panel or footer beneath the metrics.
  return <div data-testid="requester-dashboard">
    <div data-testid="workspace-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <WorkspaceCard
        key={card.label}
        {...card}
        onClick={() => onNavigate(card.page, card.query)}
      />)}
    </div>
  </div>;
}

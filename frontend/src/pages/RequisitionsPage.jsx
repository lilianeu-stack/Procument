import { useState } from 'react';
import PageCard, { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { canAccessPage } from '../utils/access.js';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';
import { requisitionDisplayReference } from '../utils/requisitionDisplay.js';

// Legacy approval queue. Creation now happens only in the official Material
// Request form in the Requester portal; the old compact requisition modal was
// removed so no active button can open it.
export default function RequisitionsPage({ page, requisitions, user, search, onDecision }) {
  const [error, setError] = useState('');
  const approver = canAccessPage(user.role, 'Approvals');
  const visible = requisitions
    .filter((request) => page !== 'Approvals' || request.status === 'Pending')
    .filter((request) => `${request.reference} ${requisitionDisplayReference(request)} ${request.requester} ${request.department} ${request.supervisorName} ${request.supervisorDecision} ${request.status}`
      .toLowerCase()
      .includes(search.toLowerCase()));

  async function decide(id, decision) {
    try { await onDecision(id, decision); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <PageCard title={page === 'Approvals' ? 'Requests awaiting your review' : 'All requisitions'} description={`${visible.length} requests`}>
    {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
    {visible.length ? <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-xs">
        <thead className="bg-white text-[10px] uppercase tracking-wider text-black"><tr>{['Request', 'Requester', 'Supervisor decision', 'Items', 'Budget code', 'Est. total', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead>
        <tbody className="divide-y divide-subtle">{visible.map((request) => <tr key={request.id}>
          <td className="px-4 py-4"><strong>{requisitionDisplayReference(request)}</strong><div className="mt-1 text-[10px] text-black">{dateLabel(request.submittedAt || request.createdAt)}</div></td>
          <td className="px-4 py-4">{request.requester}<div className="mt-1 text-[10px] text-black">{request.department || '—'}</div></td>
          <td className="max-w-[220px] px-4 py-4">
            <span className="font-semibold">{request.supervisorName || '—'}</span>
            {request.supervisorDecision && <div className="mt-1 text-[10px] text-black">
              {request.supervisorDecision}{request.supervisorDecisionAt ? ` · ${dateTimeLabel(request.supervisorDecisionAt)}` : ''}
            </div>}
            {request.supervisorNotes && <div className="mt-1 break-words text-[10px] leading-4 text-black">Note: {request.supervisorNotes}</div>}
          </td>
          <td className="max-w-[200px] truncate px-4 py-4 text-black">{request.items}</td>
          <td className="px-4 py-4">{request.budgetCode}</td><td className="px-4 py-4 font-bold">{currency(request.total)}</td>
          <td className="px-4 py-4"><StatusBadge value={request.status} /></td>
          <td className="px-4 py-4">{approver && request.status === 'Pending' && <div className="flex gap-1">
            <button onClick={() => decide(request.id, 'Approved')} className="rounded bg-white px-2 py-1.5 font-bold text-black">Approve</button>
            <button onClick={() => decide(request.id, 'Rejected')} className="rounded bg-white px-2 py-1.5 font-bold text-black">Reject</button>
          </div>}</td>
        </tr>)}</tbody>
      </table>
    </div> : <EmptyState>No requisitions match this view.</EmptyState>}
  </PageCard>;
}

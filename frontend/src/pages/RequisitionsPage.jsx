import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { canAccessPage } from '../utils/access.js';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';

function RequisitionForm({ onClose, onSubmit }) {
  const [lines, setLines] = useState([{ itemName: '', quantity: '1', estimatedUnitCost: '' }]);
  const [form, setForm] = useState({ justification: '', budgetCode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const updateLine = (index, key, value) => setLines((current) =>
    current.map((line, position) => position === index ? { ...line, [key]: value } : line));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        ...form,
        items: lines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          estimatedUnitCost: Number(line.estimatedUnitCost || 0)
        }))
      });
      onClose();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <Modal title="Create purchase requisition" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div className="max-h-56 space-y-3 overflow-y-auto">
        {lines.map((line, index) => <div key={index} className="grid grid-cols-[1fr_76px_105px_auto] items-end gap-2">
          <label className="block text-xs font-bold">Item / service<input required value={line.itemName} onChange={(event) => updateLine(index, 'itemName', event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label>
          <label className="block text-xs font-bold">Qty<input required min="1" type="number" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label>
          <label className="block text-xs font-bold">Unit cost<input min="0" step="0.01" type="number" value={line.estimatedUnitCost} onChange={(event) => updateLine(index, 'estimatedUnitCost', event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label>
          <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))} className="mb-1 px-2 py-2 text-red-600 disabled:opacity-30" aria-label="Remove item">×</button>
        </div>)}
      </div>
      <button type="button" onClick={() => setLines((current) => [...current, { itemName: '', quantity: '1', estimatedUnitCost: '' }])} className="text-xs font-bold text-brand">+ Add item</button>
      <label className="block text-xs font-bold">Budget code<input required value={form.budgetCode} onChange={(event) => setForm({ ...form, budgetCode: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" /></label>
      <label className="block text-xs font-bold">Business justification<textarea required rows="3" value={form.justification} onChange={(event) => setForm({ ...form, justification: event.target.value })} className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label>
      <ErrorMessage>{error}</ErrorMessage>
      <FormActions busy={busy} close={onClose} label="Submit for approval" />
    </form>
  </Modal>;
}

export default function RequisitionsPage({ page, requisitions, user, search, onCreate, onDecision }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const approver = canAccessPage(user.role, 'Approvals');
  const visible = requisitions
    .filter((request) => page !== 'Approvals' || request.status === 'Pending')
    .filter((request) => `${request.reference} ${request.requester} ${request.department} ${request.supervisorName} ${request.supervisorDecision} ${request.status}`
      .toLowerCase()
      .includes(search.toLowerCase()));

  async function decide(id, decision) {
    try { await onDecision(id, decision); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <>
    <PageCard title={page === 'Approvals' ? 'Requests awaiting your review' : 'All requisitions'} description={`${visible.length} requests`}
      action={<button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />New request</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {visible.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted"><tr>{['Request', 'Requester', 'Supervisor decision', 'Items', 'Budget code', 'Est. total', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map((request) => <tr key={request.id}>
            <td className="px-4 py-4"><strong>{request.reference}</strong><div className="mt-1 text-[10px] text-muted">{dateLabel(request.createdAt)}</div></td>
            <td className="px-4 py-4">{request.requester}<div className="mt-1 text-[10px] text-muted">{request.department || '—'}</div></td>
            <td className="max-w-[220px] px-4 py-4">
              <span className="font-semibold">{request.supervisorName || '—'}</span>
              {request.supervisorDecision && <div className="mt-1 text-[10px] text-muted">
                {request.supervisorDecision}{request.supervisorDecisionAt ? ` · ${dateTimeLabel(request.supervisorDecisionAt)}` : ''}
              </div>}
              {request.supervisorNotes && <div className="mt-1 break-words text-[10px] leading-4 text-amber-700">Note: {request.supervisorNotes}</div>}
            </td>
            <td className="max-w-[200px] truncate px-4 py-4 text-muted">{request.items}</td>
            <td className="px-4 py-4">{request.budgetCode}</td><td className="px-4 py-4 font-bold">{currency(request.total)}</td>
            <td className="px-4 py-4"><StatusBadge value={request.status} /></td>
            <td className="px-4 py-4">{approver && request.status === 'Pending' && <div className="flex gap-1">
              <button onClick={() => decide(request.id, 'Approved')} className="rounded bg-emerald-50 px-2 py-1.5 font-bold text-emerald-700">Approve</button>
              <button onClick={() => decide(request.id, 'Rejected')} className="rounded bg-red-50 px-2 py-1.5 font-bold text-red-700">Reject</button>
            </div>}</td>
          </tr>)}</tbody>
        </table>
      </div> : <EmptyState>No requisitions match this view.</EmptyState>}
    </PageCard>
    {showForm && <RequisitionForm onClose={() => setShowForm(false)} onSubmit={onCreate} />}
  </>;
}

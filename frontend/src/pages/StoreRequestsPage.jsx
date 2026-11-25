import { useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { dateLabel } from '../utils/format.js';

const newRequestButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';
const approveButtonClass = 'inline-flex min-h-8 items-center justify-center rounded-lg border border-black bg-reference px-3 py-1.5 text-[10px] font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1';
const secondaryActionClass = 'inline-flex min-h-8 items-center justify-center rounded-lg border border-brand bg-white px-3 py-1.5 text-[10px] font-semibold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1';

function StoreRequestForm({ items, onClose, onSubmit }) {
  const [form, setForm] = useState({ itemId: '', quantity: '1', purpose: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity) }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Create store request" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Inventory item<select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} className="field"><option value="">Choose an item…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} available</option>)}</select></label>
    <label className="block text-xs font-bold">Quantity<input required min="1" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Purpose<textarea required rows="3" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} className="field h-auto py-2" /></label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Submit request" />
  </form></Modal>;
}

export default function StoreRequestsPage({ requests, items, user, onCreate, onDecision, onIssue }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const approver = ['admin', 'approver'].includes(user.role);
  const storekeeper = ['admin', 'storekeeper'].includes(user.role);

  async function act(action) {
    try { await action(); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <>
    <PageCard
      className="shadow-dashboard"
      title="Request register"
      description={`${requests.length} ${requests.length === 1 ? 'request' : 'requests'} · Approval is required before stock issue`}
      action={<button type="button" onClick={() => setShowForm(true)} className={newRequestButtonClass}><Plus size={15} />New request</button>}
    >
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {requests.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black/55">
            <tr>{['Request', 'Requester', 'Items', 'Purpose', 'Status', 'Actions'].map((cell) =>
              <th key={cell} className="whitespace-nowrap px-5 py-3.5 font-bold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {requests.map((request) => <tr key={request.id} className="transition-colors hover:bg-hover">
              <td className="px-5 py-4 align-middle">
                <span className="block break-words font-mono text-[11px] font-semibold">{request.reference || '—'}</span>
                <span className="mt-1 block whitespace-nowrap text-[10px] text-muted">{dateLabel(request.createdAt)}</span>
              </td>
              <td className="break-words px-5 py-4 align-middle">
                <span className="block font-semibold">{request.requester || '—'}</span>
                <span className="mt-1 block text-[10px] text-muted">{request.department || '—'}</span>
              </td>
              <td className="break-words px-5 py-4 align-middle leading-5">{request.items || '—'}</td>
              <td className="break-words px-5 py-4 align-middle leading-5">{request.purpose || '—'}</td>
              <td className="px-5 py-4 align-middle"><StatusBadge value={request.status} /></td>
              <td className="px-5 py-4 align-middle">
                <div className="flex flex-wrap gap-1.5">
                  {approver && request.status === 'Pending' && <>
                    <button type="button" onClick={() => act(() => onDecision(request.id, 'Approved'))} className={approveButtonClass}>Approve</button>
                    <button type="button" onClick={() => act(() => onDecision(request.id, 'Rejected'))} className={secondaryActionClass}>Reject</button>
                  </>}
                  {storekeeper && request.status === 'Approved' && <button type="button" onClick={() => act(() => onIssue(request.id))} className={approveButtonClass}>Issue</button>}
                  {!(approver && request.status === 'Pending') && !(storekeeper && request.status === 'Approved') && <span className="text-[11px] text-muted">—</span>}
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <ClipboardList size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">No store requests yet</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
            Submitted requests will appear here for approval and stock issue.
          </p>
        </div>
      </EmptyState>}
    </PageCard>
    {showForm && <StoreRequestForm items={items} onClose={() => setShowForm(false)} onSubmit={onCreate} />}
  </>;
}

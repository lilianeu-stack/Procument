import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { dateLabel } from '../utils/format.js';

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
    <PageCard title="Store requests" description={`${requests.length} · Approval is required before stock issue`} action={<button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />New request</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {requests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[730px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Request', 'Requester', 'Items', 'Purpose', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{requests.map((request) => <tr key={request.id}><td className="px-5 py-4 font-bold">{request.reference}<div className="mt-1 text-[10px] font-normal text-muted">{dateLabel(request.createdAt)}</div></td><td className="px-5 py-4">{request.requester}<div className="text-[10px] text-muted">{request.department}</div></td><td className="px-5 py-4">{request.items}</td><td className="px-5 py-4">{request.purpose}</td><td className="px-5 py-4"><StatusBadge value={request.status} /></td><td className="px-5 py-4"><div className="flex gap-1">{approver && request.status === 'Pending' && <><button onClick={() => act(() => onDecision(request.id, 'Approved'))} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Approve</button><button onClick={() => act(() => onDecision(request.id, 'Rejected'))} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button></>}{storekeeper && request.status === 'Approved' && <button onClick={() => act(() => onIssue(request.id))} className="rounded bg-brand-light px-2 py-1 text-brand">Issue</button>}</div></td></tr>)}</tbody></table></div> : <EmptyState>No store requests have been submitted.</EmptyState>}
    </PageCard>
    {showForm && <StoreRequestForm items={items} onClose={() => setShowForm(false)} onSubmit={onCreate} />}
  </>;
}

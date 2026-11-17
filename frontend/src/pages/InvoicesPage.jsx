import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency } from '../utils/format.js';

function InvoiceForm({ orders, onClose, onSubmit }) {
  const [form, setForm] = useState({ purchaseOrderId: '', reference: '', amount: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, purchaseOrderId: Number(form.purchaseOrderId), amount: Number(form.amount) }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Submit invoice to finance" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Purchase order<select required value={form.purchaseOrderId} onChange={(event) => setForm({ ...form, purchaseOrderId: event.target.value })} className="field"><option value="">Choose an approved PO…</option>{orders.filter((order) => ['Approved', 'Partially received', 'Received'].includes(order.status)).map((order) => <option key={order.id} value={order.id}>{order.reference} · {order.supplier}</option>)}</select></label>
    <label className="block text-xs font-bold">Supplier invoice reference<input required value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Invoice amount<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="field" /></label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Submit invoice" />
  </form></Modal>;
}

export default function InvoicesPage({ invoices, orders, user, onCreate, onDecision }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const procurement = ['admin', 'procurement'].includes(user.role);
  const finance = ['admin', 'finance'].includes(user.role);

  async function decide(id, decision) {
    try { await onDecision(id, decision); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <>
    <PageCard title="Invoices & payments" description="Verify invoices against purchase orders and received goods" action={procurement && <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Submit invoice</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {invoices.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Invoice', 'Purchase order', 'Supplier', 'Amount', 'Submitted by', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4 font-bold">{invoice.reference}</td><td className="px-5 py-4">{invoice.purchaseOrder}</td><td className="px-5 py-4">{invoice.supplier}</td><td className="px-5 py-4 font-bold">{currency(invoice.amount)}</td><td className="px-5 py-4">{invoice.submittedBy}</td><td className="px-5 py-4"><StatusBadge value={invoice.status} /></td><td className="px-5 py-4">{finance && invoice.status === 'Pending' && <div className="flex gap-1"><button onClick={() => decide(invoice.id, 'Approved')} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Approve</button><button onClick={() => decide(invoice.id, 'Rejected')} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button></div>}{finance && invoice.status === 'Approved' && <button onClick={() => decide(invoice.id, 'Paid')} className="rounded bg-brand-light px-2 py-1 text-brand">Mark paid</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No invoices have been submitted.</EmptyState>}
    </PageCard>
    {showForm && <InvoiceForm orders={orders} onClose={() => setShowForm(false)} onSubmit={onCreate} />}
  </>;
}

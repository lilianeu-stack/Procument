import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import { currency, dateLabel } from '../utils/format.js';

function OrderForm({ rfqs, onClose, onSubmit }) {
  const [form, setForm] = useState({ rfqId: '', deliveryDate: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, rfqId: Number(form.rfqId) }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Create purchase order" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Awarded RFQ<select required value={form.rfqId} onChange={(event) => setForm({ ...form, rfqId: event.target.value })} className="field"><option value="">Choose an awarded RFQ…</option>{rfqs.filter((rfq) => rfq.status === 'Awarded').map((rfq) => <option key={rfq.id} value={rfq.id}>{rfq.reference} · {rfq.selectedSupplier}</option>)}</select></label>
    <label className="block text-xs font-bold">Expected delivery date<input type="date" value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} className="field" /></label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Submit for approval" />
  </form></Modal>;
}

function ReceiptForm({ order, items, onClose, onSubmit }) {
  const [form, setForm] = useState({ itemId: '', quantity: '1', source: order.reference, isFinal: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity), purchaseOrderId: order.id }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Receive goods · ${order.reference}`} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Inventory item<select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} className="field"><option value="">Choose an item…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
    <label className="block text-xs font-bold">Quantity received<input required min="1" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Delivery/source reference<input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="field" /></label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isFinal} onChange={(event) => setForm({ ...form, isFinal: event.target.checked })} />This is the final delivery</label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Record GRN" />
  </form></Modal>;
}

export default function PurchaseOrdersPage({ orders, rfqs, items, user, onCreate, onDecision, onReceive }) {
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [error, setError] = useState('');
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canApprove = ['admin', 'approver'].includes(user.role);
  const canReceive = ['admin', 'storekeeper', 'procurement'].includes(user.role);
  async function decide(id, decision) {
    try { await onDecision(id, decision); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <>
    <PageCard title="Purchase orders" description={`${orders.length} orders · Approval and delivery tracking`} action={canCreate && <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Create PO</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {orders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['PO', 'Supplier', 'Requisition', 'Items · quantity @ unit price', 'Total', 'Delivery', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{orders.map((order) => <tr key={order.id}><td className="px-4 py-4 font-bold">{order.reference}</td><td className="px-4 py-4">{order.supplier}</td><td className="px-4 py-4">{order.requisition}</td><td className="max-w-[220px] px-4 py-4 text-muted">{order.items}</td><td className="px-4 py-4 font-bold">{currency(order.total)}</td><td className="px-4 py-4">{dateLabel(order.deliveryDate)}</td><td className="px-4 py-4">{order.status}</td><td className="px-4 py-4"><div className="flex gap-1">{canApprove && order.status === 'Pending approval' && <><button onClick={() => decide(order.id, 'Approved')} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Approve</button><button onClick={() => decide(order.id, 'Rejected')} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button></>}{canReceive && ['Approved', 'Partially received'].includes(order.status) && <button onClick={() => setReceiving(order)} className="rounded border px-2 py-1 text-brand">Receive</button>}</div></td></tr>)}</tbody></table></div> : <EmptyState>No purchase orders are ready.</EmptyState>}
    </PageCard>
    {creating && <OrderForm rfqs={rfqs} onClose={() => setCreating(false)} onSubmit={onCreate} />}
    {receiving && <ReceiptForm order={receiving} items={items} onClose={() => setReceiving(null)} onSubmit={onReceive} />}
  </>;
}

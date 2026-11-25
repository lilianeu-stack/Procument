import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency, dateLabel } from '../utils/format.js';

const submitButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';
const approveButtonClass = 'inline-flex min-h-8 items-center justify-center rounded-lg border border-black bg-reference px-3 py-1.5 text-[10px] font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1';
const secondaryActionClass = 'inline-flex min-h-8 items-center justify-center rounded-lg border border-brand bg-white px-3 py-1.5 text-[10px] font-semibold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1';

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
    <PageCard
      className="shadow-dashboard"
      title="Invoice register"
      description={`${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'} · Verify supplier charges against purchase orders and received goods`}
      action={procurement && <button type="button" onClick={() => setShowForm(true)} className={submitButtonClass}><Plus size={15} />Submit invoice</button>}
    >
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {invoices.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black/55">
            <tr>{['Invoice', 'Purchase order', 'Supplier', 'Amount', 'Submitted by', 'Submitted', 'Status', 'Actions'].map((cell) =>
              <th key={cell} className="whitespace-nowrap px-4 py-3.5 font-bold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {invoices.map((invoice) => <tr key={invoice.id} className="transition-colors hover:bg-hover">
              <td className="px-4 py-4 align-middle font-mono text-[11px] font-semibold">{invoice.reference || '—'}</td>
              <td className="px-4 py-4 align-middle">{invoice.purchaseOrder || '—'}</td>
              <td className="break-words px-4 py-4 align-middle font-medium">{invoice.supplier || '—'}</td>
              <td className="whitespace-nowrap px-4 py-4 align-middle font-bold tabular-nums">{currency(invoice.amount)}</td>
              <td className="break-words px-4 py-4 align-middle">{invoice.submittedBy || '—'}</td>
              <td className="whitespace-nowrap px-4 py-4 align-middle">{dateLabel(invoice.submittedAt || invoice.createdAt)}</td>
              <td className="px-4 py-4 align-middle"><StatusBadge value={invoice.status} /></td>
              <td className="px-4 py-4 align-middle">
                {finance && invoice.status === 'Pending' && <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => decide(invoice.id, 'Approved')} className={approveButtonClass}>Approve</button>
                  <button type="button" onClick={() => decide(invoice.id, 'Rejected')} className={secondaryActionClass}>Reject</button>
                </div>}
                {finance && invoice.status === 'Approved' && <button type="button" onClick={() => decide(invoice.id, 'Paid')} className={approveButtonClass}>Mark paid</button>}
                {!(finance && ['Pending', 'Approved'].includes(invoice.status)) && <span className="text-[11px] text-muted">—</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <FileText size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">No invoices submitted yet</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
            Submitted supplier invoices will appear here for review and payment tracking.
          </p>
        </div>
      </EmptyState>}
    </PageCard>
    {showForm && <InvoiceForm orders={orders} onClose={() => setShowForm(false)} onSubmit={onCreate} />}
  </>;
}

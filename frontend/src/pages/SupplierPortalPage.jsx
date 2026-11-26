import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';

function QuoteForm({ rfq, onClose, onSubmit }) {
  const [form, setForm] = useState({ amount: '', deliveryDays: '7', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(rfq.id, { ...form, amount: Number(form.amount), deliveryDays: Number(form.deliveryDays) });
      onClose();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Submit quotation · ${rfq.reference}`} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-black">{rfq.items || 'See the RFQ for requested items.'}</p>
      <label className="block text-xs font-bold">Total quotation amount<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Delivery days<input required min="1" type="number" value={form.deliveryDays} onChange={(event) => setForm({ ...form, deliveryDays: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Notes<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="field h-auto py-2" /></label>
      <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Submit quotation" />
    </form>
  </Modal>;
}

function InvoiceForm({ order, onClose, onSubmit }) {
  const [form, setForm] = useState({ reference: '', amount: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ ...form, purchaseOrderId: order.id, amount: Number(form.amount) });
      onClose();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Submit invoice · ${order.reference}`} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-xs font-bold">Invoice reference<input required value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Invoice amount<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="field" /></label>
      <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Submit invoice" />
    </form>
  </Modal>;
}

export default function SupplierPortalPage({ portal, user, onQuote, onInvoice }) {
  const [activeRfq, setActiveRfq] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [error, setError] = useState('');
  if (!portal) return <ErrorMessage>Supplier profile is unavailable for this account.</ErrorMessage>;
  const canSubmitQuotes = user.permissions?.includes('quotations.submit');
  const canSubmitInvoices = user.permissions?.includes('invoices.create');
  const canInvoice = (order) => ['Approved', 'Partially received', 'Received'].includes(order.status);

  async function submitQuote(rfqId, form) {
    await onQuote(rfqId, form);
    setError('');
  }

  async function submitInvoice(form) {
    try { await onInvoice(form); setError(''); }
    catch (exception) { setError(exception.message); throw exception; }
  }

  return <div className="space-y-5">
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <PageCard title={portal.supplier.name} description="Your supplier profile and assigned Hope Haven procurement activity">
      <div className="grid gap-3 p-5 text-xs sm:grid-cols-3">
        <div><span className="text-black">Contact</span><p className="mt-1 font-semibold">{portal.supplier.contactName || '—'}</p></div>
        <div><span className="text-black">Email</span><p className="mt-1 font-semibold">{portal.supplier.email || '—'}</p></div>
        <div><span className="text-black">Status</span><p className="mt-1"><StatusBadge value={portal.supplier.status === 'Active' ? 'Approved' : 'Rejected'} /></p></div>
      </div>
    </PageCard>
    <PageCard title="Requests for quotation" description="RFQs sent specifically to your supplier account">
      {portal.rfqs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-black"><tr>{['RFQ', 'Requested items', 'Due date', 'Status', 'Quotation'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{portal.rfqs.map((rfq) => <tr key={rfq.id}><td className="px-5 py-4 font-bold">{rfq.reference}</td><td className="max-w-[260px] px-5 py-4">{rfq.items || '—'}</td><td className="px-5 py-4">{dateTimeLabel(rfq.dueDate)}</td><td className="px-5 py-4">{rfq.status}</td><td className="px-5 py-4">{rfq.quotationId ? <span className="font-semibold text-black">Submitted</span> : canSubmitQuotes && ['Sent', 'Evaluating'].includes(rfq.status) && <button onClick={() => setActiveRfq(rfq)} className="rounded bg-brand px-3 py-1.5 font-bold text-black">Submit quote</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No RFQs have been sent to this supplier.</EmptyState>}
      {portal.rfqs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-black"><tr>{['RFQ', 'Requested items', 'Due date', 'Status', 'Quotation'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{portal.rfqs.map((rfq) => <tr key={rfq.id}><td className="px-5 py-4 font-bold">{rfq.reference}</td><td className="max-w-[260px] px-5 py-4">{rfq.items || '—'}</td><td className="px-5 py-4">{dateTimeLabel(rfq.dueDate)}</td><td className="px-5 py-4">{rfq.status}</td><td className="px-5 py-4">{rfq.quotationId ? <span className="font-semibold text-black">Submitted</span> : canSubmitQuotes && ['Sent', 'Evaluating'].includes(rfq.status) && <button onClick={() => setActiveRfq(rfq)} className="rounded bg-brand px-3 py-1.5 font-bold text-black">Submit quote</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No RFQs have been sent to this supplier.</EmptyState>}
    </PageCard>
    <PageCard title="Purchase orders" description="Orders awarded to your supplier profile">
      {portal.purchaseOrders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-black"><tr>{['Purchase order', 'RFQ', 'Total', 'Delivery', 'Status', 'Invoice'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{portal.purchaseOrders.map((order) => <tr key={order.id}><td className="px-5 py-4 font-bold">{order.reference}</td><td className="px-5 py-4">{order.rfq}</td><td className="px-5 py-4 font-bold">{currency(order.total)}</td><td className="px-5 py-4">{dateLabel(order.deliveryDate)}</td><td className="px-5 py-4">{order.status}</td><td className="px-5 py-4">{canSubmitInvoices && canInvoice(order) && <button onClick={() => setActiveOrder(order)} className="flex items-center gap-1 rounded bg-brand-light px-2.5 py-1.5 font-bold text-black"><Plus size={12} />Submit invoice</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No purchase orders are linked to your supplier profile.</EmptyState>}
    </PageCard>
    <PageCard title="Quotations & payment status" description="Only your own submissions and awarded orders are shown">
      {portal.quotations.length || portal.invoices.length ? <div className="grid gap-5 p-5 lg:grid-cols-2">
        <section><h3 className="mb-3 text-xs font-bold">Your quotations</h3>{portal.quotations.length ? portal.quotations.map((quote) => <div key={quote.id} className="mb-2 flex items-center justify-between rounded-lg border border-slate-100 p-3 text-xs"><span><strong>{quote.rfq}</strong>{Number(quote.deliveryDays) > 0 && <span className="ml-2 text-black">{quote.deliveryDays} day(s)</span>}</span><span className="font-bold">{currency(quote.amount)}</span></div>) : <p className="text-xs text-black">No quotations submitted yet.</p>}</section>
        <section><h3 className="mb-3 text-xs font-bold">Invoices and payments</h3>{portal.invoices.length ? portal.invoices.map((invoice) => <div key={invoice.id} className="mb-2 flex items-center justify-between rounded-lg border border-slate-100 p-3 text-xs"><span><strong>{invoice.reference}</strong><span className="ml-2 text-black">{invoice.purchaseOrder}</span></span><span className="text-right"><strong>{currency(invoice.amount)}</strong><span className="mt-1 block"><StatusBadge value={invoice.status} /></span></span></div>) : <p className="text-xs text-black">No invoices submitted yet.</p>}</section>
      </div> : <EmptyState><span className="inline-flex items-center gap-2"><FileText size={15} />Your submissions and payment statuses will appear here.</span></EmptyState>}
    </PageCard>
    {activeRfq && <QuoteForm rfq={activeRfq} onClose={() => setActiveRfq(null)} onSubmit={submitQuote} />}
    {activeOrder && <InvoiceForm order={activeOrder} onClose={() => setActiveOrder(null)} onSubmit={submitInvoice} />}
  </div>;
}

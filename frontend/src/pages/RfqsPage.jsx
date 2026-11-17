import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import { currency, dateLabel } from '../utils/format.js';

function RFQForm({ requisitions, suppliers, onClose, onSubmit }) {
  const [form, setForm] = useState({ requisitionId: '', dueDate: '' });
  const [supplierIds, setSupplierIds] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, requisitionId: Number(form.requisitionId), supplierIds }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Create request for quotation" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Approved requisition<select required value={form.requisitionId} onChange={(event) => setForm({ ...form, requisitionId: event.target.value })} className="field"><option value="">Select a requisition…</option>{requisitions.filter((request) => request.status === 'Approved').map((request) => <option value={request.id} key={request.id}>{request.reference} · {request.requester}</option>)}</select></label>
    <label className="block text-xs font-bold">Due date<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className="field" /></label>
    <fieldset><legend className="mb-2 text-xs font-bold">Invite at least two active suppliers</legend><div className="max-h-40 space-y-2 overflow-auto rounded-lg border p-3">{suppliers.filter((supplier) => supplier.status === 'Active').map((supplier) => <label key={supplier.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={(event) => setSupplierIds(event.target.checked ? [...supplierIds, supplier.id] : supplierIds.filter((id) => id !== supplier.id))} />{supplier.name}</label>)}</div></fieldset>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Send RFQ" />
  </form></Modal>;
}

function QuoteForm({ rfq, suppliers, onClose, onSubmit }) {
  const [form, setForm] = useState({ supplierId: '', amount: '', deliveryDays: '7', qualityScore: '4', ratingScore: '4', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onSubmit(rfq.id, { ...form, supplierId: Number(form.supplierId), amount: Number(form.amount), deliveryDays: Number(form.deliveryDays), qualityScore: Number(form.qualityScore), ratingScore: Number(form.ratingScore) });
      onClose();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Record quotation · ${rfq.reference}`} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Invited supplier<select required value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} className="field"><option value="">Select supplier…</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3">{[['amount', 'Quote total', '0.01', '0.01'], ['deliveryDays', 'Delivery days', '1', '1'], ['qualityScore', 'Quality score (0–5)', '0', '0.1'], ['ratingScore', 'Supplier rating (0–5)', '0', '0.1']].map(([key, label, min, step]) => <label key={key} className="block text-xs font-bold">{label}<input required type="number" min={min} max={key.includes('Score') ? '5' : undefined} step={step} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="field" /></label>)}</div>
    <label className="block text-xs font-bold">Evaluation notes<textarea rows="2" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="field h-auto py-2" /></label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Save quote" />
  </form></Modal>;
}

export default function RfqsPage({ rfqs, requisitions, suppliers, quotations, user, onCreate, onLoadQuotes, onQuote, onAward }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [activeRfq, setActiveRfq] = useState(null);
  const [error, setError] = useState('');
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canEvaluate = ['admin', 'committee', 'procurement'].includes(user.role);
  const canAward = ['admin', 'committee'].includes(user.role);

  async function viewQuotes(rfq) {
    setActiveRfq(rfq); setError('');
    try { await onLoadQuotes(rfq.id); }
    catch (exception) { setError(exception.message); }
  }
  async function award(quotationId) {
    try { await onAward(activeRfq.id, quotationId); await onLoadQuotes(activeRfq.id); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  return <>
    <PageCard title="Request for quotations" description={`${rfqs.length} RFQs`}
      action={canCreate && <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Create RFQ</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {rfqs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['RFQ', 'Requisition', 'Due date', 'Suppliers', 'Quotes', 'Status', ''].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{rfqs.map((rfq) => <tr key={rfq.id}><td className="px-5 py-4 font-bold">{rfq.reference}</td><td className="px-5 py-4">{rfq.requisition}</td><td className="px-5 py-4">{dateLabel(rfq.dueDate)}</td><td className="px-5 py-4">{rfq.invitedSuppliers}</td><td className="px-5 py-4">{rfq.quotations}</td><td className="px-5 py-4">{rfq.status}{rfq.selectedSupplier && <div className="text-[10px] text-muted">{rfq.selectedSupplier}</div>}</td><td className="px-5 py-4"><button onClick={() => viewQuotes(rfq)} className="font-bold text-brand">Quotes</button></td></tr>)}</tbody></table></div> : <EmptyState>No RFQs have been created.</EmptyState>}
    </PageCard>
    {activeRfq && <PageCard title={`Quotations · ${activeRfq.reference}`} description="Compare amount, delivery time, quality, and rating" action={canEvaluate && ['Sent', 'Evaluating'].includes(activeRfq.status) && <button onClick={() => setQuoteOpen(true)} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white">Record quote</button>}>
      {quotations.length ? <div className="overflow-x-auto"><table className="w-full min-w-[610px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Supplier', 'Amount', 'Delivery', 'Quality', 'Rating', 'Award'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{quotations.map((quote) => <tr key={quote.id}><td className="px-4 py-3 font-bold">{quote.supplier}{quote.selected && ' · Selected'}</td><td className="px-4 py-3">{currency(quote.amount)}</td><td className="px-4 py-3">{quote.deliveryDays} days</td><td className="px-4 py-3">{quote.qualityScore}/5</td><td className="px-4 py-3">{quote.ratingScore}/5</td><td className="px-4 py-3">{canAward && <button disabled={quote.selected || !['Sent', 'Evaluating'].includes(activeRfq.status)} onClick={() => award(quote.id)} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-40">Select</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No quotations received.</EmptyState>}
    </PageCard>}
    {createOpen && <RFQForm requisitions={requisitions} suppliers={suppliers} onClose={() => setCreateOpen(false)} onSubmit={onCreate} />}
    {quoteOpen && activeRfq && <QuoteForm rfq={activeRfq} suppliers={suppliers} onClose={() => setQuoteOpen(false)} onSubmit={onQuote} />}
  </>;
}

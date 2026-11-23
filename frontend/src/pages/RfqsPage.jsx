import { useCallback, useRef, useState } from 'react';
import { Plus, RefreshCw, Send } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rfq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function RFQForm({ requisitions, suppliers, initialRequisitionId, onClose, onSubmit }) {
  const [form, setForm] = useState({ requisitionId: initialRequisitionId ? String(initialRequisitionId) : '', dueDate: '' });
  const [supplierIds, setSupplierIds] = useState([]);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      await onSubmit({ ...form, requisitionId: Number(form.requisitionId), supplierIds, idempotencyKey });
    } catch (exception) { setError(exception.message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title="Create request for quotation" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Approved requisition<select required value={form.requisitionId} onChange={(event) => setForm({ ...form, requisitionId: event.target.value })} className="field"><option value="">Select a requisition…</option>{requisitions.filter((request) => ['Forwarded to Procurement', 'Under Procurement Review'].includes(request.status)).map((request) => <option value={request.id} key={request.id}>{request.reference} · {request.requester}</option>)}</select></label>
    <label className="block text-xs font-bold">Due date<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className="field" /></label>
    <fieldset><legend className="mb-2 text-xs font-bold">Invite active suppliers</legend><div className="max-h-40 space-y-2 overflow-auto rounded-lg border p-3">{suppliers.filter((supplier) => supplier.status === 'Active').map((supplier) => <label key={supplier.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={(event) => setSupplierIds(event.target.checked ? [...supplierIds, supplier.id] : supplierIds.filter((id) => id !== supplier.id))} />{supplier.name}{supplier.email && <span className="text-muted">· {supplier.email}</span>}</label>)}</div></fieldset>
    <p className="text-[11px] text-muted">Each Supplier receives a separate email with a unique secure link. SMTP acceptance is not proof of inbox delivery.</p>
    {busy && <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">Sending RFQ emails… Please keep this window open.</p>}
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Send RFQ" busyLabel="Sending RFQ emails…" />
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

function statusClass(status) {
  if (status === 'Delivered' || status === 'Opened') return 'bg-emerald-50 text-emerald-700';
  if (status === 'Accepted by Email Provider') return 'bg-sky-50 text-sky-700';
  if (status === 'Failed' || status === 'Bounced') return 'bg-red-50 text-red-700';
  if (status === 'Pending' || status === 'Sending') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function emailResultNotice(result) {
  if (!result) return 'RFQ created.';
  const accepted = Number(result.accepted) || 0;
  const failed = Number(result.failed) || 0;
  if (Number(result.total) === 0 && accepted === 0 && failed === 0) {
    return 'RFQ created. No Supplier invitations were selected, so no email was sent.';
  }
  if (accepted > 0 && failed === 0) {
    return `RFQ created. RFQ email accepted by the email provider (${accepted}). Provider acceptance is not confirmed inbox delivery.`;
  }
  if (accepted > 0 && failed > 0) {
    return `RFQ created. Some emails were accepted (${accepted}), but ${failed} failed. Review the individual Supplier statuses below.`;
  }
  return `Unable to send RFQ emails. ${failed} recipient(s) failed. Review the individual Supplier statuses below and retry after correcting the problem.`;
}

export default function RfqsPage({
  rfqs = [], requisitions = [], suppliers = [], quotations = [], user = {}, query = {},
  initialRequisitionId, autoOpenCreate = false,
  onCreate, onLoadQuotes, onQuote, onAward, onLoadEmailDeliveries,
  onRetryFailedEmails, onResendRfqEmail
}) {
  const sendingRfq = useRef(false);
  const [createOpen, setCreateOpen] = useState(autoOpenCreate || Boolean(query.requisition));
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [activeRfq, setActiveRfq] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailData, setEmailData] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canEvaluate = ['admin', 'committee', 'procurement'].includes(user.role);
  const canAward = ['admin', 'committee'].includes(user.role);

  const loadEmailStatus = useCallback(async (rfqId) => {
    if (!onLoadEmailDeliveries || !rfqId) return;
    setEmailLoading(true);
    try { setEmailData(await onLoadEmailDeliveries(rfqId)); }
    catch (exception) { setError(exception.message || 'Email delivery status could not be loaded.'); }
    finally { setEmailLoading(false); }
  }, [onLoadEmailDeliveries]);

  async function createRfq(form) {
    if (sendingRfq.current) throw new Error('This RFQ is already being sent. Please wait.');
    sendingRfq.current = true;
    try {
      const result = await onCreate(form);
      setNotice(result.duplicate
        ? 'This RFQ was already submitted. Existing email delivery statuses are shown below; no duplicate was created.'
        : emailResultNotice(result.emailDelivery));
      setCreateOpen(false);
      if (result.id) {
        setActiveRfq({ id: result.id, reference: result.reference, status: 'Sent' });
        await loadEmailStatus(result.id);
      }
      return result;
    } finally { sendingRfq.current = false; }
  }

  async function viewQuotes(rfq) {
    setActiveRfq(rfq); setEmailData(null); setError(''); setNotice('');
    try { await onLoadQuotes(rfq.id); }
    catch (exception) { setError(exception.message); }
  }

  async function viewEmailStatus(rfq) {
    setActiveRfq(rfq); setError(''); setNotice('');
    await loadEmailStatus(rfq.id);
  }

  async function retryFailed() {
    if (!activeRfq) return;
    setEmailBusy(true); setError('');
    try {
      const result = await onRetryFailedEmails(activeRfq.id);
      setNotice(emailResultNotice(result.result));
      setEmailData(result);
    } catch (exception) { setError(exception.message); }
    finally { setEmailBusy(false); }
  }

  async function resend(delivery) {
    if (!activeRfq) return;
    if (!window.confirm(`Resend the ${delivery.rfqReference} link to ${delivery.recipientEmail}? This creates a new delivery attempt.`)) return;
    setEmailBusy(true); setError('');
    try {
      const result = await onResendRfqEmail(activeRfq.id, delivery.id);
      setNotice(`Link resent to ${delivery.recipientEmail}. ${emailResultNotice(result.result)}`);
      setEmailData(result);
    } catch (exception) { setError(exception.message); }
    finally { setEmailBusy(false); }
  }

  async function award(quotationId) {
    try { await onAward(activeRfq.id, quotationId); await onLoadQuotes(activeRfq.id); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  const summary = emailData?.summary;
  const deliveries = emailData?.deliveries || [];

  return <>
    {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">{notice}</div>}
    {error && <div className="mb-4"><ErrorMessage>{error}</ErrorMessage></div>}

    <div><PageCard title="Request for quotations" description={`${rfqs.length} RFQs`}
      action={canCreate && <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Create RFQ</button>}>
      {rfqs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['RFQ', 'Requisition', 'Due date', 'Suppliers', 'Quotes', 'Status', 'Email status', ''].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{rfqs.map((rfq) => <tr key={rfq.id}>
        <td className="px-5 py-4 font-bold">{rfq.reference}</td>
        <td className="px-5 py-4">{rfq.requisition}</td>
        <td className="px-5 py-4">{dateLabel(rfq.dueDate)}</td>
        <td className="px-5 py-4">{rfq.invitedSuppliers}</td>
        <td className="px-5 py-4">{rfq.quotations}</td>
        <td className="px-5 py-4">{rfq.status}{rfq.selectedSupplier && <div className="text-[10px] text-muted">{rfq.selectedSupplier}</div>}</td>
        <td className="px-5 py-4"><button onClick={() => viewEmailStatus(rfq)} className="font-bold text-brand">Email status</button></td>
        <td className="px-5 py-4"><button onClick={() => viewQuotes(rfq)} className="font-bold text-brand">Quotes</button></td>
      </tr>)}</tbody></table></div> : <EmptyState>No RFQs have been created.</EmptyState>}
    </PageCard></div>

    {activeRfq && <div className="mt-5"><PageCard title={`Quotations · ${activeRfq.reference}`} description="Compare amount, delivery time, quality, and rating" action={canEvaluate && ['Sent', 'Evaluating'].includes(activeRfq.status) && <button onClick={() => setQuoteOpen(true)} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white">Record quote</button>}>
      {quotations.length ? <div className="overflow-x-auto"><table className="w-full min-w-[610px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Supplier', 'Amount', 'Delivery', 'Quality', 'Rating', 'Award'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{quotations.map((quote) => <tr key={quote.id}><td className="px-4 py-3 font-bold">{quote.supplier}{quote.selected && ' · Selected'}</td><td className="px-4 py-3">{currency(quote.amount)}</td><td className="px-4 py-3">{quote.deliveryDays} days</td><td className="px-4 py-3">{quote.qualityScore}/5</td><td className="px-4 py-3">{quote.ratingScore}/5</td><td className="px-4 py-3">{canAward && <button disabled={quote.selected || !['Sent', 'Evaluating'].includes(activeRfq.status)} onClick={() => award(quote.id)} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700 disabled:opacity-40">Select</button>}</td></tr>)}</tbody></table></div> : <EmptyState>No quotations received.</EmptyState>}
    </PageCard></div>}

    {activeRfq && <div className="mt-5"><PageCard title={`Email delivery · ${activeRfq.reference}`} description=" SMTP acceptance is shown as Accepted by Email Provider, never as Delivered"
      action={summary?.Failed > 0 && <button disabled={emailBusy} onClick={retryFailed} className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={13} />Retry failed emails</button>}>
      {emailLoading && <div className="p-5 text-sm text-muted">Loading delivery status…</div>}
      {!emailLoading && !emailData && <EmptyState>Select “Email status” on an RFQ to see individual delivery records.</EmptyState>}
      {!emailLoading && summary && <>
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3 lg:grid-cols-6">
          {[['Suppliers', summary.suppliers], ['Accepted by provider', summary['Accepted by Email Provider']], ['Delivered', summary.Delivered], ['Opened', summary.Opened], ['Failed', summary.Failed], ['Pending', summary.Pending]].map(([label, value]) => <div key={label} className="rounded-lg border bg-slate-50 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">{label}</div><div className="mt-1 text-lg font-extrabold">{value || 0}</div></div>)}
        </div>
        {deliveries.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Supplier', 'Recipient', 'Status', 'Attempts', 'Sent', 'Provider message ID', 'Opened', 'Failure reason', ''].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{deliveries.map((delivery) => <tr key={delivery.id}>
          <td className="px-4 py-3 font-bold">{delivery.supplier}</td>
          <td className="px-4 py-3">{delivery.recipientEmail || <span className="text-red-600">No valid email</span>}</td>
          <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClass(delivery.status)}`}>{delivery.status}</span></td>
          <td className="px-4 py-3">{delivery.attempts}</td>
          <td className="px-4 py-3">{dateTimeLabel(delivery.sentAt)}</td>
          <td className="max-w-[180px] truncate px-4 py-3 font-mono text-[10px] text-muted" title={delivery.providerMessageId || ''}>{delivery.providerMessageId || '—'}</td>
          <td className="px-4 py-3">{dateTimeLabel(delivery.openedAt)}</td>
          <td className="max-w-[220px] px-4 py-3 text-red-600">{delivery.errorDetails?.message || '—'}</td>
          <td className="px-4 py-3"><button disabled={emailBusy} onClick={() => resend(delivery)} className="inline-flex items-center gap-1 font-bold text-brand disabled:opacity-50"><Send size={12} />Resend link</button></td>
        </tr>)}</tbody></table></div> : <EmptyState>No Supplier invitations were recorded for this RFQ.</EmptyState>}
      </>}
    </PageCard></div>}

    {createOpen && <RFQForm requisitions={requisitions} suppliers={suppliers} initialRequisitionId={initialRequisitionId || query.requisition} onClose={() => setCreateOpen(false)} onSubmit={createRfq} />}
    {quoteOpen && activeRfq && <QuoteForm rfq={activeRfq} suppliers={suppliers} onClose={() => setQuoteOpen(false)} onSubmit={onQuote} />}
  </>;
}

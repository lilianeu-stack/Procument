import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, Check, CheckCircle2, ChevronDown, Clock3, FileEdit, FileText,
  RefreshCw, Search, Send, X as XIcon
} from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import CommitteeReviewModal from './CommitteeReviewModal.jsx';
import { currency, dateTimeLabel } from '../utils/format.js';
import { toDateTimeInputValue, toUtcDateTimeInputValue } from '../utils/dates.js';

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rfq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function SupplierMultiSelect({ suppliers, selectedIds, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function closeOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, []);

  const active = suppliers.filter((supplier) => supplier.status === 'Active');
  const term = query.trim().toLowerCase();
  const filtered = term
    ? active.filter((supplier) => `${supplier.name || ''} ${supplier.email || ''}`.toLowerCase().includes(term))
    : active;
  const selected = active.filter((supplier) => selectedIds.includes(supplier.id));

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }

  return <div ref={containerRef} className="relative">
    <label className="block text-xs font-bold">Suppliers</label>
    <button type="button" onClick={() => setOpen((value) => !value)} className="field mt-1 flex w-full items-center justify-between text-left text-xs font-normal">
      <span className={selected.length ? 'text-slate-700' : 'text-muted'}>
        {selected.length ? `${selected.length} supplier${selected.length === 1 ? '' : 's'} selected` : 'Search and select suppliers…'}
      </span>
      <ChevronDown size={14} />
    </button>
    {open && <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
      <div className="border-b border-slate-100 p-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2">
          <Search size={14} className="text-muted" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers by name or email…" className="w-full py-2 text-xs outline-none" />
        </div>
      </div>
      <div className="max-h-44 overflow-auto py-1">
        {filtered.length ? filtered.map((supplier) => {
          const checked = selectedIds.includes(supplier.id);
          return <button type="button" key={supplier.id} onClick={() => toggle(supplier.id)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
            <span className={`mt-0.5 grid h-4 w-4 place-items-center rounded border ${checked ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>
              {checked && <Check size={11} />}
            </span>
            <span>
              <span className="block text-xs font-bold text-slate-800">{supplier.name}</span>
              <span className="block text-[11px] text-muted">{supplier.email || 'No email on file'}</span>
            </span>
          </button>;
        }) : <p className="px-3 py-3 text-xs text-muted">No suppliers found.</p>}
      </div>
    </div>}
    {selected.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {selected.map((supplier) => <span key={supplier.id} className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-1 text-[11px] font-bold text-brand">
        {supplier.name}
        <button type="button" onClick={() => toggle(supplier.id)} aria-label={`Remove ${supplier.name}`} className="rounded-full p-0.5 hover:bg-brand/10"><XIcon size={11} /></button>
      </span>)}
    </div>}
  </div>;
}

export function RFQForm({ requisitions = [], suppliers = [], initialRequisitionId, onClose, onSubmit }) {
  const [form, setForm] = useState({
    requisitionId: initialRequisitionId ? String(initialRequisitionId) : '',
    startDate: '',
    dueDate: '',
    message: ''
  });
  const [supplierIds, setSupplierIds] = useState([]);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!form.startDate || !form.dueDate) {
      setError('Enter both the start date/time and the end date/time (deadline).');
      return;
    }
    if (new Date(form.dueDate).getTime() < new Date(form.startDate).getTime()) {
      setError('The end date/time (deadline) must be on or after the start date/time.');
      return;
    }
    if (!supplierIds.length) {
      setError('Select at least one supplier.');
      return;
    }
    submitting.current = true;
    setBusy(true); setError('');
    try {
      await onSubmit({
        ...form,
        startDate: toUtcDateTimeInputValue(form.startDate),
        dueDate: toUtcDateTimeInputValue(form.dueDate),
        requisitionId: Number(initialRequisitionId || form.requisitionId),
        supplierIds,
        idempotencyKey
      });
    } catch (exception) { setError(exception.message); }
    finally { submitting.current = false; setBusy(false); }
  }

  const eligibleRequests = requisitions.filter((request) => ['Forwarded to Procurement', 'Under Procurement Review'].includes(request.status));
  const nowDateTime = toDateTimeInputValue();

  return <Modal title="Create request for quotation" size="md" onClose={onClose}><form onSubmit={submit} className="space-y-3">
    {!initialRequisitionId && <label className="block text-xs font-bold">Request<select required value={form.requisitionId} onChange={(event) => setForm({ ...form, requisitionId: event.target.value })} className="field"><option value="">Select a request…</option>{eligibleRequests.map((request) => <option value={request.id} key={request.id}>{request.reference} · {request.requester}</option>)}</select></label>}
    <fieldset>
      <legend className="mb-2 text-xs font-bold">Send date</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-muted">Start date<input required type="datetime-local" step="60" value={form.startDate} min={nowDateTime} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className="field" /></label>
        <label className="block text-xs font-bold text-muted">End date (deadline)<input required type="datetime-local" step="60" value={form.dueDate} min={form.startDate || nowDateTime} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className="field" /></label>
      </div>
    </fieldset>
    <SupplierMultiSelect suppliers={suppliers} selectedIds={supplierIds} onChange={setSupplierIds} />
    <label className="block text-xs font-bold">Message to suppliers<textarea rows="3" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Add a message that will be included in the email sent to the selected suppliers…" className="field h-auto py-2" /></label>
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

export function emailResultNotice(result) {
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

function fallbackRfqStats(rfqs) {
  return {
    total: rfqs.length,
    draft: rfqs.filter((rfq) => rfq.status === 'Draft').length,
    sent: rfqs.filter((rfq) => rfq.status === 'Sent').length,
    awaitingResponses: rfqs.filter((rfq) => rfq.status === 'Sent' && Number(rfq.quotations) === 0).length,
    receivedQuotations: rfqs.filter((rfq) => Number(rfq.quotations) > 0).length,
    closed: rfqs.filter((rfq) => rfq.status === 'Closed').length
  };
}

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total RFQs', icon: FileText, note: 'All registered RFQs', status: '', response: 'all' },
  { key: 'draft', label: 'Draft RFQs', icon: FileEdit, note: 'Not sent to suppliers', status: 'Draft', response: 'all' },
  { key: 'sent', label: 'Sent RFQs', icon: Send, note: 'Invitations issued', status: 'Sent', response: 'all' },
  { key: 'awaitingResponses', label: 'Awaiting Supplier Responses', icon: Clock3, note: 'Sent, no quotation yet', status: 'Sent', response: 'awaiting' },
  { key: 'receivedQuotations', label: 'Received Quotations', icon: CheckCircle2, note: 'At least one quotation', status: '', response: 'responded' },
  { key: 'closed', label: 'Closed RFQs', icon: Archive, note: 'Closed without award', status: 'Closed', response: 'all' }
];

export default function RfqsPage({
  rfqs = [], requisitions = [], suppliers = [], quotations = [], user = {}, query = {},
  committeeMembers = [], initialRequisitionId, autoOpenCreate = false,
  onCreate, onLoadQuotes, onQuote, onAward, onLoadEmailDeliveries,
  onRetryFailedEmails, onResendRfqEmail, onSendToCommittee, onPreviewCommittee,
  onLoadCommitteeReviews, onResendCommitteeReview, getRfqStats
}) {
  const sendingRfq = useRef(false);
  const notificationRfqHandled = useRef('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [committeeReviews, setCommitteeReviews] = useState([]);
  const [createOpen, setCreateOpen] = useState(autoOpenCreate || Boolean(query.requisition));
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [activeRfq, setActiveRfq] = useState(null);
  const [detailRfq, setDetailRfq] = useState(null);
  const [responseFilter, setResponseFilter] = useState('all');
  const [responseDetails, setResponseDetails] = useState(null);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailData, setEmailData] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [committeeBusy, setCommitteeBusy] = useState(false);
  const [selectedRfqIds, setSelectedRfqIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [rfqStats, setRfqStats] = useState(null);
  const canEvaluate = ['admin', 'committee', 'procurement'].includes(user.role);
  const canAward = ['admin', 'committee'].includes(user.role);
  const canSendToCommittee = ['admin', 'procurement'].includes(user.role);

  useEffect(() => {
    if (!getRfqStats) return undefined;
    let active = true;
    getRfqStats()
      .then((response) => { if (active) setRfqStats(response.stats || null); })
      .catch((exception) => { if (active) setError(exception.message || 'RFQ statistics could not be loaded.'); });
    return () => { active = false; };
  }, [getRfqStats, rfqs]);

  const loadEmailStatus = useCallback(async (rfqId) => {
    if (!onLoadEmailDeliveries || !rfqId) return;
    setEmailLoading(true);
    try { setEmailData(await onLoadEmailDeliveries(rfqId)); }
    catch (exception) { setError(exception.message || 'Email delivery status could not be loaded.'); }
    finally { setEmailLoading(false); }
  }, [onLoadEmailDeliveries]);

  const loadCommitteeReviews = useCallback(async (rfqId) => {
    if (!onLoadCommitteeReviews || !rfqId) { setCommitteeReviews([]); return; }
    try {
      const result = await onLoadCommitteeReviews(rfqId);
      setCommitteeReviews(result.reviews || []);
    } catch (exception) {
      setCommitteeReviews([]);
      setError(exception.message || 'Committee decisions could not be loaded.');
    }
  }, [onLoadCommitteeReviews]);

  async function resendCommitteeLink(review) {
    if (!onResendCommitteeReview || !detailRfq) return;
    if (!window.confirm(`Resend the decision link to ${review.recipientEmail}? The same private link will be used.`)) return;
    setCommitteeBusy(true); setError(''); setNotice('');
    try {
      const result = await onResendCommitteeReview(detailRfq.id, review.id);
      setNotice(result.message || `Decision link resent to ${review.recipientEmail}.`);
      await loadCommitteeReviews(detailRfq.id);
    } catch (exception) {
      setError(exception.message || 'The decision link could not be resent.');
    } finally {
      setCommitteeBusy(false);
    }
  }

  useEffect(() => {
    setCommitteeReviews([]);
    if (detailRfq?.id) loadCommitteeReviews(detailRfq.id);
  }, [detailRfq?.id, loadCommitteeReviews]);

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
        const createdRfq = { id: result.id, reference: result.reference, status: 'Sent' };
        setDetailRfq(createdRfq);
        setResponseDetails(null);
        setResponsesLoading(true);
        try { setResponseDetails(await onLoadQuotes(result.id)); }
        catch (exception) { setError(exception.message || 'RFQ details could not be loaded.'); }
        finally { setResponsesLoading(false); }
        await loadEmailStatus(result.id);
      }
      return result;
    } finally { sendingRfq.current = false; }
  }

  async function viewQuotes(rfq) {
    setDetailRfq(rfq); setResponseDetails(null); setError(''); setNotice('');
    setResponsesLoading(true);
    try { setResponseDetails(await onLoadQuotes(rfq.id)); }
    catch (exception) { setError(exception.message); }
    finally { setResponsesLoading(false); }
  }

  // Notification links point here with ?rfq=<id>; open that RFQ's responses.
  useEffect(() => {
    if (!query.rfq || !rfqs.length || notificationRfqHandled.current === String(query.rfq)) return;
    const match = rfqs.find((rfq) => String(rfq.id) === String(query.rfq));
    if (!match) return;
    notificationRfqHandled.current = String(query.rfq);
    setDetailRfq(match); setResponseDetails(null); setError(''); setNotice('');
    if (onLoadQuotes) {
      setResponsesLoading(true);
      onLoadQuotes(match.id)
        .then(setResponseDetails)
        .catch((exception) => setError(exception.message))
        .finally(() => setResponsesLoading(false));
    }
  }, [query.rfq, rfqs, activeRfq?.id, onLoadQuotes]);

  async function viewEmailStatus(rfq) {
    setActiveRfq(rfq); setResponseDetails(null); setError(''); setNotice('');
    setResponsesLoading(true);
    onLoadQuotes(rfq.id)
      .then(setResponseDetails)
      .catch((exception) => setError(exception.message || 'RFQ details could not be loaded.'))
      .finally(() => setResponsesLoading(false));
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
    try {
      const rfqId = (activeRfq || detailRfq).id;
      await onAward(rfqId, quotationId);
      setResponseDetails(await onLoadQuotes(rfqId));
      setError('');
    }
    catch (exception) { setError(exception.message); }
  }

  const summary = emailData?.summary;
  const deliveries = emailData?.deliveries || [];
  const currentStats = rfqStats || fallbackRfqStats(rfqs);
  const respondedCount = rfqs.filter((rfq) => (rfq.responses || []).length > 0).length;
  const visibleRfqs = rfqs.filter((rfq) => {
    const responded = (rfq.responses || []).length > 0;
    const matchesStatus = !statusFilter || rfq.status === statusFilter;
    const matchesResponses = responseFilter === 'all' || (responseFilter === 'responded' ? responded : !responded);
    return matchesStatus && matchesResponses;
  });
  const eligibleVisibleRfqs = visibleRfqs.filter((rfq) => (rfq.responses || []).length > 0);
  const allVisibleEligibleSelected = eligibleVisibleRfqs.length > 0 &&
    eligibleVisibleRfqs.every((rfq) => selectedRfqIds.includes(String(rfq.id)));
  const selectedRfq = selectedRfqIds.length === 1
    ? rfqs.find((rfq) => String(rfq.id) === selectedRfqIds[0])
    : null;
  const loadedResponseDetails = String(responseDetails?.rfq?.id) === String(detailRfq?.id) ? responseDetails : null;

  function toggleRfqSelection(rfqId) {
    const id = String(rfqId);
    setSelectedRfqIds((selected) => selected.includes(id)
      ? selected.filter((selectedId) => selectedId !== id)
      : [...selected, id]);
  }

  function toggleVisibleRfqSelection() {
    const visibleIds = eligibleVisibleRfqs.map((rfq) => String(rfq.id));
    setSelectedRfqIds((selected) => {
      if (allVisibleEligibleSelected) return selected.filter((id) => !visibleIds.includes(id));
      return [...new Set([...selected, ...visibleIds])];
    });
  }

  function openCommitteeReview() {
    if (!onPreviewCommittee || !selectedRfqIds.length) return;
    setError('');
    setNotice('');
    setReviewOpen(true);
  }

  function viewCommitteeResults() {
    if (!selectedRfq) return;
    viewQuotes(selectedRfq);
  }

  async function sendCommitteeReview(payload) {
    setCommitteeBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await onSendToCommittee(payload);
      setNotice(`Email provider accepted the review form for ${result.accepted} of ${result.total} selected committee member${result.total === 1 ? '' : 's'}; provider acceptance does not confirm inbox delivery.`);
      const failures = (result.deliveries || []).filter((delivery) => delivery.status !== 'Accepted by Email Provider');
      if (failures.length) {
        setError(`Could not send to ${failures.map((delivery) => `${delivery.email}: ${delivery.error || delivery.status}`).join('; ')}`);
      } else {
        setSelectedRfqIds([]);
      }
      if (detailRfq?.id && (payload.rfqIds || []).map(Number).includes(Number(detailRfq.id))) {
        await loadCommitteeReviews(detailRfq.id);
      }
      return result;
    } catch (exception) {
      setError(exception.message || 'The selected RFQs could not be sent to the Procurement Committee.');
      throw exception;
    } finally {
      setCommitteeBusy(false);
    }
  }

  return <>
    {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">{notice}</div>}
    {error && <div className="mb-4"><ErrorMessage>{error}</ErrorMessage></div>}

    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {SUMMARY_CARDS.map((card) => {
        const active = statusFilter === card.status && responseFilter === card.response;
        return <button key={card.key} type="button" aria-pressed={active}
          onClick={() => { setStatusFilter(card.status); setResponseFilter(card.response); }}
          className={`flex min-h-[126px] flex-col justify-between rounded-xl border p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? 'border-black bg-reference text-black' : 'border-brand bg-white text-black hover:bg-hover'}`}>
          <span className="flex items-start justify-between gap-2 text-xs font-semibold">
            {card.label}<card.icon size={16} aria-hidden="true" />
          </span>
          <span className="display-font mt-3 text-2xl font-extrabold">{currentStats[card.key] ?? '—'}</span>
          <span className="mt-1 text-[10px] text-muted">{card.note}</span>
        </button>;
      })}
    </div>

    <div>
      <div className="mb-3 flex justify-end">
        <label className="block w-full text-xs font-bold sm:w-64">
          Filter by response
          <select value={responseFilter} onChange={(event) => setResponseFilter(event.target.value)} className="field mt-1">
            <option value="all">All RFQs</option>
            <option value="responded">Supplier responded</option>
            <option value="awaiting">Awaiting response</option>
          </select>
        </label>
      </div>
      <PageCard title="RFQs" description={`${visibleRfqs.length} of ${rfqs.length} RFQs · ${respondedCount} with supplier responses`}
        action={<div className="flex flex-wrap justify-end gap-2">
          {canSendToCommittee && <button type="button" onClick={openCommitteeReview}
            disabled={!selectedRfqIds.length || committeeBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">
            <Send size={14} />{committeeBusy ? 'Sending…' : `Send to Committee${selectedRfqIds.length ? ` (${selectedRfqIds.length})` : ''}`}
          </button>}
          {canSendToCommittee && <button type="button" onClick={viewCommitteeResults}
            disabled={!selectedRfq || committeeBusy}
            title={!selectedRfq ? 'Select exactly one RFQ to view committee results' : 'View committee results for the selected RFQ'}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-tint px-3 py-2 text-xs font-bold text-accent-text hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">
            <CheckCircle2 size={14} />View Commit Results
          </button>}
        </div>}>
      {visibleRfqs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>
        {canSendToCommittee && <th className="px-3 py-3">
          <input type="checkbox" checked={allVisibleEligibleSelected} disabled={!eligibleVisibleRfqs.length || committeeBusy}
            onChange={toggleVisibleRfqSelection} aria-label="Select all RFQs with supplier responses shown" />
        </th>}
        {['RFQ', 'Requisition', 'Due date', 'Suppliers', 'Quotes', 'Supplier responses', 'Status', 'Email status', 'Actions'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}
      </tr></thead><tbody className="divide-y">{visibleRfqs.map((rfq) => <tr key={rfq.id}>
        {canSendToCommittee && <td className="px-3 py-4">
          <input type="checkbox" checked={selectedRfqIds.includes(String(rfq.id))}
            disabled={!(rfq.responses || []).length || committeeBusy}
            onChange={() => toggleRfqSelection(rfq.id)}
            aria-label={`Select ${rfq.reference} for Procurement Committee`} />
        </td>}
        <td className="px-5 py-4 font-bold">
          <button type="button" onClick={() => viewQuotes(rfq)} className="text-brand hover:underline">{rfq.reference}</button>
        </td>
        <td className="px-5 py-4">{rfq.requisition}</td>
        <td className="px-5 py-4">{dateTimeLabel(rfq.dueDate)}</td>
        <td className="px-5 py-4">{rfq.invitedSuppliers}</td>
        <td className="px-5 py-4">{rfq.quotations}</td>
        <td className="max-w-[320px] px-5 py-4">
          {(rfq.responses || []).length ? <div className="space-y-1">
            {rfq.responses.slice(0, 3).map((response) => <div key={response.id} className="rounded bg-emerald-50 px-2 py-1">
              <div className="font-bold text-emerald-800">{response.supplier} · {currency(response.amount)}</div>
              {(response.notes || response.items?.some((item) => item.comment)) && <div className="truncate text-[10px] text-muted" title={response.notes || response.items?.find((item) => item.comment)?.comment || ''}>
                {response.notes || response.items?.find((item) => item.comment)?.comment || ''}
              </div>}
            </div>)}
            {rfq.responses.length > 3 && <div className="text-[10px] text-muted">+{rfq.responses.length - 3} more</div>}
          </div> : <span className="text-muted">No replies yet</span>}
        </td>
        <td className="px-5 py-4">{rfq.status}{rfq.selectedSupplier && <div className="text-[10px] text-muted">{rfq.selectedSupplier}</div>}</td>
        <td className="px-5 py-4"><button onClick={() => viewEmailStatus(rfq)} className="font-bold text-brand">Email status</button></td>
        <td className="px-5 py-4"><button type="button" onClick={() => viewQuotes(rfq)} className="font-bold text-brand">
          {(rfq.responses || []).length ? `View responses (${rfq.responses.length})` : 'View RFQ details'}
        </button></td>
      </tr>)}</tbody></table></div> : <EmptyState>{rfqs.length ? 'No RFQs match this response filter.' : 'No RFQs have been created.'}</EmptyState>}
    </PageCard></div>

    {detailRfq && <Modal title={`RFQ details and supplier responses · ${detailRfq.reference}`} size="xl" onClose={() => setDetailRfq(null)}>
      {canEvaluate && ['Sent', 'Evaluating'].includes(detailRfq.status) && <div className="mb-4 flex justify-end">
        <button onClick={() => { setActiveRfq(detailRfq); setQuoteOpen(true); }} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">Record quote</button>
      </div>}
        {responsesLoading ? <div role="status" className="p-5 text-sm text-muted">Loading RFQ and supplier response details…</div> :
          loadedResponseDetails ? <>
            <section className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide">Invitation sent to suppliers</h3>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-muted">Requisition</dt><dd className="mt-1 font-semibold">{loadedResponseDetails.rfq.requisitionReference}</dd></div>
                <div><dt className="text-muted">Request title</dt><dd className="mt-1 font-semibold">{loadedResponseDetails.rfq.title}</dd></div>
                <div><dt className="text-muted">Department</dt><dd className="mt-1 font-semibold">{loadedResponseDetails.rfq.department || '—'}</dd></div>
                <div><dt className="text-muted">Sent</dt><dd className="mt-1 font-semibold">{dateTimeLabel(loadedResponseDetails.rfq.issuedAt)}</dd></div>
                <div><dt className="text-muted">Response deadline</dt><dd className="mt-1 font-semibold">{dateTimeLabel(loadedResponseDetails.rfq.dueDate)}</dd></div>
                <div><dt className="text-muted">RFQ status</dt><dd className="mt-1 font-semibold">{loadedResponseDetails.rfq.status}</dd></div>
              </dl>
              {loadedResponseDetails.rfq.message && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5">
                <div className="font-bold">Message from Procurement</div>
                <p className="mt-1 whitespace-pre-wrap text-muted">{loadedResponseDetails.rfq.message}</p>
              </div>}
              <h4 className="mt-4 text-xs font-bold">Items and prices included in the invitation</h4>
              {loadedResponseDetails.rfq.requestedItems?.length ? <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[580px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Item', 'Quantity', 'Estimated unit price', 'Estimated total'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
                  <tbody className="divide-y">{loadedResponseDetails.rfq.requestedItems.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                    <td className="px-3 py-2 font-semibold">{item.itemName}</td>
                    <td className="px-3 py-2">{item.quantity} {item.unit}</td>
                    <td className="px-3 py-2">{currency(item.estimatedUnitCost)}</td>
                    <td className="px-3 py-2 font-bold">{currency(item.lineTotal)}</td>
                  </tr>)}</tbody>
                </table>
              </div> : <p className="mt-2 text-xs text-muted">No requested item details were found.</p>}
            </section>

            <div className="px-5 py-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide">Supplier responses ({loadedResponseDetails.quotations.length})</h3>
              {loadedResponseDetails.quotations.length ? <div className="mt-3 space-y-3">
                {loadedResponseDetails.quotations.map((quote) => <article key={quote.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-extrabold">{quote.supplier}{quote.selected && <span className="ml-2 text-emerald-700">Selected</span>}</h4>
                      <p className="mt-1 text-xs text-muted">
                        {quote.supplierContact ? `${quote.supplierContact} · ` : ''}{quote.supplierEmail || 'No email on file'}
                        {quote.supplierPhone ? ` · ${quote.supplierPhone}` : ''}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">Submitted {dateTimeLabel(quote.submittedAt)}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-extrabold text-brand">{currency(quote.amount)}</div>
                      {Number(quote.deliveryDays) > 0 && <div className="text-xs text-muted">Delivery: {quote.deliveryDays} days</div>}
                      {(quote.qualityScore !== null || quote.ratingScore !== null) && <div className="mt-1 text-[10px] text-muted">
                        Evaluation scores: quality {Number(quote.qualityScore) || 0}/5 · rating {Number(quote.ratingScore) || 0}/5
                      </div>}
                    </div>
                  </div>
                  {quote.items.length ? <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Item', 'Description', 'Quantity', 'Unit price', 'Line total', 'Supplier comment'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
                      <tbody className="divide-y">{quote.items.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                        <td className="px-3 py-2 font-semibold">{item.itemName}</td>
                        <td className="px-3 py-2 text-muted">{item.description || '—'}</td>
                        <td className="px-3 py-2">{item.quantity} {item.unit}</td>
                        <td className="px-3 py-2">{currency(item.unitPrice)}</td>
                        <td className="px-3 py-2 font-bold">{currency(item.lineTotal)}</td>
                        <td className="whitespace-pre-wrap px-3 py-2 text-muted">{item.comment || '—'}</td>
                      </tr>)}</tbody>
                    </table>
                  </div> : <p className="mt-3 text-xs text-muted">No itemized prices were submitted.</p>}
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                    <div className="font-bold">Overall supplier comment</div>
                    <p className="mt-1 whitespace-pre-wrap text-muted">{quote.notes || 'No additional comment.'}</p>
                  </div>
                  {canAward && <div className="mt-3 flex justify-end">
                    <button disabled={quote.selected || !['Sent', 'Evaluating'].includes(detailRfq.status)} onClick={() => award(quote.id)} className="rounded bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-40">
                      {quote.selected ? 'Selected supplier' : 'Select supplier'}
                    </button>
                  </div>}
                </article>)}
              </div> : <EmptyState>No supplier responses have been received for this RFQ.</EmptyState>}
            </div>

            {(committeeReviews.length > 0 || canSendToCommittee) && <div className="border-t border-slate-100 px-5 py-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide">Committee decisions received ({committeeReviews.length})</h3>
              {committeeReviews.length ? <div className="mt-3 space-y-3">
                {committeeReviews.map((review) => <article key={review.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-extrabold">{review.recipientName} · {review.recipientEmail}</h4>
                    <div className="flex items-center gap-2">
                      {canSendToCommittee && !review.submittedAt && <button
                        type="button"
                        disabled={committeeBusy}
                        onClick={() => resendCommitteeLink(review)}
                        className="inline-flex items-center gap-1 rounded-lg border border-brand px-2 py-1 text-[10px] font-bold text-brand disabled:opacity-50">
                        <RefreshCw size={12} />Resend link
                      </button>}
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${review.submittedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {review.submittedAt ? `Submitted ${dateTimeLabel(review.submittedAt)}` : 'Awaiting decision'}
                      </span>
                    </div>
                  </div>
                  {review.decisions?.length
                    ? <ul className="mt-3 space-y-2">
                      {review.decisions.map((decision) => <li key={`${review.id}-${decision.supplierId}`} className="rounded-lg bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold">{decision.supplier}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${decision.decision === 'Accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {decision.decision === 'Rejected' ? 'Deny' : decision.decision}
                          </span>
                        </div>
                        <p className="mt-1 text-muted">Submitted by <strong className="text-slate-800">{decision.responderName || review.recipientName}</strong>{decision.decidedAt ? ` · ${dateTimeLabel(decision.decidedAt)}` : ''}</p>
                        {decision.reason && <p className="mt-1 whitespace-pre-wrap text-muted">Reason: {decision.reason}</p>}
                      </li>)}
                    </ul> : <p className="mt-2 text-xs text-muted">No decisions have been submitted from this link yet.</p>}
                </article>)}
              </div> : <p className="mt-3 text-xs text-muted">No committee results are available for this RFQ yet.</p>}
            </div>}
          </> : <EmptyState>RFQ details could not be loaded.</EmptyState>}
    </Modal>}

    {activeRfq && <div className="mt-5"><PageCard title={`Email delivery · ${activeRfq.reference}`} description=" SMTP acceptance is shown as Accepted by Email Provider, never as Delivered"
      action={summary?.Failed > 0 && <button disabled={emailBusy} onClick={retryFailed} className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black disabled:opacity-50"><RefreshCw size={13} />Retry failed emails</button>}>
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

    {reviewOpen && <CommitteeReviewModal
      rfqIds={selectedRfqIds.map(Number)}
      members={committeeMembers}
      onClose={() => setReviewOpen(false)}
      onPreview={onPreviewCommittee}
      onSend={sendCommitteeReview}
    />}
    {createOpen && <RFQForm requisitions={requisitions} suppliers={suppliers} initialRequisitionId={initialRequisitionId || query.requisition} onClose={() => setCreateOpen(false)} onSubmit={createRfq} />}
    {quoteOpen && activeRfq && <QuoteForm rfq={activeRfq} suppliers={suppliers} onClose={() => setQuoteOpen(false)} onSubmit={onQuote} />}
  </>;
}

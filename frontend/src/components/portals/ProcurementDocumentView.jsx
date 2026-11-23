import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Download, Eye, FileCheck2, FileText, Paperclip,
  RefreshCw
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import Modal from '../ui/Modal.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import {
  EmptyState, ErrorState, KeyValue, LoadingState, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import MaterialRequestDocument from '../documents/MaterialRequestDocument.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import { downloadBinary, previewBinary } from '../../utils/attachments.js';
import { PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';

const HISTORY_LABELS = {
  created: 'Created by Requester',
  submitted: 'Submitted to Department Supervisor',
  resubmitted: 'Resubmitted to Department Supervisor',
  information_requested: 'Additional information requested by Supervisor',
  approved_by_supervisor: 'Reviewed and approved by Supervisor',
  rejected_by_supervisor: 'Rejected by Supervisor',
  forwarded_to_procurement: 'Forwarded to Procurement',
  received_by_procurement: 'Received by Procurement',
  procurement_review_started: 'Procurement review started',
  procurement_review_started_by_rfq: 'Procurement processing started'
};

const PREVIEWABLE = new Set([
  'application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg', 'image/webp'
]);

function Section({ title, icon: Icon, children, id }) {
  return <section id={id} className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
    <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
      {Icon && <Icon size={15} className="text-brand" />}
      <h2 className="text-xs font-extrabold uppercase tracking-wide">{title}</h2>
    </header>
    <div className="p-5">{children}</div>
  </section>;
}

function historySummary(entry) {
  const parts = [];
  if (entry.previousStatus || entry.newStatus) {
    parts.push(`${entry.previousStatus || '—'} → ${entry.newStatus || '—'}`);
  }
  if (entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)) {
    const detailText = Object.entries(entry.details)
      .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' · ');
    if (detailText) parts.push(detailText);
  }
  return parts.join(' · ');
}

export default function ProcurementDocumentView({ id, portalApi, navigate, query = {} }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showOfficial, setShowOfficial] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getReceivedRequest(id);
      setRequest(response.requisition);
    } catch (exception) {
      setError(exception.message || 'The document could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, id]);

  useEffect(() => { load(); }, [load]);

  function back() {
    const next = { ...query };
    delete next.view;
    navigate(RECEIVED_REQUESTS_PAGE, next);
  }

  function attachmentPath(attachmentId, inline = false) {
    return `/procurement/received-requests/${id}/attachments/${attachmentId}${inline ? '?inline=1' : ''}`;
  }

  async function downloadAttachment(file) {
    try {
      setActionError('');
      await downloadBinary(attachmentPath(file.id), file.fileName);
    } catch (exception) { setActionError(exception.message); }
  }

  async function previewAttachment(file) {
    try {
      setActionError('');
      await previewBinary(attachmentPath(file.id, true), file.fileName);
    } catch (exception) { setActionError(exception.message); }
  }

  async function review() {
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await portalApi.reviewReceivedRequest(id);
      setNotice(result?.message || 'Review recorded.');
      await load();
    } catch (exception) { setActionError(exception.message || 'The review could not be recorded.'); }
    finally { setBusy(false); }
  }

  function continueProcessing() {
    navigate(PROCUREMENT_PROCESSING_PAGE, { request: id, tab: 'rfqs' });
  }

  if (loading && !request) return <LoadingState label="Opening full document…" />;
  if (error || !request) return <>
    <ErrorState message={error} onRetry={load} />
    <button type="button" onClick={back} className={primaryButtonClass()}><ArrowLeft size={14} />Back to Received Requests</button>
  </>;

  const items = request.items || [];
  const financials = request.financials || {
    subtotal: Number(request.total) || 0, taxes: 0, otherCosts: 0, grandTotal: Number(request.total) || 0
  };

  return <div className="space-y-5">
    <PrintHeader
      title={request.title}
      reference={request.reference}
      dates={`Submitted ${dateTimeLabel(request.submittedAt || request.createdAt)} · Forwarded ${dateTimeLabel(request.forwardedAt)}`}
    />
    <div className="no-print flex flex-wrap items-start justify-between gap-3">
      <div>
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-brand">
          <ArrowLeft size={14} />Back to Received Requests
        </button>
        <div className="mt-3 text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">
          Supervisor-forwarded document · {request.reference}
        </div>
        <h1 className="display-font mt-1 text-2xl font-extrabold tracking-tight">{request.title}</h1>
        <p className="mt-1 text-xs text-muted">{request.department || 'Department'} · Forwarded {dateTimeLabel(request.forwardedAt)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={request.status} />
        <button type="button" onClick={() => setShowOfficial(true)} className={secondaryButtonClass()}>
          <FileText size={14} />Official form
        </button>
        <button type="button" onClick={() => document.getElementById('received-attachments')?.scrollIntoView({ behavior: 'smooth' })} className={secondaryButtonClass()}>
          <Paperclip size={14} />View Attachments
        </button>
        <DownloadButton type="requisition" id={id} format="pdf" label="PDF" />
        <DownloadButton type="requisition" id={id} format="xlsx" label="Excel" />
        <DownloadButton type="requisition" id={id} format="csv" label="CSV" />
        <PrintButton label="Print Document" />
        <button type="button" onClick={review} disabled={busy} className={secondaryButtonClass()}>
          <FileCheck2 size={14} />{busy ? 'Saving…' : 'Review Request'}
        </button>
        <button type="button" onClick={continueProcessing} className={primaryButtonClass()}>
          <FileText size={14} />Continue Procurement Processing
        </button>
      </div>
    </div>

    {(actionError || notice) && <div className="no-print space-y-2">
      {actionError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
    </div>}

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="A. Request information" icon={FileText}>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          <KeyValue label="Request reference">{request.reference}</KeyValue>
          <KeyValue label="Current status"><StatusBadge value={request.status} /></KeyValue>
          <KeyValue label="Request title">{request.title}</KeyValue>
          <KeyValue label="Request date">{dateTimeLabel(request.createdAt)}</KeyValue>
          <KeyValue label="Department">{request.department || '—'}</KeyValue>
          <KeyValue label="Location">{request.location || '—'}</KeyValue>
          <KeyValue label="Priority">{request.priority || 'Medium'}</KeyValue>
          <KeyValue label="Requester name">{request.requester}</KeyValue>
          <KeyValue label="Requester email">{request.requesterEmail || '—'}</KeyValue>
          <KeyValue label="Requester phone">{request.requesterPhone || 'Not provided'}</KeyValue>
          <KeyValue label="Required delivery date">{dateLabel(request.requiredBy)}</KeyValue>
          <KeyValue label="Budget code">{request.budgetCode || '—'}</KeyValue>
          <KeyValue label="Date submitted">{dateTimeLabel(request.submittedAt || request.createdAt)}</KeyValue>
        </dl>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Purpose and justification</div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-ink">{request.justification || '—'}</p>
        </div>
        {request.informationResponse && <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">
          <strong>Requester response to information request:</strong> {request.informationResponse}
        </div>}
      </Section>

      <Section title="E. Department Supervisor approval & forwarding" icon={FileCheck2}>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          <KeyValue label="Supervisor full name">{request.supervisorName || request.forwardedByName || '—'}</KeyValue>
          <KeyValue label="Supervisor department">{request.supervisorDepartment || request.department || '—'}</KeyValue>
          <KeyValue label="Approval decision">{request.supervisorDecision || '—'}</KeyValue>
          <KeyValue label="Approval date and time">{dateTimeLabel(request.supervisorDecisionAt)}</KeyValue>
          <KeyValue label="Forwarding date and time">{dateTimeLabel(request.forwardedAt)}</KeyValue>
          <KeyValue label="Forwarded by">{request.forwardedByName || request.supervisorName || '—'}</KeyValue>
        </dl>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Supervisor comments</div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-ink">{request.supervisorNotes || 'No comments supplied.'}</p>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-800">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          This document was sent to Procurement by an authorized Department Supervisor and has not been altered.
        </div>
      </Section>
    </div>

    <Section title={`B. Requested items (${items.length})`} icon={FileText}>
      {items.length ? <TableScroll minWidth={880}>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-muted">
            <tr>
              {['Item name', 'Description / specifications', 'Quantity', 'Unit of measurement', 'Estimated unit price', 'Remarks', 'Estimated total price'].map((heading) =>
                <th key={heading} className="whitespace-nowrap px-3 py-2.5 font-bold">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => <tr key={item.id}>
              <td className="px-3 py-3 font-bold">{item.itemName}</td>
              <td className="min-w-[220px] px-3 py-3 text-muted">{item.description || '—'}</td>
              <td className="whitespace-nowrap px-3 py-3">{item.quantity}</td>
              <td className="whitespace-nowrap px-3 py-3">{item.unit || 'unit'}</td>
              <td className="whitespace-nowrap px-3 py-3">{currency(item.estimatedUnitCost)}</td>
              <td className="px-3 py-3 text-muted">{item.remarks || '—'}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-bold">{currency(item.lineTotal)}</td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No items recorded" description="This document has no item lines." />}
    </Section>

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="C. Financial summary" icon={FileCheck2}>
        <dl className="space-y-3 text-xs">
          {[
            ['Subtotal', financials.subtotal, false],
            ['Applicable taxes', financials.taxes, true],
            ['Other costs', financials.otherCosts, true]
          ].map(([label, value, optional]) => <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2">
            <dt className="text-muted">{label}{optional && Number(value) === 0 ? <span className="ml-1 text-[10px]">(not applicable)</span> : null}</dt>
            <dd className="font-bold">{currency(value)}</dd>
          </div>)}
          <div className="flex items-center justify-between pt-2 text-sm font-extrabold">
            <dt>Grand total</dt><dd className="text-brand">{currency(financials.grandTotal)}</dd>
          </div>
        </dl>
      </Section>

      <Section id="received-attachments" title={`D. Supporting documents and attachments (${(request.attachments || []).length})`} icon={Paperclip}>
        {!request.attachments?.length ? <EmptyState title="No attachments" description="The Requester submitted no supporting documents." /> :
          <ul className="space-y-2">
            {request.attachments.map((file) => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip size={14} className="shrink-0 text-muted" />
                <span className="truncate text-xs font-semibold">{file.fileName}</span>
                <span className="shrink-0 text-[10px] text-muted">{Math.max(1, Math.round(Number(file.fileSize) / 1024))} KB</span>
              </span>
              <span className="flex items-center gap-3">
                {PREVIEWABLE.has(file.mimeType) && <button type="button" onClick={() => previewAttachment(file)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">
                  <Eye size={12} />Preview
                </button>}
                <button type="button" onClick={() => downloadAttachment(file)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">
                  <Download size={12} />Download
                </button>
              </span>
            </li>)}
          </ul>}
        <p className="mt-3 text-[10px] text-muted">Attachments are served only to authorized Procurement and Administrator accounts.</p>
      </Section>
    </div>

    <Section title="F. Complete request history" icon={RefreshCw}>
      {!request.activity?.length ? <EmptyState title="No history recorded" /> : <ol className="space-y-5">
        {request.activity.map((entry, index) => <li key={entry.id} className="relative pl-7">
          {index < request.activity.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
          <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand ring-1 ring-brand" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold">{HISTORY_LABELS[entry.action] || String(entry.action).replace(/_/g, ' ')}</span>
            <span className="text-[10px] text-muted">{dateTimeLabel(entry.createdAt)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">{entry.actor ? `by ${entry.actor}` : 'System'}</div>
          {historySummary(entry) && <div className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[10px] leading-4 text-muted">
            {historySummary(entry)}
          </div>}
        </li>)}
      </ol>}
    </Section>

    <div className="no-print flex flex-wrap justify-end gap-2 pb-4">
      <button type="button" onClick={back} className={secondaryButtonClass()}><ArrowLeft size={14} />Back to Received Requests</button>
      <button type="button" onClick={continueProcessing} className={primaryButtonClass()}>Continue Procurement Processing</button>
    </div>

    {showOfficial && <Modal title="Official material request form" size="xl" onClose={() => setShowOfficial(false)}>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        <PrintButton label="Print official form" />
        <DownloadButton type="requisition" id={id} format="pdf" label="Download official PDF" />
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        <MaterialRequestDocument requisition={request} />
      </div>
    </Modal>}
  </div>;
}

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, ClipboardList, Download, Eye, FileCheck2, FileText,
  Paperclip, RefreshCw, Send
} from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
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

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function Field({ label, value, children, className = '' }) {
  if (!hasValue(value)) return null;
  return <KeyValue label={label} className={className}>{children ?? value}</KeyValue>;
}

function Section({ title, icon: Icon, children, id }) {
  return <section id={id} className="overflow-hidden rounded-xl border border-brand bg-white">
    <header className="flex items-center gap-2 border-b border-subtle px-5 py-3">
      {Icon && <Icon size={15} className="text-black" />}
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-black">{title}</h2>
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
  const [sendOpen, setSendOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [senderNote, setSenderNote] = useState('');
  const [sendError, setSendError] = useState('');
  const [sentForms, setSentForms] = useState([]);
  const [showOfficial, setShowOfficial] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getReceivedRequest(id);
      setRequest(response.requisition);
      if (portalApi.getRequisitionForms) {
        const forms = await portalApi.getRequisitionForms(id);
        setSentForms(forms.forms || []);
      }
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
    delete next.request;
    navigate(RECEIVED_REQUESTS_PAGE, next);
  }

  function attachmentPath(attachmentId) {
    return `/procurement/received-requests/${id}/attachments/${attachmentId}`;
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
      // previewBinary() appends inline=1 with the authenticated request.
      await previewBinary(attachmentPath(file.id), file.fileName);
    } catch (exception) { setActionError(exception.message); }
  }

  async function resendForm(threadId) {
    if (!window.confirm('Resend this response form with a fresh working link? The original link stays open but only one response can be submitted.')) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await portalApi.resendRequisitionForm(id, threadId);
      setNotice(result.message || 'Response form resent.');
      const forms = await portalApi.getRequisitionForms(id);
      setSentForms(forms.forms || []);
    } catch (exception) {
      setActionError(exception.message || 'The response form could not be resent.');
    } finally { setBusy(false); }
  }

  function continueProcessing() {
    navigate(PROCUREMENT_PROCESSING_PAGE, { request: id, tab: 'rfqs' });
  }

  function openSendModal() {
    setRecipientEmail('');
    setRecipientPhone('');
    setSenderNote('');
    setSendError('');
    setSendOpen(true);
  }

  async function sendToAnotherUser(event) {
    event.preventDefault();
    setBusy(true); setSendError(''); setNotice('');
    try {
      const result = await portalApi.sendRequisitionEmail(id, {
        to: recipientEmail,
        recipientPhone: recipientPhone.trim(),
        message: senderNote.trim()
      });
      setNotice(result.message || 'Request sent successfully.');
      setSendOpen(false);
      await load();
    } catch (exception) {
      setSendError(exception.message || 'The request could not be sent.');
    } finally { setBusy(false); }
  }

  if (loading && !request) return <LoadingState label="Opening request document…" />;
  if (error || !request) return <>
    <ErrorState message={error} onRetry={load} />
    <button type="button" onClick={back} className={primaryButtonClass()}>
      <ArrowLeft size={14} />Back to Received Requests
    </button>
  </>;

  const items = request.items || [];
  const attachments = request.attachments || [];
  const title = hasValue(request.title) ? request.title : `Request ${request.reference}`;
  const sendTotal = items.reduce((sum, item) => sum + Number(
    item.lineTotal ?? (Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0)
  ), 0);

  return <div className="space-y-5">
    <PrintHeader
      title={title}
      reference={request.reference}
      dates={`Submitted ${dateTimeLabel(request.submittedAt || request.createdAt)} · Forwarded ${dateTimeLabel(request.forwardedAt)}`}
    />

    <section className="overflow-hidden rounded-xl border border-brand bg-white">
      <div className="flex flex-wrap items-center justify-between gap-5 border-b border-subtle bg-white px-6 py-6">
        <div className="max-w-3xl">
          <button type="button" onClick={back}
            className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-black hover:underline">
            <ArrowLeft size={14} />Back to Received Requests
          </button>
          <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-black">
            Supervisor-forwarded request document
          </div>
          <h1 className="display-font text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-xs leading-5 text-black">
            Original submission details, Supervisor decision and attachments are preserved exactly as received.
          </p>
        </div>
        <div className="min-w-[180px] rounded-xl border border-brand bg-white px-5 py-4">
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-black">Request reference</div>
          <div className="display-font mt-1 text-xl font-extrabold tracking-tight">{request.reference}</div>
          <div className="mt-3"><StatusBadge value={request.status} /></div>
        </div>
      </div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowOfficial(true)} className={secondaryButtonClass()}>
            <Eye size={14} />View Official Request Form
          </button>
          <DownloadButton type="requisition" id={id} format="pdf" label="Download PDF" />
          <PrintButton label="Print Document" />
          <button type="button" onClick={openSendModal} disabled={busy} className={secondaryButtonClass('disabled:opacity-50')}>
            <Send size={14} />Send to another user
          </button>
        </div>
        <button type="button" onClick={continueProcessing} className={primaryButtonClass()}>
          <FileCheck2 size={14} />Continue Procurement Processing
        </button>
      </div>
    </section>

    {actionError && <p role="alert" className="no-print rounded-lg border border-brand bg-white px-3 py-2 text-xs text-black">{actionError}</p>}
    {notice && <p role="status" className="no-print rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{notice}</p>}

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Request information" icon={ClipboardList}>
        <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label="Request reference" value={request.reference}>{request.reference}</Field>
          <Field label="Requesting department" value={request.department}>{request.department}</Field>
          <Field label="Requester name" value={request.requester}>{request.requester}</Field>
          <Field label="Submission date" value={request.submittedAt || request.createdAt}>
            {dateTimeLabel(request.submittedAt || request.createdAt)}
          </Field>
          <Field label="Current status" value={request.status}><StatusBadge value={request.status} /></Field>
          <Field label="Location where items are needed" value={request.location}>{request.location}</Field>
          <Field label="Request title" value={request.title}>{request.title}</Field>
          <Field label="Request date" value={request.createdAt}>{dateTimeLabel(request.createdAt)}</Field>
          <Field label="Priority" value={request.priority}>{request.priority}</Field>
          <Field label="Required by" value={request.requiredBy}>{dateLabel(request.requiredBy)}</Field>
          <Field label="Budget code" value={request.budgetCode}>{request.budgetCode}</Field>
          <Field label="Requester email" value={request.requesterEmail}>{request.requesterEmail}</Field>
          <Field label="Requester phone" value={request.requesterPhone}>{request.requesterPhone}</Field>
        </dl>
        <Field label="Purpose of the request" value={request.justification} className="mt-5 border-t border-subtle pt-4">
          <p className="whitespace-pre-wrap text-xs leading-6 text-black">{request.justification}</p>
        </Field>
        <Field label="Requester response to information request" value={request.informationResponse} className="mt-4 border-t border-subtle pt-4">
          <p className="whitespace-pre-wrap text-xs leading-6 text-black">{request.informationResponse}</p>
        </Field>
      </Section>

      <Section title="Supervisor information" icon={FileCheck2}>
        <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label="Supervisor name" value={request.supervisorName || request.forwardedByName}>
            {request.supervisorName || request.forwardedByName}
          </Field>
          <Field label="Approval or rejection status" value={request.supervisorDecision}>
            {request.supervisorDecision}
          </Field>
          <Field label="Decision date" value={request.supervisorDecisionAt}>
            {dateTimeLabel(request.supervisorDecisionAt)}
          </Field>
          <Field label="Forwarded to Procurement date" value={request.forwardedAt}>
            {dateTimeLabel(request.forwardedAt)}
          </Field>
          <Field label="Forwarded by" value={request.forwardedByName || request.supervisorName}>
            {request.forwardedByName || request.supervisorName}
          </Field>
          <Field label="Supervisor department" value={request.supervisorDepartment || request.department}>
            {request.supervisorDepartment || request.department}
          </Field>
        </dl>
        <Field label="Supervisor comments" value={request.supervisorNotes} className="mt-5 border-t border-subtle pt-4">
          <p className="whitespace-pre-wrap text-xs leading-6 text-black">{request.supervisorNotes}</p>
        </Field>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-brand px-3 py-3 text-[11px] leading-5 text-black">
          <FileCheck2 size={15} className="mt-0.5 shrink-0" />
          <span>
            This request was sent to Procurement by an authorized Department Supervisor after an explicit
            forwarding decision. Supervisor approval alone never forwards a request.
          </span>
        </div>
      </Section>
    </div>

    <Section title={`Requested items (${items.length})`} icon={FileText}>
      {items.length ? <TableScroll minWidth={760}>
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase text-black">
            <tr>
              {['Item #', 'Item description', 'Quantity', 'Unit of measure', 'Remarks'].map((heading) =>
                <th key={heading} className="whitespace-nowrap border-b border-subtle px-3 py-2.5 font-extrabold">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {items.map((item, index) => <tr key={item.id} className="hover:bg-brand">
              <td className="whitespace-nowrap px-3 py-3 font-bold">{index + 1}</td>
              <td className="min-w-[240px] px-3 py-3">
                <span className="font-bold text-black">{item.itemName || '—'}</span>
                {hasValue(item.description) && <span className="mt-1 block whitespace-pre-wrap text-[11px] text-black">{item.description}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-3">{item.quantity ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-3">{item.unit || '—'}</td>
              <td className="px-3 py-3 text-black">{hasValue(item.remarks) ? item.remarks : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState
        title="No items recorded"
        description="The original request did not include item lines."
      />}
    </Section>

    <Section id="received-attachments" title={`Attachments (${attachments.length})`} icon={Paperclip}>
      {attachments.length ? <ul className="space-y-2">
        {attachments.map((file) => <li key={file.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip size={14} className="shrink-0 text-black" />
            <span className="truncate text-xs font-bold text-black">{file.fileName}</span>
            <span className="shrink-0 text-[10px] text-black">
              {Math.max(1, Math.round(Number(file.fileSize) / 1024))} KB
            </span>
          </span>
          <span className="flex items-center gap-3">
            {PREVIEWABLE.has(file.mimeType) && <button type="button" onClick={() => previewAttachment(file)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-black hover:underline">
              <Eye size={12} />View
            </button>}
            <button type="button" onClick={() => downloadAttachment(file)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-black hover:underline">
              <Download size={12} />Download
            </button>
          </span>
        </li>)}
      </ul> : <EmptyState
        title="No attachments"
        description="No documents were attached to the original request."
      />}
      <p className="mt-3 text-[10px] text-black">
        Attachments are served securely to authorized Procurement and Administrator accounts only.
      </p>
    </Section>

    <Section title={`Sent response forms (${sentForms.length})`} icon={Send}>
      {sentForms.length ? <TableScroll minWidth={760}>
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase text-black">
            <tr>{['Recipient', 'Sent', 'Message', 'Response', 'Action'].map((heading) =>
              <th key={heading} className="border-b border-subtle px-3 py-2.5 font-extrabold">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {sentForms.map((form) => <tr key={form.id}>
              <td className="px-3 py-3 font-bold">{form.recipientEmail}</td>
              <td className="px-3 py-3">{dateTimeLabel(form.createdAt)}</td>
              <td className="max-w-[260px] px-3 py-3 text-black">{form.message || '—'}</td>
              <td className="px-3 py-3">{form.responded ? `Submitted ${dateTimeLabel(form.responseSubmittedAt || form.createdAt)}` : 'Awaiting response'}</td>
              <td className="px-3 py-3"><button type="button" disabled={busy} onClick={() => resendForm(form.id)} className="font-bold text-black disabled:opacity-50">
                Resend working link
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No response forms sent" description="Use “Send to another user” to send the requested items with an online response link." />}
      <p className="mt-3 text-[11px] leading-5 text-black">
        Older emails may contain a localhost link. Resend a form to give the recipient the current public link. Each form accepts only one response.
      </p>
    </Section>

    <Section title="Request history" icon={RefreshCw}>
      {!request.activity?.length ? <EmptyState title="No history recorded" /> : <ol className="space-y-5">
        {request.activity.map((entry, index) => <li key={entry.id} className="relative pl-7">
          {index < request.activity.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-black/20" />}
          <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-reference ring-1 ring-brand" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-black">
              {HISTORY_LABELS[entry.action] || String(entry.action).replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-black">{dateTimeLabel(entry.createdAt)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-black">{entry.actor ? `by ${entry.actor}` : 'System'}</div>
          {hasValue(historySummary(entry)) && <div className="mt-1 rounded-lg border border-brand px-2 py-1 text-[10px] leading-4 text-black">
            {historySummary(entry)}
          </div>}
        </li>)}
      </ol>}
    </Section>

    <div className="no-print flex flex-wrap justify-end gap-2 pb-4">
      <button type="button" onClick={back} className={secondaryButtonClass()}>
        <ArrowLeft size={14} />Back to Received Requests
      </button>
      <button type="button" onClick={continueProcessing} className={primaryButtonClass()}>
        <FileCheck2 size={14} />Continue Procurement Processing
      </button>
    </div>

    {sendOpen && <Modal title="Send requested items to another user" size="lg" onClose={() => !busy && setSendOpen(false)}>
      <form onSubmit={sendToAnotherUser} className="space-y-5">
        {sendError && <p role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs text-black">{sendError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-bold">
            Email address *
            <input type="email" required value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="recipient@example.com" className="field" />
          </label>
          <label className="block text-xs font-bold">
            Phone number
            <input type="tel" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)}
              placeholder="Phone number" className="field" />
          </label>
        </div>
        <label className="block text-xs font-bold">
          Message to recipient (optional)
          <textarea rows="3" maxLength={2000} value={senderNote} onChange={(event) => setSenderNote(event.target.value)}
            placeholder="Add a short note, for example: Please confirm the quantities and comment if anything needs changing."
            className="field h-auto py-2" />
        </label>

        <Section title={`Requested items (${items.length})`} icon={FileText}>
          {items.length ? <TableScroll minWidth={700}>
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-black">
                <tr>
                  {['Item', 'Quantity', 'Unit price', 'Total'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap border-b border-subtle px-3 py-2.5 font-extrabold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {items.map((item) => <tr key={item.id}>
                  <td className="px-3 py-3 font-bold text-black">{item.itemName || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3">{item.quantity ?? '—'} {item.unit || 'unit'}</td>
                  <td className="whitespace-nowrap px-3 py-3">{currency(item.estimatedUnitCost)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-bold">
                    {currency(item.lineTotal ?? (Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0))}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <EmptyState title="No items recorded" />}
          <div className="mt-3 flex justify-end border-t border-subtle pt-3 text-sm font-extrabold">
            <span>Total</span><span className="ml-3">{currency(sendTotal)}</span>
          </div>
        </Section>

        <div className="rounded-lg border border-brand bg-white p-3 text-[11px] leading-5 text-black">
          The recipient will receive this as a table with quantities and a private response link.
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setSendOpen(false)} className={secondaryButtonClass('disabled:opacity-50')}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !recipientEmail.trim()} className={primaryButtonClass()}>
            <Send size={14} />{busy ? 'Sending…' : 'Send by email'}
          </button>
        </div>
      </form>
    </Modal>}

    {showOfficial && <Modal title="Official material request form" size="xl" onClose={() => setShowOfficial(false)}>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        <PrintButton label="Print official form" />
        <DownloadButton type="requisition" id={id} format="pdf" label="Download official PDF" />
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-brand bg-white p-3">
        <MaterialRequestDocument requisition={request} />
      </div>
    </Modal>}
  </div>;
}

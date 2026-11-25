import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, FileCheck2, FileText, Send
} from 'lucide-react';
import StatusBadge from '../ui/StatusBadge.jsx';
import Modal from '../ui/Modal.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import {
  EmptyState, ErrorState, KeyValue, LoadingState, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import { PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';

function Section({ title, icon: Icon, children, id }) {
  return <section id={id} className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
    <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
      {Icon && <Icon size={15} className="text-brand" />}
      <h2 className="text-xs font-extrabold uppercase tracking-wide">{title}</h2>
    </header>
    <div className="p-5">{children}</div>
  </section>;
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
    navigate(RECEIVED_REQUESTS_PAGE, next);
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

  function openSendModal() {
    setRecipientEmail('');
    setRecipientPhone('');
    setSenderNote('');
    setSendError('');
    setSendOpen(true);
  }

  async function sendToAnotherUser(event) {
    event.preventDefault();
    setSendError('');
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function resendForm(threadId) {
    if (!window.confirm('Resend this response form with a fresh working link? The original link stays open but only one response can be submitted.')) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await portalApi.resendRequisitionForm(id, threadId);
      setNotice(result.message || 'Response form resent.');
    } catch (exception) {
      setActionError(exception.message || 'The response form could not be resent.');
    } finally { setBusy(false); }
  }

  if (loading && !request) return <LoadingState label="Opening full document…" />;
  if (error || !request) return <>
    <ErrorState message={error} onRetry={load} />
    <button type="button" onClick={back} className={primaryButtonClass()}><ArrowLeft size={14} />Back to Received Requests</button>
  </>;

  const items = request.items || [];
  const sendTotal = items.reduce(
    (sum, item) => sum + Number(item.lineTotal ?? Number(item.quantity) * Number(item.estimatedUnitCost)),
    0
  );
  return <div className="space-y-5">
    {sendOpen && <Modal title="Send requested items to another user" size="lg" onClose={() => !busy && setSendOpen(false)}>
      <form onSubmit={sendToAnotherUser} className="space-y-5">
        {sendError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{sendError}</p>}
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
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Quantity</th>
                  <th className="px-3 py-2.5">Unit price</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => <tr key={item.id}>
                  <td className="px-3 py-3 font-bold">{item.itemName}</td>
                  <td className="px-3 py-3">{item.quantity} {item.unit || 'unit'}</td>
                  <td className="px-3 py-3">{currency(item.estimatedUnitCost)}</td>
                  <td className="px-3 py-3 text-right font-bold">
                    {currency(item.lineTotal ?? Number(item.quantity) * Number(item.estimatedUnitCost))}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <EmptyState title="No items recorded" />}
          <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 text-sm font-extrabold">
            <span>Total</span><span className="ml-3 text-brand">{currency(sendTotal)}</span>
          </div>
        </Section>

        <div className="rounded-lg bg-blue-50 p-3 text-[11px] leading-5 text-blue-800">
          The recipient will receive this as a table with quantities.
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setSendOpen(false)} className={secondaryButtonClass()}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !recipientEmail.trim()} className={primaryButtonClass()}>
            <Send size={14} />{busy ? 'Sending…' : 'Send by email'}
          </button>
        </div>
      </form>
    </Modal>}

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
        <DownloadButton type="requisition" id={id} format="pdf" label="PDF" />
        <DownloadButton type="requisition" id={id} format="xlsx" label="Excel" />
        <DownloadButton type="requisition" id={id} format="csv" label="CSV" />
        <PrintButton label="Print Document" />
        <button type="button" onClick={review} disabled={busy} className={secondaryButtonClass()}>
          <FileCheck2 size={14} />{busy ? 'Saving…' : 'Review Request'}
        </button>
        <button type="button" onClick={openSendModal} disabled={busy} className={secondaryButtonClass()}>
          <Send size={14} />Send to another user
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

    <Section title={`Sent response forms (${sentForms.length})`} icon={Send}>
      {sentForms.length ? <TableScroll minWidth={760}>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-muted">
            <tr>
              {['Recipient', 'Sent', 'Message', 'Response', 'Action'].map((heading) =>
                <th key={heading} className="px-3 py-2.5 font-bold">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sentForms.map((form) => <tr key={form.id}>
              <td className="px-3 py-3 font-bold">{form.recipientEmail}</td>
              <td className="px-3 py-3">{dateTimeLabel(form.createdAt)}</td>
              <td className="max-w-[260px] px-3 py-3 text-muted">{form.message || '—'}</td>
              <td className="px-3 py-3">{form.responded ? `Submitted ${dateTimeLabel(form.responseSubmittedAt || form.createdAt)}` : 'Awaiting response'}</td>
              <td className="px-3 py-3"><button type="button" disabled={busy} onClick={() => resendForm(form.id)} className="font-bold text-brand disabled:opacity-50">
                Resend working link
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No response forms sent" description="Use “Send to another user” to send the requested items with an online response link." />}
      <p className="mt-3 text-[11px] leading-5 text-muted">
        Older emails may contain a localhost link. Resend a form to give the recipient the current public link. Each form accepts only one response.
      </p>
    </Section>

    <Section title={`B. Requested items (${items.length})`} icon={FileText}>
      {items.length ? <TableScroll minWidth={880}>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-muted">
            <tr>
              {['Item name', 'Description / specifications', 'Quantity', 'Unit of measurement', 'Estimated unit price', 'Estimated total price'].map((heading) =>
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
              <td className="whitespace-nowrap px-3 py-3 text-right font-bold">{currency(item.lineTotal)}</td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No items recorded" description="This document has no item lines." />}
    </Section>

  </div>;
}

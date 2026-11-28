import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Copy, Eye, FileCheck2, FileText, Link2, RefreshCw, Send } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import SignatureUpload from '../ui/SignatureUpload.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import {
  EmptyState, ErrorState, KeyValue, LoadingState, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import MaterialRequestDocument from '../documents/MaterialRequestDocument.jsx';
import { currency, dateTimeLabel } from '../../utils/format.js';
import { requisitionDisplayReference } from '../../utils/requisitionDisplay.js';
import { PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';

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

export default function ProcurementDocumentView({ id, portalApi, navigate, query = {} }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderSignature, setSenderSignature] = useState(null);
  const [senderNote, setSenderNote] = useState('');
  const [sendError, setSendError] = useState('');
  const [showOfficial, setShowOfficial] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [sentForms, setSentForms] = useState([]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [copiedThreadId, setCopiedThreadId] = useState(null);

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

  const loadForms = useCallback(async () => {
    setLinkError('');
    if (!portalApi.getRequisitionForms) return;
    try {
      const forms = await portalApi.getRequisitionForms(id);
      setSentForms(forms.forms || []);
    } catch (exception) {
      setLinkError(exception.message || 'The response links could not be loaded.');
    }
  }, [portalApi, id]);

  useEffect(() => { load(); }, [load]);

  function back() {
    const next = { ...query };
    delete next.view;
    delete next.request;
    navigate(RECEIVED_REQUESTS_PAGE, next);
  }

  function continueProcessing() {
    navigate(PROCUREMENT_PROCESSING_PAGE, { request: id, tab: 'rfqs' });
  }

  function openSendModal() {
    setRecipientEmail('');
    setRecipientPhone('');
    setSenderName('');
    setSenderSignature(null);
    setSenderNote('');
    setSendError('');
    setSendOpen(true);
  }

  function openLinksModal() {
    setLinkError('');
    setCopiedThreadId(null);
    setLinksOpen(true);
    void loadForms();
  }

  async function copyResponseLink(form) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(form.responseUrl);
      } else {
        const input = document.createElement('textarea');
        input.value = form.responseUrl;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setCopiedThreadId(form.id);
    } catch {
      setLinkError('Copy failed. Select the link in the box and copy it manually.');
    }
  }

  async function resendForm(threadId) {
    if (!window.confirm('Resend this response form to the original recipient with the current public link?')) return;
    setLinkBusy(true); setLinkError('');
    try {
      const result = await portalApi.resendRequisitionForm(id, threadId);
      setNotice(result.message || 'Response form resent.');
      await loadForms();
    } catch (exception) {
      setLinkError(exception.message || 'The response form could not be resent.');
    } finally { setLinkBusy(false); }
  }

  async function sendToAnotherUser(event) {
    event.preventDefault();
    setBusy(true); setSendError(''); setNotice('');
    try {
      const result = await portalApi.sendRequisitionEmail(id, {
        to: recipientEmail,
        recipientPhone: recipientPhone.trim(),
        senderName: senderName.trim(),
        senderSignature,
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
  const displayReference = requisitionDisplayReference(request);
  const title = hasValue(request.title) ? request.title : `Request ${displayReference}`;
  const sendTotal = items.reduce((sum, item) => sum + Number(
    item.lineTotal ?? (Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0)
  ), 0);

  return <div className="space-y-5">
    <PrintHeader
      title={title}
      reference={displayReference}
      dates={`Requested ${dateTimeLabel(request.submittedAt || request.createdAt)} · Forwarded ${dateTimeLabel(request.forwardedAt)}`}
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
            Original submission details and Supervisor decision are preserved exactly as received.
          </p>
        </div>
        <div className="min-w-[180px] rounded-xl border border-brand bg-white px-5 py-4">
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-black">Request reference</div>
          <div className="display-font mt-1 text-xl font-extrabold tracking-tight">{displayReference}</div>
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
          <button type="button" onClick={openLinksModal} disabled={busy} className={secondaryButtonClass('disabled:opacity-50')}>
            <Link2 size={14} />Response links
          </button>
        </div>
        <button type="button" onClick={continueProcessing} className={primaryButtonClass()}>
          <FileCheck2 size={14} />Continue Procurement Processing
        </button>
      </div>
    </section>

    {notice && <p role="status" className="no-print rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{notice}</p>}

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Request information" icon={ClipboardList}>
        <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label="Request reference" value={displayReference}>{displayReference}</Field>
          <Field label="Requesting department" value={request.department}>{request.department}</Field>
          <Field label="Requester name" value={request.requester}>{request.requester}</Field>
          <Field label="Requested At" value={request.submittedAt || request.createdAt}>
            {dateTimeLabel(request.submittedAt || request.createdAt)}
          </Field>
          <Field label="Current status" value={request.status}><StatusBadge value={request.status} /></Field>
          <Field label="Location where items are needed" value={request.location}>{request.location}</Field>
          <Field label="Request title" value={request.title}>{request.title}</Field>
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
        {request.supervisorDecision === 'Approved' && <div className="mt-5 border-t border-subtle pt-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-black">Approved by signature</div>
          {request.supervisorSignature
            ? <img src={request.supervisorSignature} alt="Approved by signature"
                className="mt-2 max-h-16 max-w-full object-contain" />
            : <p className="mt-2 text-[11px] leading-5 text-black">Digitally approved — no signature image was uploaded.</p>}
        </div>}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-bold">
            Your name *
            <input required maxLength={150} value={senderName} onChange={(event) => setSenderName(event.target.value)}
              placeholder="Name of sender" className="field" />
          </label>
          <SignatureUpload
            label="Sender signature"
            value={senderSignature}
            onChange={setSenderSignature}
            disabled={busy}
          />
        </div>
        <label className="block text-xs font-bold">
          Message to recipient (optional)
          <textarea rows="3" maxLength={2000} value={senderNote} onChange={(event) => setSenderNote(event.target.value)}
            placeholder="Add a short note, for example: Please confirm the quantities and comment if anything needs changing."
            className="field h-auto py-2" />
        </label>

        <div className="rounded-lg border border-brand bg-white p-3 text-[11px] leading-5 text-black">
          The recipient will receive this as a table with quantities, your name, your signature and a private response link.
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setSendOpen(false)} className={secondaryButtonClass('disabled:opacity-50')}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !recipientEmail.trim() || !senderName.trim() || !senderSignature} className={primaryButtonClass()}>
            <Send size={14} />{busy ? 'Sending…' : 'Send by email'}
          </button>
        </div>
      </form>
    </Modal>}

    {linksOpen && <Modal title="Response links" size="lg" onClose={() => !linkBusy && setLinksOpen(false)}>
      <div className="space-y-4">
        <p className="text-xs leading-5 text-black">
          Each link opens the requested items and response form on any phone, tablet or computer.
          The recipient does not need a staff account. Only one response can be submitted per form.
        </p>
        {linkError && <p role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{linkError}</p>}
        {sentForms.length ? <ul className="space-y-3">
          {sentForms.map((form) => <li key={form.id} className="rounded-xl border border-brand bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold break-all text-black">{form.recipientEmail}</span>
              <span className="text-[10px] font-bold text-black">
                {form.responded ? `Submitted ${dateTimeLabel(form.responseSubmittedAt)}` : `Sent ${dateTimeLabel(form.createdAt)}`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input readOnly value={form.responseUrl || ''} aria-label={`Response link for ${form.recipientEmail}`}
                onFocus={(event) => event.target.select()} className="field min-w-[220px] flex-1 text-[11px]" />
              <button type="button" disabled={!form.responseUrl} onClick={() => copyResponseLink(form)}
                className={secondaryButtonClass('disabled:opacity-50')}>
                <Copy size={13} />{copiedThreadId === form.id ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" disabled={linkBusy} onClick={() => resendForm(form.id)}
                className={secondaryButtonClass('disabled:opacity-50')}>
                <RefreshCw size={13} />{linkBusy ? 'Sending…' : 'Resend email'}
              </button>
            </div>
          </li>)}
        </ul> : <EmptyState
          title="No response links yet"
          description="Use Send to another user to create a public response form."
        />}
      </div>
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

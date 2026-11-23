import { useState } from 'react';
import { CheckCircle2, FileText, Info, MessageSquare, Pencil, Send, XCircle } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import MaterialRequestDocument from '../documents/MaterialRequestDocument.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import {
  ActivityTimeline, AttachmentList, AttachmentPicker, KeyValue, LoadingState,
  PageHeader, PortalBadge, TableScroll, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import { downloadBinary, filesToAttachments } from '../../utils/attachments.js';
import {
  decisionLabel, decisionTone, isDraft, isInformationRequired, isPendingApproval
} from '../../utils/status.js';

function DetailSection({ title, children }) {
  return <section className="rounded-xl border border-slate-100 bg-white">
    <header className="border-b border-slate-100 px-4 py-3 text-xs font-bold">{title}</header>
    <div className="p-4">{children}</div>
  </section>;
}

export default function RequestDetail({
  requisition, portal = 'requester', onClose, portalApi, onMessage, onChanged, onEdit
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [response, setResponse] = useState('');
  const [files, setFiles] = useState([]);
  const [pendingDecision, setPendingDecision] = useState('');
  const [showOfficial, setShowOfficial] = useState(false);

  if (!requisition) return null;
  const isSupervisor = portal === 'supervisor';
  const status = requisition.status;
  const otherUserId = isSupervisor ? requisition.requesterId : requisition.supervisorId;
  const items = requisition.items || [];
  const total = items.length
    ? items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.estimatedUnitCost), 0)
    : Number(requisition.total) || 0;

  async function run(handler, successMessage) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await handler();
      setFiles([]); setReason(''); setResponse(''); setPendingDecision('');
      setNotice(result?.message || successMessage);
      await onChanged?.();
    } catch (exception) {
      setError(exception.message || 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDecision() {
    if (!pendingDecision) return;
    if (pendingDecision !== 'Approve' && !reason.trim()) {
      setError('A reason is required when rejecting or requesting information.');
      return;
    }
    await run(
      () => portalApi.decideRequest(requisition.id, { decision: pendingDecision, reason: reason.trim() }),
      'Decision recorded.'
    );
  }

  return <Modal title={`Request · ${requisition.reference}`} size="xl" onClose={onClose}>
    <PrintHeader
      title={requisition.title || requisition.reference}
      reference={requisition.reference}
      dates={`Submitted ${dateTimeLabel(requisition.submittedAt || requisition.createdAt)} · Required by ${dateLabel(requisition.requiredBy)}`}
    />
    <PageHeader
      eyebrow={requisition.department || 'Department'}
      title={requisition.title || requisition.reference}
      description={requisition.justification || 'No justification supplied.'}
      actions={<div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={status} />
        <PortalBadge tone={decisionTone(requisition.supervisorDecision)}>
          Supervisor: {decisionLabel(requisition.supervisorDecision)}
        </PortalBadge>
        <button type="button" onClick={() => setShowOfficial(true)} className={secondaryButtonClass()}>
          <FileText size={14} />Official form
        </button>
        {!isSupervisor && isDraft(status) && onEdit && <button type="button" onClick={onEdit} className={secondaryButtonClass()}>
          <Pencil size={14} />Edit official form
        </button>}
        <PrintButton label="Print Request" />
        <DownloadButton type="requisition" id={requisition.id} format="pdf" label="PDF" />
        <DownloadButton type="requisition" id={requisition.id} format="xlsx" label="Excel" />
        <DownloadButton type="requisition" id={requisition.id} format="csv" label="CSV" />
      </div>}
    />

    {(error || notice) && <div className="mb-4 space-y-2">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
    </div>}

    <div className="grid gap-4 lg:grid-cols-2">
      <DetailSection title="Request details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <KeyValue label="Reference">{requisition.reference}</KeyValue>
          <KeyValue label="Priority">{requisition.priority || 'Medium'}</KeyValue>
          <KeyValue label="Requester">{requisition.requester || '—'}</KeyValue>
          <KeyValue label="Department">{requisition.department || '—'}</KeyValue>
          <KeyValue label="Location">{requisition.location || '—'}</KeyValue>
          <KeyValue label="Submitted">{dateTimeLabel(requisition.submittedAt || requisition.createdAt)}</KeyValue>
          <KeyValue label="Required by">{dateLabel(requisition.requiredBy)}</KeyValue>
          <KeyValue label="Budget code">{requisition.budgetCode || '—'}</KeyValue>
          <KeyValue label="Estimated total"><span className="text-brand">{currency(total)}</span></KeyValue>
          <KeyValue label="Supervisor">{requisition.supervisorName || '—'}</KeyValue>
          <KeyValue label="Decision at">{dateTimeLabel(requisition.supervisorDecisionAt)}</KeyValue>
        </dl>
        {requisition.supervisorNotes && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          <strong>Supervisor note:</strong> {requisition.supervisorNotes}
        </p>}
        {requisition.informationResponse && <p className="mt-2 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">
          <strong>Your response:</strong> {requisition.informationResponse}
        </p>}
        {otherUserId && onMessage && <button type="button" onClick={() => onMessage(otherUserId, requisition.id)}
          className={`${secondaryButtonClass('mt-4')}`}>
          <MessageSquare size={14} />Message {isSupervisor ? 'Requester' : 'Supervisor'}
        </button>}
      </DetailSection>

      <DetailSection title={`Items (${items.length})`}>
        {items.length ? <TableScroll minWidth={460}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted">
              <tr><th className="px-2 py-2">Item</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Unit cost</th><th className="px-2 py-2">Remarks</th><th className="px-2 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => <tr key={item.id}>
                <td className="px-2 py-2 font-bold">{item.itemName}{item.description && <div className="text-[10px] font-normal text-muted">{item.description}</div>}</td>
                <td className="px-2 py-2">{item.quantity} {item.unit}</td>
                <td className="px-2 py-2">{currency(item.estimatedUnitCost)}</td>
                <td className="px-2 py-2 text-muted">{item.remarks || '—'}</td>
                <td className="px-2 py-2 text-right font-bold">{currency(item.lineTotal ?? item.quantity * item.estimatedUnitCost)}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll> : <p className="text-xs text-muted">No items recorded.</p>}
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 text-xs font-bold">
          Total <span className="ml-3 text-brand">{currency(total)}</span>
        </div>
      </DetailSection>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <DetailSection title={`Attachments (${(requisition.attachments || []).length})`}>
        {requisition.loadingAttachments ? <LoadingState label="Loading attachments…" /> :
          <AttachmentList attachments={requisition.attachments || []}
            downloadPath={(id, name) => downloadBinary(`/portal/requisitions/${requisition.id}/attachments/${id}`, name)}
            onError={setError} />}
      </DetailSection>
      <DetailSection title="Approval & activity history">
        <ActivityTimeline activity={requisition.activity || []} />
      </DetailSection>
    </div>

    {!isSupervisor && (isDraft(status) || isInformationRequired(status)) && <DetailSection title={isDraft(status) ? 'Submit this request' : 'Respond and resubmit'}>
      <div className="space-y-4">
        {isInformationRequired(status) && <label className="block text-xs font-bold">
          Response to your Supervisor
          <textarea rows="3" required value={response} onChange={(event) => setResponse(event.target.value)}
            placeholder="Explain how you addressed the requested information…" className="field h-auto py-2" />
        </label>}
        <AttachmentPicker files={files} onChange={setFiles} error={error && error.includes('attachment') ? error : ''} />
        <button type="button" disabled={busy || (isInformationRequired(status) && !response.trim())}
          onClick={() => run(async () => {
            const attachments = files.length ? await filesToAttachments(files) : undefined;
            return isDraft(status)
              ? portalApi.submitRequesterRequest(requisition.id, { attachments })
              : portalApi.resubmitRequesterRequest(requisition.id, { response: response.trim(), attachments });
          }, 'Request submitted to your Supervisor.')} className={primaryButtonClass()}>
          <Send size={14} />{busy ? 'Submitting…' : isDraft(status) ? 'Submit to Supervisor' : 'Resubmit request'}
        </button>
        <p className="text-[10px] text-muted">Attachments selected above are included when you submit or resubmit.</p>
      </div>
    </DetailSection>}

    {isSupervisor && status === 'Approved by Supervisor' && requisition.supervisorDecision === 'Approved' && !requisition.forwardedBySupervisor && <DetailSection title="Forward to Procurement">
      <p className="mb-3 text-xs leading-5 text-muted">
        Your approval is recorded. Forwarding is a separate action: it sends the complete original request and every
        attachment to Procurement, notifies the team and the Requester, and cannot be undone or repeated.
      </p>
      <button type="button" disabled={busy} onClick={() => run(
        () => portalApi.forwardRequest(requisition.id),
        'Request forwarded to Procurement.'
      )} className={primaryButtonClass()}>
        <Send size={14} />{busy ? 'Forwarding…' : 'Forward to Procurement'}
      </button>
    </DetailSection>}

    {isSupervisor && isPendingApproval(status) && <DetailSection title="Decision">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'Approve', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
            { value: 'Reject', icon: XCircle, className: 'border-red-200 bg-red-50 text-red-700' },
            { value: 'Request Information', icon: Info, className: 'border-amber-200 bg-amber-50 text-amber-700' }
          ].map(({ value, icon: Icon, className }) => <button key={value} type="button" disabled={busy}
            onClick={() => { setPendingDecision(value); setError(''); }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${pendingDecision === value ? 'ring-2 ring-brand/40' : ''} ${className}`}>
            <Icon size={14} />{value}
          </button>)}
        </div>
        {pendingDecision && <label className="block text-xs font-bold">
          {pendingDecision === 'Approve' ? 'Note (optional)' : 'Reason (required)'}
          <textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder={pendingDecision === 'Approve' ? 'Optional decision note…' : 'Explain your decision…'}
            className="field h-auto py-2" />
        </label>}
        <button type="button" disabled={busy || !pendingDecision} onClick={confirmDecision} className={primaryButtonClass()}>
          <CheckCircle2 size={14} />{busy ? 'Saving…' : 'Confirm decision'}
        </button>
        <p className="text-[10px] text-muted">A decision can only be recorded once. Already-decided requests cannot be actioned again.</p>
      </div>
    </DetailSection>}

    {showOfficial && <Modal title="Official material request form" size="xl" onClose={() => setShowOfficial(false)}>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        <PrintButton label="Print official form" />
        <DownloadButton type="requisition" id={requisition.id} format="pdf" label="Download official PDF" />
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        <MaterialRequestDocument requisition={requisition} />
      </div>
    </Modal>}
  </Modal>;
}

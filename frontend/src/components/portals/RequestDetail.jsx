import { useState } from 'react';
import {
  ArrowRightLeft, Building2, CheckCircle2, FileText, Info, MessageSquare,
  Pencil, Send, TriangleAlert, Warehouse, XCircle
} from 'lucide-react';
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
  return <section className="rounded-xl border border-brand bg-white">
    <header className="border-b border-subtle px-4 py-3 text-xs font-bold">{title}</header>
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
  const [routingChoice, setRoutingChoice] = useState('');
  const [partialRouting, setPartialRouting] = useState(false);
  const [routingComments, setRoutingComments] = useState('');
  const [routingConfirmation, setRoutingConfirmation] = useState(null);
  const [returnComments, setReturnComments] = useState('');
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

  const routingStock = requisition.routingStock || [];
  const hasStockShortage = routingStock.some((line) => !line.matched
    || Number(line.availableQuantity) < Number(line.requestedQuantity));

  function requestRoutingConfirmation() {
    if (!routingChoice) return;
    setError('');
    setRoutingConfirmation({
      destination: routingChoice === 'procurement' ? 'Procurement' : partialRouting ? 'Split' : 'Stock Keeper',
      comments: routingComments.trim()
    });
  }

  async function confirmRouting() {
    if (!routingConfirmation) return;
    const payload = {
      destination: routingConfirmation.destination,
      comments: routingConfirmation.comments,
      stockLines: routingConfirmation.destination === 'Split'
        ? routingStock
          .filter((line) => Number(line.availableQuantity) > 0)
          .map((line) => ({
            requisitionItemId: line.requisitionItemId,
            itemId: line.itemId,
            quantity: Math.min(Number(line.requestedQuantity), Number(line.availableQuantity))
          }))
        : undefined
    };
    await run(() => portalApi.routeRequest(requisition.id, payload), 'Routing decision recorded.');
    setRoutingConfirmation(null);
    setRoutingChoice('');
    setPartialRouting(false);
    setRoutingComments('');
  }

  async function forwardReturn(returnId) {
    await run(
      () => portalApi.routeShortage(requisition.id, { returnId, comments: returnComments.trim() }),
      'Shortage forwarded to Procurement.'
    );
    setReturnComments('');
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
      {error && <p role="alert" className="rounded-lg bg-white px-3 py-2 text-xs text-black">{error}</p>}
      {notice && <p className="rounded-lg bg-white px-3 py-2 text-xs text-black">{notice}</p>}
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
          <KeyValue label="Estimated total"><span className="text-black">{currency(total)}</span></KeyValue>
          <KeyValue label="Supervisor">{requisition.supervisorName || '—'}</KeyValue>
          <KeyValue label="Decision at">{dateTimeLabel(requisition.supervisorDecisionAt)}</KeyValue>
        </dl>
        {requisition.supervisorNotes && <p className="mt-4 rounded-lg bg-white p-3 text-xs leading-5 text-black">
          <strong>Supervisor note:</strong> {requisition.supervisorNotes}
        </p>}
        {requisition.informationResponse && <p className="mt-2 rounded-lg bg-white p-3 text-xs leading-5 text-black">
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
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr><th className="px-2 py-2">Item</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Unit cost</th><th className="px-2 py-2">Remarks</th><th className="px-2 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => <tr key={item.id}>
                <td className="px-2 py-2 font-bold">{item.itemName}{item.description && <div className="text-[10px] font-normal text-black">{item.description}</div>}</td>
                <td className="px-2 py-2">{item.quantity} {item.unit}</td>
                <td className="px-2 py-2">{currency(item.estimatedUnitCost)}</td>
                <td className="px-2 py-2 text-black">{item.remarks || '—'}</td>
                <td className="px-2 py-2 text-right font-bold">{currency(item.lineTotal ?? item.quantity * item.estimatedUnitCost)}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll> : <p className="text-xs text-black">No items recorded.</p>}
        <div className="mt-3 flex justify-end border-t border-subtle pt-3 text-xs font-bold">
          Total <span className="ml-3 text-black">{currency(total)}</span>
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
        <p className="text-[10px] text-black">Attachments selected above are included when you submit or resubmit.</p>
      </div>
    </DetailSection>}

    {isSupervisor && status === 'Approved by Supervisor' && requisition.supervisorDecision === 'Approved'
      && !requisition.routedAt && <DetailSection title="Request Routing Decision">
      <div className="space-y-4">
        <div className="rounded-lg border border-subtle bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold">
            <Warehouse size={14} />Stock availability verification
          </div>
          {routingStock.length ? <TableScroll minWidth={620}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black">
                <tr>
                  {['Item', 'Requested', 'Available stock', 'Unit', 'Status'].map((heading) =>
                    <th key={heading} className="px-2 py-2">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {routingStock.map((line) => {
                  const insufficient = Number(line.availableQuantity) < Number(line.requestedQuantity);
                  return <tr key={line.requisitionItemId}>
                    <td className="px-2 py-2 font-bold">{line.itemName}
                      {line.sku && <span className="block text-[10px] font-normal text-black">SKU {line.sku}</span>}
                    </td>
                    <td className="px-2 py-2">{line.requestedQuantity}</td>
                    <td className="px-2 py-2 font-bold">{line.availableQuantity}</td>
                    <td className="px-2 py-2">{line.unit}</td>
                    <td className={`px-2 py-2 font-bold ${insufficient ? 'text-black' : 'text-black'}`}>
                      {line.status}
                      {insufficient && <span className="block text-[10px] font-normal text-black">
                        Short by {Number(line.requestedQuantity) - Number(line.availableQuantity)} {line.unit}
                      </span>}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </TableScroll> : <p className="text-xs text-black">No stock records are linked to these requested items.</p>}
          {hasStockShortage && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-subtle bg-white px-3 py-2 text-xs font-bold text-black">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            Some items are unmatched, unavailable, or insufficient. Send to Stock Keeper to have every requested line reviewed; the Stock Keeper can return any physical shortage to you. Use partial routing only to issue existing stock and forward the shortfall to Procurement.
          </p>}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <button type="button" disabled={busy}
            onClick={() => { setRoutingChoice('procurement'); setPartialRouting(false); setError(''); }}
            className={`rounded-xl border border-subtle bg-white p-4 text-left transition hover:border-brand hover:bg-hover ${routingChoice === 'procurement' ? 'ring-2 ring-brand' : ''}`}>
            <span className="mb-2 flex items-center gap-2 text-sm font-extrabold text-black">
              <Building2 size={16} />Option A: Send to Procurement Office
            </span>
            <span className="block text-xs leading-5 text-black">Use this option when requested items are not available in stock, stock is insufficient, or items must be purchased from external Suppliers.</span>
            <span className="mt-3 block text-xs text-black"><strong>Destination:</strong> Procurement Office</span>
            <span className="block text-xs text-black"><strong>Reason:</strong> Items need to be purchased.</span>
          </button>
          <button type="button" disabled={busy}
            onClick={() => { setRoutingChoice('stock'); setError(''); }}
            className={`rounded-xl border border-subtle bg-white p-4 text-left transition hover:border-brand hover:bg-hover ${routingChoice === 'stock' ? 'ring-2 ring-brand' : ''}`}>
            <span className="mb-2 flex items-center gap-2 text-sm font-extrabold text-black">
              <Warehouse size={16} />Option B: Send to Stock Keeper
            </span>
            <span className="block text-xs leading-5 text-black">Route every requested line—including free-text, insufficient, or unavailable items—to the Stock Keeper for stock review and shortage reporting.</span>
            <span className="mt-3 block text-xs text-black"><strong>Destination:</strong> Stock Keeper</span>
            <span className="block text-xs text-black"><strong>Reason:</strong> The Stock Keeper verifies physical stock and returns any shortage.</span>
          </button>
        </div>

        {hasStockShortage && routingChoice === 'stock' && <label className="flex items-start gap-2 rounded-lg border border-subtle bg-white px-3 py-2 text-xs text-black">
          <input type="checkbox" checked={partialRouting} onChange={(event) => setPartialRouting(event.target.checked)} className="mt-0.5" />
          <span><strong>Partial routing:</strong> issue only the available quantities through the Stock Keeper and forward the shortage to Procurement. The original request reference and all quantities remain traceable.</span>
        </label>}

        {routingChoice && <label className="block text-xs font-bold">
          {routingChoice === 'procurement' ? 'Supervisor comments or routing justification' : 'Supervisor comments or issue instructions'}
          <textarea rows="3" value={routingComments} onChange={(event) => setRoutingComments(event.target.value)}
            placeholder={routingChoice === 'procurement' ? 'Explain why purchasing is required…' : 'Add issue instructions for the Stock Keeper…'}
            className="field h-auto py-2" />
        </label>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || !routingChoice} onClick={requestRoutingConfirmation} className={primaryButtonClass()}>
            <Send size={14} />{routingChoice === 'procurement' ? 'Forward to Procurement' : 'Send to Stock Keeper'}
          </button>
          <span className="text-[10px] text-black">Stock is reduced only after the Stock Keeper records the physical issue.</span>
        </div>
      </div>
    </DetailSection>}

    {isSupervisor && requisition.routing?.lines?.length > 0 && <DetailSection title="Routing record">
      <div className="space-y-2">
        {requisition.routing.lines.map((line) => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-subtle bg-white px-3 py-2 text-xs text-black">
          <span><strong>{line.itemName}</strong> · {line.destination} · {line.quantity} {line.unit}</span>
          <span>Issued {line.issuedQuantity} · Returned {line.returnedQuantity} · {line.status}</span>
        </div>)}
        {requisition.routedAt && <p className="text-[10px] text-black">Authorized by {requisition.routedByName || 'Supervisor'} on {dateTimeLabel(requisition.routedAt)}.</p>}
      </div>
    </DetailSection>}

    {isSupervisor && requisition.routing?.returns?.filter((entry) => entry.status === 'Awaiting Supervisor Decision').length > 0
      && <DetailSection title="Stock shortage review">
        <div className="space-y-3">
          {requisition.routing.returns.filter((entry) => entry.status === 'Awaiting Supervisor Decision').map((entry) => <div key={entry.id} className="rounded-lg border border-subtle bg-white p-3">
            <p className="flex items-start gap-2 text-xs font-bold text-black">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              {entry.itemName}: {entry.unavailableQuantity} unavailable · {entry.availableQuantity} available
            </p>
            {entry.reason && <p className="mt-2 text-xs text-black">{entry.reason}</p>}
            <p className="mt-1 text-[10px] text-black">Reported by {entry.reportedByName || 'Stock Keeper'} · {dateTimeLabel(entry.createdAt)}</p>
          </div>)}
          <label className="block text-xs font-bold">
            Procurement routing justification
            <textarea rows="2" value={returnComments} onChange={(event) => setReturnComments(event.target.value)}
              placeholder="Explain why purchasing is required…" className="field h-auto py-2" />
          </label>
          <button type="button" disabled={busy || !requisition.routing.returns.some((entry) => entry.status === 'Awaiting Supervisor Decision')}
            onClick={() => {
              const pending = requisition.routing.returns.find((entry) => entry.status === 'Awaiting Supervisor Decision');
              if (pending) forwardReturn(pending.id);
            }} className={primaryButtonClass()}>
            <ArrowRightLeft size={14} />{busy ? 'Forwarding…' : 'Forward shortage to Procurement'}
          </button>
        </div>
      </DetailSection>}

    {isSupervisor && isPendingApproval(status) && <DetailSection title="Decision">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'Approve', icon: CheckCircle2, className: 'border-brand bg-white text-black' },
            { value: 'Reject', icon: XCircle, className: 'border-brand bg-white text-black' },
            { value: 'Request Information', icon: Info, className: 'border-brand bg-white text-black' }
          ].map(({ value, icon: Icon, className }) => <button key={value} type="button" disabled={busy}
            onClick={() => { setPendingDecision(value); setError(''); }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${pendingDecision === value ? 'ring-2 ring-brand' : ''} ${className}`}>
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
        <p className="text-[10px] text-black">A decision can only be recorded once. Already-decided requests cannot be actioned again.</p>
      </div>
    </DetailSection>}

    {routingConfirmation && <Modal title="Confirm routing decision" size="md" onClose={() => setRoutingConfirmation(null)}>
      <div className="space-y-4 text-xs text-black">
        <p className="font-bold">Confirm the destination for {requisition.reference}.</p>
        <div className="rounded-lg border border-subtle bg-white px-3 py-2">
          <p><strong>Destination:</strong> {routingConfirmation.destination === 'Procurement' ? 'Procurement Office'
            : routingConfirmation.destination === 'Split' ? 'Stock Keeper + Procurement (partial)' : 'Stock Keeper'}</p>
          <p><strong>Reason:</strong> {routingConfirmation.destination === 'Procurement' ? 'Items need to be purchased.'
            : routingConfirmation.destination === 'Split' ? 'Available stock will be issued; the shortage will be purchased.'
              : 'Every requested line will be reviewed by the Stock Keeper; physical shortages are returned to you.'}</p>
          {routingConfirmation.comments && <p><strong>Comments:</strong> {routingConfirmation.comments}</p>}
        </div>
        <p>Original items, quantities, attachments and the Supervisor decision are preserved. This action cannot be undone.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setRoutingConfirmation(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="button" disabled={busy} onClick={confirmRouting} className={primaryButtonClass()}>
            {busy ? 'Routing…' : 'Confirm and route'}
          </button>
        </div>
      </div>
    </Modal>}

    {showOfficial && <Modal title="Official material request form" size="xl" onClose={() => setShowOfficial(false)}>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        <PrintButton label="Print official form" />
        <DownloadButton type="requisition" id={requisition.id} format="pdf" label="Download official PDF" />
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-brand bg-white p-3">
        <MaterialRequestDocument requisition={requisition} />
      </div>
    </Modal>}
  </Modal>;
}

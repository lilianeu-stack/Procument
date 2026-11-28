import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft, CheckCircle2, ClipboardCheck, Eye, PackageCheck, RefreshCw, TriangleAlert, XCircle
} from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import PageCard from '../ui/PageCard.jsx';
import StockKeeperRequesters from './StockKeeperRequesters.jsx';
import {
  EmptyState, ErrorState, LoadingState, PortalBadge, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import { statusLabel, statusTone } from '../../utils/status.js';

const transactionKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// The register has one derived status per request. It is never written over the
// Supervisor's requisition status: the eight values come from the Stock Keeper
// decision, the physical issue history, and whether the request was opened.
function deriveGroupStatus(group) {
  const issued = group.lines.reduce((sum, line) => sum + Math.max(0, Number(line.issuedQuantity) || 0), 0);
  const remaining = group.lines.reduce((sum, line) => sum + Math.max(0, Number(line.remainingQuantity) || 0), 0);
  if (group.decision === 'Rejected') return 'Rejected';
  if (group.requisitionStatus === 'Returned to Supervisor') return 'Returned to Supervisor';
  if (group.requisitionStatus === 'Completed') return 'Completed';
  if ((group.requestStatus === 'Issued' || remaining === 0) && issued > 0) return 'Issued';
  if (issued > 0 && remaining > 0) return 'Partially Issued';
  if (group.decision === 'Accepted') return 'Accepted';
  if (group.decision === 'Pending') return group.isNew ? 'New Request' : 'Pending Stock Keeper Review';
  return group.decision;
}

function groupRequests(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const id = Number(row.requestId);
    if (!groups.has(id)) {
      groups.set(id, {
        requestId: id,
        reference: row.requisitionReference || row.reference,
        storeReference: row.reference,
        requester: row.requester,
        department: row.department,
        submittedAt: row.submittedAt,
        forwardedAt: row.forwardedAt,
        routedAt: row.routedAt,
        supervisorName: row.supervisorName,
        supervisorComments: row.supervisorComments,
        requisitionStatus: row.requisitionStatus,
        requestStatus: row.requestStatus,
        decision: row.stockkeeperDecision || 'Pending',
        isNew: Boolean(row.isNew),
        decisionAt: row.decisionAt,
        comments: row.stockkeeperComments,
        rejectionReason: row.rejectionReason,
        decidedBy: row.stockkeeperName,
        issuedAt: row.issuedAt,
        lines: []
      });
    }
    groups.get(id).lines.push(row);
  }
  const result = [...groups.values()];
  for (const group of result) group.status = deriveGroupStatus(group);
  return result.sort((a, b) => String(b.routedAt || '').localeCompare(String(a.routedAt || '')));
}

export default function StockKeeperSupervisorRequests({ portalApi, query = {}, initial = null, user = {} }) {
  const [tab, setTab] = useState('requests');
  const [requests, setRequests] = useState(initial || []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decision, setDecision] = useState(null);
  const [issue, setIssue] = useState(null);
  const [shortage, setShortage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await portalApi.getRoutedRequests();
      setRequests(response.requests || []);
    } catch (exception) {
      setError(exception.message || 'Supervisor requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { if (!initial || tab === 'requests') load(); }, [initial, load, tab]);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const response = await portalApi.getRoutedRequest(id);
      setDetail(response);
      // Opening a new request moves it from New Request to Pending Stock Keeper
      // Review. The backend records the view time in the same database row.
      setRequests((current) => current.map((row) => Number(row.requestId) === Number(id)
        ? { ...row, isNew: false, status: row.stockkeeperDecision === 'Pending' ? 'Pending Stock Keeper Review' : row.status }
        : row));
    } catch (exception) {
      setError(exception.message || 'The complete request could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [portalApi]);

  useEffect(() => {
    const requestedId = Number(query.request);
    if (!requestedId) return undefined;
    let active = true;
    (async () => {
      try {
        const response = await portalApi.getRoutedRequests();
        if (!active) return;
        const rows = response.requests || [];
        setRequests(rows);
        const match = rows.find((row) => Number(row.requestId) === requestedId)
          || rows.find((row) => Number(row.requisitionId) === requestedId);
        await loadDetail(match ? Number(match.requestId) : requestedId);
      } catch (exception) {
        if (active) await loadDetail(requestedId);
      }
    })();
    return () => { active = false; };
  }, [query.request, portalApi, loadDetail]);

  const groups = useMemo(() => groupRequests(requests), [requests]);

  function openDecision(group, next) {
    setNotice('');
    setDecision({
      requestId: group.requestId,
      reference: group.reference,
      decision: next,
      comments: '',
      reason: '',
      lines: group.lines.map((line) => ({
        storeRequestItemId: line.storeRequestItemId,
        itemName: line.itemName,
        sku: line.sku,
        unit: line.unit,
        requested: Number(line.remainingQuantity) || 0,
        available: Number(line.availableBalance) || 0,
        quantity: String(Math.min(Number(line.remainingQuantity) || 0, Number(line.availableBalance) || 0))
      }))
    });
  }

  function openIssue(line, group) {
    setNotice('');
    setIssue({
      requestId: Number(line.requestId || group.requestId),
      reference: group.reference,
      storeRequestItemId: line.storeRequestItemId,
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      quantity: String(Math.min(Number(line.remainingQuantity) || 0, Number(line.availableBalance) || 0)),
      date: new Date().toISOString().slice(0, 10),
      receivedBy: group.requester || '',
      description: '',
      key: transactionKey()
    });
  }

  function openShortage(line, group) {
    const outstanding = Number(line.remainingQuantity) || 0;
    const available = Math.min(outstanding, Number(line.availableBalance) || 0);
    setShortage({
      requestId: Number(line.requestId || group.requestId),
      storeRequestItemId: line.storeRequestItemId,
      reference: group.reference,
      itemName: line.itemName,
      unit: line.unit,
      outstanding,
      availableQuantity: String(available),
      unavailableQuantity: String(outstanding - available),
      reason: ''
    });
  }

  async function submitDecision(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await portalApi.decideStockRequest(decision.requestId, {
        decision: decision.decision,
        comments: decision.comments,
        reason: decision.reason,
        lines: decision.decision === 'Accepted'
          ? decision.lines.map((line) => ({ storeRequestItemId: line.storeRequestItemId, quantity: Number(line.quantity) }))
          : undefined
      });
      setNotice(result.message || `${decision.decision} request ${decision.reference}.`);
      setDecision(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The decision could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function submitIssue(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await portalApi.issueStock({
        storeRequestId: issue.requestId,
        itemId: issue.itemId,
        quantity: Number(issue.quantity),
        date: issue.date,
        receivedBy: issue.receivedBy,
        description: issue.description,
        idempotencyKey: issue.key
      });
      setNotice(result.message || `Stock issued for ${issue.itemName}.`);
      setIssue(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The stock issue could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function submitShortage(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await portalApi.reportStockShortage(shortage.requestId, {
        storeRequestItemId: shortage.storeRequestItemId,
        availableQuantity: Number(shortage.availableQuantity),
        unavailableQuantity: Number(shortage.unavailableQuantity),
        reason: shortage.reason
      });
      setNotice(`Shortage for ${shortage.itemName} returned to the Supervisor.`);
      setShortage(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The shortage could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="mb-4 flex flex-wrap justify-end gap-2">
      <button type="button" className={tab === 'requests' ? primaryButtonClass() : secondaryButtonClass()} onClick={() => setTab('requests')}>Requests</button>
      <button type="button" className={tab === 'requesters' ? primaryButtonClass() : secondaryButtonClass()} onClick={() => setTab('requesters')}>List of Requesters</button>
      <button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>
    </div>

    {notice && <p role="status" className="no-print mb-4 rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">{notice}</p>}
    <ErrorState message={error} onRetry={load} />

    {tab === 'requesters' ? <StockKeeperRequesters portalApi={portalApi} user={user} /> : <>
      <PageCard title="Supervisor request register" description={`${groups.length} routed request${groups.length === 1 ? '' : 's'}`}>
        {loading ? <LoadingState label="Loading Supervisor requests…" /> : !groups.length ?
          <EmptyState title="No Supervisor requests" description="Requests routed by Department Supervisors will appear here. Requests sent only to Procurement are intentionally excluded." /> :
          <TableScroll minWidth={1600}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black">
                <tr>
                  {['Request Reference', 'Requester', 'Department', 'Request Date', 'Date Forwarded', 'Items', 'Quantities', 'Available Stock', 'Supervisor', 'Comments', 'Status', 'Actions'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-3 py-3">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((group) => <tr key={group.requestId}>
                  <td className="px-3 py-3 font-bold">{group.reference}<span className="mt-1 block text-[10px] font-normal">{group.storeReference}</span></td>
                  <td className="px-3 py-3">{group.requester || '—'}</td>
                  <td className="px-3 py-3">{group.department || '—'}</td>
                  <td className="px-3 py-3">{dateLabel(group.submittedAt) || '—'}</td>
                  <td className="px-3 py-3">{dateTimeLabel(group.forwardedAt || group.routedAt) || '—'}
                    {!group.forwardedAt && group.routedAt && <span className="mt-1 block text-[10px]">Routed to Stock Keeper</span>}
                  </td>
                  <td className="px-3 py-3">
                    {group.lines.map((line) => <span key={line.storeRequestItemId} className="block">
                      {line.itemName || 'Requested item'}{line.sku ? ` (${line.sku})` : ''}
                    </span>)}
                  </td>
                  <td className="px-3 py-3">
                    {group.lines.map((line) => <span key={line.storeRequestItemId} className="block">
                      {line.requestedQuantity} requested · {line.authorizedQuantity} authorized · {line.issuedQuantity} issued
                    </span>)}
                  </td>
                  <td className="px-3 py-3">
                    {group.lines.map((line) => <span key={line.storeRequestItemId} className="block">
                      {line.availableBalance} {line.unit || 'unit'}
                    </span>)}
                  </td>
                  <td className="px-3 py-3">{group.supervisorName || '—'}</td>
                  <td className="px-3 py-3"><span className="block max-w-48">{group.supervisorComments || '—'}</span></td>
                  <td className="px-3 py-3">
                    <PortalBadge tone={statusTone(group.status)}>{statusLabel(group.status)}</PortalBadge>
                    <span className="mt-1 block text-[10px]">Stock Keeper decision: {group.decision}</span>
                    {group.decisionAt && <span className="mt-1 block text-[10px]">{dateTimeLabel(group.decisionAt)}</span>}
                    {group.rejectionReason && <span className="mt-1 block text-[10px]">Reason: {group.rejectionReason}</span>}
                    {group.comments && <span className="mt-1 block text-[10px]">Comments: {group.comments}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => loadDetail(group.requestId)} className={secondaryButtonClass()}><Eye size={13} />View</button>
                      {['New Request', 'Pending Stock Keeper Review'].includes(group.status) && <>
                        <button type="button" onClick={() => openDecision(group, 'Accepted')} className={primaryButtonClass()}><CheckCircle2 size={13} />Accept</button>
                        <button type="button" onClick={() => openDecision(group, 'Rejected')} className={secondaryButtonClass()}><XCircle size={13} />Reject</button>
                      </>}
                      {['Accepted', 'Partially Issued'].includes(group.status) && group.lines
                        .filter((line) => Number(line.remainingQuantity) > 0 && line.itemId)
                        .map((line) => <button
                          key={`issue-${line.storeRequestItemId}`} type="button" onClick={() => openIssue(line, group)} className={secondaryButtonClass()}>
                          <PackageCheck size={13} />Issue {line.itemName}
                        </button>)}
                      {['Accepted', 'Partially Issued'].includes(group.status) && group.lines
                        .filter((line) => Number(line.remainingQuantity) > 0)
                        .map((line) => <button
                          key={`short-${line.storeRequestItemId}`} type="button" onClick={() => openShortage(line, group)} className={secondaryButtonClass()}>
                          <TriangleAlert size={13} />Shortage {line.itemName}
                        </button>)}
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>}
      </PageCard>
    </>}

    {detail && <Modal title={`Request history · ${detail.request?.requisitionReference || 'Request'}`} size="xl" onClose={() => setDetail(null)}>
      {detailLoading && <LoadingState label="Loading request history…" />}
      {!detailLoading && <div className="space-y-4 text-xs text-black">
        <div className="grid gap-2 sm:grid-cols-3">
          <p><strong>Reference:</strong> {detail.request?.reference}</p>
          <p><strong>Submitted:</strong> {dateTimeLabel(detail.request?.submittedAt) || '—'}</p>
          <p><strong>Forwarded:</strong> {dateTimeLabel(detail.request?.forwardedAt) || '—'}</p>
          <p><strong>Routed:</strong> {dateTimeLabel(detail.request?.routedAt) || '—'}</p>
          <p><strong>Supervisor:</strong> {detail.request?.supervisorName || '—'}</p>
          <p><strong>Status:</strong> {statusLabel(detail.request?.status || (detail.request?.isNew ? 'New Request' : 'Pending Stock Keeper Review'))}</p>
          <p><strong>Decision:</strong> {detail.request?.stockkeeperDecision || 'Pending'} by {detail.request?.stockkeeperName || '—'}</p>
        </div>
        <p className="rounded-lg border border-subtle bg-white p-3"><strong>Purpose:</strong> {detail.request?.justification || detail.request?.purpose || '—'}</p>
        {(detail.request?.supervisorComments || detail.request?.stockkeeperComments || detail.request?.rejectionReason) && <div className="rounded-lg border border-subtle bg-white p-3">
          {detail.request?.supervisorComments && <p><strong>Supervisor comments:</strong> {detail.request.supervisorComments}</p>}
          {detail.request?.stockkeeperComments && <p className="mt-1"><strong>Stock Keeper comments:</strong> {detail.request.stockkeeperComments}</p>}
          {detail.request?.rejectionReason && <p className="mt-1"><strong>Rejection reason:</strong> {detail.request.rejectionReason}</p>}
        </div>}
        <TableScroll minWidth={680}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Item', 'Requested', 'Authorized', 'Issued', 'Available'].map((name) => <th key={name} className="px-2 py-2">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {(detail.items || []).map((line) => <tr key={line.id}>
                <td className="px-2 py-2 font-bold">{line.itemName}</td>
                <td className="px-2 py-2">{line.requestedQuantity}</td>
                <td className="px-2 py-2">{line.authorizedQuantity ?? line.requestedQuantity}</td>
                <td className="px-2 py-2">{line.issuedQuantity}</td>
                <td className="px-2 py-2">{line.availableBalance}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        {(detail.returns || []).map((entry) => <p key={entry.id} className="flex items-start gap-2 rounded-lg border border-subtle bg-white p-3">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {entry.itemName}: {entry.unavailableQuantity} unavailable · {entry.reason} · {entry.status}
        </p>)}
      </div>}
    </Modal>}

    {decision && <Modal title={`${decision.decision} request · ${decision.reference}`} size="lg" onClose={() => setDecision(null)}>
      <form onSubmit={submitDecision} className="space-y-3 text-xs text-black">
        <p className="rounded-lg border border-brand bg-white p-3">
          {decision.decision === 'Accepted'
            ? 'Confirm the quantity that can be supplied. Acceptance only authorizes preparation; stock is reduced only in Stock Out.'
            : 'Rejecting returns the request to the Supervisor. The original request and routing history remain unchanged.'}
        </p>
        {decision.decision === 'Accepted' && <TableScroll minWidth={620}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Item', 'Code', 'Outstanding', 'Available', 'Authorized quantity'].map((name) => <th key={name} className="px-2 py-2">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {decision.lines.map((line, index) => <tr key={line.storeRequestItemId}>
                <td className="px-2 py-2 font-bold">{line.itemName}</td>
                <td className="px-2 py-2">{line.sku || '—'}</td>
                <td className="px-2 py-2">{line.requested}</td>
                <td className="px-2 py-2">{line.available}</td>
                <td className="px-2 py-2"><input type="number" min="0" max={Math.min(line.requested, line.available)} required
                  value={line.quantity} onChange={(event) => setDecision({
                    ...decision,
                    lines: decision.lines.map((item, itemIndex) => itemIndex === index ? { ...line, quantity: event.target.value } : item)
                  })} className="field h-9 w-28" /></td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
        {decision.decision === 'Rejected' && <label className="block font-bold">Rejection reason
          <textarea rows="3" required value={decision.reason} onChange={(event) => setDecision({ ...decision, reason: event.target.value })}
            className="field h-auto py-2" />
        </label>}
        <label className="block font-bold">Comments for Supervisor and requester
          <textarea rows="3" value={decision.comments} onChange={(event) => setDecision({ ...decision, comments: event.target.value })}
            className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setDecision(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}>
            <ClipboardCheck size={14} />{busy ? 'Saving…' : `Confirm ${decision.decision.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>}

    {issue && <Modal title={`Issue stock · ${issue.itemName}`} size="md" onClose={() => setIssue(null)}>
      <form onSubmit={submitIssue} className="space-y-3 text-xs text-black">
        <p>Request {issue.reference} · {issue.unit || 'unit'}</p>
        <label className="block font-bold">Quantity to issue
          <input type="number" min="1" max={Math.max(1, Math.min(Number(issue.quantity) || 0, 100000))} required value={issue.quantity}
            onChange={(event) => setIssue({ ...issue, quantity: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Issue date
          <input type="date" required value={issue.date} onChange={(event) => setIssue({ ...issue, date: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Received by
          <input required value={issue.receivedBy} onChange={(event) => setIssue({ ...issue, receivedBy: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Bin Card description
          <textarea rows="2" value={issue.description} onChange={(event) => setIssue({ ...issue, description: event.target.value })} className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setIssue(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}><PackageCheck size={14} />{busy ? 'Recording…' : 'Record physical issue'}</button>
        </div>
      </form>
    </Modal>}

    {shortage && <Modal title={`Report shortage · ${shortage.itemName}`} size="md" onClose={() => setShortage(null)}>
      <form onSubmit={submitShortage} className="space-y-3 text-xs text-black">
        <p>{shortage.outstanding} {shortage.unit} outstanding on {shortage.reference}. Unavailable units are returned to the Supervisor; no stock is reduced.</p>
        <label className="block font-bold">Physically available
          <input type="number" min="0" max={shortage.outstanding} required value={shortage.availableQuantity}
            onChange={(event) => {
              const available = Math.min(shortage.outstanding, Number(event.target.value) || 0);
              setShortage({ ...shortage, availableQuantity: String(available), unavailableQuantity: String(shortage.outstanding - available) });
            }} className="field" />
        </label>
        <label className="block font-bold">Unavailable
          <input type="number" min="1" required readOnly value={shortage.unavailableQuantity} className="field" />
        </label>
        <label className="block font-bold">Reason
          <textarea rows="3" required value={shortage.reason} onChange={(event) => setShortage({ ...shortage, reason: event.target.value })} className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setShortage(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}><ArrowRightLeft size={14} />{busy ? 'Saving…' : 'Return shortage'}</button>
        </div>
      </form>
    </Modal>}
  </>;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, ClipboardCheck, Eye, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, LoadingState, PageHeader, PortalBadge, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';

function transactionKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function groupRequests(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = Number(row.requestId);
    if (!groups.has(key)) {
      groups.set(key, {
        requestId: key,
        reference: row.requisitionReference || row.reference,
        storeReference: row.reference,
        requester: row.requester,
        department: row.department,
        routedAt: row.routedAt,
        supervisorName: row.supervisorName,
        supervisorComments: row.supervisorComments,
        status: row.requisitionStatus,
        lines: []
      });
    }
    groups.get(key).lines.push(row);
  }
  return [...groups.values()].sort((a, b) => String(b.routedAt || '').localeCompare(String(a.routedAt || '')));
}

export default function StockKeeperIssueRequests({ portalApi, query = {}, initial = null }) {
  const [requests, setRequests] = useState(initial || []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [shortage, setShortage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getIssueRequests();
      setRequests(response.requests || []);
    } catch (exception) {
      setError(exception.message || 'Requests to issue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { if (!initial) load(); }, [initial, load]);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const response = await portalApi.getRoutedRequest(id);
      setDetail(response);
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
        const queue = await portalApi.getIssueRequests();
        if (!active) return;
        const rows = queue.requests || [];
        setRequests(rows);
        // New notifications carry the store-request id; older links carried the
        // requisition id. Resolve either form without exposing the wrong detail.
        const match = rows.find((row) => Number(row.requisitionId) === requestedId);
        await loadDetail(match ? Number(match.requestId) : requestedId);
      } catch (exception) {
        if (active) await loadDetail(requestedId);
      }
    })();
    return () => { active = false; };
  }, [query.request, portalApi, loadDetail]);

  const groups = useMemo(() => groupRequests(requests), [requests]);
  const selectedId = detail?.request?.id || Number(query.request);
  const selected = groups.find((group) => Number(group.requestId) === Number(selectedId));

  function openIssue(line) {
    const outstanding = Number(line.remainingQuantity) || 0;
    const available = Number(line.availableBalance) || 0;
    setIssue({
      storeRequestId: line.requestId,
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      reference: line.requisitionReference || line.reference,
      quantity: String(Math.max(1, Math.min(outstanding, available))),
      date: new Date().toISOString().slice(0, 10),
      receivedBy: line.requester || '',
      description: '',
      key: transactionKey()
    });
  }

  function openShortage(line) {
    const outstanding = Number(line.remainingQuantity) || 0;
    setShortage({
      storeRequestId: line.requestId,
      storeRequestItemId: line.storeRequestItemId,
      itemName: line.itemName,
      unit: line.unit,
      reference: line.requisitionReference || line.reference,
      outstanding,
      availableQuantity: String(Math.min(outstanding, Number(line.availableBalance) || 0)),
      unavailableQuantity: String(Math.max(0, outstanding - Math.min(outstanding, Number(line.availableBalance) || 0))),
      reason: ''
    });
  }

  async function submitIssue(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await portalApi.issueStock({
        storeRequestId: issue.storeRequestId,
        itemId: issue.itemId,
        quantity: Number(issue.quantity),
        date: issue.date,
        receivedBy: issue.receivedBy,
        description: issue.description,
        idempotencyKey: issue.key
      });
      setIssue(null);
      await load();
      if (detail) await loadDetail(detail.request.id);
    } catch (exception) {
      setError(exception.message || 'The stock issue could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function submitShortage(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await portalApi.reportStockShortage(shortage.storeRequestId, {
        storeRequestItemId: shortage.storeRequestItemId,
        availableQuantity: Number(shortage.availableQuantity),
        unavailableQuantity: Number(shortage.unavailableQuantity),
        reason: shortage.reason
      });
      setShortage(null);
      await load();
      if (detail) await loadDetail(detail.request.id);
    } catch (exception) {
      setError(exception.message || 'The shortage could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeader
      eyebrow="Supervisor-routed stock work"
      title="Requests to Issue"
      description="Verify physical stock, confirm quantities issued, and record the Bin Card transaction. Stock is reduced only when a stock-out transaction succeeds."
      actions={<button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>}
    />
    <ErrorState message={error} onRetry={load} />
    <PageCard
      title="Stock issue queue"
      description={groups.length ? `${groups.length} routed request${groups.length === 1 ? '' : 's'} awaiting issue` : 'No requests awaiting issue'}
    >
      {loading && !initial ? <LoadingState label="Loading routed requests…" /> : !groups.length ?
        <EmptyState title="No requests to issue" description="Requests routed here by a Department Supervisor will appear automatically." /> :
        <TableScroll minWidth={1050}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>
                {['Request reference', 'Requester', 'Department', 'Request date', 'Requested items', 'Available stock', 'Supervisor', 'Status', 'Actions'].map((heading) =>
                  <th key={heading} className="whitespace-nowrap px-3 py-3">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {groups.map((group) => <tr key={group.requestId}>
                <td className="px-3 py-3 font-bold">{group.reference}</td>
                <td className="px-3 py-3">{group.requester || '—'}</td>
                <td className="px-3 py-3">{group.department || '—'}</td>
                <td className="px-3 py-3">{dateLabel(group.routedAt)}</td>
                <td className="px-3 py-3">
                  {group.lines.map((line) => <span key={line.storeRequestItemId || line.itemId} className="block">
                    {line.itemName} · {line.requestedQuantity - line.issuedQuantity} {line.unit} outstanding
                  </span>)}
                </td>
                <td className="px-3 py-3">
                  {group.lines.map((line) => <span key={line.storeRequestItemId || line.itemId} className="block">
                    {line.availableBalance} {line.unit}
                  </span>)}
                </td>
                <td className="px-3 py-3">{group.supervisorName || '—'}</td>
                <td className="px-3 py-3"><PortalBadge>{group.status || 'Awaiting Stock Issue'}</PortalBadge></td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => loadDetail(group.requestId)} className={secondaryButtonClass()}>
                      <Eye size={13} />View
                    </button>
                    {group.lines.map((line) => <button key={line.storeRequestItemId || line.itemId} type="button"
                      onClick={() => openIssue(line)}
                      className={secondaryButtonClass()}>
                      <PackageCheck size={13} />Issue {line.itemName}
                    </button>)}
                    {group.lines.map((line) => <button key={`short-${line.storeRequestItemId || line.itemId}`} type="button"
                      onClick={() => openShortage(line)}
                      className={secondaryButtonClass()}>
                      <TriangleAlert size={13} />Shortage
                    </button>)}
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
    </PageCard>

    {selected && <PageCard title={`Request · ${selected.reference}`} description="Supervisor authorization and issued quantities">
      <p className="text-xs text-black">Supervisor: {selected.supervisorName || '—'} · Routed {dateTimeLabel(selected.routedAt)}</p>
      {selected.supervisorComments && <p className="mt-2 text-xs text-black">{selected.supervisorComments}</p>}
    </PageCard>}

    {detail && <Modal title={`Complete request · ${detail.request.requisitionReference}`} size="xl" onClose={() => setDetail(null)}>
      {detailLoading && <LoadingState label="Loading request…" />}
      {!detailLoading && <div className="space-y-4 text-xs text-black">
        <div className="grid gap-2 sm:grid-cols-2">
          <p><strong>Requester:</strong> {detail.request.requester}</p>
          <p><strong>Department:</strong> {detail.request.department || '—'}</p>
          <p><strong>Supervisor:</strong> {detail.request.supervisorName || '—'}</p>
          <p><strong>Status:</strong> {detail.request.requisitionStatusLabel}</p>
        </div>
        <p className="rounded-lg border border-subtle bg-white p-3"><strong>Purpose:</strong> {detail.request.justification || detail.request.purpose}</p>
        {detail.request.supervisorComments && <p className="rounded-lg border border-subtle bg-white p-3"><strong>Supervisor comments:</strong> {detail.request.supervisorComments}</p>}
        <TableScroll minWidth={620}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Item', 'Requested', 'Issued', 'Outstanding', 'Available balance'].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {detail.items.map((line) => <tr key={line.id}>
                <td className="px-2 py-2 font-bold">{line.itemName}</td>
                <td className="px-2 py-2">{line.requestedQuantity} {line.unit}</td>
                <td className="px-2 py-2">{line.issuedQuantity}</td>
                <td className="px-2 py-2">{line.outstandingQuantity}</td>
                <td className="px-2 py-2">{line.availableBalance}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        {detail.returns.map((entry) => <p key={entry.id} className="flex items-start gap-2 rounded-lg border border-subtle bg-white p-3">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {entry.itemName}: {entry.unavailableQuantity} unavailable · {entry.reason} · {entry.status}
        </p>)}
      </div>}
    </Modal>}

    {issue && <Modal title={`Issue stock · ${issue.itemName}`} size="md" onClose={() => setIssue(null)}>
      <form onSubmit={submitIssue} className="space-y-3 text-xs text-black">
        <p>Request {issue.reference} · {issue.unit || 'unit'}</p>
        <label className="block font-bold">Quantity to issue
          <input type="number" min="1" required value={issue.quantity} onChange={(event) => setIssue({ ...issue, quantity: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Issue date
          <input type="date" required value={issue.date} onChange={(event) => setIssue({ ...issue, date: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Receiving person / acknowledgement
          <input required value={issue.receivedBy} onChange={(event) => setIssue({ ...issue, receivedBy: event.target.value })} className="field" />
        </label>
        <label className="block font-bold">Bin Card description
          <textarea rows="2" value={issue.description} onChange={(event) => setIssue({ ...issue, description: event.target.value })} className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setIssue(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}>
            <ClipboardCheck size={14} />{busy ? 'Recording…' : 'Confirm physical issue'}
          </button>
        </div>
      </form>
    </Modal>}

    {shortage && <Modal title={`Report shortage · ${shortage.itemName}`} size="md" onClose={() => setShortage(null)}>
      <form onSubmit={submitShortage} className="space-y-3 text-xs text-black">
        <p>Request {shortage.reference} · {shortage.outstanding} {shortage.unit} outstanding. The unavailable quantity is returned to the Supervisor; no stock is reduced.</p>
        <label className="block font-bold">Quantity physically available
          <input type="number" min="0" max={shortage.outstanding} required value={shortage.availableQuantity}
            onChange={(event) => {
              const available = Math.min(shortage.outstanding, Number(event.target.value) || 0);
              setShortage({ ...shortage, availableQuantity: String(available), unavailableQuantity: String(shortage.outstanding - available) });
            }} className="field" />
        </label>
        <label className="block font-bold">Quantity unavailable
          <input type="number" min="1" required value={shortage.unavailableQuantity} readOnly className="field" />
        </label>
        <label className="block font-bold">Discrepancy reason and required adjustment
          <textarea rows="3" required value={shortage.reason} onChange={(event) => setShortage({ ...shortage, reason: event.target.value })}
            placeholder="State the physical count difference and any authorized stock adjustment needed…" className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setShortage(null)} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}>
            <ArrowRightLeft size={14} />{busy ? 'Saving…' : 'Return shortage to Supervisor'}
          </button>
        </div>
      </form>
    </Modal>}
  </>;
}

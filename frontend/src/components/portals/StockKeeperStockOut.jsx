import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, LoadingState, PortalBadge, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';

const transactionKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const number = (value) => Number(value) || 0;

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
        routedAt: row.routedAt,
        supervisorName: row.supervisorName,
        comments: row.stockkeeperComments,
        decisionAt: row.decisionAt,
        decidedBy: row.stockkeeperName,
        lines: []
      });
    }
    groups.get(id).lines.push(row);
  }
  return [...groups.values()];
}

export default function StockKeeperStockOut({ portalApi, initial = null }) {
  const [requests, setRequests] = useState(initial || []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await portalApi.getIssueRequests();
      setRequests(response.requests || []);
    } catch (exception) {
      setError(exception.message || 'Accepted requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupRequests(
    (requests || []).filter((row) => row.stockkeeperDecision === 'Accepted')
  ), [requests]);

  function openIssue(group) {
    setNotice('');
    setIssue({
      requestId: group.requestId,
      reference: group.reference,
      date: new Date().toISOString().slice(0, 10),
      receivedBy: group.requester || '',
      comments: '',
      key: transactionKey(),
      lines: group.lines.map((line) => ({
        storeRequestItemId: line.storeRequestItemId,
        itemName: line.itemName,
        unit: line.unit,
        authorized: number(line.authorizedQuantity),
        issued: number(line.issuedQuantity),
        outstanding: number(line.remainingQuantity),
        available: number(line.availableBalance),
        quantity: String(Math.min(number(line.remainingQuantity), number(line.availableBalance))),
        selected: true
      }))
    });
  }

  async function submitIssue(event) {
    event.preventDefault();
    const selected = issue.lines.filter((line) => line.selected);
    if (!selected.length) {
      setError('Select at least one item to issue.');
      return;
    }
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await portalApi.issueRequest(issue.requestId, {
        idempotencyKey: issue.key,
        date: issue.date,
        receivedBy: issue.receivedBy,
        comments: issue.comments,
        lines: selected.map((line) => ({ storeRequestItemId: line.storeRequestItemId, quantity: Number(line.quantity) }))
      });
      setNotice(`${result.referenceNo || 'Stock-out'} saved. ${result.total || 0} unit(s) issued. ${result.message || ''}`);
      setIssue(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The stock-out could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>
    </div>
    {notice && <p role="status" className="no-print mb-4 rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">{notice}</p>}
    <ErrorState message={error} onRetry={load} />
    <PageCard title="Accepted requests ready for issue" description={`${groups.length} request${groups.length === 1 ? '' : 's'} with outstanding authorized quantities`}>
      {loading && !initial ? <LoadingState label="Loading accepted requests…" /> : !groups.length ?
        <EmptyState title="No accepted requests" description="Supervisor requests appear here after they are accepted. Accept a request on the Requests from Supervisors page." /> :
        <TableScroll minWidth={1220}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Request', 'Requester', 'Department', 'Routed', 'Supervisor', 'Items / authorized', 'Available', 'Accepted by', 'Actions'].map((name) =>
                <th key={name} className="whitespace-nowrap px-3 py-3">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {groups.map((group) => <tr key={group.requestId}>
                <td className="px-3 py-3 font-bold">{group.reference}<span className="mt-1 block text-[10px] font-normal">{group.storeReference}</span></td>
                <td className="px-3 py-3">{group.requester || '—'}</td>
                <td className="px-3 py-3">{group.department || '—'}</td>
                <td className="px-3 py-3">{dateTimeLabel(group.routedAt)}</td>
                <td className="px-3 py-3">{group.supervisorName || '—'}</td>
                <td className="px-3 py-3">{group.lines.map((line) => <span key={line.storeRequestItemId} className="block">
                  {line.itemName}: {line.remainingQuantity} of {line.authorizedQuantity} {line.unit} outstanding
                </span>)}</td>
                <td className="px-3 py-3">{group.lines.map((line) => <span key={`bal-${line.storeRequestItemId}`} className="block">{line.availableBalance} {line.unit}</span>)}</td>
                <td className="px-3 py-3"><PortalBadge tone="emerald">Accepted</PortalBadge><span className="mt-1 block text-[10px]">{group.decidedBy || '—'} · {dateLabel(group.decisionAt)}</span></td>
                <td className="px-3 py-3"><button type="button" className={primaryButtonClass()} onClick={() => openIssue(group)}><PackageCheck size={13} />Issue selected items</button></td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
    </PageCard>

    {issue && <Modal title={`Issue stock · ${issue.reference}`} size="xl" onClose={() => setIssue(null)}>
      <form onSubmit={submitIssue} className="space-y-4 text-xs text-black">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block font-bold">Issue date
            <input type="date" required value={issue.date} onChange={(event) => setIssue({ ...issue, date: event.target.value })} className="field" />
          </label>
          <label className="block font-bold">Received by
            <input required value={issue.receivedBy} onChange={(event) => setIssue({ ...issue, receivedBy: event.target.value })} className="field" />
          </label>
          <label className="block font-bold">Reference
            <input readOnly value={issue.reference} className="field bg-white" />
          </label>
        </div>
        <TableScroll minWidth={840}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Issue', 'Item', 'Outstanding', 'Available', 'Quantity'].map((name) => <th key={name} className="px-2 py-2">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {issue.lines.map((line, index) => <tr key={line.storeRequestItemId}>
                <td className="px-2 py-2"><input type="checkbox" checked={line.selected}
                  onChange={(event) => setIssue({
                    ...issue,
                    lines: issue.lines.map((item, itemIndex) => itemIndex === index ? { ...line, selected: event.target.checked } : item)
                  })} /></td>
                <td className="px-2 py-2 font-bold">{line.itemName}</td>
                <td className="px-2 py-2">{line.outstanding} {line.unit}</td>
                <td className="px-2 py-2">{line.available} {line.unit}</td>
                <td className="px-2 py-2"><input type="number" min="1" max={Math.min(line.outstanding, line.available)} required={line.selected} disabled={!line.selected}
                  value={line.quantity} onChange={(event) => setIssue({
                    ...issue,
                    lines: issue.lines.map((item, itemIndex) => itemIndex === index ? { ...line, quantity: event.target.value } : item)
                  })} className="field h-9 w-28" /></td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        <label className="block font-bold">Bin Card / issue comments
          <textarea rows="3" value={issue.comments} onChange={(event) => setIssue({ ...issue, comments: event.target.value })} className="field h-auto py-2" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryButtonClass()} onClick={() => setIssue(null)}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}><PackageCheck size={14} />{busy ? 'Saving stock-out…' : 'Confirm stock-out'}</button>
        </div>
      </form>
    </Modal>}
  </>;
}

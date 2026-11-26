import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowUpFromLine, FileText, Search, SlidersHorizontal
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import Modal from '../ui/Modal.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import { downloadBinary, filesToAttachments } from '../../utils/attachments.js';
import { dateTimeLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';
import { AttachmentList, AttachmentPicker } from './PortalUi.jsx';
import {
  EmptyState, ErrorState, LoadingState, PageHeader, PortalBadge, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';

const ITEMS_REPORT = {
  exportKey: 'stockkeeperItems',
  title: 'Stock Register',
  fields: [{ key: 'updated', label: 'Last updated' }],
  defaultField: 'updated'
};
const BIN_CARD_REPORT = {
  exportKey: 'stockkeeperBinCard',
  title: 'Stock Bin Card',
  fields: [
    { key: 'movement', label: 'Transaction date' },
    { key: 'created', label: 'Date recorded' }
  ],
  defaultField: 'movement'
};

function transactionKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function OperationForm({ operation, items, issueRequests, selectedItemId, preferredRequestId, onClose, onSubmit }) {
  const [form, setForm] = useState({
    itemId: String(selectedItemId || ''),
    storeRequestId: String(preferredRequestId || ''),
    quantity: '1',
    date: new Date().toISOString().slice(0, 10),
    referenceNo: '',
    source: '',
    description: '',
    receivedBy: '',
    direction: 'Out',
    reason: ''
  });
  const [files, setFiles] = useState([]);
  const [key, setKey] = useState(transactionKey);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedIssue = issueRequests.find((request) =>
    String(request.requestId) === form.storeRequestId && String(request.itemId) === form.itemId
  );
  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setKey(transactionKey());
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        itemId: Number(form.itemId),
        quantity: Number(form.quantity),
        date: form.date,
        referenceNo: form.referenceNo,
        description: form.description,
        idempotencyKey: key
      };
      if (operation === 'in') {
        payload.source = form.source;
        payload.attachments = files.length ? await filesToAttachments(files) : [];
      } else if (operation === 'out') {
        payload.storeRequestId = Number(form.storeRequestId);
        payload.receivedBy = form.receivedBy;
      } else {
        payload.direction = form.direction;
        payload.reason = form.reason;
      }
      await onSubmit(operation, payload);
      onClose();
    } catch (exception) {
      setError(exception.message || 'The transaction could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const title = operation === 'in' ? 'Record Stock In'
    : operation === 'out' ? 'Record Stock Out' : 'Record Stock Adjustment';
  const itemOptions = operation === 'out'
    ? issueRequests
    : items;

  useEffect(() => {
    if (operation === 'out' && issueRequests.length && !form.storeRequestId) {
      const first = issueRequests.find((request) => String(request.itemId) === String(selectedItemId)) || issueRequests[0];
      setForm((current) => ({
        ...current,
        itemId: String(first.itemId),
        storeRequestId: String(first.requestId),
        quantity: String(Math.min(first.remainingQuantity, first.availableBalance) || 1)
      }));
    }
  }, [operation, issueRequests, form.storeRequestId, selectedItemId]);

  useEffect(() => {
    if (operation !== 'out' || !preferredRequestId) return;
    const preferred = issueRequests.find((request) => String(request.requestId) === String(preferredRequestId));
    if (preferred) {
      setForm((current) => ({
        ...current,
        storeRequestId: String(preferred.requestId),
        itemId: String(preferred.itemId),
        quantity: String(Math.min(preferred.remainingQuantity, preferred.availableBalance) || 1)
      }));
    }
  }, [operation, preferredRequestId, issueRequests]);

  return <Modal title={title} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      {operation === 'out' ? <label className="block text-xs font-bold">Approved request and item
        <select required value={form.storeRequestId && form.itemId ? `${form.storeRequestId}:${form.itemId}` : ''}
          onChange={(event) => {
            const [requestId, itemId] = event.target.value.split(':');
            const selected = issueRequests.find((request) => String(request.requestId) === requestId && String(request.itemId) === itemId);
            setForm((current) => ({
              ...current, storeRequestId: requestId || '', itemId: itemId || '',
              quantity: String(Math.min(selected?.remainingQuantity || 1, selected?.availableBalance || 1))
            }));
            setKey(transactionKey());
          }} className="field">
          <option value="">Select an approved request…</option>
          {issueRequests.map((request) => <option key={`${request.requestId}:${request.itemId}`} value={`${request.requestId}:${request.itemId}`}>
            {request.reference} · {request.requester} · {request.itemName} (remaining {request.remainingQuantity}; available {request.availableBalance})
          </option>)}
        </select>
      </label> : <label className="block text-xs font-bold">Inventory item
        <select required value={form.itemId} onChange={(event) => update('itemId', event.target.value)} className="field">
          <option value="">Select an item…</option>
          {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku} · balance {item.balance ?? item.availableBalance}</option>)}
        </select>
      </label>}

      {operation === 'out' && selectedIssue && <div className="grid gap-2 rounded-lg border border-brand bg-white p-3 text-xs sm:grid-cols-2">
        <p><span className="text-black">Requester:</span> <strong>{selectedIssue.requester}</strong></p>
        <p><span className="text-black">Department:</span> <strong>{selectedIssue.department || '—'}</strong></p>
        <p><span className="text-black">Request reference:</span> <strong>{selectedIssue.reference}</strong></p>
        <p><span className="text-black">Available:</span> <strong>{selectedIssue.availableBalance} {selectedIssue.unit}</strong></p>
        {selectedIssue.availableBalance < selectedIssue.remainingQuantity && <p className="font-semibold text-black sm:col-span-2">
          Shortage: {selectedIssue.remainingQuantity - selectedIssue.availableBalance} {selectedIssue.unit} of the approved quantity cannot currently be issued.
        </p>}
      </div>}

      {operation === 'adjustment' && <label className="block text-xs font-bold">Adjustment direction
        <select value={form.direction} onChange={(event) => update('direction', event.target.value)} className="field">
          <option value="Out">Reduce balance</option><option value="In">Increase balance</option>
        </select>
      </label>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">Quantity
          <input required min="1" max={operation === 'out' && selectedIssue ? Math.min(selectedIssue.remainingQuantity, selectedIssue.availableBalance) : undefined}
            type="number" step="1" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} className="field" />
        </label>
        <label className="block text-xs font-bold">Transaction date
          <input required type="date" value={form.date} onChange={(event) => update('date', event.target.value)} className="field" />
        </label>
      </div>
      <label className="block text-xs font-bold">Reference number <span className="font-normal text-black">(optional; generated if blank)</span>
        <input value={form.referenceNo} onChange={(event) => update('referenceNo', event.target.value)} maxLength="40" className="field" />
      </label>
      {operation === 'in' && <label className="block text-xs font-bold">Source / supplier
        <input required value={form.source} onChange={(event) => update('source', event.target.value)} maxLength="180" className="field" />
      </label>}
      {operation === 'out' && <label className="block text-xs font-bold">Received by <span className="font-normal text-black">(optional)</span>
        <input value={form.receivedBy} onChange={(event) => update('receivedBy', event.target.value)} maxLength="150" className="field" />
      </label>}
      {operation === 'adjustment' && <label className="block text-xs font-bold">Reason for adjustment
        <textarea required rows="3" value={form.reason} onChange={(event) => update('reason', event.target.value)} className="field h-auto py-2" />
      </label>}
      {operation !== 'adjustment' && <label className="block text-xs font-bold">
        {operation === 'out' ? 'Purpose / remarks' : 'Description / remarks'}
        <textarea rows="2" value={form.description} onChange={(event) => update('description', event.target.value)} className="field h-auto py-2" />
      </label>}
      {operation === 'in' && <div>
        <p className="mb-2 text-xs font-bold">Supporting document <span className="font-normal text-black">(optional)</span></p>
        <AttachmentPicker files={files} onChange={(next) => { setFiles(next); setKey(transactionKey()); }} />
      </div>}
      <ErrorState message={error} />
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
        <button type="submit" disabled={busy || (operation === 'out' && (!selectedIssue || selectedIssue.availableBalance < 1))}
          className={primaryButtonClass()}>{busy ? 'Recording…' : operation === 'in' ? 'Record Stock In' : operation === 'out' ? 'Record Stock Out' : 'Record Adjustment'}</button>
      </div>
    </form>
  </Modal>;
}

function BinCardDetails({ card, onDownload, onError, actions, user = {} }) {
  const { item, movements, openingBalance } = card;
  const [dateFilter, setDateFilter] = useState({});
  const reportUser = user?.name
    ? { name: user.name, roleLabel: roleLabel(user.role), department: user.department }
    : null;

  return <>
    <ReportToolbar
      report={BIN_CARD_REPORT}
      dateFilter={dateFilter}
      onDateFilterChange={setDateFilter}
      params={{ itemId: item.id }}
      reference={item.sku}
      user={reportUser}
      department={user.department || ''}
      scope="bin card transactions"
      printLabel="Print Bin Card"
    />
    <PageHeader eyebrow="Stock ledger" title={item.name} description={`${item.sku} · ${item.category} · ${item.department || 'General storage'}`}
      actions={actions} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Opening Balance', `${openingBalance} ${item.unit}`],
        ['Current Balance', `${item.balance} ${item.unit}`],
        ['Minimum Stock Level', `${item.minimumStock} ${item.unit}`],
        ['Last Updated', dateTimeLabel(item.updatedAt)]
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-brand bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-black">{label}</p><p className="mt-2 text-sm font-extrabold">{value}</p>
      </div>)}
    </div>
    <PageCard title="Bin Card Transactions" description="Historical transactions are append-only and cannot be silently edited or deleted.">
      {movements.length ? <TableScroll minWidth={900}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-black">
            <tr>{['Date', 'Reference No.', 'Description', 'Stock In', 'Stock Out', 'Balance', 'Updated By', 'Documents'].map((column) =>
              <th key={column} className="whitespace-nowrap px-4 py-3 font-bold">{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {[...movements].reverse().map((movement) => <tr key={movement.id}>
              <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(movement.movementAt)}</td>
              <td className="px-4 py-3 font-semibold">{movement.referenceNo || movement.source}</td>
              <td className="max-w-64 px-4 py-3">{movement.description || movement.source}
                {movement.requester && <div className="mt-0.5 text-[10px] text-black">{movement.requester} · {movement.department}</div>}
                {movement.receivedBy && <div className="mt-0.5 text-[10px] text-black">Received by {movement.receivedBy}</div>}
              </td>
              <td className="px-4 py-3 font-semibold text-black">{movement.direction === 'In' ? movement.quantity : '—'}</td>
              <td className="px-4 py-3 font-semibold text-black">{movement.direction === 'Out' ? movement.quantity : '—'}</td>
              <td className="px-4 py-3 font-extrabold">{movement.balance}</td>
              <td className="px-4 py-3">{movement.updatedBy || '—'}</td>
              <td className="px-4 py-3">{movement.attachments?.length ? <AttachmentList
                attachments={movement.attachments}
                downloadPath={(attachmentId, fileName) => onDownload(item.id, movement.id, attachmentId, fileName)}
                onError={onError}
              /> : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No transactions recorded" description={`${openingBalance} ${item.unit} is the opening balance for this Bin Card.`} />}
    </PageCard>
  </>;
}

export default function StockKeeperBinCards({
  portalApi, initialItems = [], initialIssueRequests = [], query = {}, navigate, user = {}
}) {
  const [items, setItems] = useState(initialItems);
  const [issueRequests, setIssueRequests] = useState(initialIssueRequests);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(query.item ? String(query.item) : '');
  const [card, setCard] = useState(null);
  const [operation, setOperation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [listDateFilter, setListDateFilter] = useState({});
  const autoOpenedRequest = useRef('');
  const reportUser = user?.name
    ? { name: user.name, roleLabel: roleLabel(user.role), department: user.department }
    : null;

  useEffect(() => { setItems(initialItems); }, [initialItems]);
  useEffect(() => { setIssueRequests(initialIssueRequests); }, [initialIssueRequests]);
  useEffect(() => { setSelectedId(query.item ? String(query.item) : ''); }, [query.item]);

  async function refresh() {
    setError('');
    try {
      const [itemResult, requestResult] = await Promise.all([
        portalApi.getStockItems(), portalApi.getIssueRequests()
      ]);
      setItems(itemResult.items || []);
      setIssueRequests(requestResult.requests || []);
    } catch (exception) {
      setError(exception.message || 'Inventory could not be refreshed.');
    }
  }

  useEffect(() => {
    if (!selectedId) { setCard(null); return; }
    let active = true;
    setLoading(true);
    setError('');
    portalApi.getBinCard(selectedId)
      .then((result) => { if (active) setCard(result); })
      .catch((exception) => { if (active) setError(exception.message || 'Bin Card could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId, portalApi]);

  useEffect(() => {
    const requestId = query.request ? String(query.request) : '';
    if (!requestId || requestId === autoOpenedRequest.current || !issueRequests.length) return;
    const request = issueRequests.find((candidate) => String(candidate.requestId) === requestId);
    if (request) {
      autoOpenedRequest.current = requestId;
      setSelectedId(String(request.itemId));
      setOperation('out');
    }
  }, [query.request, issueRequests]);

  const filteredItems = useMemo(() => items.filter((item) =>
    `${item.name} ${item.sku} ${item.category} ${item.department || ''}`.toLowerCase().includes(search.toLowerCase())
  ), [items, search]);

  async function submitOperation(type, payload) {
    const result = type === 'in' ? await portalApi.stockIn(payload)
      : type === 'out' ? await portalApi.stockOut(payload)
        : await portalApi.stockAdjustment(payload);
    setNotice(result.message || 'Inventory transaction recorded.');
    await refresh();
    if (selectedId) {
      const latest = await portalApi.getBinCard(selectedId);
      setCard(latest);
    }
  }

  async function downloadDocument(itemId, movementId, attachmentId, fileName) {
    await downloadBinary(
      `/portal/stockkeeper/items/${itemId}/movements/${movementId}/attachments/${attachmentId}`,
      fileName
    );
  }

  function openOperation(type) {
    setError('');
    setNotice('');
    setOperation(type);
  }

  const actions = <div className="flex flex-wrap gap-2">
    <button type="button" onClick={() => openOperation('in')} className={primaryButtonClass()}><ArrowDownToLine size={14} />Stock In</button>
    <button type="button" onClick={() => openOperation('out')} disabled={!issueRequests.length}
      title={!issueRequests.length ? 'No approved requests are waiting for stock issue.' : undefined}
      className={secondaryButtonClass()}><ArrowUpFromLine size={14} />Stock Out</button>
    <button type="button" onClick={() => openOperation('adjustment')} className={secondaryButtonClass()}><SlidersHorizontal size={14} />Adjust</button>
  </div>;

  return <div className="space-y-5">
    {selectedId && <button type="button" onClick={() => { setSelectedId(''); setCard(null); navigate('Bin Card'); }}
      className="inline-flex items-center gap-1 text-xs font-bold text-black hover:underline"><ArrowLeft size={14} />All Bin Cards</button>}
    {selectedId ? loading && !card ? <LoadingState label="Loading Bin Card…" /> : card ?
      <>
        {notice && <div role="status" className="rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">{notice}</div>}
        <ErrorState message={error} onRetry={() => portalApi.getBinCard(selectedId).then(setCard).catch((exception) => setError(exception.message))} />
        <BinCardDetails card={card} onDownload={downloadDocument} onError={setError} actions={actions} user={user} />
      </> : error ? <ErrorState message={error} onRetry={() => portalApi.getBinCard(selectedId).then(setCard).catch((exception) => setError(exception.message))} /> :
      <EmptyState title="Bin Card unavailable" description="The item may have been removed or is no longer available." /> :
      <>
        <PageHeader eyebrow="Inventory ledger" title="Bin Card"
          description="Review item balances and append stock-in, authorized stock-out, or traceable adjustment transactions."
          actions={actions} />
        <ReportToolbar
          report={ITEMS_REPORT}
          dateFilter={listDateFilter}
          onDateFilterChange={setListDateFilter}
          params={{ search }}
          user={reportUser}
          scope="stock register items"
          printLabel="Print stock register"
        />
        {notice && <div role="status" className="rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">{notice}</div>}
        <ErrorState message={error} onRetry={refresh} />
        <PageCard title="Inventory Items" description={`${items.length} item(s)`}>
          <div className="flex flex-wrap items-end gap-3 border-b border-subtle bg-white px-4 py-4">
            <label className="block w-full sm:max-w-sm"><span className="text-[10px] font-bold uppercase tracking-wide text-black">Search Bin Cards</span>
              <span className="relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item, code, category or location…" className="field pl-9" /></span>
            </label>
            <span className="text-[10px] text-black">Select an item to open its transaction ledger.</span>
          </div>
          {filteredItems.length ? <TableScroll minWidth={760}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black"><tr>
                {['Item', 'Category', 'Location', 'Current Balance', 'Minimum Level', 'Last Updated', 'Status'].map((column) =>
                  <th key={column} className="whitespace-nowrap px-4 py-3 font-bold">{column}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-subtle">
                {filteredItems.map((item) => <tr key={item.id} className="hover:bg-white">
                  <td className="px-4 py-3"><button type="button" onClick={() => { setSelectedId(String(item.id)); navigate('Bin Card', { item: item.id }); }}
                    className="text-left font-bold text-black hover:underline">{item.name}<span className="block text-[10px] font-normal text-black">{item.sku}</span></button></td>
                  <td className="px-4 py-3">{item.category}</td><td className="px-4 py-3">{item.department || 'General storage'}</td>
                  <td className="px-4 py-3 font-extrabold">{item.balance} {item.unit}</td><td className="px-4 py-3">{item.minimumStock} {item.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(item.updatedAt)}</td>
                  <td className="px-4 py-3"><PortalBadge tone={item.balance <= item.minimumStock ? 'amber' : 'emerald'}>
                    {item.balance === 0 ? 'Out of stock' : item.balance <= item.minimumStock ? 'Low stock' : 'Available'}
                  </PortalBadge></td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <EmptyState title="No Bin Cards found" description="Try a different search or record a new inventory item through the Administrator." action={<FileText size={16} className="mx-auto text-black" />} />}
        </PageCard>
      </>}
    {operation && <OperationForm operation={operation} items={items} issueRequests={issueRequests}
      preferredRequestId={query.request}
      selectedItemId={selectedId} onClose={() => setOperation('')} onSubmit={submitOperation} />}
  </div>;
}

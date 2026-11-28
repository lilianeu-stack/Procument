import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, FileText, PackagePlus, RefreshCw, Truck } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, LoadingState, PortalBadge, TableScroll,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';

const transactionKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const number = (value) => Number(value) || 0;

export default function StockKeeperStockIn({ portalApi, query = {}, initial = null }) {
  const [deliveries, setDeliveries] = useState(initial || []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await portalApi.getExpectedDeliveries();
      setDeliveries(response.deliveries || []);
    } catch (exception) {
      setError(exception.message || 'Expected deliveries could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setError('');
    try {
      setSelected(await portalApi.getExpectedDelivery(id));
    } catch (exception) {
      setError(exception.message || 'The expected delivery could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [portalApi]);

  useEffect(() => {
    const id = Number(query.purchaseOrder);
    if (id) void openDetail(id);
  }, [query.purchaseOrder, openDetail]);

  function openReceipt(delivery, all) {
    setNotice('');
    setReceipt({
      purchaseOrderId: delivery.id,
      reference: delivery.reference,
      supplier: delivery.supplier,
      all,
      date: new Date().toISOString().slice(0, 10),
      comments: '',
      key: transactionKey(),
      lines: (delivery.items || []).filter((line) => number(line.outstandingQuantity) > 0).map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        sku: line.itemCode || '—',
        unit: line.unit,
        outstanding: number(line.outstandingQuantity),
        acceptedQuantity: String(all ? number(line.outstandingQuantity) : Math.min(number(line.outstandingQuantity), number(line.outstandingQuantity))),
        rejectedQuantity: '0',
        condition: all ? 'Good' : '',
        comments: '',
        departmentId: line.departmentId || '',
        storageLocation: line.storageLocation || ''
      }))
    });
  }

  async function submitReceipt(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const lines = receipt.lines.map((line) => ({
        itemId: line.itemId,
        deliveredQuantity: number(line.acceptedQuantity) + number(line.rejectedQuantity),
        acceptedQuantity: number(line.acceptedQuantity),
        rejectedQuantity: number(line.rejectedQuantity),
        condition: line.condition || (number(line.rejectedQuantity) ? 'Damaged/rejected' : 'Good'),
        comments: line.comments,
        departmentId: line.departmentId || null,
        storageLocation: line.storageLocation || null
      }));
      const payload = {
        idempotencyKey: receipt.key,
        date: receipt.date,
        comments: receipt.comments,
        lines
      };
      const result = receipt.all
        ? await portalApi.receiveAll(receipt.purchaseOrderId, payload)
        : await portalApi.receiveItems(receipt.purchaseOrderId, payload);
      setNotice(`${result.reference || 'Goods receipt'} saved. ${result.acceptedTotal || 0} accepted, ${result.rejectedTotal || 0} damaged/rejected.`);
      setReceipt(null);
      setSelected(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The delivery could not be received.');
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
    <PageCard title="Expected deliveries" description="Approved purchase orders awaiting full or partial receipt">
      {loading && !initial ? <LoadingState label="Loading expected deliveries…" /> : !deliveries.length ?
        <EmptyState title="No expected deliveries" description="When Procurement approves a purchase order, the Stock Keeper is notified and its expected delivery appears here." /> :
        <TableScroll minWidth={1040}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Purchase order', 'Supplier', 'Expected date', 'Officer', 'Items', 'Status', 'Actions'].map((name) =>
                <th key={name} className="whitespace-nowrap px-3 py-3">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {deliveries.map((delivery) => <tr key={delivery.id}>
                <td className="px-3 py-3 font-bold">{delivery.reference}</td>
                <td className="px-3 py-3">{delivery.supplier}</td>
                <td className="px-3 py-3">{dateLabel(delivery.expectedDate) || 'To be confirmed'}</td>
                <td className="px-3 py-3">{delivery.procurementOfficer || '—'}</td>
                <td className="px-3 py-3">{(delivery.items || []).map((line) => `${line.itemName}: ${number(line.outstandingQuantity)} ${line.unit} outstanding`).join(' · ') || '—'}</td>
                <td className="px-3 py-3"><PortalBadge tone={delivery.status === 'Approved' ? 'blue' : 'amber'}>{delivery.status}</PortalBadge></td>
                <td className="px-3 py-3"><div className="flex flex-wrap gap-1.5">
                  <button type="button" className={secondaryButtonClass()} onClick={() => openDetail(delivery.id)}><FileText size={13} />View</button>
                  <button type="button" className={primaryButtonClass()} onClick={() => openReceipt(delivery, true)}><CheckCircle2 size={13} />Receive All Items</button>
                  <button type="button" className={secondaryButtonClass()} onClick={() => openReceipt(delivery, false)}><PackagePlus size={13} />Receive Individual</button>
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
    </PageCard>

    {selected && <Modal title={`Expected delivery · ${selected.reference}`} size="xl" onClose={() => setSelected(null)}>
      {detailLoading && <LoadingState label="Loading delivery…" />}
      {!detailLoading && <div className="space-y-4 text-xs text-black">
        <div className="grid gap-2 sm:grid-cols-3">
          <p><strong>Supplier:</strong> {selected.supplier}</p>
          <p><strong>Expected:</strong> {dateLabel(selected.expectedDate) || 'To be confirmed'}</p>
          <p><strong>Procurement officer:</strong> {selected.procurementOfficer || '—'}</p>
        </div>
        <p className="rounded-lg border border-subtle bg-white p-3"><strong>Delivery information:</strong> {selected.deliveryInformation}</p>
        <TableScroll minWidth={760}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Item', 'Code', 'Expected', 'Received', 'Damaged', 'Outstanding', 'Unit'].map((name) => <th key={name} className="px-2 py-2">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {selected.items.map((line) => <tr key={line.purchaseOrderItemId}>
                <td className="px-2 py-2 font-bold">{line.itemName}</td>
                <td className="px-2 py-2">{line.itemCode || '—'}</td>
                <td className="px-2 py-2">{number(line.expectedQuantity)}</td>
                <td className="px-2 py-2">{number(line.receivedQuantity)}</td>
                <td className="px-2 py-2">{number(line.damagedQuantity)}</td>
                <td className="px-2 py-2">{number(line.outstandingQuantity)}</td>
                <td className="px-2 py-2">{line.unit}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        <div className="rounded-lg border border-subtle bg-white p-3">
          <p className="flex items-center gap-2 font-bold"><FileText size={14} />Attached documents</p>
          {(selected.documents || []).length
            ? selected.documents.map((document) => <p key={document.id} className="mt-1">{document.fileName}</p>)
            : <p className="mt-1">No documents attached to the originating requisition.</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {number(selected.items.reduce((sum, line) => sum + number(line.outstandingQuantity), 0)) > 0 && <>
            <button type="button" className={primaryButtonClass()} onClick={() => openReceipt(selected, true)}><CheckCircle2 size={14} />Receive All Items</button>
            <button type="button" className={secondaryButtonClass()} onClick={() => openReceipt(selected, false)}><PackagePlus size={14} />Receive Individual Items</button>
          </>}
        </div>
      </div>}
    </Modal>}

    {receipt && <Modal title={`${receipt.all ? 'Receive all' : 'Receive individual items'} · ${receipt.reference}`} size="xl" onClose={() => setReceipt(null)}>
      <form onSubmit={submitReceipt} className="space-y-4 text-xs text-black">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-bold">Receiving date
            <input type="date" required value={receipt.date} onChange={(event) => setReceipt({ ...receipt, date: event.target.value })} className="field" />
          </label>
          <label className="block font-bold">Receipt comments
            <input value={receipt.comments} onChange={(event) => setReceipt({ ...receipt, comments: event.target.value })} className="field" placeholder="Optional delivery note" />
          </label>
        </div>
        <TableScroll minWidth={1000}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Item', 'Outstanding', 'Accepted', 'Damaged/rejected', 'Delivered', 'Condition', 'Storage location'].map((name) => <th key={name} className="px-2 py-2">{name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {receipt.lines.map((line, index) => <tr key={`${line.itemId}-${index}`}>
                <td className="px-2 py-2 font-bold">{line.itemName}<span className="block text-[10px] font-normal">{line.sku}</span></td>
                <td className="px-2 py-2">{line.outstanding} {line.unit}</td>
                <td className="px-2 py-2"><input type="number" min="0" max={line.outstanding} required disabled={receipt.all}
                  value={line.acceptedQuantity} onChange={(event) => setReceipt({
                    ...receipt,
                    lines: receipt.lines.map((item, itemIndex) => itemIndex === index ? { ...line, acceptedQuantity: event.target.value } : item)
                  })} className="field h-9 w-24" /></td>
                <td className="px-2 py-2"><input type="number" min="0" max={line.outstanding} required disabled={receipt.all}
                  value={line.rejectedQuantity} onChange={(event) => setReceipt({
                    ...receipt,
                    lines: receipt.lines.map((item, itemIndex) => itemIndex === index ? { ...line, rejectedQuantity: event.target.value } : item)
                  })} className="field h-9 w-24" /></td>
                <td className="px-2 py-2 font-bold">{number(line.acceptedQuantity) + number(line.rejectedQuantity)}</td>
                <td className="px-2 py-2"><select disabled={receipt.all} value={line.condition}
                  onChange={(event) => setReceipt({
                    ...receipt,
                    lines: receipt.lines.map((item, itemIndex) => itemIndex === index ? { ...line, condition: event.target.value } : item)
                  })} className="field h-9 w-36">
                  <option value="">Select condition</option>
                  <option value="Good">Good</option>
                  <option value="Damaged/rejected">Damaged/rejected</option>
                  <option value="Partial">Partial</option>
                </select></td>
                <td className="px-2 py-2"><input disabled={receipt.all} value={line.storageLocation}
                  onChange={(event) => setReceipt({
                    ...receipt,
                    lines: receipt.lines.map((item, itemIndex) => itemIndex === index ? { ...line, storageLocation: event.target.value } : item)
                  })} className="field h-9 w-40" /></td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        <p className="flex items-center gap-2 rounded-lg border border-brand bg-white p-3"><CalendarDays size={14} />Accepted quantity increases stock. Damaged/rejected quantity is recorded for reporting and Procurement notification only.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryButtonClass()} onClick={() => setReceipt(null)}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}><Truck size={14} />{busy ? 'Saving receipt…' : 'Save goods receipt'}</button>
        </div>
      </form>
    </Modal>}
  </>;
}

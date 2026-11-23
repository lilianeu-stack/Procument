import { useEffect, useMemo, useState } from 'react';
import { Eye, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import DownloadButton from '../components/ui/DownloadButton.jsx';
import PrintButton from '../components/ui/PrintButton.jsx';
import PurchaseOrderDocument from '../components/documents/PurchaseOrderDocument.jsx';
import SupplierPricingAwardSummary from '../components/documents/SupplierPricingAwardSummary.jsx';
import SendForApprovalModal from '../components/portals/SendForApprovalModal.jsx';
import SupplierSelectionModal from '../components/portals/SupplierSelectionModal.jsx';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';
import {
  PURCHASE_ORDER_TYPES, calculatePurchaseTotals,
  canEditPurchaseOrder, configuredVatRate, formatRwf
} from '../utils/purchaseCalculations.js';

// The frontend values are previews only; the backend recalculates all totals.
const emptyLine = () => ({ itemName: '', description: '', quantity: '1', unit: 'unit', unitPrice: '' });

function normalizeDetail(response) {
  return response?.purchaseOrder || response?.order || response || {};
}

// MySQL DATE values arrive as ISO timestamps, while <input type="date"> only
// accepts YYYY-MM-DD. Without this conversion the edit form silently clears
// the delivery date and blocks saving.
function dateInputValue(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function detailLines(order) {
  if (!Array.isArray(order?.items)) return [];
  return order.items.map((line) => ({
    id: line.id,
    itemName: line.itemName || line.name || '',
    description: line.description || '',
    quantity: String(line.quantity ?? 1),
    unit: line.unit || 'unit',
    unitPrice: String(line.unitPrice ?? '')
  }));
}

function supplierFor(rfq) {
  return {
    name: rfq?.selectedSupplier || rfq?.supplier || rfq?.awardedSupplier || '—',
    contact: rfq?.supplierContact || rfq?.awardedSupplierContact || rfq?.selectedSupplierContact || rfq?.contact || '—',
    address: rfq?.supplierAddress || rfq?.awardedSupplierAddress || rfq?.selectedSupplierAddress || '—'
  };
}

function canSendForApproval(order) {
  return !['Required', 'Collecting'].includes(order?.supplierPricingStatus);
}

// The awarded quotation, not the requisition estimate, is authoritative. Mirror
// the backend's distribution across the original lines so the on-screen totals
// agree with what will be saved.
function distributeAwardedAmount(lines, amount) {
  const totalCents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0 || !lines.length) return lines;
  const totalUnits = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) || 1;
  const estimateTotal = lines.reduce((sum, line) => (
    sum + (Number(line.quantity) || 0) * (Number(line.estimatedUnitCost) || 0)
  ), 0);
  let remainingCents = totalCents;
  return lines.map((line, index) => {
    const weight = estimateTotal > 0
      ? (Number(line.quantity) || 0) * (Number(line.estimatedUnitCost) || 0) / estimateTotal
      : (Number(line.quantity) || 0) / totalUnits;
    const lineCents = index === lines.length - 1 ? remainingCents : Math.round(totalCents * weight);
    remainingCents -= lineCents;
    const quantity = Number(line.quantity) || 1;
    return { ...line, unitPrice: String((lineCents / 100) / quantity) };
  });
}

function validateLines(lines) {
  if (!lines.length) return 'Add at least one purchase order line.';
  for (const [index, line] of lines.entries()) {
    if (!String(line.itemName || '').trim()) return `Line ${index + 1} needs a description.`;
    if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1) return `Line ${index + 1} needs a whole quantity of at least 1.`;
    if (line.unitPrice === '' || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) return `Line ${index + 1} needs a valid unit price.`;
  }
  return '';
}

function ItemTable({ lines, onChange, onAdd, onRemove, vatRate }) {
  const totals = calculatePurchaseTotals(lines, vatRate ?? configuredVatRate());
  return <div className="space-y-3">
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase text-muted">
          <tr>{['Item No.', 'Quantity', 'Unit', 'Description', 'Unit Price', 'Total Price', ''].map((heading) =>
            <th key={heading} className="whitespace-nowrap px-3 py-3 font-bold">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((line, index) => <tr key={line.id || `line-${index}`} className="align-top">
            <td className="px-3 py-3 font-bold text-muted">{index + 1}</td>
            <td className="px-3 py-3"><input required type="number" min="1" step="1" value={line.quantity}
              onChange={(event) => onChange(index, 'quantity', event.target.value)} className="field mt-0 w-20" /></td>
            <td className="px-3 py-3"><input required value={line.unit}
              onChange={(event) => onChange(index, 'unit', event.target.value)} className="field mt-0 w-24" /></td>
            <td className="min-w-[220px] px-3 py-3">
              <input required value={line.itemName} placeholder="Item name"
                onChange={(event) => onChange(index, 'itemName', event.target.value)} className="field mt-0" />
              <input value={line.description} placeholder="Description / specification"
                onChange={(event) => onChange(index, 'description', event.target.value)} className="field mt-1.5" />
            </td>
            <td className="px-3 py-3"><input required type="number" min="0" step="0.01" value={line.unitPrice}
              onChange={(event) => onChange(index, 'unitPrice', event.target.value)} className="field mt-0 w-28" /></td>
            <td className="whitespace-nowrap px-3 py-4 font-bold">{formatRwf((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</td>
            <td className="px-3 py-3"><button type="button" onClick={() => onRemove(index)} aria-label={`Remove line ${index + 1}`}
              className="inline-flex items-center gap-1 rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600">
              <Trash2 size={14} /><span className="text-[10px] font-bold">Remove</span>
            </button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-brand">
      <Plus size={14} />Add line
    </button>
    <dl className="grid gap-2 rounded-lg bg-slate-50 p-4 text-xs sm:grid-cols-2">
      <dt className="sm:col-span-2 text-[10px] font-extrabold uppercase tracking-wide text-brand">Financial Summary</dt>
      <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-bold">{formatRwf(totals.subtotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">VAT ({totals.vatRate}%)</dt><dd className="font-bold">{formatRwf(totals.vatAmount)}</dd></div>
      <div className="flex justify-between sm:col-span-2"><dt className="font-bold">Total Amount</dt><dd className="font-extrabold text-brand">{formatRwf(totals.total)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Total Amount in Words · Rwandan Francs</dt><dd className="mt-1 font-semibold">{totals.amountInWords}</dd></div>
    </dl>
  </div>;
}

export function OrderForm({ rfqs, requisition, initialRfqId, onClose, onSubmit, onSendIntent }) {
  const awardedRfqs = rfqs.filter((rfq) => rfq.status === 'Awarded');
  const requisitionItemsKey = JSON.stringify(requisition?.items || []);
  const requisitionLines = useMemo(() => (Array.isArray(requisition?.items)
    ? requisition.items.filter((line) => String(line.itemName || '').trim()).map((line) => ({
        itemName: line.itemName || '',
        description: line.description || '',
        quantity: String(line.quantity ?? 1),
        unit: line.unit || 'unit',
        unitPrice: String(line.estimatedUnitCost ?? '')
      }))
    : []), [requisitionItemsKey]);
  const [form, setForm] = useState({
    rfqId: initialRfqId ? String(initialRfqId) : '',
    deliveryDate: '',
    type: 'Standard'
  });
  const [lines, setLines] = useState(requisitionLines.length ? requisitionLines : [emptyLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedRfq = awardedRfqs.find((rfq) => String(rfq.id) === String(form.rfqId));
  const awardedAmount = Number(selectedRfq?.awardedAmount) || 0;
  const supplier = supplierFor(selectedRfq);

  useEffect(() => {
    if (!requisitionLines.length) return;
    setLines(distributeAwardedAmount(requisitionLines, awardedAmount));
  }, [requisitionLines, awardedAmount]);

  function updateLine(index, key, value) {
    setLines((current) => current.map((line, position) => position === index ? { ...line, [key]: value } : line));
  }

  function formPayload() {
    // The backend derives supplier, lines, VAT and totals from the awarded
    // quotation and originating request; only these fields are accepted.
    return { rfqId: Number(form.rfqId), deliveryDate: form.deliveryDate, type: form.type };
  }

  function validationProblem() {
    if (!form.rfqId) return 'Choose an awarded RFQ.';
    if (!form.deliveryDate) return 'Choose the expected delivery date.';
    return validateLines(lines);
  }

  async function startSend() {
    const problem = validationProblem();
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      if (!onSendIntent) throw new Error('Supplier pricing requests are not available.');
      await onSendIntent({
        id: null,
        reference: 'New purchase order',
        supplier: supplier.name,
        type: form.type,
        total: calculatePurchaseTotals(lines, configuredVatRate()).total,
        deliveryDate: form.deliveryDate,
        __createPayload: formPayload(),
        __sendToSuppliers: true
      });
    } catch (exception) {
      setError(exception.message || 'The Purchase Order could not be saved.');
    } finally { setBusy(false); }
  }

  return <Modal title="New purchase order · official form" size="xl" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void startSend(); }} className="space-y-5">
      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Purchase order details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">Awarded RFQ *
            <select required value={form.rfqId} onChange={(event) => setForm({ ...form, rfqId: event.target.value })} className="field">
              <option value="">Choose an awarded RFQ…</option>
              {awardedRfqs.map((rfq) => <option key={rfq.id} value={rfq.id}>{rfq.reference} · {rfq.selectedSupplier}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Type
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="field">
              {PURCHASE_ORDER_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">P.O No
            <input readOnly value="Assigned when saved" className="field bg-slate-50 text-muted" />
          </label>
          <label className="block text-xs font-bold">Date
            <input readOnly value={dateLabel(new Date().toISOString())} className="field bg-slate-50 text-muted" />
          </label>
          <label className="block text-xs font-bold">Date of Delivery *
            <input required type="date" value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} className="field" />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Registered supplier information</h3>
        <dl className="grid gap-3 text-xs sm:grid-cols-3">
          <div><dt className="text-[10px] text-muted">Supplier</dt><dd className="font-bold">{supplier.name}</dd></div>
          <div><dt className="text-[10px] text-muted">Supplier Contact</dt><dd className="font-bold">{supplier.contact}</dd></div>
          <div><dt className="text-[10px] text-muted">Address</dt><dd className="font-bold">{supplier.address}</dd></div>
        </dl>
        <p className="mt-2 text-[10px] text-muted">Registered details come from the awarded quotation and are printed on the official purchase order.</p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Purchase order items</h3>
        <ItemTable lines={lines} onChange={updateLine} onAdd={() => setLines((current) => [...current, emptyLine()])}
          onRemove={(index) => setLines((current) => current.length === 1 ? current : current.filter((_, position) => position !== index))} />
        {requisitionLines.length > 0 && <p className="mt-2 text-[10px] text-muted">Lines were prefilled from the originating requisition. Final prices are recalculated from the awarded quotation.</p>}
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold">Cancel</button>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          <Send size={14} />{busy ? 'Saving Purchase Order…' : 'Send to Suppliers'}
        </button>
      </div>
    </form>
  </Modal>;
}

export function OrderEditForm({ order, onClose, onSubmit, onSendIntent }) {
  const [form, setForm] = useState({
    type: order.type || 'Standard',
    deliveryDate: dateInputValue(order.deliveryDate),
    supplierContact: order.supplierContact || '',
    supplierAddress: order.supplierAddress || ''
  });
  const [lines, setLines] = useState(detailLines(order).length ? detailLines(order) : [emptyLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const vatRate = Number(order.vatRate ?? configuredVatRate()) || 0;

  function updateLine(index, key, value) {
    setLines((current) => current.map((line, position) => position === index ? { ...line, [key]: value } : line));
  }

  function formPayload() {
    // Totals are deliberately not sent: the backend recalculates them.
    return {
      type: form.type,
      deliveryDate: form.deliveryDate,
      supplierContact: form.supplierContact,
      supplierAddress: form.supplierAddress,
      items: lines.map((line) => ({
        ...(line.id ? { id: Number(line.id) } : {}),
        itemName: String(line.itemName).trim(),
        description: String(line.description || '').trim(),
        quantity: Number(line.quantity),
        unit: line.unit || 'unit',
        unitPrice: Number(line.unitPrice)
      }))
    };
  }

  async function startSend() {
    if (!form.deliveryDate) { setError('Choose the delivery date.'); return; }
    const problem = validateLines(lines);
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      if (!onSendIntent) throw new Error('Supplier pricing requests are not available.');
      await onSendIntent({
        ...order,
        __updatePayload: formPayload(),
        __sendToSuppliers: true
      });
    } catch (exception) {
      setError(exception.message || 'The Purchase Order could not be saved.');
    } finally { setBusy(false); }
  }

  return <Modal title={`Edit purchase order · ${order.reference}`} size="xl" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void startSend(); }} className="space-y-5">
      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Purchase order details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">Supplier
            <input readOnly value={order.supplier || '—'} className="field bg-slate-50 text-muted" />
          </label>
          <label className="block text-xs font-bold">P.O No
            <input readOnly value={order.reference || '—'} className="field bg-slate-50 text-muted" />
          </label>
          <label className="block text-xs font-bold">Supplier Contact
            <input value={form.supplierContact} onChange={(event) => setForm({ ...form, supplierContact: event.target.value })} className="field" />
          </label>
          <label className="block text-xs font-bold">Type
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="field">
              {[...new Set([form.type, ...PURCHASE_ORDER_TYPES])].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold sm:col-span-2">Address
            <input value={form.supplierAddress} onChange={(event) => setForm({ ...form, supplierAddress: event.target.value })} className="field" />
          </label>
          <label className="block text-xs font-bold">Date
            <input readOnly value={dateLabel(order.createdAt || order.date)} className="field bg-slate-50 text-muted" />
          </label>
          <label className="block text-xs font-bold">Date of Delivery *
            <input required type="date" value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} className="field" />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-muted">VAT is fixed at {vatRate}% by the configured business settings and cannot be edited here.</p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Purchase order items</h3>
        <ItemTable lines={lines} vatRate={vatRate} onChange={updateLine} onAdd={() => setLines((current) => [...current, emptyLine()])}
          onRemove={(index) => setLines((current) => current.length === 1 ? current : current.filter((_, position) => position !== index))} />
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold">Cancel</button>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          <Send size={14} />{busy ? 'Saving Purchase Order…' : 'Send to Suppliers'}
        </button>
      </div>
    </form>
  </Modal>;
}

function ReceiptForm({ order, items, onClose, onSubmit }) {
  const [form, setForm] = useState({ itemId: '', quantity: '1', source: order.reference, isFinal: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity), purchaseOrderId: order.id }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Receive goods · ${order.reference}`} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Inventory item<select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} className="field"><option value="">Choose an item…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
    <label className="block text-xs font-bold">Quantity received<input required min="1" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Delivery/source reference<input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="field" /></label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isFinal} onChange={(event) => setForm({ ...form, isFinal: event.target.checked })} />This is the final delivery</label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Record GRN" />
  </form></Modal>;
}

export default function PurchaseOrdersPage({
  orders = [], rfqs = [], items = [], suppliers = [], user = {}, requisition = null,
  onCreate, onDecision, onReceive, getPurchaseOrder, updatePurchaseOrder,
  loadApprovers, onSendForApproval, onRevokeApproval, sendPurchaseOrderToSuppliers
}) {
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [sendOrder, setSendOrder] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailMode, setDetailMode] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canApprove = ['admin', 'approver'].includes(user.role);
  const canReceive = ['admin', 'storekeeper', 'procurement'].includes(user.role);

  const requestId = requisition ? Number(requisition.id ?? requisition) : null;
  const scopedOrders = requestId
    ? orders.filter((order) => Number(order.requisitionId) === requestId)
    : orders;
  const scopedRfqs = requestId
    ? rfqs.filter((rfq) => Number(rfq.requisitionId) === requestId)
    : rfqs;
  const awardedRfqs = scopedRfqs.filter((rfq) => rfq.status === 'Awarded');
  const initialRfqId = requestId && awardedRfqs.length === 1 ? awardedRfqs[0].id : '';

  async function decide(id, decision) {
    try { await onDecision(id, decision); setError(''); }
    catch (exception) { setError(exception.message); }
  }

  async function openDetail(order, mode = 'view') {
    setDetail(null); setDetailMode(mode); setDetailError(''); setDetailLoading(true);
    try {
      const response = getPurchaseOrder ? await getPurchaseOrder(order.id) : order;
      const full = normalizeDetail(response);
      setDetail({
        ...order,
        ...full,
        supplier: full.supplier || order.supplier,
        reference: full.reference || order.reference
      });
    } catch (exception) {
      setDetailError(exception.message || 'The purchase order could not be opened.');
    } finally { setDetailLoading(false); }
  }

  function closeDetail() {
    setDetail(null); setDetailMode(''); setDetailError('');
  }

  async function saveEdit(payload) {
    if (!updatePurchaseOrder || !detail) throw new Error('Purchase order editing is not available.');
    const result = await updatePurchaseOrder(detail.id, payload);
    const refreshed = normalizeDetail(result);
    setDetail({ ...detail, ...refreshed });
    setDetailMode('view');
    return refreshed;
  }

  async function prepareSupplierRequest(preview) {
    let saved;
    if (preview.__createPayload) {
      if (!onCreate) throw new Error('Purchase Order creation is not available.');
      saved = await onCreate(preview.__createPayload);
      setCreating(false);
    } else if (preview.__updatePayload) {
      if (!updatePurchaseOrder) throw new Error('Purchase Order editing is not available.');
      saved = normalizeDetail(await updatePurchaseOrder(preview.id, preview.__updatePayload));
      closeDetail();
    } else {
      throw new Error('Save the Purchase Order before selecting Suppliers.');
    }

    const id = saved?.id ?? saved?.purchaseOrder?.id ?? preview.id;
    const reference = saved?.reference || saved?.purchaseOrder?.reference || preview.reference;
    if (!id || !reference || reference === 'New purchase order') {
      throw new Error('The saved Purchase Order reference could not be confirmed.');
    }
    setSendOrder({
      ...preview,
      ...(saved?.purchaseOrder || saved),
      id,
      reference,
      __createPayload: undefined,
      __updatePayload: undefined,
      __sendToSuppliers: true
    });
  }

  async function refreshDetail(id) {
    if (!getPurchaseOrder) return;
    try {
      const response = await getPurchaseOrder(id);
      const refreshed = normalizeDetail(response);
      setDetail((current) => current && Number(current.id) === Number(id)
        ? { ...current, ...refreshed }
        : current);
    } catch { /* the list refresh already reports broader API failures */ }
  }

  async function saveAndSend(order, payload) {
    const toSuppliers = Boolean(order.__sendToSuppliers);
    if (toSuppliers && !sendPurchaseOrderToSuppliers) throw new Error('Sending supplier pricing requests is not available.');
    if (!toSuppliers && !onSendForApproval) throw new Error('Sending purchase orders is not available.');
    const id = Number(order.id);
    if (!Number.isInteger(id) || id < 1 || order.__createPayload || order.__updatePayload) {
      throw new Error('Save the Purchase Order before confirming Supplier invitations.');
    }
    const response = toSuppliers
      ? await sendPurchaseOrderToSuppliers(id, payload)
      : await onSendForApproval(id, payload);
    const missing = response?.emailDelivery?.missing;
    const failed = Number(response?.emailDelivery?.failed) || 0;
    if (toSuppliers) {
      setNotice(missing?.length || (failed > 0 && !response?.emailDelivery?.accepted)
        ? 'Pricing request saved, but messages were NOT delivered. Check email delivery from Supplier responses.'
        : response.message || 'Pricing request sent to the selected suppliers.');
    } else {
      setNotice(response.message || 'Purchase order sent for approval.');
    }
    setError('');
    return response;
  }

  function closeSendModal() {
    const sentId = sendOrder?.id;
    setSendOrder(null);
    if (sentId) {
      if (detailMode === 'edit') setDetailMode('view');
      void refreshDetail(sentId);
    }
  }

  async function revokeApproval(order) {
    try {
      await onRevokeApproval(order.id, order.approval.id);
      setNotice('Approval link revoked. The purchase order remains pending approval.');
      setError('');
      await refreshDetail(order.id);
    } catch (exception) {
      setError(exception.message || 'The approval link could not be revoked.');
    }
  }

  return <>
    <PageCard title="Purchase orders" description={`${scopedOrders.length} orders${requisition?.reference ? ` · ${requisition.reference}` : ''} · Official forms, approval and delivery tracking`} action={canCreate && <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Create PO</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {detailError && <div className="p-4"><ErrorMessage>{detailError}</ErrorMessage></div>}
      {notice && <div className="px-4 pb-4"><p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</p></div>}
      {scopedOrders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['PO', 'Supplier / registered contact', 'Requisition', 'Type', 'Items', 'Total', 'Delivery', 'Status', 'Actions'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{scopedOrders.map((order) => <tr key={order.id}>
        <td className="px-4 py-4 font-bold">{order.reference}</td>
        <td className="px-4 py-4"><div className="font-bold">{order.supplier}</div><div className="text-[10px] text-muted">{order.supplierContact || 'No contact recorded'}{order.supplierAddress ? ` · ${order.supplierAddress}` : ''}</div></td>
        <td className="px-4 py-4">{order.requisition}</td>
        <td className="px-4 py-4">{order.type || 'Standard'}</td>
        <td className="max-w-[220px] px-4 py-4 text-muted">{order.items}</td>
        <td className="px-4 py-4 font-bold">{currency(order.total)}</td>
        <td className="px-4 py-4">{dateLabel(order.deliveryDate)}</td>
        <td className="px-4 py-4">
          <div className="font-semibold">{order.status}</div>
          {order.supplierPricingStatus && order.supplierPricingStatus !== 'Not requested'
            && <div className="mt-1 text-[10px] text-muted">Supplier pricing · {order.supplierPricingStatus}</div>}
          {order.approval && <div className="mt-1 text-[10px] text-muted">
            {order.approval.status === 'Pending' ? `Sent to ${order.approval.recipientName}` : `Approval ${order.approval.status}`}
            {order.approval.decisionComment ? ` · “${order.approval.decisionComment}”` : ''}
          </div>}
        </td>
        <td className="px-4 py-4"><div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => openDetail(order, 'view')} className="rounded border border-slate-200 px-2 py-1 text-brand inline-flex items-center gap-1"><Eye size={12} />View</button>
          {canEditPurchaseOrder(order, user) && <button type="button" onClick={() => openDetail(order, 'edit')} className="rounded border border-slate-200 px-2 py-1 text-brand inline-flex items-center gap-1"><Pencil size={12} />Edit</button>}
          {canCreate && order.status === 'Pending approval' && canSendForApproval(order) && <button type="button" onClick={() => { setNotice(''); setSendOrder(order); }} className="inline-flex items-center gap-1 rounded border border-brand bg-brand/5 px-2 py-1 font-bold text-brand"><Mail size={12} />Send for approval</button>}
          {canCreate && order.status === 'Pending approval' && order.supplierPricingStatus !== 'Awarded' && <button type="button" onClick={() => { setNotice(''); setSendOrder({ ...order, __sendToSuppliers: true }); }} className="inline-flex items-center gap-1 rounded border border-brand bg-brand/5 px-2 py-1 font-bold text-brand"><Send size={12} />Send to Suppliers</button>}
          {canApprove && order.status === 'Pending approval' && canSendForApproval(order) && <><button type="button" onClick={() => decide(order.id, 'Approved')} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Approve</button><button type="button" onClick={() => decide(order.id, 'Rejected')} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button></>}
          {canReceive && ['Approved', 'Partially received'].includes(order.status) && <button type="button" onClick={() => setReceiving(order)} className="rounded border px-2 py-1 text-brand">Receive</button>}
        </div></td>
      </tr>)}</tbody></table></div> : <EmptyState>{requestId ? 'No purchase orders for this request yet.' : 'No purchase orders are ready.'}</EmptyState>}
    </PageCard>

    {creating && <OrderForm rfqs={scopedRfqs} requisition={requisition} initialRfqId={initialRfqId} onClose={() => setCreating(false)} onSubmit={onCreate}
      onSendIntent={async (preview) => { setNotice(''); await prepareSupplierRequest(preview); }} />}
    {receiving && <ReceiptForm order={receiving} items={items} onClose={() => setReceiving(null)} onSubmit={onReceive} />}
    {sendOrder?.__sendToSuppliers && <SupplierSelectionModal order={sendOrder} suppliers={suppliers} onSend={saveAndSend} onClose={closeSendModal} />}
    {sendOrder && !sendOrder.__sendToSuppliers && <SendForApprovalModal order={sendOrder} loadApprovers={loadApprovers} onSend={saveAndSend} onClose={closeSendModal} />}

    {detailLoading && <Modal title="Opening purchase order" onClose={closeDetail}><div className="py-8 text-center text-xs text-muted">Loading official form…</div></Modal>}
    {!detailLoading && detailMode === 'view' && detail && <Modal title={`Official purchase order · ${detail.reference}`} size="xl" onClose={closeDetail}>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <PrintButton label="Print official form" />
          <DownloadButton type="purchaseOrder" id={detail.id} format="pdf" label="Download official PDF" />
          <DownloadButton type="purchaseOrder" id={detail.id} format="xlsx" label="Excel" />
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPurchaseOrder(detail, user) && <button type="button" onClick={() => setDetailMode('edit')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-brand"><Pencil size={14} />Edit</button>}
          {canCreate && detail.status === 'Pending approval' && canSendForApproval(detail) && <button type="button" onClick={() => { setNotice(''); setSendOrder(detail); }} className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand/5 px-3 py-2 text-xs font-bold text-brand"><Mail size={14} />Send for approval</button>}
          {canCreate && detail.status === 'Pending approval' && detail.supplierPricingStatus !== 'Awarded' && <button type="button" onClick={() => { setNotice(''); setSendOrder({ ...detail, __sendToSuppliers: true }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Send size={14} />Send to Suppliers</button>}
          <button type="button" onClick={closeDetail} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Close</button>
        </div>
      </div>
      {detail.approval && <section className="no-print mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-brand">Approval request · {detail.approval.status}</strong>
          {detail.approval.status === 'Pending' && canCreate && <button type="button" onClick={() => revokeApproval(detail)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-bold text-red-700">Revoke link</button>}
        </div>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[10px] text-muted">Recipient</dt><dd className="font-bold">{detail.approval.recipientName || '—'}</dd></div>
          <div><dt className="text-[10px] text-muted">Sender</dt><dd className="font-bold">{detail.approval.senderName || '—'}</dd></div>
          <div><dt className="text-[10px] text-muted">Sent</dt><dd className="font-bold">{dateTimeLabel(detail.approval.sentAt)}</dd></div>
          <div><dt className="text-[10px] text-muted">Decision</dt><dd className="font-bold">{detail.approval.decidedAt ? dateTimeLabel(detail.approval.decidedAt) : '—'}</dd></div>
          {detail.approval.decisionComment && <div className="sm:col-span-4"><dt className="text-[10px] text-muted">Comment</dt><dd className="italic">“{detail.approval.decisionComment}”</dd></div>}
        </dl>
      </section>}
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        <PurchaseOrderDocument order={detail} />
        {detail.supplierPricingAward && <div className="mt-4"><SupplierPricingAwardSummary award={detail.supplierPricingAward} /></div>}
      </div>
    </Modal>}
    {!detailLoading && detailMode === 'edit' && detail && <OrderEditForm order={detail} onClose={() => setDetailMode('view')} onSubmit={saveEdit}
      onSendIntent={async (preview) => { setNotice(''); await prepareSupplierRequest(preview); }} />}
  </>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import DownloadButton from '../components/ui/DownloadButton.jsx';
import PrintButton from '../components/ui/PrintButton.jsx';
import PurchaseOrderDocument from '../components/documents/PurchaseOrderDocument.jsx';
import SupplierPricingAwardSummary from '../components/documents/SupplierPricingAwardSummary.jsx';
import SendForApprovalModal from '../components/portals/SendForApprovalModal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import SignatureUpload from '../components/ui/SignatureUpload.jsx';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';
import { requisitionDisplayReference } from '../utils/requisitionDisplay.js';
import {
  PURCHASE_ORDER_TYPES, calculatePurchaseTotals,
  canEditPurchaseOrder, configuredVatRate, formatRwf
} from '../utils/purchaseCalculations.js';

// The frontend values are previews only; the backend recalculates all totals.
// Overview cards open the existing page with a query filter. These groups mirror
// the dashboard counts without adding a new route or changing backend data.
const PO_STATUS_GROUPS = {
  'Pending approval': ['Pending approval'],
  Approved: ['Approved', 'Partially received', 'Received']
};

const createPoButtonClass = 'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 sm:w-auto';
const rowActionClass = 'inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-brand bg-white px-2.5 py-1.5 text-[10px] font-semibold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1';
const rowPrimaryActionClass = 'inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-reference px-2.5 py-1.5 text-[10px] font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1';

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
    email: rfq?.selectedSupplierEmail || rfq?.awardedSupplierEmail || rfq?.supplierEmail || '—',
    phone: rfq?.selectedSupplierPhone || rfq?.awardedSupplierPhone || rfq?.supplierPhone || '—',
    address: rfq?.supplierAddress || rfq?.awardedSupplierAddress || rfq?.selectedSupplierAddress || '—'
  };
}

function recommendationDecisionLabel(value) {
  if (value === 'Accepted') return 'Accepted';
  if (value === 'Rejected') return 'Denied';
  return value || 'Awaiting decision';
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

// Only lines the supplier actually entered in its quotation are shown on the
// purchase order form. Requisition estimates are used solely as a fallback
// when no itemised quotation exists.
function supplierQuoteLines(items) {
  return (Array.isArray(items) ? items : [])
    .filter((line) => String(line.itemName || '').trim())
    .map((line) => ({
      quotationItemId: line.quotationItemId,
      itemName: line.itemName || '',
      description: line.description || '',
      quantity: String(line.quantity ?? 1),
      unit: line.unit || 'unit',
      unitPrice: String(line.unitPrice ?? '')
    }));
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

function ItemTable({ lines, onChange, onAdd, onRemove }) {
  return <div className="space-y-3">
    <div className="overflow-x-auto rounded-lg border border-brand">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-white text-[10px] uppercase text-black">
          <tr>{['Item No.', 'Quantity', 'Unit', 'Description', 'Unit Price', 'Total Price', ''].map((heading) =>
            <th key={heading} className="whitespace-nowrap px-3 py-3 font-bold">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((line, index) => <tr key={line.id || `line-${index}`} className="align-top">
            <td className="px-3 py-3 font-bold text-black">{index + 1}</td>
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
              className="inline-flex items-center gap-1 rounded-lg p-2 text-black hover:bg-white hover:text-black">
              <Trash2 size={14} /><span className="text-[10px] font-bold">Remove</span>
            </button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-2 text-xs font-bold text-black">
      <Plus size={14} />Add line
    </button>
  </div>;
}

export function OrderForm({
  rfqs, recommendations = [], requisition, initialRfqId, initialSupplierId,
  initialItems = [], onLoadQuotes, onClose, onSubmit, onSendIntent
}) {
  const awardedRfqs = rfqs.filter((rfq) => rfq.status === 'Awarded').map((rfq) => {
    const recommendation = recommendations.find((entry) =>
      Number(entry.rfqId) === Number(rfq.id) &&
      String(entry.recommendedSupplier) === String(rfq.selectedSupplier || rfq.supplier));
    return {
      ...rfq,
      __key: `rfq-${rfq.id}`,
      __supplierId: recommendation ? Number(recommendation.supplierId) : null,
      __recommendation: recommendation || null
    };
  });
  // Procurement's recommended supplier can be used even before the RFQ has been
  // formally awarded. The backend awards that quotation when the PO is saved.
  const recommendedRfqs = recommendations
    .filter((entry) => !awardedRfqs.some((rfq) =>
      Number(rfq.id) === Number(entry.rfqId) && Number(rfq.__supplierId) === Number(entry.supplierId)))
    .map((entry) => ({
      id: entry.rfqId,
      reference: entry.reference,
      status: 'Awarded',
      selectedSupplier: entry.recommendedSupplier,
      supplier: entry.recommendedSupplier,
      supplierContact: entry.supplierContact,
      supplierAddress: entry.supplierAddress,
      awardedAmount: Number(entry.quotationAmount) || 0,
      __key: `recommended-${entry.rfqId}-${entry.supplierId}`,
      __supplierId: Number(entry.supplierId),
      __recommendation: entry,
      supplierEmail: entry.supplierEmail,
      supplierPhone: entry.supplierPhone
    }));
  const selectableRfqs = [...awardedRfqs, ...recommendedRfqs];
  const initialKey = selectableRfqs.find((rfq) =>
    Number(rfq.id) === Number(initialRfqId) &&
    (!initialSupplierId || Number(rfq.__supplierId) === Number(initialSupplierId)))?.__key || '';
  const requisitionItemsKey = JSON.stringify(requisition?.items || []);
  const initialItemsKey = JSON.stringify(initialItems || []);
  const initialSupplierLines = useMemo(() => supplierQuoteLines(initialItems), [initialItemsKey]);
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
    selection: initialKey,
    deliveryDate: '',
    type: 'Standard'
  });
  const [lines, setLines] = useState(initialSupplierLines.length
    ? initialSupplierLines
    : requisitionLines.length ? requisitionLines : [emptyLine()]);
  const [preparedSignature, setPreparedSignature] = useState('');
  const [approvedSignature, setApprovedSignature] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedRfq = selectableRfqs.find((rfq) => rfq.__key === form.selection);
  const selectedKey = selectedRfq?.__key || '';
  const awardedAmount = Number(selectedRfq?.awardedAmount) || 0;
  const supplier = supplierFor(selectedRfq);

  useEffect(() => {
    let active = true;
    async function applySupplierLines() {
      if (!selectedRfq) {
        if (active) setLines([emptyLine()]);
        return;
      }
      // The recommendation card already carries the exact lines the supplier submitted.
      const passedLines = selectedKey === initialKey ? initialSupplierLines : [];
      if (passedLines.length) {
        if (active) setLines(passedLines);
        return;
      }
      const recommendation = recommendations.find((entry) =>
        Number(entry.rfqId) === Number(selectedRfq.id) &&
        (!selectedRfq.__supplierId || Number(entry.supplierId) === Number(selectedRfq.__supplierId)));
      const recommendedLines = supplierQuoteLines(recommendation?.items);
      if (recommendedLines.length) {
        if (active) setLines(recommendedLines);
        return;
      }
      // Awarded RFQs have no recommendation snapshot, so read the selected
      // quotation and its itemised lines from the RFQ response record.
      if (onLoadQuotes && selectedRfq.id) {
        try {
          const detail = await onLoadQuotes(selectedRfq.id);
          const quotes = Array.isArray(detail?.quotations) ? detail.quotations : [];
          const quote = selectedRfq.__supplierId
            ? quotes.find((entry) => Number(entry.supplierId) === Number(selectedRfq.__supplierId))
            : quotes.find((entry) => entry.selected) || quotes[0];
          const quotedLines = supplierQuoteLines(quote?.items);
          if (!active) return;
          if (quotedLines.length) {
            setLines(quotedLines);
            return;
          }
        } catch { /* the requisition estimate remains a safe fallback */ }
      }
      if (!active) return;
      setLines(requisitionLines.length ? distributeAwardedAmount(requisitionLines, awardedAmount) : [emptyLine()]);
    }
    void applySupplierLines();
    return () => { active = false; };
  }, [selectedKey, initialKey, initialItemsKey, requisitionItemsKey, awardedAmount, recommendations, onLoadQuotes]);

  function updateLine(index, key, value) {
    setLines((current) => current.map((line, position) => position === index ? { ...line, [key]: value } : line));
  }

  function formPayload() {
    // The backend derives lines, VAT and totals from the quotation. When the
    // entry came from Procurement's recommendation, send that supplier so the
    // backend awards the matching quotation before saving the PO.
    return {
      rfqId: Number(selectedRfq?.id),
      ...(selectedRfq?.__supplierId ? { supplierId: Number(selectedRfq.__supplierId) } : {}),
      deliveryDate: form.deliveryDate,
      type: form.type,
      preparedBySignature: preparedSignature,
      approvedBySignature: approvedSignature
    };
  }

  function validationProblem() {
    if (!form.selection) return 'Choose an awarded RFQ or Procurement recommendation.';
    if (!form.deliveryDate) return 'Choose the expected delivery date.';
    if (!preparedSignature) return 'Upload the Prepared by signature image.';
    if (!approvedSignature) return 'Upload the Approved by signature image.';
    return validateLines(lines);
  }

  async function startSend() {
    const problem = validationProblem();
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      if (!onSendIntent) throw new Error('Sending the official purchase order is not available.');
      await onSendIntent({
        id: null,
        reference: 'New purchase order',
        supplier: supplier.name,
        type: form.type,
        total: calculatePurchaseTotals(lines, configuredVatRate()).total,
        deliveryDate: form.deliveryDate,
        __createPayload: formPayload()
      });
    } catch (exception) {
      setError(exception.message || 'The Purchase Order could not be saved.');
    } finally { setBusy(false); }
  }

  return <Modal title="New purchase order · official form" size="xl" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void startSend(); }} className="space-y-5">
      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Purchase order details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">Awarded RFQ / Procurement recommendation *
            <select required value={form.selection} onChange={(event) => setForm({ ...form, selection: event.target.value })} className="field">
              <option value="">Choose an RFQ or recommendation…</option>
              {awardedRfqs.length > 0 && <optgroup label="Awarded RFQs">
                {awardedRfqs.map((rfq) => <option key={rfq.__key} value={rfq.__key}>{rfq.reference} · {rfq.selectedSupplier}</option>)}
              </optgroup>}
              {recommendedRfqs.length > 0 && <optgroup label="Procurement recommendations">
                {recommendedRfqs.map((rfq) => <option key={rfq.__key} value={rfq.__key}>{rfq.reference} · Recommended: {rfq.recommendedSupplier}</option>)}
              </optgroup>}
            </select>
          </label>
          <label className="block text-xs font-bold">Type
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="field">
              {PURCHASE_ORDER_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">P.O No
            <input readOnly value="Assigned when saved" className="field bg-white text-black" />
          </label>
          <label className="block text-xs font-bold">Date
            <input readOnly value={dateLabel(new Date().toISOString())} className="field bg-white text-black" />
          </label>
          <label className="block text-xs font-bold">Date of Delivery *
            <input required type="date" value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} className="field" />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-brand bg-white p-4">
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Registered supplier information</h3>
        <dl className="grid gap-3 text-xs sm:grid-cols-4">
          <div><dt className="text-[10px] text-black">Supplier</dt><dd className="font-bold">{supplier.name}</dd></div>
          <div><dt className="text-[10px] text-black">Supplier Email</dt><dd className="break-all font-bold">{supplier.email}</dd></div>
          <div><dt className="text-[10px] text-black">Supplier Phone</dt><dd className="font-bold">{supplier.phone}</dd></div>
          <div><dt className="text-[10px] text-black">Address</dt><dd className="font-bold">{supplier.address}</dd></div>
        </dl>
        <p className="mt-2 text-[10px] text-black">Registered details come from the awarded or Procurement-recommended supplier quotation and are printed on the official purchase order.</p>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Prepared by signature</h3>
          <SignatureUpload label="Prepared by" value={preparedSignature} onChange={setPreparedSignature} />
        </div>
        <div>
          <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Approved by signature</h3>
          <SignatureUpload label="Approved by" value={approvedSignature} onChange={setApprovedSignature} />
        </div>
        <p className="sm:col-span-2 text-[10px] text-black">Both signature images are required before the official purchase order can be saved.</p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Purchase order items</h3>
        <ItemTable lines={lines} onChange={updateLine} onAdd={() => setLines((current) => [...current, emptyLine()])}
          onRemove={(index) => setLines((current) => current.length === 1 ? current : current.filter((_, position) => position !== index))} />
        <p className="mt-2 text-[10px] text-black">Items, quantities, descriptions and prices are the lines the selected supplier entered in its quotation. Requisition estimates are used only when a supplier did not provide itemised lines.</p>
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Cancel</button>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
          <Send size={14} />{busy ? 'Saving & Sending PO…' : 'Save & Send PO'}
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
      if (!onSendIntent) throw new Error('Sending the official purchase order is not available.');
      await onSendIntent({
        ...order,
        __updatePayload: formPayload()
      });
    } catch (exception) {
      setError(exception.message || 'The Purchase Order could not be saved.');
    } finally { setBusy(false); }
  }

  return <Modal title={`Edit purchase order · ${order.reference}`} size="xl" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void startSend(); }} className="space-y-5">
      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Purchase order details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">Supplier
            <input readOnly value={order.supplier || '—'} className="field bg-white text-black" />
          </label>
          <label className="block text-xs font-bold">P.O No
            <input readOnly value={order.reference || '—'} className="field bg-white text-black" />
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
            <input readOnly value={dateLabel(order.createdAt || order.date)} className="field bg-white text-black" />
          </label>
          <label className="block text-xs font-bold">Date of Delivery *
            <input required type="date" value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} className="field" />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-black">VAT is fixed at {vatRate}% by the configured business settings and cannot be edited here.</p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-black">Purchase order items</h3>
        <ItemTable lines={lines} onChange={updateLine} onAdd={() => setLines((current) => [...current, emptyLine()])}
          onRemove={(index) => setLines((current) => current.length === 1 ? current : current.filter((_, position) => position !== index))} />
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Cancel</button>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
          <Send size={14} />{busy ? 'Saving & Sending PO…' : 'Save & Send PO'}
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

function RecommendedSupplierDetail({ entry, canCreate, onClose, onViewPurchaseOrder, onCreatePurchaseOrder }) {
  const quotedItems = Array.isArray(entry.items) ? entry.items : [];
  return <Modal title={`Recommended supplier · ${entry.recommendedSupplier}`} size="xl" onClose={onClose}>
    <div className="space-y-5 text-xs">
      <section className="rounded-lg border-2 border-brand bg-brand-light/40 p-4">
        <span className="inline-flex rounded-full bg-brand px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-widest text-black">Procurement recommendation</span>
        <p className="mt-3 text-lg font-extrabold text-black">{entry.recommendedSupplier}</p>
        <strong className="mt-3 block text-[10px] font-extrabold uppercase tracking-wide text-black">Reason for recommendation</strong>
        <p className="mt-1 whitespace-pre-wrap font-semibold leading-relaxed text-black">{entry.reason || 'No reason was recorded for this recommendation.'}</p>
      </section>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-[10px] font-bold uppercase text-black">RFQ</dt><dd className="font-bold">{entry.reference || '—'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Requisition</dt><dd className="font-bold">{entry.requisitionDisplayReference || entry.requisitionReference || '—'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Department</dt><dd className="font-bold">{entry.department || '—'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Recommended by</dt><dd className="font-bold">{entry.recipientName || 'Procurement'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Sent</dt><dd className="font-bold">{dateTimeLabel(entry.sentAt)}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Committee response</dt><dd className="font-bold">{recommendationDecisionLabel(entry.decision)}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Submitted by</dt><dd className="font-bold">{entry.responderName || '—'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-black">Decision reason</dt><dd className="whitespace-pre-wrap font-bold">{entry.decisionReason || '—'}</dd></div>
      </dl>

      <section className="rounded-lg border border-brand bg-white p-4">
        <h3 className="mb-3 text-[10px] font-extrabold uppercase tracking-wide">Registered supplier details</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-black">Contact</dt><dd className="font-bold">{entry.supplierContact || '—'}</dd></div>
          <div><dt className="text-black">Phone</dt><dd className="font-bold">{entry.supplierPhone || '—'}</dd></div>
          <div><dt className="text-black">Email</dt><dd className="font-bold break-words">{entry.supplierEmail || '—'}</dd></div>
          <div><dt className="text-black">Address</dt><dd className="font-bold">{entry.supplierAddress || '—'}</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border border-brand bg-white p-4">
        <h3 className="mb-3 text-[10px] font-extrabold uppercase tracking-wide">Quotation details</h3>
        <dl className="mb-3 grid gap-3 sm:grid-cols-3">
          <div><dt className="text-black">Total quoted amount</dt><dd className="font-extrabold">{formatRwf(entry.quotationAmount)}</dd></div>
          <div><dt className="text-black">Delivery days</dt><dd className="font-bold">{entry.deliveryDays ?? '—'}</dd></div>
          <div><dt className="text-black">Supplier notes</dt><dd className="whitespace-pre-wrap font-bold">{entry.quotationNotes || '—'}</dd></div>
        </dl>
        {quotedItems.length ? <div className="overflow-x-auto rounded border border-subtle">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="bg-hover text-[10px] uppercase text-black">
              <tr>{['Item', 'Description', 'Qty', 'Unit price', 'Line total', 'Comment'].map((heading) =>
                <th key={heading} className="whitespace-nowrap px-2 py-2 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {quotedItems.map((line, index) => <tr key={line.quotationItemId || `${entry.reviewId}-${index}`}>
                <td className="px-2 py-2 font-bold">{line.itemName || '—'}</td>
                <td className="px-2 py-2">{line.description || '—'}</td>
                <td className="px-2 py-2">{line.quantity ?? '—'}</td>
                <td className="px-2 py-2">{formatRwf(line.unitPrice)}</td>
                <td className="px-2 py-2 font-bold">{formatRwf(line.lineTotal)}</td>
                <td className="px-2 py-2 whitespace-pre-wrap">{line.comment || '—'}</td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="text-black">No itemised quotation was recorded.</p>}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 font-bold">Close</button>
        {entry.purchaseOrderId && <button type="button" onClick={() => onViewPurchaseOrder(entry)} className="rounded-lg border border-brand bg-white px-4 py-2 font-bold">View purchase order {entry.purchaseOrderReference || ''}</button>}
        {!entry.purchaseOrderId && canCreate && <button type="button" onClick={() => onCreatePurchaseOrder(entry)} className="rounded-lg bg-brand px-4 py-2 font-bold">Create purchase order</button>}
      </div>
    </div>
  </Modal>;
}

export default function PurchaseOrdersPage({
  orders = [], rfqs = [], items = [], suppliers = [], user = {}, requisition = null,
  query = {}, navigate, onCreate, onDecision, onReceive, getPurchaseOrder, updatePurchaseOrder,
  loadApprovers, onLoadCommitteeRecommendations, onLoadQuotes, onSendForApproval, onRevokeApproval,
  sendPurchaseOrderToSupplier, onSaveSignatures
}) {
  const [creating, setCreating] = useState(false);
  const [poSelection, setPoSelection] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationDetail, setRecommendationDetail] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const [sendOrder, setSendOrder] = useState(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailMode, setDetailMode] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [signatureDraft, setSignatureDraft] = useState({ preparedBySignature: '', approvedBySignature: '' });
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [recommendationError, setRecommendationError] = useState('');
  const openedQueryOrder = useRef(null);
  const openedQueryRfq = useRef(null);
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canApprove = ['admin', 'approver'].includes(user.role);
  const canReceive = ['admin', 'storekeeper', 'procurement'].includes(user.role);

  const requestId = requisition ? Number(requisition.id ?? requisition) : null;
  const scopedOrders = requestId
    ? orders.filter((order) => Number(order.requisitionId) === requestId)
    : orders;
  const activePoStatuses = Object.prototype.hasOwnProperty.call(PO_STATUS_GROUPS, query.status)
    ? PO_STATUS_GROUPS[query.status]
    : null;
  const visibleOrders = activePoStatuses
    ? scopedOrders.filter((order) => activePoStatuses.includes(order.status))
    : scopedOrders;
  const scopedRfqs = requestId
    ? rfqs.filter((rfq) => Number(rfq.requisitionId) === requestId)
    : rfqs;
  const awardedRfqs = scopedRfqs.filter((rfq) => rfq.status === 'Awarded');
  const visibleRecommendations = useMemo(() => {
    const unique = new Map();
    for (const entry of recommendations) {
      if (requestId && Number(entry.requisitionId) !== requestId) continue;
      const key = `${entry.rfqId}:${entry.supplierId}`;
      if (!unique.has(key)) unique.set(key, entry);
    }
    return [...unique.values()];
  }, [recommendations, requestId]);
  const linkedRfqId = Number(query.rfq || 0);
  const linkedRecommendation = visibleRecommendations.find((entry) => Number(entry.rfqId) === linkedRfqId);
  const queryHasAwardedRfq = awardedRfqs.some((rfq) => Number(rfq.id) === linkedRfqId);
  const initialRfqId = poSelection?.rfqId || (requestId && awardedRfqs.length === 1
    ? awardedRfqs[0].id
    : queryHasAwardedRfq ? linkedRfqId : linkedRecommendation?.rfqId || '');
  const initialSupplierId = poSelection?.supplierId || (!queryHasAwardedRfq ? linkedRecommendation?.supplierId : null) || null;

  async function refreshRecommendations() {
    if (typeof onLoadCommitteeRecommendations !== 'function') return;
    try {
      const response = await onLoadCommitteeRecommendations();
      setRecommendations(Array.isArray(response?.recommendations) ? response.recommendations : []);
      setRecommendationError('');
    } catch (exception) {
      setRecommendationError(exception.message || 'Recommended suppliers could not be loaded.');
    }
  }

  useEffect(() => {
    void refreshRecommendations();
    // Load once when the Purchase orders workspace opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!Number.isInteger(linkedRfqId) || linkedRfqId <= 0 || !initialRfqId) return;
    if (openedQueryRfq.current === linkedRfqId) return;
    openedQueryRfq.current = linkedRfqId;
    setCreating(true);
  }, [linkedRfqId, initialRfqId]);

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
      setSignatureDraft({
        preparedBySignature: full.preparedSignature || '',
        approvedBySignature: full.approvedSignature || ''
      });
      setSignatureError('');
    } catch (exception) {
      setDetailError(exception.message || 'The purchase order could not be opened.');
    } finally { setDetailLoading(false); }
  }

  function closeDetail() {
    setDetail(null); setDetailMode(''); setDetailError('');
  }

  function viewRecommendedPurchaseOrder(entry) {
    const existing = orders.find((order) => Number(order.id) === Number(entry.purchaseOrderId));
    setRecommendationDetail(null);
    void openDetail(existing || {
      id: entry.purchaseOrderId,
      reference: entry.purchaseOrderReference || 'Purchase order',
      supplier: entry.recommendedSupplier
    }, 'view');
  }

  function createRecommendedPurchaseOrder(entry) {
    setRecommendationDetail(null);
    setError('');
    setPoSelection({ rfqId: entry.rfqId, supplierId: entry.supplierId, items: entry.items || [] });
    setCreating(true);
  }

  // Overview links carry `order`; opening the existing Purchase orders page with
  // that parameter reveals the actual official document instead of a filtered list.
  const linkedOrderId = Number(query.order || query.view || 0);
  useEffect(() => {
    if (!Number.isInteger(linkedOrderId) || linkedOrderId <= 0) return;
    if (openedQueryOrder.current === linkedOrderId) return;
    const linkedOrder = scopedOrders.find((order) => Number(order.id) === linkedOrderId);
    if (!linkedOrder) return;
    openedQueryOrder.current = linkedOrderId;
    void openDetail(linkedOrder, 'view');
  }, [linkedOrderId, scopedOrders, getPurchaseOrder]);

  async function saveEdit(payload) {
    if (!updatePurchaseOrder || !detail) throw new Error('Purchase order editing is not available.');
    const result = await updatePurchaseOrder(detail.id, payload);
    const refreshed = normalizeDetail(result);
    setDetail({ ...detail, ...refreshed });
    setDetailMode('view');
    return refreshed;
  }

  async function saveSignatures() {
    if (!onSaveSignatures || !detail) throw new Error('Signature upload is not available.');
    setSignatureBusy(true); setSignatureError('');
    try {
      const payload = {
        ...(canCreate ? { preparedBySignature: signatureDraft.preparedBySignature || null } : {}),
        ...(canApprove ? { approvedBySignature: signatureDraft.approvedBySignature || null } : {})
      };
      const result = await onSaveSignatures(detail.id, payload);
      const refreshed = normalizeDetail(result);
      setDetail((current) => ({ ...current, ...refreshed }));
      setSignatureDraft({
        preparedBySignature: refreshed.preparedSignature || '',
        approvedBySignature: refreshed.approvedSignature || ''
      });
      setNotice('Signature images saved to the official purchase order.');
    } catch (exception) {
      setSignatureError(exception.message || 'The signatures could not be saved.');
    } finally { setSignatureBusy(false); }
  }

  async function prepareSupplierRequest(preview) {
    let saved;
    if (preview.__createPayload) {
      if (!onCreate) throw new Error('Purchase Order creation is not available.');
      saved = await onCreate(preview.__createPayload);
      setCreating(false);
      setPoSelection(null);
      await refreshRecommendations();
    } else if (preview.__updatePayload) {
      if (!updatePurchaseOrder) throw new Error('Purchase Order editing is not available.');
      saved = normalizeDetail(await updatePurchaseOrder(preview.id, preview.__updatePayload));
      closeDetail();
    } else {
      throw new Error('Save the Purchase Order before sending it to the supplier.');
    }

    const id = saved?.id ?? saved?.purchaseOrder?.id ?? preview.id;
    const reference = saved?.reference || saved?.purchaseOrder?.reference || preview.reference;
    if (!id || !reference || reference === 'New purchase order') {
      throw new Error('The saved Purchase Order reference could not be confirmed.');
    }
    await sendOfficialPurchaseOrder({ id, reference });
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

  // The supplier receives the saved official purchase order PDF itself, never
  // the RFQ or the supplier-pricing form. The backend attaches the same signed
  // document produced by Download official PDF.
  async function sendOfficialPurchaseOrder(order, payload = {}) {
    if (!sendPurchaseOrderToSupplier) throw new Error('Sending the official purchase order is not available.');
    const id = Number(order?.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('Save the Purchase Order before sending it to the supplier.');
    }
    setSendBusy(true); setError(''); setNotice('');
    try {
      const response = await sendPurchaseOrderToSupplier(id, payload);
      const accepted = Number(response?.emailDelivery?.accepted) || 0;
      const failed = Number(response?.emailDelivery?.failed) || 0;
      setNotice(failed && !accepted
        ? `${response.deliveryQueued ? 'Items were queued for Storekeeper review, but ' : ''}the official purchase order was not delivered. Check the email delivery status and try again.`
        : response.message || `Official purchase order ${order?.reference || ''} sent to the registered supplier.`);
      await refreshDetail(id);
      return response;
    } finally { setSendBusy(false); }
  }

  async function emailPurchaseOrder(order) {
    try { await sendOfficialPurchaseOrder(order); }
    catch (exception) { setError(exception.message || 'The purchase order could not be sent.'); }
  }

  async function saveAndSend(order, payload) {
    if (!onSendForApproval) throw new Error('Sending purchase orders is not available.');
    const id = Number(order.id);
    if (!Number.isInteger(id) || id < 1 || order.__createPayload || order.__updatePayload) {
      throw new Error('Save the Purchase Order before confirming approval.');
    }
    const response = await onSendForApproval(id, payload);
    setNotice(response.message || 'Purchase order sent for approval.');
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
    <PageCard className="shadow-dashboard" title="Purchase orders" description={`${visibleOrders.length} orders${requisition ? ` · ${requisitionDisplayReference(requisition)}` : ''} · Official forms, approval and delivery tracking`} action={canCreate && <button type="button" onClick={() => { setPoSelection(null); setCreating(true); }} className={createPoButtonClass}><Plus size={15} />Create PO</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {detailError && <div className="p-4"><ErrorMessage>{detailError}</ErrorMessage></div>}
      {recommendationError && <div className="px-4 pb-3"><ErrorMessage>{recommendationError}</ErrorMessage></div>}
      {notice && <div className="px-4 pb-4"><p role="status" className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black">{notice}</p></div>}
      {activePoStatuses && <div className="px-4 pb-3">
        <button type="button" onClick={() => navigate?.('Purchase orders')} className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-3 py-1.5 text-[11px] font-bold text-black hover:bg-hover">
          Filtered: {query.status}<span className="text-black underline">Clear</span>
        </button>
      </div>}
      {visibleRecommendations.length > 0 && <section className="border-y border-subtle bg-white/70 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-black">Recommended suppliers</h3>
          <p className="text-[10px] text-black">Procurement recommendations sent to the Committee · click a supplier to see the quotation, reason and response</p>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {visibleRecommendations.map((entry) => <button key={`${entry.rfqId}-${entry.supplierId}`} type="button"
            onClick={() => setRecommendationDetail(entry)}
            aria-label={`View recommended supplier ${entry.recommendedSupplier} for ${entry.reference}`}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand bg-white px-3 py-3 text-left transition hover:border-black hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1">
            <span className="min-w-0">
              <span className="block break-words text-xs font-extrabold text-black">{entry.recommendedSupplier}</span>
              <span className="mt-0.5 block break-words text-[10px] text-black">
                {entry.reference}{entry.requisitionReference ? ` · ${entry.requisitionDisplayReference || entry.requisitionReference}` : ''}
                {entry.purchaseOrderReference ? ` · ${entry.purchaseOrderReference}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block whitespace-nowrap text-[11px] font-bold text-black">{formatRwf(entry.quotationAmount)}</span>
              <span className="mt-0.5 block text-[10px] text-black">{recommendationDecisionLabel(entry.decision)}</span>
            </span>
          </button>)}
        </div>
      </section>}
      {visibleOrders.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black">
            <tr className="border-b border-subtle">
              {['PO', 'Supplier / registered contact', 'Requisition', 'Type', 'Items', 'Total', 'Delivery', 'Status', 'Actions']
                .map((cell) => <th key={cell} scope="col" className="whitespace-nowrap px-3 py-3.5 font-extrabold">{cell}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {visibleOrders.map((order) => <tr key={order.id} className="align-top transition-colors hover:bg-hover">
              <td className="break-words px-3 py-4 font-extrabold leading-5 text-black">{order.reference}</td>
              <td className="px-3 py-4">
                <div className="break-words font-bold leading-5 text-black">{order.supplier || '—'}</div>
                <div className="mt-1 break-words text-[10px] leading-4 text-black">
                  {order.supplierContact || 'No contact recorded'}{order.supplierAddress ? ` · ${order.supplierAddress}` : ''}
                </div>
              </td>
              <td className="break-words px-3 py-4 font-medium text-black">{order.requisitionDisplayReference || order.requisition || '—'}</td>
              <td className="px-3 py-4">
                <span className="inline-flex rounded-md border border-brand bg-white px-2 py-1 text-[10px] font-semibold text-black">
                  {order.type || 'Standard'}
                </span>
              </td>
              <td className="whitespace-pre-line break-words px-3 py-4 text-[11px] leading-5 text-black">{order.items || '—'}</td>
              <td className="whitespace-nowrap px-3 py-4 text-right font-extrabold tabular-nums text-black">{currency(order.total)}</td>
              <td className="whitespace-nowrap px-3 py-4 tabular-nums text-black">{dateLabel(order.deliveryDate) || '—'}</td>
              <td className="px-3 py-4">
                <StatusBadge value={order.status} className="max-w-full whitespace-normal text-[10px] leading-tight" />
                {order.supplierPricingStatus && order.supplierPricingStatus !== 'Not requested'
                  && <div className="mt-1.5 break-words text-[10px] leading-4 text-black">Supplier pricing · {order.supplierPricingStatus}</div>}
                {order.approval && <div className="mt-1.5 break-words text-[10px] leading-4 text-black">
                  {order.approval.status === 'Pending' ? `Sent to ${order.approval.recipientName}` : `Approval ${order.approval.status}`}
                  {order.approval.decisionComment ? ` · “${order.approval.decisionComment}”` : ''}
                </div>}
              </td>
              <td className="px-3 py-4">
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={() => openDetail(order, 'view')}
                    aria-label={`View purchase order ${order.reference}`} className={rowActionClass}>
                    <Eye size={12} />View
                  </button>
                  {canEditPurchaseOrder(order, user) && <button type="button" onClick={() => openDetail(order, 'edit')}
                    aria-label={`Edit purchase order ${order.reference}`} className={rowActionClass}>
                    <Pencil size={12} />Edit
                  </button>}
                  {canCreate && order.status === 'Pending approval' && canSendForApproval(order) && <button type="button"
                    onClick={() => { setNotice(''); setSendOrder(order); }} className={rowPrimaryActionClass}>
                    <Mail size={12} />Send for approval
                  </button>}
                  {canCreate && order.status === 'Pending approval' && order.supplierPricingStatus !== 'Awarded' && <button type="button"
                    onClick={() => { void emailPurchaseOrder(order); }} disabled={sendBusy} className={rowActionClass}>
                    <Send size={12} />{sendBusy ? 'Sending…' : 'Send to Suppliers'}
                  </button>}
                  {canApprove && order.status === 'Pending approval' && canSendForApproval(order) && <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => decide(order.id, 'Approved')}
                      className="min-h-8 rounded-lg border border-brand bg-white px-2 py-1.5 text-[10px] font-semibold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1">Approve</button>
                    <button type="button" onClick={() => decide(order.id, 'Rejected')}
                      className="min-h-8 rounded-lg border border-brand bg-white px-2 py-1.5 text-[10px] font-semibold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1">Reject</button>
                  </div>}
                  {canReceive && ['Approved', 'Partially received'].includes(order.status) && <button type="button"
                    onClick={() => setReceiving(order)} className={rowActionClass}>Receive</button>}
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>{requestId ? 'No purchase orders for this request yet.' : 'No purchase orders are ready.'}</EmptyState>}
    </PageCard>

    {creating && <OrderForm rfqs={scopedRfqs} recommendations={visibleRecommendations} requisition={requisition}
      initialRfqId={initialRfqId} initialSupplierId={initialSupplierId}
      initialItems={poSelection?.items || linkedRecommendation?.items || []}
      onLoadQuotes={onLoadQuotes}
      onClose={() => { setCreating(false); setPoSelection(null); }} onSubmit={onCreate}
      onSendIntent={async (preview) => { setNotice(''); await prepareSupplierRequest(preview); }} />}
    {receiving && <ReceiptForm order={receiving} items={items} onClose={() => setReceiving(null)} onSubmit={onReceive} />}
    {sendOrder && <SendForApprovalModal order={sendOrder} loadApprovers={loadApprovers} onSend={saveAndSend} onClose={closeSendModal} />}

    {recommendationDetail && <RecommendedSupplierDetail entry={recommendationDetail} canCreate={canCreate}
      onClose={() => setRecommendationDetail(null)} onViewPurchaseOrder={viewRecommendedPurchaseOrder}
      onCreatePurchaseOrder={createRecommendedPurchaseOrder} />}
    {detailLoading && <Modal title="Opening purchase order" onClose={closeDetail}><div className="py-8 text-center text-xs text-black">Loading official form…</div></Modal>}
    {!detailLoading && detailMode === 'view' && detail && <Modal title={`Official purchase order · ${detail.reference}`} size="xl" onClose={closeDetail}>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <PrintButton label="Print official form" />
          <DownloadButton type="purchaseOrder" id={detail.id} format="pdf" label="Download official PDF" />
          <DownloadButton type="purchaseOrder" id={detail.id} format="xlsx" label="Excel" />
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPurchaseOrder(detail, user) && <button type="button" onClick={() => setDetailMode('edit')} className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-2 text-xs font-bold text-black"><Pencil size={14} />Edit</button>}
          {canCreate && detail.status === 'Pending approval' && canSendForApproval(detail) && <button type="button" onClick={() => { setNotice(''); setSendOrder(detail); }} className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-white px-3 py-2 text-xs font-bold text-black"><Mail size={14} />Send for approval</button>}
          {canCreate && detail.status === 'Pending approval' && detail.supplierPricingStatus !== 'Awarded' && <button type="button" onClick={() => { void emailPurchaseOrder(detail); }} disabled={sendBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black"><Send size={14} />{sendBusy ? 'Sending…' : 'Send to Suppliers'}</button>}
          <button type="button" onClick={closeDetail} className="rounded-lg border border-brand px-3 py-2 text-xs font-bold">Close</button>
        </div>
      </div>
      {detail.approval && <section className="no-print mb-4 rounded-lg border border-brand bg-white p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-black">Approval request · {detail.approval.status}</strong>
          {detail.approval.status === 'Pending' && canCreate && <button type="button" onClick={() => revokeApproval(detail)} className="rounded-lg border border-brand bg-white px-3 py-1.5 font-bold text-black">Revoke link</button>}
        </div>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[10px] text-black">Recipient</dt><dd className="font-bold">{detail.approval.recipientName || '—'}</dd></div>
          <div><dt className="text-[10px] text-black">Sender</dt><dd className="font-bold">{detail.approval.senderName || '—'}</dd></div>
          <div><dt className="text-[10px] text-black">Sent</dt><dd className="font-bold">{dateTimeLabel(detail.approval.sentAt)}</dd></div>
          <div><dt className="text-[10px] text-black">Decision</dt><dd className="font-bold">{detail.approval.decidedAt ? dateTimeLabel(detail.approval.decidedAt) : '—'}</dd></div>
          {detail.approval.decisionComment && <div className="sm:col-span-4"><dt className="text-[10px] text-black">Comment</dt><dd className="italic">“{detail.approval.decisionComment}”</dd></div>}
        </dl>
      </section>}
      {(canCreate || canApprove) && <section className="no-print mb-4 rounded-lg border border-brand bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-black">Official signatures</h3>
            <p className="mt-1 text-[10px] text-black">Uploaded images appear on the Prepared by and Approved by lines of the purchase order.</p>
          </div>
          <button type="button" onClick={() => { void saveSignatures(); }} disabled={signatureBusy}
            className="rounded-lg bg-brand px-3 py-2 text-[11px] font-bold text-black disabled:opacity-50">
            {signatureBusy ? 'Saving…' : 'Save signatures'}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {canCreate && <SignatureUpload label="Prepared by" value={signatureDraft.preparedBySignature}
            onChange={(value) => setSignatureDraft((current) => ({ ...current, preparedBySignature: value }))} />}
          {canApprove && <SignatureUpload label="Approved by" value={signatureDraft.approvedBySignature}
            onChange={(value) => setSignatureDraft((current) => ({ ...current, approvedBySignature: value }))} />}
        </div>
        {signatureError && <ErrorMessage>{signatureError}</ErrorMessage>}
      </section>}
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-brand bg-white p-3">
        <PurchaseOrderDocument order={detail} />
        {detail.supplierPricingAward && <div className="mt-4"><SupplierPricingAwardSummary award={detail.supplierPricingAward} /></div>}
      </div>
    </Modal>}
    {!detailLoading && detailMode === 'edit' && detail && <OrderEditForm order={detail} onClose={() => setDetailMode('view')} onSubmit={saveEdit}
      onSendIntent={async (preview) => { setNotice(''); await prepareSupplierRequest(preview); }} />}
  </>;
}

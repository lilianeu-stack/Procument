import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowDown, ArrowUp, CheckCircle2, Clock3, Eye, FileEdit,
  FileText, Loader2, Mail, Pencil, Plus, RefreshCw, Search, Send,
  Trash2, X, XCircle
} from 'lucide-react';
import PageCard from '../components/ui/PageCard.jsx';
import DateRangeFilter from '../components/ui/DateRangeFilter.jsx';
import DownloadButton from '../components/ui/DownloadButton.jsx';
import Modal from '../components/ui/Modal.jsx';
import PrintButton from '../components/ui/PrintButton.jsx';
import PrintHeader from '../components/ui/PrintHeader.jsx';
import {
  ErrorState, FilterField, KeyValue, LoadingState, Pagination, TableScroll,
  secondaryButtonClass
} from '../components/portals/PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../utils/format.js';
import { todayIso } from '../utils/dates.js';
import { reportForPage } from '../utils/reportFields.js';

const REPORT = reportForPage('RFQs') || {
  exportKey: 'rfqs', title: 'Requests for quotation',
  fields: [
    { key: 'issued', label: 'Date issued' }, { key: 'due', label: 'Quotation due date' },
    { key: 'closed', label: 'Date closed' }, { key: 'created', label: 'Date created' }
  ],
  defaultField: 'issued'
};

const RFQ_STATUSES = ['Draft', 'Sent', 'Evaluating', 'Awarded', 'Closed'];
const SUMMARY_CARDS = [
  { key: 'total', label: 'Total RFQs', icon: FileText, note: 'All registered RFQs', filter: {} },
  { key: 'draft', label: 'Draft RFQs', icon: FileEdit, note: 'Not sent to suppliers', filter: { status: 'Draft', hasResponses: '' } },
  { key: 'sent', label: 'Sent RFQs', icon: Send, note: 'Invitations issued', filter: { status: 'Sent', hasResponses: '' } },
  { key: 'awaitingResponses', label: 'Awaiting Supplier Responses', icon: Clock3, note: 'Sent, no quotation yet', filter: { status: 'Sent', hasResponses: 'no' } },
  { key: 'receivedQuotations', label: 'Received Quotations', icon: CheckCircle2, note: 'RFQs with at least one quotation', filter: { status: '', hasResponses: 'yes' } },
  { key: 'closed', label: 'Closed RFQs', icon: Archive, note: 'Closed without award', filter: { status: 'Closed', hasResponses: '' } }
];

const SORT_COLUMNS = {
  reference: 'reference',
  requisition: 'requisition',
  rfqDate: 'rfqDate',
  dueDate: 'dueDate',
  invitedSuppliers: 'invitedSuppliers',
  quotations: 'quotations',
  status: 'status'
};

const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand bg-reference px-3.5 py-2 text-xs font-bold text-black transition hover:brightness-95 active:brightness-90 focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50';
const createRfqButtonClass = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-reference px-5 py-3 text-sm font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';
const secondaryBtn = secondaryButtonClass();

function errorText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.message) return errorText(value.message);
  if (value.data?.message) return errorText(value.data.message);
  try { return JSON.stringify(value); } catch { return 'Something went wrong.'; }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// Compact register styling. Labels retain status meaning; dots aid scanning.
const RFQ_STATUS_SURFACE = {
  Draft: 'border-brand bg-white text-black/55',
  Sent: 'border-black/10 bg-black/[0.03] text-black',
  Evaluating: 'border-black/15 bg-black/[0.06] text-black',
  Awarded: 'border-black/15 bg-white text-black',
  Closed: 'border-black/20 bg-black/[0.08] text-black/60',
  Submitted: 'border-brand bg-white text-black/70'
};
const RFQ_STATUS_DOT = {
  Draft: 'bg-black/30',
  Sent: 'bg-black/55',
  Evaluating: 'bg-black/75',
  Awarded: 'bg-success',
  Closed: 'bg-reference',
  Submitted: 'bg-black/45'
};
const OPEN_RFQ_STATUSES = new Set(['Sent', 'Evaluating']);
const TABLE_HEADER_BASE = 'px-3 py-3.5 text-[10px] font-extrabold uppercase tracking-[.03em] text-black/50';
const TABLE_CELL = 'px-3 py-3.5 align-middle';
const ACTION_ICON_BUTTON = 'grid h-7 w-7 place-items-center rounded-md border border-brand bg-white text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40';

function RfqStatusBadge({ status, label }) {
  const value = status || '';
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold leading-none ${RFQ_STATUS_SURFACE[value] || 'border-brand bg-white text-black/70'}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RFQ_STATUS_DOT[value] || 'bg-black/40'}`} aria-hidden="true" />
    {label ?? value ?? '—'}
  </span>;
}

function CountIndicator({ value, label }) {
  const numeric = Number(value);
  const count = Number.isFinite(numeric) ? numeric : 0;
  return <span
    className={`inline-flex min-w-[30px] justify-center rounded-md border border-brand px-2 py-1 text-[11px] font-bold tabular-nums ${count ? 'bg-white text-black' : 'bg-white text-black/40'}`}
    title={`${count} ${label}`}
    aria-label={`${count} ${label}`}>
    {count}
  </span>;
}

function isOverdueRfq(rfq) {
  const due = String(rfq?.dueDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < todayIso() && OPEN_RFQ_STATUSES.has(rfq.status);
}

function SortHeader({ label, sortKey, filters, onSort }) {
  const active = filters.sort === sortKey;
  return <th scope="col" aria-sort={active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    className={`${TABLE_HEADER_BASE} whitespace-nowrap text-left`}>
    <button type="button" onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1.5 rounded hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      aria-label={`Sort by ${label}`}>
      {label}
      {active && (filters.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  </th>;
}

function SectionTitle({ children, note }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-3">
    <h3 className="text-xs font-extrabold uppercase tracking-wide">{children}</h3>
    {note && <span className="text-[10px] text-muted">{note}</span>}
  </div>;
}

function RfqFormModal({
  mode = 'create', rfq = null, initialRequisitionId = '', requisitions = [], suppliers = [],
  initialSupplierIds = [], portalApi, onClose, onSubmit, busy = false
}) {
  const [form, setForm] = useState({
    requisitionId: String(rfq?.requisitionId || initialRequisitionId || ''),
    dueDate: rfq?.dueDate ? String(rfq.dueDate).slice(0, 10) : '',
    instructions: rfq?.instructions || '',
    terms: rfq?.terms || ''
  });
  const [supplierIds, setSupplierIds] = useState(
    initialSupplierIds.length ? initialSupplierIds.map(String) : (rfq?.suppliers || []).map((supplier) => String(supplier.id))
  );
  const [supplierSearch, setSupplierSearch] = useState('');
  const [requestItems, setRequestItems] = useState(rfq?.items || []);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    const id = Number(form.requisitionId);
    if (!Number.isInteger(id) || id < 1 || !portalApi?.getReceivedRequest || rfq?.items?.length) return undefined;
    setItemsLoading(true);
    portalApi.getReceivedRequest(id)
      .then((response) => { if (active) setRequestItems(response.requisition?.items || []); })
      .catch(() => { if (active) setRequestItems([]); })
      .finally(() => { if (active) setItemsLoading(false); });
    return () => { active = false; };
  }, [form.requisitionId, portalApi, rfq?.items?.length]);

  const eligibleSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.status === 'Active'), [suppliers]);
  const filteredSuppliers = useMemo(() => {
    const needle = supplierSearch.trim().toLowerCase();
    if (!needle) return eligibleSuppliers;
    return eligibleSuppliers.filter((supplier) =>
      [supplier.name, supplier.email, supplier.contactName || supplier.contact_name].some((value) =>
        String(value || '').toLowerCase().includes(needle)));
  }, [eligibleSuppliers, supplierSearch]);

  const selectedRequisition = requisitions.find((request) => String(request.id) === String(form.requisitionId));
  const selectedCount = supplierIds.length;

  function toggleSupplier(id) {
    setSupplierIds((current) => current.includes(String(id))
      ? current.filter((value) => value !== String(id))
      : [...current, String(id)]);
  }

  async function submit(saveAsDraft) {
    if (submitting.current || busy) return;
    if (!selectedCount) { setLocalError('Select at least one active supplier.'); return; }
    submitting.current = true;
    setLocalError('');
    try {
      await onSubmit({
        requisitionId: Number(form.requisitionId),
        dueDate: form.dueDate,
        instructions: form.instructions,
        terms: form.terms,
        supplierIds: supplierIds.map(Number),
        saveAsDraft
      });
    } catch (exception) { setLocalError(errorText(exception)); }
    finally { submitting.current = false; }
  }

  const isEdit = mode === 'edit';

  return <Modal size="xl" title={isEdit ? `Edit draft RFQ · ${rfq?.reference || ''}` : 'Create request for quotation'} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); submit(false); }} className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-brand">
        <SectionTitle>RFQ Information</SectionTitle>
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <KeyValue label="RFQ reference">{isEdit ? rfq?.reference : 'Generated on save'}</KeyValue>
          <KeyValue label="RFQ date">{isEdit ? (dateLabel(rfq?.issuedAt || rfq?.createdAt) || '—') : 'Generated on send'}</KeyValue>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
            Related procurement request
            <select required value={form.requisitionId} onChange={(event) => {
              setForm({ ...form, requisitionId: event.target.value });
              setRequestItems([]);
            }} className="field" aria-label="Related procurement request">
              <option value="">Select a request…</option>
              {requisitions.filter((request) =>
                ['Forwarded to Procurement', 'Under Procurement Review', 'Procurement Approved', 'Approved', 'In procurement']
                  .includes(request.status))
                .map((request) => <option key={request.id} value={request.id}>{request.reference} · {request.requester || request.title || 'Request'}</option>)}
            </select>
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
            Submission deadline
            <input type="date" value={form.dueDate} min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
              className="field" aria-label="Submission deadline" />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-brand">
        <SectionTitle note="Shared with every invited supplier">Instructions to Suppliers</SectionTitle>
        <div className="p-5">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
            Instructions
            <textarea rows="3" value={form.instructions}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              placeholder="Provide collection, inspection or submission instructions."
              className="field mt-1 h-auto py-2" aria-label="Instructions to suppliers" />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-brand">
        <SectionTitle note="Included in the supplier quotation request">Terms and Conditions</SectionTitle>
        <div className="p-5">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
            Terms
            <textarea rows="3" value={form.terms}
              onChange={(event) => setForm({ ...form, terms: event.target.value })}
              placeholder="State validity, payment or delivery terms where applicable."
              className="field mt-1 h-auto py-2" aria-label="Terms and conditions" />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-brand">
        <SectionTitle note={itemsLoading ? 'Loading items…' : 'Items are taken from the selected procurement request'}>
          Requested Items
        </SectionTitle>
        {requestItems.length ? <TableScroll minWidth={620}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-muted"><tr>
              <th className="px-4 py-3">Item No.</th><th className="px-4 py-3">Description / specifications</th>
              <th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Unit</th>
            </tr></thead>
            <tbody className="divide-y">
              {requestItems.map((item, index) => <tr key={item.id || `${item.itemName}-${index}`}>
                <td className="px-4 py-3 font-bold">{String(index + 1).padStart(2, '0')}</td>
                <td className="px-4 py-3"><span className="font-bold">{item.itemName || '—'}</span>
                  {item.description && <span className="mt-0.5 block text-[11px] text-muted">{item.description}</span>}</td>
                <td className="px-4 py-3">{item.quantity ?? '—'}</td>
                <td className="px-4 py-3">{item.unit || '—'}</td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll> : <p className="px-5 py-6 text-xs text-muted">
          {selectedRequisition?.items
            ? String(selectedRequisition.items)
            : 'No item lines are available for the selected request. Open the original request document to review them.'}
        </p>}
      </section>

      <section className="overflow-hidden rounded-xl border border-brand">
        <SectionTitle note={`${selectedCount} selected`}>Supplier Selection</SectionTitle>
        <div className="flex flex-wrap items-end gap-3 border-b border-subtle p-4">
          <FilterField label="Search registered suppliers" className="w-full sm:w-72">
            <span className="relative block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Name, contact or registered email" className="field pl-9" />
            </span>
          </FilterField>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSupplierIds(filteredSuppliers
              .filter((supplier) => validEmail(supplier.email))
              .map((supplier) => String(supplier.id)))}
              className={secondaryBtn}>Select all shown</button>
            <button type="button" onClick={() => setSupplierIds([])} className={secondaryBtn}>Deselect all</button>
          </div>
        </div>
        <div className="max-h-72 divide-y overflow-y-auto">
          {filteredSuppliers.map((supplier) => {
            const emailOk = validEmail(supplier.email);
            const checked = supplierIds.includes(String(supplier.id));
            return <label key={supplier.id} className={`flex items-start gap-3 px-5 py-3 ${emailOk ? 'hover:bg-hover' : 'opacity-60'}`}>
              <input type="checkbox" checked={checked} disabled={!emailOk} onChange={() => toggleSupplier(supplier.id)}
                className="mt-1" aria-label={`Select ${supplier.name}`} />
              <span className="min-w-0">
                <span className="block text-xs font-bold">{supplier.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {supplier.contactName || supplier.contact_name || 'No contact name'} · {supplier.email || 'No registered email'}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-[10px] font-bold text-black">
                {emailOk ? supplier.status : 'Email unavailable'}
              </span>
            </label>;
          })}
          {!filteredSuppliers.length && <p className="px-5 py-6 text-xs text-muted">No active registered suppliers match this search.</p>}
        </div>
      </section>

      <div className="rounded-lg border border-brand bg-white px-4 py-3 text-[11px] leading-5 text-black">
        {isEdit
          ? `Saving will update this draft. Sending later will create ${selectedCount} individual supplier email(s), each with a unique secure link.`
          : `Creating without saving as draft will send ${selectedCount} individual supplier email(s), each with a unique secure link. SMTP acceptance is not proof of inbox delivery.`}
      </div>
      {localError && <p role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{localError}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}><X size={14} />Cancel</button>
        {!isEdit && <button type="button" disabled={busy || submitting.current}
          onClick={() => submit(true)} className={secondaryBtn}><FileEdit size={14} />Save as draft</button>}
        <button type="submit" disabled={busy || submitting.current} className={primaryButtonClass}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : isEdit ? <Pencil size={14} /> : <Send size={14} />}
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create & send RFQ'}
        </button>
      </div>
    </form>
  </Modal>;
}

function ConfirmDialog({ title, message, confirmLabel, busy, onClose, onConfirm }) {
  return <Modal size="sm" title={title} onClose={onClose} dismissible={!busy}>
    <p className="text-xs leading-5 text-black">{message}</p>
    <div className="mt-5 flex justify-end gap-2 border-t border-subtle pt-4">
      <button type="button" disabled={busy} onClick={onClose} className={secondaryBtn}>Cancel</button>
      <button type="button" disabled={busy} onClick={onConfirm} className={primaryButtonClass}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  </Modal>;
}

function QuotationDialog({ quote, canAward, busy, onClose, onAward }) {
  if (!quote) return null;
  return <Modal size="md" title={`Quotation · ${quote.supplier}`} onClose={onClose}>
    <div className="grid gap-3 sm:grid-cols-2">
      <KeyValue label="Supplier">{quote.supplier}</KeyValue>
      <KeyValue label="Submitted">{dateTimeLabel(quote.submittedAt) || '—'}</KeyValue>
      <KeyValue label="Quoted amount">{currency(quote.amount)}</KeyValue>
      <KeyValue label="Delivery lead time">{quote.deliveryDays ? `${quote.deliveryDays} day(s)` : '—'}</KeyValue>
      <KeyValue label="Quality score">{Number(quote.qualityScore) > 0 ? `${quote.qualityScore}/5` : '—'}</KeyValue>
      <KeyValue label="Supplier rating">{Number(quote.ratingScore) > 0 ? `${quote.ratingScore}/5` : '—'}</KeyValue>
      <KeyValue label="Quotation reference" className="sm:col-span-2">Not supplied</KeyValue>
      <KeyValue label="Notes" className="sm:col-span-2">{quote.notes || '—'}</KeyValue>
    </div>
    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
      <PrintButton label="Print quotation" />
      <DownloadButton type="rfqQuotation" id={quote.id} format="pdf" label="Download PDF" />
      {canAward && !quote.selected && <button type="button" disabled={busy} onClick={() => onAward(quote.id)} className={primaryButtonClass}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Select quotation
      </button>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Close</button>
    </div>
  </Modal>;
}

function ComparisonDialog({ quotations, onClose }) {
  return <Modal size="lg" title="Compare quotations" onClose={onClose}>
    <TableScroll minWidth={650}>
      <table className="w-full text-left text-xs">
        <thead className="bg-white text-[10px] uppercase text-muted"><tr>
          <th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Amount</th>
          <th className="px-4 py-3">Lead time</th><th className="px-4 py-3">Quality</th>
          <th className="px-4 py-3">Rating</th><th className="px-4 py-3">Submitted</th>
        </tr></thead>
        <tbody className="divide-y">
          {quotations.map((quote) => <tr key={quote.id}>
            <td className="px-4 py-3 font-bold">{quote.supplier}{quote.selected ? ' · Selected' : ''}</td>
            <td className="px-4 py-3">{currency(quote.amount)}</td>
            <td className="px-4 py-3">{quote.deliveryDays ? `${quote.deliveryDays} day(s)` : '—'}</td>
            <td className="px-4 py-3">{Number(quote.qualityScore) > 0 ? `${quote.qualityScore}/5` : '—'}</td>
            <td className="px-4 py-3">{Number(quote.ratingScore) > 0 ? `${quote.ratingScore}/5` : '—'}</td>
            <td className="px-4 py-3">{dateLabel(quote.submittedAt) || '—'}</td>
          </tr>)}
        </tbody>
      </table>
    </TableScroll>
    <div className="mt-4 flex justify-end border-t border-subtle pt-4">
      <button type="button" onClick={onClose} className={secondaryBtn}>Close</button>
    </div>
  </Modal>;
}

function EmailDeliveryPanel({
  rfq, emailData, emailLoading, emailBusy, canManage, onLoad, onRetry, onResend
}) {
  const summary = emailData?.summary || {};
  const deliveries = emailData?.deliveries || [];
  const cards = [
    ['Suppliers', summary.suppliers], ['Provider accepted', summary['Accepted by Email Provider']],
    ['Confirmed delivered', summary.Delivered], ['Opened', summary.Opened],
    ['Failed', summary.Failed], ['Pending', summary.Pending]
  ];
  const configError = deliveries.find((delivery) => delivery.errorDetails?.code === 'EMAIL_NOT_CONFIGURED')?.errorDetails?.message;

  return <section className="mt-5 overflow-hidden rounded-xl border border-brand bg-white">
    <SectionTitle note="Provider acceptance is not confirmed inbox delivery">
      Email sending status · {rfq.reference}
    </SectionTitle>
    {emailLoading && <LoadingState label="Loading email delivery status…" />}
    {!emailLoading && !emailData && <div className="px-5 py-8 text-center text-xs text-muted">Select “Email status” to load individual supplier delivery records.</div>}
    {!emailLoading && emailData && <>
      <div className="grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value]) => <div key={label} className="rounded-lg border border-brand bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
          <div className="display-font mt-1 text-xl font-extrabold">{value || 0}</div>
        </div>)}
      </div>
      {configError && <p role="alert" className="mx-5 mb-4 rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{configError}</p>}
      {canManage && Number(summary.Failed) > 0 && <div className="px-5 pb-4">
        <button type="button" disabled={emailBusy} onClick={onRetry} className={primaryButtonClass}>
          {emailBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Retry failed emails
        </button>
      </div>}
      {deliveries.length ? <TableScroll minWidth={940}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-muted"><tr>
            <th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Registered email</th>
            <th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempts</th>
            <th className="px-4 py-3">Sent</th><th className="px-4 py-3">Opened</th>
            <th className="px-4 py-3">Error / configuration</th><th className="px-4 py-3">Action</th>
          </tr></thead>
          <tbody className="divide-y">
            {deliveries.map((delivery) => <tr key={delivery.id} className="hover:bg-hover">
              <td className="px-4 py-3 font-bold">{delivery.supplier}</td>
              <td className="px-4 py-3">{delivery.recipientEmail || '—'}</td>
              <td className="px-4 py-3"><RfqStatusBadge status={delivery.status} /></td>
              <td className="px-4 py-3">{delivery.attempts}</td>
              <td className="px-4 py-3">{dateTimeLabel(delivery.sentAt) || '—'}</td>
              <td className="px-4 py-3">{dateTimeLabel(delivery.openedAt) || '—'}</td>
              <td className="max-w-[260px] px-4 py-3 text-black">{delivery.errorDetails?.message || '—'}</td>
              <td className="px-4 py-3"><button type="button" disabled={emailBusy} onClick={() => onResend(delivery)}
                className="inline-flex items-center gap-1 font-bold text-black hover:underline disabled:opacity-50"
                title={`Resend link to ${delivery.recipientEmail}`} aria-label={`Resend link to ${delivery.recipientEmail}`}>
                <Send size={12} />Resend
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <p className="px-5 py-6 text-xs text-muted">No supplier invitations were recorded for this RFQ.</p>}
      <div className="border-t border-subtle px-5 py-3">
        <button type="button" onClick={onLoad} className={secondaryBtn}><RefreshCw size={13} />Refresh email status</button>
      </div>
    </>}
  </section>;
}

function fallbackStats(rfqs = []) {
  return {
    total: rfqs.length,
    draft: rfqs.filter((rfq) => rfq.status === 'Draft').length,
    sent: rfqs.filter((rfq) => rfq.status === 'Sent').length,
    awaitingResponses: rfqs.filter((rfq) => rfq.status === 'Sent' && Number(rfq.quotations) === 0).length,
    receivedQuotations: rfqs.filter((rfq) => Number(rfq.quotations) > 0).length,
    closed: rfqs.filter((rfq) => rfq.status === 'Closed').length
  };
}

export default function RfqsPage({
  rfqs = [], requisitions = [], suppliers = [], quotations = [], user = {}, query = {},
  initialRequisitionId, autoOpenCreate = false,
  onCreate, onLoadQuotes, onQuote, onAward, onLoadEmailDeliveries,
  onRetryFailedEmails, onResendRfqEmail,
  listRfqs, getRfqStats, getRfqDetail, onUpdateRFQ, onDeleteRFQ, onSendRFQ, onCloseRFQ,
  navigate, portalApi
}) {
  const initialDetailId = Number(query.rfq) || null;
  const [filters, setFilters] = useState({
    reference: query.reference || '',
    supplier: query.supplier || '',
    requisition: query.requisitionRef || '',
    status: query.status || '',
    hasResponses: query.hasResponses || '',
    sort: query.sort || 'rfqDate',
    direction: query.direction || 'desc',
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10
  });
  const [dateFilter, setDateFilter] = useState({
    preset: '', from: query.from || '', to: query.to || '', dateField: query.dateField || REPORT.defaultField
  });
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [listLoading, setListLoading] = useState(Boolean(listRfqs));
  const [listError, setListError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [detailId, setDetailId] = useState(initialDetailId);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const [detailError, setDetailError] = useState('');
  const [createOpen, setCreateOpen] = useState(Boolean(query.requisition) && autoOpenCreate && !initialDetailId);
  const [editOpen, setEditOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [activeQuote, setActiveQuote] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [emailData, setEmailData] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  const canCreate = ['admin', 'procurement'].includes(user.role);
  const canEvaluate = ['admin', 'committee', 'procurement'].includes(user.role);
  const canAward = ['admin', 'committee'].includes(user.role);

  const listParams = useMemo(() => ({
    ...filters,
    from: dateFilter.from || '',
    to: dateFilter.to || '',
    dateField: dateFilter.dateField || REPORT.defaultField
  }), [filters, dateFilter.from, dateFilter.to, dateFilter.dateField]);

  const loadList = useCallback(async () => {
    if (!listRfqs) return;
    setListLoading(true); setListError('');
    try { setResult(await listRfqs(listParams)); }
    catch (exception) { setListError(errorText(exception) || 'RFQs could not be loaded.'); }
    finally { setListLoading(false); }
  }, [listRfqs, listParams]);

  useEffect(() => {
    if (!listRfqs) return undefined;
    const timer = window.setTimeout(loadList, 200);
    return () => window.clearTimeout(timer);
  }, [listRfqs, loadList]);

  const loadStats = useCallback(async () => {
    if (!getRfqStats) return;
    try {
      const response = await getRfqStats();
      setStats(response.stats || null); setStatsError('');
    } catch (exception) { setStatsError(errorText(exception) || 'RFQ statistics could not be loaded.'); }
  }, [getRfqStats]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const loadEmailStatus = useCallback(async (rfqId) => {
    if (!onLoadEmailDeliveries || !rfqId) return;
    setEmailLoading(true);
    try { setEmailData(await onLoadEmailDeliveries(rfqId)); }
    catch (exception) { setError(errorText(exception) || 'Email delivery status could not be loaded.'); }
    finally { setEmailLoading(false); }
  }, [onLoadEmailDeliveries]);

  useEffect(() => {
    let active = true;
    if (!detailId) { setDetail(null); setDetailLoading(false); return undefined; }
    setDetailLoading(true); setDetailError(''); setEmailData(null);
    if (getRfqDetail) {
      getRfqDetail(detailId)
        .then((response) => {
          if (!active) return;
          setDetail(response);
          if (response.rfq?.status !== 'Draft') void loadEmailStatus(detailId);
        })
        .catch((exception) => { if (active) setDetailError(errorText(exception) || 'RFQ details could not be loaded.'); })
        .finally(() => { if (active) setDetailLoading(false); });
    } else {
      const row = rfqs.find((item) => Number(item.id) === Number(detailId));
      const related = requisitions.find((request) => Number(request.id) === Number(row?.requisitionId));
      const requestQuotes = quotations.filter((quote) => Number(quote.rfqId) === Number(detailId));
      const suppliersForRfq = suppliers.filter((supplier) => requestQuotes.some((quote) => Number(quote.supplierId) === Number(supplier.id)));
      setDetail({
        rfq: row ? { ...row, invitedSuppliers: suppliersForRfq.length, quotations: requestQuotes.length } : null,
        items: related?.items || [],
        suppliers: suppliersForRfq,
        quotations: requestQuotes,
        activity: []
      });
      setDetailLoading(false);
    }
    return () => { active = false; };
  }, [detailId, getRfqDetail, loadEmailStatus, rfqs, requisitions, quotations, suppliers]);

  const localData = useMemo(() => {
    let rows = [...rfqs];
    const textFields = [['reference', 'reference'], ['supplier', 'supplier'], ['requisition', 'requisition']];
    for (const [key, alias] of textFields) {
      const needle = String(filters[key] || '').trim().toLowerCase();
      if (!needle) continue;
      rows = rows.filter((row) => {
        if (key === 'supplier') return String(row[alias] || '').toLowerCase().includes(needle);
        return String(row[alias] || row.requisition || '').toLowerCase().includes(needle);
      });
    }
    if (filters.status) rows = rows.filter((row) => row.status === filters.status);
    if (filters.hasResponses === 'yes') rows = rows.filter((row) => Number(row.quotations) > 0);
    if (filters.hasResponses === 'no') rows = rows.filter((row) => Number(row.quotations) === 0);
    if (dateFilter.from || dateFilter.to) {
      const column = { issued: 'issuedAt', due: 'dueDate', closed: 'closedAt', created: 'createdAt' }[dateFilter.dateField] || 'issuedAt';
      rows = rows.filter((row) => {
        const value = String(row[column] || '').slice(0, 10);
        if (!value) return false;
        return (!dateFilter.from || value >= dateFilter.from) && (!dateFilter.to || value <= dateFilter.to);
      });
    }
    const valueFor = (row) => {
      if (filters.sort === 'reference') return row.reference;
      if (filters.sort === 'requisition') return row.requisition;
      if (filters.sort === 'dueDate') return row.dueDate || '';
      if (filters.sort === 'invitedSuppliers') return Number(row.invitedSuppliers) || 0;
      if (filters.sort === 'quotations') return Number(row.quotations) || 0;
      if (filters.sort === 'status') return row.status;
      return row.issuedAt || row.createdAt || '';
    };
    rows.sort((left, right) => {
      const a = valueFor(left); const b = valueFor(right);
      const comparison = String(a).localeCompare(String(b), undefined, { numeric: true });
      return filters.direction === 'asc' ? comparison : -comparison;
    });
    const total = rows.length;
    const start = (filters.page - 1) * filters.limit;
    return {
      rfqs: rows.slice(start, start + filters.limit),
      pagination: { page: filters.page, limit: filters.limit, total, pages: Math.max(1, Math.ceil(total / filters.limit)) }
    };
  }, [rfqs, filters, dateFilter.from, dateFilter.to, dateFilter.dateField]);

  const rows = listRfqs ? (result?.rfqs || []) : localData.rfqs;
  const pagination = listRfqs ? result?.pagination : localData.pagination;
  const currentStats = stats || fallbackStats(rfqs);
  const dateFieldChanged = Boolean(dateFilter.dateField && dateFilter.dateField !== REPORT.defaultField);
  const hasFilters = Boolean(filters.reference || filters.supplier || filters.requisition || filters.status
    || filters.hasResponses || dateFilter.preset || dateFilter.from || dateFilter.to || dateFieldChanged);
  const activeRfq = detail?.rfq || null;
  const activeQuotations = detail?.quotations || [];

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? value : 1 }));
  }

  function updateDateFilter(next) {
    setDateFilter(next);
    setFilters((current) => (current.page === 1 ? current : { ...current, page: 1 }));
  }

  function applyCard(card) {
    setFilters((current) => ({
      ...current,
      status: card.filter.status || '',
      hasResponses: card.filter.hasResponses || '',
      page: 1
    }));
    setNotice(''); setError('');
  }

  function toggleSort(key) {
    setFilters((current) => ({
      ...current,
      sort: SORT_COLUMNS[key] || key,
      direction: current.sort === (SORT_COLUMNS[key] || key) && current.direction === 'asc' ? 'desc' : 'asc',
      page: 1
    }));
  }

  function clearFilters() {
    setFilters((current) => ({
      ...current, reference: '', supplier: '', requisition: '', status: '', hasResponses: '', page: 1
    }));
    setDateFilter({ preset: '', from: '', to: '', dateField: REPORT.defaultField });
  }

  function openDetail(id) {
    setDetailId(Number(id));
    setNotice(''); setError(''); setDetailError(''); setEmailData(null);
  }

  function closeDetail() {
    setDetailId(null); setDetail(null); setEmailData(null); setNotice(''); setError('');
    if (query.rfq && navigate) navigate('RFQs', {});
  }

  function refresh() {
    loadList(); loadStats();
    if (detailId && getRfqDetail) {
      getRfqDetail(detailId).then((response) => setDetail(response)).catch(() => {});
    }
  }

  async function runAction(handler, successMessage, after, { rethrow = false } = {}) {
    setActionBusy(true); setError(''); setNotice('');
    try {
      const response = await handler();
      setNotice(successMessage(response));
      await after?.(response);
      refresh();
      return response;
    } catch (exception) {
      setError(errorText(exception) || 'The action could not be completed.');
      if (rethrow) throw exception;
      return null;
    } finally { setActionBusy(false); }
  }

  async function createRfq(form) {
    setBusy(true);
    try {
      return await runAction(
        () => onCreate(form),
        (result) => result.duplicate
          ? 'This RFQ already exists. The existing record was opened; no duplicate was created.'
          : result.status === 'Draft'
            ? 'Draft RFQ saved. No supplier email has been sent yet.'
            : emailResultNotice(result.emailDelivery),
        (result) => { setCreateOpen(false); if (result.id) setDetailId(Number(result.id)); },
        { rethrow: true }
      );
    } finally { setBusy(false); }
  }

  async function saveDraftChanges(form) {
    setBusy(true);
    try {
      await runAction(
        () => onUpdateRFQ(detailId, form),
        () => 'Draft RFQ updated.',
        () => setEditOpen(false),
        { rethrow: true }
      );
    } finally { setBusy(false); }
  }

  async function confirmSelected() {
    if (!confirmAction) return;
    if (confirmAction.type === 'send') {
      const rfqId = Number(confirmAction.rfq?.id || detailId);
      await runAction(
        () => onSendRFQ(rfqId),
        (result) => `${result.reference} was sent. ${emailResultNotice(result.emailDelivery)}`,
        () => { setConfirmAction(null); loadEmailStatus(rfqId); }
      );
    } else if (confirmAction.type === 'delete') {
      await runAction(
        () => onDeleteRFQ(confirmAction.rfq.id),
        (result) => result.message || 'Draft RFQ deleted.',
        () => { setConfirmAction(null); closeDetail(); }
      );
    } else if (confirmAction.type === 'close') {
      await runAction(
        () => onCloseRFQ(confirmAction.rfq.id),
        (result) => result.message || 'RFQ closed.',
        () => setConfirmAction(null)
      );
    }
  }

  async function retryFailed() {
    if (!activeRfq) return;
    setEmailBusy(true); setError('');
    try {
      const response = await onRetryFailedEmails(activeRfq.id);
      setEmailData(response);
      setNotice(emailResultNotice(response.result));
    } catch (exception) { setError(errorText(exception)); }
    finally { setEmailBusy(false); }
  }

  async function resend(delivery) {
    if (!activeRfq) return;
    if (!window.confirm(`Resend the ${activeRfq.reference} link to ${delivery.recipientEmail}? This creates a new delivery attempt.`)) return;
    setEmailBusy(true); setError('');
    try {
      const response = await onResendRfqEmail(activeRfq.id, delivery.id);
      setEmailData(response);
      setNotice(`Link resent to ${delivery.recipientEmail}. ${emailResultNotice(response.result)}`);
    } catch (exception) { setError(errorText(exception)); }
    finally { setEmailBusy(false); }
  }

  async function award(quotationId) {
    if (!activeRfq) return;
    await runAction(
      () => onAward(activeRfq.id, quotationId),
      () => 'Supplier selected. Procurement can now prepare the purchase order.',
      () => {
        setActiveQuote(null);
        setDetail((current) => current ? {
          ...current,
          rfq: { ...current.rfq, status: 'Awarded' },
          quotations: current.quotations.map((quote) => ({ ...quote, selected: quote.id === quotationId }))
        } : current);
      }
    );
  }

  function emailResultNotice(result) {
    if (!result) return 'RFQ saved.';
    const accepted = Number(result.accepted) || 0;
    const failed = Number(result.failed) || 0;
    if (Number(result.total) === 0 && accepted === 0 && failed === 0) {
      return 'No supplier invitations were selected, so no email was sent.';
    }
    if (accepted > 0 && failed === 0) {
      return `Provider accepted ${accepted} email(s). Provider acceptance is not confirmed inbox delivery.`;
    }
    if (accepted > 0 && failed > 0) {
      return `Provider accepted ${accepted} email(s); ${failed} failed. Review the individual supplier statuses.`;
    }
    return `${failed} email(s) failed. Review the error details and retry after correcting the configuration.`;
  }

  return <>
    <PrintHeader title={REPORT.title} reference="" />
    {notice && <div role="status" className="mb-4 rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black">{notice}</div>}
    {(error || listError || detailError || statsError) && <div className="mb-4">
      <ErrorState message={error || listError || detailError || statsError} onRetry={refresh} />
    </div>}

    {detailId ? <>
      <section className="mb-5 overflow-hidden rounded-xl border border-brand bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-subtle px-6 py-6">
          <div className="max-w-3xl">
            <button type="button" onClick={closeDetail} className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-black hover:underline">
              ← Back to RFQs
            </button>
            <div className="mb-2 w-fit rounded-full bg-white px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.14em] text-black">
              Request for quotation
            </div>
            <h1 className="display-font text-[25px] font-extrabold tracking-tight">{activeRfq?.reference || 'RFQ details'}</h1>
            <p className="mt-2 text-xs leading-5 text-black">
              {activeRfq?.requisitionTitle
                ? `${activeRfq.requisition} · ${activeRfq.requisitionTitle}`
                : activeRfq?.requisition || 'Review the quotation request and supplier activity.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeRfq && <RfqStatusBadge status={activeRfq.status} />}
            {canCreate && activeRfq?.status === 'Draft' && <>
              <button type="button" onClick={() => setEditOpen(true)} className={secondaryBtn}><Pencil size={14} />Edit</button>
              <button type="button" disabled={actionBusy} onClick={() => setConfirmAction({ type: 'send', rfq: activeRfq })} className={primaryButtonClass}><Send size={14} />Send RFQ</button>
              <button type="button" disabled={actionBusy} onClick={() => setConfirmAction({ type: 'delete', rfq: activeRfq })} className={secondaryBtn}><Trash2 size={14} />Delete draft</button>
            </>}
            {canCreate && ['Sent', 'Evaluating'].includes(activeRfq?.status) && <button type="button"
              disabled={actionBusy} onClick={() => setConfirmAction({ type: 'close', rfq: activeRfq })} className={secondaryBtn}>
              <XCircle size={14} />Close RFQ
            </button>}
            <PrintButton label="Print" disabled={!activeRfq} />
            {activeRfq && <DownloadButton type="rfq" id={activeRfq.id} format="pdf" label="Download PDF" />}
          </div>
        </div>
      </section>

      {detailLoading && <PageCard title="Opening RFQ"><LoadingState label="Loading RFQ details…" /></PageCard>}
      {!detailLoading && !activeRfq && <PageCard title="RFQ not found"><p className="px-5 py-8 text-center text-xs text-muted">This RFQ could not be opened. Return to the register and try again.</p></PageCard>}
      {!detailLoading && activeRfq && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-brand bg-white">
            <SectionTitle>RFQ Information</SectionTitle>
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <KeyValue label="RFQ reference">{activeRfq.reference}</KeyValue>
              <KeyValue label="Related request">{activeRfq.requisition || '—'}</KeyValue>
              <KeyValue label="RFQ date">{dateLabel(activeRfq.issuedAt || activeRfq.createdAt) || '—'}</KeyValue>
              <KeyValue label="Submission deadline">{dateLabel(activeRfq.dueDate) || '—'}</KeyValue>
              <KeyValue label="Department">{activeRfq.department || '—'}</KeyValue>
              <KeyValue label="Prepared by">{activeRfq.createdBy || '—'}</KeyValue>
              <KeyValue label="Suppliers invited">{activeRfq.invitedSuppliers ?? '—'}</KeyValue>
              <KeyValue label="Quotations received">{activeRfq.quotations ?? activeQuotations.length}</KeyValue>
              {activeRfq.awardedSupplier && <KeyValue label="Selected supplier" className="sm:col-span-2">{activeRfq.awardedSupplier}</KeyValue>}
              {activeRfq.instructions && <KeyValue label="Instructions to suppliers" className="sm:col-span-2">{activeRfq.instructions}</KeyValue>}
              {activeRfq.terms && <KeyValue label="Terms and conditions" className="sm:col-span-2">{activeRfq.terms}</KeyValue>}
            </dl>
          </section>
          <section className="overflow-hidden rounded-xl border border-brand bg-white">
            <SectionTitle note={`${detail.activity?.length || 0} event(s)`}>Relevant activity history</SectionTitle>
            {detail.activity?.length ? <ol className="space-y-4 p-5">
              {detail.activity.map((entry) => <li key={entry.id} className="border-l-2 border-brand pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold capitalize">{String(entry.action || 'activity').replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-muted">{dateTimeLabel(entry.createdAt) || '—'}</span>
                </div>
                {entry.actor && <div className="mt-0.5 text-[11px] text-muted">by {entry.actor}</div>}
                {(entry.previousStatus || entry.newStatus) && <div className="mt-1 text-[10px] font-bold">{entry.previousStatus || '—'} → {entry.newStatus || '—'}</div>}
              </li>)}
            </ol> : <p className="px-5 py-8 text-center text-xs text-muted">No RFQ activity has been recorded yet.</p>}
          </section>
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-brand bg-white">
          <SectionTitle>Requested Items</SectionTitle>
          {detail.items?.length ? <TableScroll minWidth={680}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-muted"><tr>
                <th className="px-4 py-3">Item No.</th><th className="px-4 py-3">Description / specifications</th>
                <th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Unit</th>
              </tr></thead>
              <tbody className="divide-y">
                {detail.items.map((item, index) => <tr key={item.id || index} className="hover:bg-hover">
                  <td className="px-4 py-3 font-bold">{String(index + 1).padStart(2, '0')}</td>
                  <td className="px-4 py-3"><span className="font-bold">{item.itemName || '—'}</span>
                    {item.description && <span className="mt-0.5 block text-[11px] text-muted">{item.description}</span>}</td>
                  <td className="px-4 py-3">{item.quantity ?? '—'}</td>
                  <td className="px-4 py-3">{item.unit || '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <p className="px-5 py-6 text-xs text-muted">No item lines are attached to this RFQ.</p>}
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-brand bg-white">
          <SectionTitle note={`${detail.suppliers?.length || 0} invited`}>Invited Suppliers and Responses</SectionTitle>
          {detail.suppliers?.length ? <TableScroll minWidth={760}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-muted"><tr>
                <th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Registered email</th><th className="px-4 py-3">Email status</th>
                <th className="px-4 py-3">Responses</th>
              </tr></thead>
              <tbody className="divide-y">
                {detail.suppliers.map((supplier) => <tr key={supplier.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-bold">{supplier.name}</td>
                  <td className="px-4 py-3">{supplier.contactName || '—'}{supplier.phone ? ` · ${supplier.phone}` : ''}</td>
                  <td className="px-4 py-3">{supplier.email || '—'}</td>
                  <td className="px-4 py-3">{supplier.emailStatus || (supplier.emailStatus === null ? 'Not sent' : '—')}</td>
                  <td className="px-4 py-3">{supplier.responses ?? '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <p className="px-5 py-6 text-xs text-muted">No suppliers have been invited to this RFQ.</p>}
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-brand bg-white">
          <SectionTitle note={`${activeQuotations.length} real quotation record(s)`}>
            Received Quotations
          </SectionTitle>
          {activeQuotations.length > 1 && <div className="border-b border-subtle px-5 py-3">
            <button type="button" onClick={() => setCompareOpen(true)} className={secondaryBtn}><FileText size={14} />Compare Quotations</button>
          </div>}
          {canEvaluate && ['Sent', 'Evaluating'].includes(activeRfq.status) && <div className="border-b border-subtle px-5 py-3">
            <button type="button" onClick={() => setQuoteOpen(true)} className={primaryButtonClass}><Plus size={14} />Record quote</button>
          </div>}
          {activeQuotations.length ? <TableScroll minWidth={720}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-muted"><tr>
                <th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Submission date</th>
                <th className="px-4 py-3">Quotation reference</th><th className="px-4 py-3">Quoted amount</th>
                <th className="px-4 py-3">Lead time</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
              </tr></thead>
              <tbody className="divide-y">
                {activeQuotations.map((quote) => <tr key={quote.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-bold">{quote.supplier}{quote.selected ? ' · Selected' : ''}</td>
                  <td className="px-4 py-3">{dateTimeLabel(quote.submittedAt) || '—'}</td>
                  <td className="px-4 py-3">Not supplied</td>
                  <td className="px-4 py-3 font-bold">{currency(quote.amount)}</td>
                  <td className="px-4 py-3">{quote.deliveryDays ? `${quote.deliveryDays} day(s)` : '—'}</td>
                  <td className="px-4 py-3"><RfqStatusBadge status={quote.selected ? 'Awarded' : 'Submitted'} label={quote.selected ? 'Selected' : 'Submitted'} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setActiveQuote(quote)} className="inline-flex items-center gap-1 font-bold text-black hover:underline" title="View quotation"><Eye size={12} />View</button>
                      <DownloadButton type="rfqQuotation" id={quote.id} format="pdf" label="PDF" className="!px-2 !py-1" />
                      <PrintButton label="Print" className="!px-2 !py-1" />
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll> : <p className="px-5 py-6 text-xs text-muted">No quotations have been received for this RFQ.</p>}
        </section>

        {activeRfq.status !== 'Draft' && <EmailDeliveryPanel
          rfq={activeRfq} emailData={emailData} emailLoading={emailLoading} emailBusy={emailBusy}
          canManage={canCreate} onLoad={() => loadEmailStatus(activeRfq.id)}
          onRetry={retryFailed} onResend={resend}
        />}
      </>}
    </> : <>
      <section className="mb-6 overflow-hidden rounded-xl border border-brand bg-white">
        <div className="flex flex-wrap items-center justify-between gap-5 border-b border-subtle bg-white px-5 py-5 sm:px-6 sm:py-6">
          <div className="min-w-[220px] flex-1">
            <h1 className="display-font text-2xl font-extrabold tracking-tight sm:text-[28px]">Requests for Quotation (RFQs)</h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
              Create, distribute, and manage supplier quotation requests throughout the procurement process.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
            <div className="min-w-[150px] rounded-xl border border-brand bg-white px-5 py-4 text-center">
              <div className="text-[10px] font-extrabold uppercase tracking-[.12em] text-black">Total RFQs</div>
              <div className="display-font mt-1 text-3xl font-extrabold tracking-tight">{currentStats.total ?? '—'}</div>
            </div>
            {canCreate && <button type="button" onClick={() => setCreateOpen(true)} className={createRfqButtonClass}>
              <Plus size={15} />Create RFQ
            </button>}
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {SUMMARY_CARDS.map((card) => {
          const cardStatus = card.filter.status || '';
          const cardResponses = card.filter.hasResponses || '';
          const active = filters.status === cardStatus && filters.hasResponses === cardResponses;
          return <button key={card.key} type="button" aria-pressed={active} onClick={() => applyCard(card)}
            className={`group flex min-h-[160px] flex-col justify-between rounded-2xl border p-5 text-left shadow-dashboard transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-2 ${active ? 'border-black bg-reference text-black' : 'border-brand bg-white text-black hover:bg-accent-tint hover:border-accent-border'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className={`text-[12px] font-semibold sm:text-[13px] ${active ? 'text-black/80' : 'text-black'}`}>{card.label}</span>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${active ? 'border-black/20 bg-black/10 text-black' : 'border-brand bg-white text-black'}`}><card.icon size={17} /></span>
            </div>
            <div className="display-font mt-3 text-[28px] font-extrabold tracking-tight">{currentStats[card.key] ?? '—'}</div>
            <div className={`mt-1 text-[11px] ${active ? 'text-black/70' : 'text-muted'}`}>{card.note}</div>
          </button>;
        })}
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display-font text-sm font-extrabold">RFQ register</h2>
          <p className="text-[11px] text-muted">Print or download the current filtered result set.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand bg-white p-1.5">
          <PrintButton label="Print register" tone="toolbar" className="!border-black !bg-reference !text-black hover:brightness-95 focus-visible:!ring-black" />
          <DownloadButton exportKey={REPORT.exportKey} format="pdf" params={listParams} label="PDF" tone="toolbar" />
          <DownloadButton exportKey={REPORT.exportKey} format="xlsx" params={listParams} label="Excel" tone="toolbar" />
          <DownloadButton exportKey={REPORT.exportKey} format="csv" params={listParams} label="CSV" tone="toolbar" />
        </div>
      </div>

      <PageCard title="Requests for quotation" description="All filters, sorting and pagination use registered RFQ records."
        action={<button type="button" onClick={refresh} disabled={listLoading}
          title="Refresh RFQs" aria-label="Refresh RFQs" aria-busy={listLoading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand bg-white text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>}>
        <div className="no-print border-b border-subtle bg-white px-4 py-3.5 sm:px-5">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-12">
            <FilterField label="RFQ reference" className="w-full xl:col-span-3">
              <input value={filters.reference} onChange={(event) => updateFilter('reference', event.target.value)}
                placeholder="e.g. RFQ-2026-ABC123" aria-label="RFQ reference" className="field h-9" />
            </FilterField>
            <FilterField label="Supplier" className="w-full xl:col-span-3">
              <input value={filters.supplier} onChange={(event) => updateFilter('supplier', event.target.value)}
                placeholder="Search invited supplier" aria-label="Supplier" className="field h-9" />
            </FilterField>
            <FilterField label="Purchase request" className="w-full xl:col-span-3">
              <input value={filters.requisition} onChange={(event) => updateFilter('requisition', event.target.value)}
                placeholder="Reference or title" aria-label="Purchase request" className="field h-9" />
            </FilterField>
            <FilterField label="RFQ status" className="w-full xl:col-span-3">
              <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}
                aria-label="RFQ status" className="field h-9">
                <option value="">All statuses</option>
                {RFQ_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </FilterField>
            <DateRangeFilter compact value={dateFilter} fields={REPORT.fields} onChange={updateDateFilter}
              label="RFQ dates" className="md:col-span-2 xl:col-span-8" />
            <div className="flex min-w-0 flex-wrap items-end gap-2 self-start md:col-span-2 xl:col-span-4">
              <label className="block min-w-0 shrink-0">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">Rows per page</span>
                <select value={filters.limit} onChange={(event) => updateFilter('limit', Number(event.target.value))}
                  className="field h-9 w-24 px-2.5 text-[11px]" aria-label="Rows per page">
                  {[10, 20, 50].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <button type="button" disabled={!hasFilters} onClick={clearFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand bg-white px-3 text-[11px] font-bold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40">
                <X size={13} />Clear Filters
              </button>
            </div>
          </div>
        </div>

        {listLoading && <LoadingState label="Loading RFQs…" />}
        {!listLoading && !rows.length && <div className="px-5 py-12 text-center">
          <FileText size={22} className="mx-auto text-muted" />
          <p className="mt-3 text-sm font-bold">No RFQs match the current filters.</p>
          <p className="mt-1 text-xs text-muted">Adjust the filters or create a new request for quotation.</p>
        </div>}
        {!listLoading && rows.length > 0 && (
          <TableScroll minWidth={1120} label="RFQ register table" className="rounded-xl border border-brand bg-white">
            <table className="w-full table-fixed border-collapse text-left text-[13px] text-ink">
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead className="bg-white">
                <tr className="border-b border-subtle">
                  <th scope="col" className={`${TABLE_HEADER_BASE} text-left`}>#</th>
                  <SortHeader label="RFQ Reference" sortKey="reference" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Related Request" sortKey="requisition" filters={filters} onSort={toggleSort} />
                  <SortHeader label="RFQ Date" sortKey="rfqDate" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Submission Deadline" sortKey="dueDate" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Suppliers Invited" sortKey="invitedSuppliers" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Responses Received" sortKey="quotations" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Status" sortKey="status" filters={filters} onSort={toggleSort} />
                  <th scope="col" className={`${TABLE_HEADER_BASE} sticky right-0 z-20 border-l border-subtle bg-white text-center`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rfq, index) => {
                  const issuedDate = rfq.issuedAt || rfq.createdAt;
                  const overdue = isOverdueRfq(rfq);
                  return <tr key={rfq.id} className="group border-b border-subtle transition-colors last:border-b-0 hover:bg-hover">
                    <td className={`${TABLE_CELL} whitespace-nowrap text-[11px] tabular-nums text-black/40`}>
                      {((pagination?.page || 1) - 1) * (pagination?.limit || filters.limit) + index + 1}
                    </td>
                    <td className={`${TABLE_CELL} min-w-0`}>
                      <span className="block max-w-[190px] truncate text-[12.5px] font-semibold tracking-[-0.01em] text-black" title={rfq.reference || ''}>
                        {rfq.reference || '—'}
                      </span>
                    </td>
                    <td className={`${TABLE_CELL} min-w-0`}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="block truncate text-[12px] font-semibold text-black" title={rfq.requisition || ''}>{rfq.requisition || '—'}</span>
                        <span className="block truncate text-[11px] leading-4 text-black/50" title={rfq.requisitionTitle || ''}>
                          {rfq.requisitionTitle || '—'}
                        </span>
                      </div>
                    </td>
                    <td className={`${TABLE_CELL} whitespace-nowrap text-[12px] tabular-nums text-black/70`}
                      title={issuedDate ? dateTimeLabel(issuedDate) : ''}>
                      {issuedDate ? dateLabel(issuedDate) : '—'}
                    </td>
                    <td className={TABLE_CELL}>
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums ${overdue ? 'font-semibold text-black' : 'text-black/70'}`}>
                        <span className={overdue ? 'border-b border-dashed border-black/60' : ''}
                          title={rfq.dueDate ? `Quotation due ${dateLabel(rfq.dueDate)}` : ''}>
                          {rfq.dueDate ? dateLabel(rfq.dueDate) : '—'}
                        </span>
                        {overdue && <Clock3 size={12} role="img" aria-label="Overdue" title="Overdue · quotation deadline has passed" className="text-black/60" />}
                      </span>
                    </td>
                    <td className={`${TABLE_CELL} text-center`}>
                      <CountIndicator value={rfq.invitedSuppliers} label="suppliers invited" />
                    </td>
                    <td className={`${TABLE_CELL} text-center`}>
                      <CountIndicator value={rfq.quotations} label="responses received" />
                    </td>
                    <td className={TABLE_CELL}>
                      <RfqStatusBadge status={rfq.status} />
                    </td>
                    <td className={`${TABLE_CELL} sticky right-0 z-10 whitespace-nowrap border-l border-subtle bg-white text-center transition-colors group-hover:bg-hover`}>
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => openDetail(rfq.id)} title="View RFQ" aria-label={`View RFQ ${rfq.reference}`}
                          className={ACTION_ICON_BUTTON}><Eye size={13} aria-hidden="true" /></button>
                        {canCreate && rfq.status === 'Draft' && <>
                          <button type="button" onClick={() => { openDetail(rfq.id); setEditOpen(true); }} title="Edit draft RFQ" aria-label={`Edit RFQ ${rfq.reference}`}
                            className={ACTION_ICON_BUTTON}><Pencil size={13} aria-hidden="true" /></button>
                          <button type="button" disabled={actionBusy} onClick={() => setConfirmAction({ type: 'send', rfq })} title="Send RFQ" aria-label={`Send RFQ ${rfq.reference}`}
                            className={`${ACTION_ICON_BUTTON} !bg-reference !text-black hover:brightness-95`}><Send size={13} aria-hidden="true" /></button>
                          <button type="button" onClick={() => setConfirmAction({ type: 'delete', rfq })} title="Delete draft RFQ" aria-label={`Delete draft RFQ ${rfq.reference}`}
                            className={ACTION_ICON_BUTTON}><Trash2 size={13} aria-hidden="true" /></button>
                        </>}
                        {canCreate && ['Sent', 'Evaluating'].includes(rfq.status) && <button type="button"
                          onClick={() => setConfirmAction({ type: 'close', rfq })} title="Close RFQ" aria-label={`Close RFQ ${rfq.reference}`}
                          className={ACTION_ICON_BUTTON}><XCircle size={13} aria-hidden="true" /></button>}
                        {rfq.status !== 'Draft' && <>
                          <button type="button" onClick={() => { openDetail(rfq.id); loadEmailStatus(rfq.id); }} title="Email status" aria-label={`Email status for ${rfq.reference}`}
                            className={ACTION_ICON_BUTTON}><Mail size={13} aria-hidden="true" /></button>
                          <button type="button" onClick={() => openDetail(rfq.id)} title="View quotations" aria-label={`View quotations for ${rfq.reference}`}
                            className={ACTION_ICON_BUTTON}><FileText size={13} aria-hidden="true" /></button>
                        </>}
                      </div>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        <Pagination pagination={pagination} onChange={(page) => updateFilter('page', page)} />
      </PageCard>
    </>}

    {createOpen && <RfqFormModal
      requisitions={requisitions} suppliers={suppliers} initialRequisitionId={initialRequisitionId || query.requisition}
      portalApi={portalApi} onClose={() => setCreateOpen(false)} onSubmit={createRfq} busy={busy}
    />}
    {editOpen && activeRfq && <RfqFormModal mode="edit" rfq={{
      ...activeRfq,
      suppliers: detail?.suppliers || [],
      items: detail?.items || []
    }} requisitions={requisitions} suppliers={suppliers} portalApi={portalApi}
      onClose={() => setEditOpen(false)} onSubmit={saveDraftChanges} busy={busy} />}
    {quoteOpen && activeRfq && <QuickQuoteForm rfq={activeRfq} suppliers={detail?.suppliers || []}
      onClose={() => setQuoteOpen(false)} busy={actionBusy}
      onSubmit={async (form) => {
        await runAction(() => onQuote(activeRfq.id, form), () => 'Quotation recorded.', () => setQuoteOpen(false), { rethrow: true });
      }} />}
    {activeQuote && <QuotationDialog quote={activeQuote} canAward={canAward} busy={actionBusy}
      onClose={() => setActiveQuote(null)} onAward={award} />}
    {compareOpen && <ComparisonDialog quotations={activeQuotations} onClose={() => setCompareOpen(false)} />}
    {confirmAction && <ConfirmDialog
      title={confirmAction.type === 'delete' ? 'Delete draft RFQ' : confirmAction.type === 'send' ? 'Send RFQ to suppliers' : 'Close RFQ'}
      message={confirmAction.type === 'delete'
        ? `Delete ${confirmAction.rfq.reference}? This destructive action removes the draft and its selected suppliers. It cannot be undone.`
        : confirmAction.type === 'send'
          ? `Send ${confirmAction.rfq.reference} to every selected supplier? Each supplier receives an individual email with a unique secure link. Provider acceptance is not confirmed inbox delivery.`
          : `Close ${confirmAction.rfq.reference}? Suppliers will no longer be able to submit quotations.`}
      confirmLabel={confirmAction.type === 'delete' ? 'Delete draft' : confirmAction.type === 'send' ? 'Send RFQ' : 'Close RFQ'}
      busy={actionBusy} onClose={() => setConfirmAction(null)} onConfirm={confirmSelected}
    />}
  </>;
}

function QuickQuoteForm({ rfq, suppliers, onClose, onSubmit, busy }) {
  const [form, setForm] = useState({
    supplierId: '', amount: '', deliveryDays: '7', qualityScore: '4', ratingScore: '4', notes: ''
  });
  const [localError, setLocalError] = useState('');
  async function submit(event) {
    event.preventDefault(); setLocalError('');
    try {
      await onSubmit({
        ...form,
        supplierId: Number(form.supplierId), amount: Number(form.amount),
        deliveryDays: Number(form.deliveryDays), qualityScore: Number(form.qualityScore),
        ratingScore: Number(form.ratingScore)
      });
    } catch (exception) { setLocalError(errorText(exception)); }
  }
  return <Modal size="md" title={`Record quotation · ${rfq.reference}`} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">Invited supplier
        <select required value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} className="field">
          <option value="">Select supplier…</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['amount', 'Quotation amount', '0.01', '0.01'],
          ['deliveryDays', 'Delivery days', '1', '1'],
          ['qualityScore', 'Quality score (0–5)', '0', '0.1'],
          ['ratingScore', 'Supplier rating (0–5)', '0', '0.1']
        ].map(([key, label, min, step]) => <label key={key} className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          {label}
          <input required type="number" min={min} max={key.includes('Score') ? '5' : undefined} step={step}
            value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="field" />
        </label>)}
      </div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">Evaluation notes
        <textarea rows="2" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}
          className="field h-auto py-2" />
      </label>
      {localError && <p role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs font-semibold text-black">{localError}</p>}
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className={secondaryBtn}><X size={14} />Cancel</button>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Save quotation
        </button>
      </div>
    </form>
  </Modal>;
}

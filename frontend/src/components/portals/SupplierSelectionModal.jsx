import { useMemo, useState } from 'react';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail, Search, Send, Users
} from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { EmptyState, ErrorMessage } from '../ui/PageCard.jsx';
import { dateLabel } from '../../utils/format.js';
import { formatRwf } from '../../utils/purchaseCalculations.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isInactive(supplier) {
  const status = String(supplier?.status || '').toLowerCase();
  return supplier?.isActive === false || ['inactive', 'disabled', 'suspended'].includes(status);
}

function eligibility(supplier) {
  if (!supplier?.id) return 'Inactive';
  if (isInactive(supplier)) return 'Inactive';
  if (!EMAIL_PATTERN.test(String(supplier.email || supplier.registeredEmail || supplier.contactEmail || '').trim())) {
    return 'No registered email';
  }
  return '';
}

function errorDetailsText(value) {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  return value.message || value.reason || JSON.stringify(value);
}

function decorated(supplier) {
  return {
    ...supplier,
    id: Number(supplier.id),
    name: supplier.name || supplier.supplierName || 'Unnamed supplier',
    email: supplier.email || supplier.registeredEmail || supplier.contactEmail || '',
    contact: supplier.contactName || supplier.contact || supplier.contactPerson || '—',
    status: isInactive(supplier) ? 'Inactive' : 'Active',
    reason: eligibility(supplier)
  };
}

export default function SupplierSelectionModal({ order, suppliers = [], onSend, onClose }) {
  const [stage, setStage] = useState('select');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [deadline, setDeadline] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const rows = useMemo(() => (Array.isArray(suppliers) ? suppliers : []).map(decorated), [suppliers]);
  const filtered = useMemo(() => rows.filter((supplier) => {
    if (statusFilter !== 'All' && supplier.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    return !term || `${supplier.name} ${supplier.email} ${supplier.contact}`.toLowerCase().includes(term);
  }), [rows, search, statusFilter]);
  const eligibleIds = filtered.filter((supplier) => !supplier.reason).map((supplier) => supplier.id);
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.includes(id));
  const chosen = rows.filter((supplier) => selected.includes(supplier.id));

  function toggle(id) {
    const supplier = rows.find((row) => row.id === id);
    if (!supplier || supplier.reason) return;
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setError('');
  }

  function selectAll() {
    setSelected((current) => [...new Set([...current, ...eligibleIds])]);
    setError('');
  }

  function deselectAll() {
    const filteredIds = new Set(filtered.map((supplier) => supplier.id));
    setSelected((current) => current.filter((id) => !filteredIds.has(id)));
  }

  function review() {
    if (!chosen.length) { setError('Select at least one registered supplier.'); return; }
    const invalid = chosen.find((supplier) => supplier.reason);
    if (invalid) { setError(`${invalid.name} cannot be invited: ${invalid.reason}.`); return; }
    setError('');
    setStage('confirm');
  }

  async function confirmSend() {
    if (!confirmed) { setError('Confirm that the selected suppliers should receive this request.'); return; }
    if (!onSend) { setError('Sending supplier requests is not available.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = {
        supplierIds: chosen.map((supplier) => supplier.id),
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(deadline ? { submissionDeadline: deadline } : {})
      };
      const response = await onSend(order, payload);
      setResult(response || {});
      setStage('result');
    } catch (exception) {
      setError(exception.message || 'The supplier requests could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const delivery = result?.emailDelivery || {};
  const missing = Array.isArray(delivery.missing) ? delivery.missing : [];
  const deliveries = Array.isArray(result?.deliveries) ? result.deliveries : [];
  const accepted = Number(delivery.accepted) || 0;
  const failed = Number(delivery.failed) || 0;

  return <Modal
    title={stage === 'result' ? 'Supplier pricing request' : 'Send to suppliers'}
    size="lg"
    onClose={onClose}
  >
    {stage === 'select' ? <div className="space-y-4">
      <section className="rounded-lg border border-brand bg-white p-4">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-black">Purchase order</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="display-font text-lg font-extrabold">{order?.reference || 'New purchase order'}</h3>
            <p className="mt-1 text-xs text-black">
              {order?.supplier || 'Supplier recorded on the order'} · Delivery {dateLabel(order?.deliveryDate)}
            </p>
          </div>
          <div className="text-right text-xs">
            <span className="block text-black">Total</span>
            <strong className="text-black">{formatRwf(order?.total)}</strong>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-black">Registered suppliers</h3>
            <p className="mt-1 text-[11px] text-black">Only active suppliers with a valid registered email can receive a pricing link.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Suppliers"
                aria-label="Search Suppliers" className="field w-52 pl-9" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter supplier status" className="field w-32">
              {['All', 'Active', 'Inactive'].map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand bg-white px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectAll} disabled={!eligibleIds.length} className="rounded-lg border border-brand bg-white px-3 py-1.5 font-bold text-black disabled:opacity-50">Select All</button>
            <button type="button" onClick={deselectAll} disabled={!selected.length} className="rounded-lg border border-brand bg-white px-3 py-1.5 font-bold text-black disabled:opacity-50">Deselect All</button>
          </div>
          <span className="inline-flex items-center gap-1.5 font-bold text-black"><Users size={14} />Selected Suppliers: {selected.length}</span>
        </div>

        {filtered.length ? <div className="mt-3 max-h-[42vh] overflow-auto rounded-lg border border-brand">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 bg-white text-[10px] uppercase text-black">
              <tr>{['', 'Supplier name', 'Registered email', 'Contact person', 'Supplier status'].map((heading) =>
                <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((supplier) => <tr key={supplier.id} className={supplier.reason ? 'opacity-70' : ''}>
                <td className="px-3 py-3">
                  <input type="checkbox" checked={selected.includes(supplier.id)} disabled={Boolean(supplier.reason)}
                    onChange={() => toggle(supplier.id)} aria-label={`Select ${supplier.name}`} className="h-4 w-4" />
                </td>
                <td className="px-3 py-3 font-bold">{supplier.name}</td>
                <td className="px-3 py-3">
                  <span className="break-all">{supplier.email || '—'}</span>
                  {supplier.reason === 'No registered email' && <span className="mt-1 block font-bold text-black">No registered email</span>}
                </td>
                <td className="px-3 py-3">{supplier.contact}</td>
                <td className="px-3 py-3">
                  <StatusBadge value={supplier.status} />
                  {supplier.reason === 'Inactive' && <span className="mt-1 block font-bold text-black">Inactive</span>}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div> : <EmptyState>No registered suppliers match your search.</EmptyState>}
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Cancel</button>
        <button type="button" onClick={review} disabled={!selected.length}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
          Review request <ArrowLeft size={14} className="rotate-180" />
        </button>
      </div>
    </div> : stage === 'confirm' ? <div className="space-y-4">
      <section className="rounded-lg border border-brand bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-black"><CheckCircle2 size={16} />Confirm before sending</h3>
        <p className="mt-2 text-xs leading-5 text-black">
          A private pricing link will be emailed to each registered supplier. Quoted prices stay visible to Procurement only.
        </p>
        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-[10px] text-black">Purchase order</dt><dd className="font-bold">{order?.reference || 'Assigned when saved'}</dd></div>
          <div><dt className="text-[10px] text-black">Suppliers selected</dt><dd className="font-bold">{chosen.length}</dd></div>
          <div><dt className="text-[10px] text-black">Total</dt><dd className="font-bold">{formatRwf(order?.total)}</dd></div>
          <div><dt className="text-[10px] text-black">Submission deadline</dt><dd className="font-bold">{deadline ? dateLabel(deadline) : 'Not configured'}</dd></div>
        </dl>
        <ul className="mt-3 space-y-1.5 rounded-lg border border-brand bg-white p-3 text-xs">
          {chosen.map((supplier) => <li key={supplier.id} className="flex flex-wrap justify-between gap-2 border-b border-subtle pb-1.5 last:border-0 last:pb-0">
            <span className="font-bold">{supplier.name}</span><span className="break-all text-black">{supplier.email}</span>
          </li>)}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">Submission deadline (optional)
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="field mt-1" />
        </label>
        <label className="flex items-start gap-2 text-xs font-semibold">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />
          I confirm these registered suppliers should receive a private pricing link for this purchase order.
        </label>
        <label className="block text-xs font-bold sm:col-span-2">Message to suppliers (optional)
          <textarea rows="3" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add any instructions for the suppliers…"
            className="field mt-1 h-auto py-2" />
        </label>
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={() => { setStage('select'); setError(''); }} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold disabled:opacity-50">Back</button>
        <button type="button" onClick={confirmSend} disabled={busy || !confirmed}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy ? 'Saving and sending…' : 'Confirm and send'}
        </button>
      </div>
    </div> : <div className="space-y-4">
      <section className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${missing.length || failed > 0 || accepted === 0
        ? 'border-brand bg-white text-black' : 'border-brand bg-white text-black'}`}>
        {missing.length || failed > 0 || accepted === 0
          ? <AlertCircle size={18} className="mt-0.5 shrink-0" />
          : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
        <div>
          <strong>{missing.length ? 'Pricing request saved, but messages were NOT delivered.' : failed > 0 ? 'Pricing request saved; some messages were NOT delivered.' : accepted > 0 ? 'Pricing request recorded.' : 'Pricing request saved; no emails were accepted.'}</strong>
          <p className="mt-1 text-xs leading-5">
            {missing.length
              ? 'Messages were NOT delivered. The email configuration is missing the variables below. Fix the configuration and retry from Supplier responses.'
              : failed > 0
                ? 'Some suppliers were not notified. Check the delivery details below and retry failed emails from Supplier responses.'
                : accepted > 0
                  ? `${accepted} supplier ${accepted === 1 ? 'message was' : 'messages were'} accepted for delivery.`
                  : 'No supplier message was accepted for delivery. Check the registered emails and email configuration.'}
          </p>
          {result?.message && <p className="mt-2 text-xs font-semibold">{result.message}</p>}
        </div>
      </section>

      <dl className="grid gap-3 rounded-lg border border-brand bg-white p-4 text-xs sm:grid-cols-3">
        <div><dt className="text-[10px] text-black">Request reference</dt><dd className="mt-1 break-all font-bold">{result?.reference || result?.requestId || '—'}</dd></div>
        <div><dt className="text-[10px] text-black">Accepted</dt><dd className="mt-1 font-bold">{accepted}</dd></div>
        <div><dt className="text-[10px] text-black">Failed</dt><dd className="mt-1 font-bold">{failed}</dd></div>
        <div><dt className="text-[10px] text-black">Total attempted</dt><dd className="mt-1 font-bold">{Number(delivery.total) || deliveries.length}</dd></div>
        <div><dt className="text-[10px] text-black">Skipped</dt><dd className="mt-1 font-bold">{Number(delivery.skipped) || 0}</dd></div>
      </dl>

      {missing.length > 0 && <section className="rounded-lg border border-brand bg-white p-4 text-xs text-black">
        <h4 className="flex items-center gap-2 font-extrabold"><Mail size={14} />Missing email variables</h4>
        <p className="mt-1">Messages were NOT delivered. The following variables are missing:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 font-bold">{missing.map((item, index) => <li key={`${item}-${index}`} className="break-all">{String(item)}</li>)}</ul>
      </section>}

      {deliveries.length > 0 && <section className="overflow-x-auto rounded-lg border border-brand">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-black">
            <tr>{['Supplier', 'Recipient', 'Email status', 'Status', 'Error'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {deliveries.map((item) => <tr key={item.id || item.supplierId}>
              <td className="px-3 py-3 font-bold">{item.supplierName || '—'}</td>
              <td className="px-3 py-3 break-all">{item.recipientEmail || '—'}</td>
              <td className="px-3 py-3"><StatusBadge value={item.emailStatus || item.status || 'Pending'} /></td>
              <td className="px-3 py-3">{item.status || '—'}</td>
              <td className="px-3 py-3 text-black">{errorDetailsText(item.errorDetails)}</td>
            </tr>)}
          </tbody>
        </table>
      </section>}

      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black">Done</button>
      </div>
    </div>}
  </Modal>;
}

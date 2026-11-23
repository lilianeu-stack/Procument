import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import PageCard, { EmptyState } from '../ui/PageCard.jsx';
import Modal from '../ui/Modal.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import { ErrorState, LoadingState } from './PortalUi.jsx';
import { api } from '../../services/api.js';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import {
  calculateSupplierTotals, configuredVatRate, roundMoney
} from '../../utils/purchaseCalculations.js';

const money = (value, code = 'RWF') => `${new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(roundMoney(value))} ${code || 'RWF'}`;

function friendlyError(exception) {
  if (exception?.status === 410) {
    return 'This pricing link has expired or was revoked by Procurement. Ask Procurement for a new link.';
  }
  if (exception?.status === 404) {
    return 'This pricing link is invalid or no longer exists. Check the link you received.';
  }
  return exception?.message || 'This pricing request could not be opened.';
}

function emptyForm() {
  return {
    items: {},
    quotationValidity: '',
    deliveryLeadTime: '',
    otherCharges: '0',
    comments: '',
    technicalRemarks: ''
  };
}

function formFromResponse(response, items) {
  const quoted = new Map((response?.items || []).map((item) => [
    Number(item.purchaseOrderItemId ?? item.id), item
  ]));
  const prices = {};
  (items || []).forEach((item) => {
    const id = Number(item.purchaseOrderItemId ?? item.id);
    const price = quoted.get(id)?.unitPrice;
    prices[id] = price === undefined || price === null ? '' : String(price);
  });
  return {
    items: prices,
    quotationValidity: response?.quotationValidity ?? '',
    deliveryLeadTime: response?.deliveryLeadTime ?? '',
    otherCharges: response?.otherCharges === undefined || response?.otherCharges === null
      ? '0' : String(response.otherCharges),
    comments: response?.comments || '',
    technicalRemarks: response?.technicalRemarks || ''
  };
}

function isLocked(request) {
  const status = String(request?.response?.status || '').toLowerCase();
  return Boolean(
    request?.pricingRequest?.isSubmitted
    || request?.response?.submittedAt
    || ['submitted', 'awarded', 'revoked', 'expired'].includes(status)
  );
}

export default function SupplierPricingPage({ token }) {
  const [request, setRequest] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitConfirmed, setSubmitConfirmed] = useState(false);
  const [locked, setLocked] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError('This supplier pricing link is missing its access token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api(`/supplier-pricing/${encodeURIComponent(token)}`);
      setRequest(response);
      setForm(formFromResponse(response.response, response.items));
      setLocked(isLocked(response));
    } catch (exception) {
      setError(friendlyError(exception));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (Array.isArray(request?.items) ? request.items : []), [request]);
  const currencyCode = request?.pricingRequest?.currency || 'RWF';
  const vatRate = Number(request?.pricingRequest?.vatRate ?? request?.response?.vatRate ?? configuredVatRate()) || 0;
  const otherCharges = Number(form.otherCharges) || 0;
  const quotedItems = useMemo(() => items.map((item) => ({
    ...item,
    unitPrice: form.items[Number(item.purchaseOrderItemId ?? item.id)] ?? ''
  })), [items, form.items]);
  const totals = useMemo(
    () => calculateSupplierTotals(quotedItems, vatRate, otherCharges),
    [quotedItems, vatRate, otherCharges]
  );

  function updatePrice(id, value) {
    setForm((current) => ({ ...current, items: { ...current.items, [id]: value } }));
    setValidationError('');
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError('');
  }

  function payload(allowBlank = false) {
    return {
      items: items.map((item) => {
        const id = Number(item.purchaseOrderItemId ?? item.id);
        const raw = form.items[id];
        const blank = raw === '' || raw === undefined || raw === null;
        return { purchaseOrderItemId: id, unitPrice: blank && allowBlank ? '' : Number(raw) };
      }),
      quotationValidity: String(form.quotationValidity || '').trim(),
      deliveryLeadTime: String(form.deliveryLeadTime || '').trim(),
      otherCharges: Number(form.otherCharges || 0),
      comments: String(form.comments || '').trim(),
      technicalRemarks: String(form.technicalRemarks || '').trim()
    };
  }

  function validate(requireAll = true) {
    if (!items.length) return 'There are no requested items to price.';
    for (const [index, item] of items.entries()) {
      const id = Number(item.purchaseOrderItemId ?? item.id);
      const raw = form.items[id];
      if (raw === '' || raw === undefined || raw === null) {
        if (requireAll) return `Enter a supplier unit price for item ${item.itemNo || index + 1}.`;
        continue;
      }
      const price = Number(raw);
      if (!Number.isFinite(price) || price < 0) {
        return `Enter a valid supplier unit price of 0 or more for item ${item.itemNo || index + 1}.`;
      }
    }
    if (!Number.isFinite(totals.subtotal) || !Number.isFinite(totals.vatAmount)
      || !Number.isFinite(totals.total) || totals.total < 0) {
      return 'The quotation totals could not be calculated. Check the entered prices.';
    }
    if (!Number.isFinite(otherCharges) || otherCharges < 0) {
      return 'Other charges must be a valid amount of zero or more.';
    }
    return '';
  }

  async function saveDraft() {
    const problem = validate(false);
    if (problem) { setValidationError(problem); return; }
    setBusy(true); setError(''); setValidationError(''); setNotice('');
    try {
      const response = await api(`/supplier-pricing/${encodeURIComponent(token)}/draft`, {
        method: 'PATCH',
        body: JSON.stringify(payload(true))
      });
      setRequest((current) => ({
        ...current,
        response: response.response || current?.response,
        pricingRequest: { ...(current?.pricingRequest || {}), isSubmitted: false }
      }));
      setNotice(response.message || 'Draft saved. You can return and complete your quotation later.');
    } catch (exception) {
      setError(friendlyError(exception));
    } finally {
      setBusy(false);
    }
  }

  async function submitQuotation() {
    const problem = validate();
    if (problem) { setSubmitOpen(false); setValidationError(problem); return; }
    setBusy(true); setError(''); setValidationError(''); setNotice('');
    try {
      const response = await api(`/supplier-pricing/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        body: JSON.stringify({ ...payload(), confirm: true })
      });
      setRequest((current) => ({
        ...current,
        response: response.response || current?.response,
        pricingRequest: { ...(current?.pricingRequest || {}), isSubmitted: true }
      }));
      setLocked(true);
      setSubmitOpen(false);
      setSubmitConfirmed(false);
      setNotice(response.message || 'Your quotation was submitted. Procurement will review it privately.');
    } catch (exception) {
      setError(friendlyError(exception));
    } finally {
      setBusy(false);
    }
  }

  const details = request?.pricingRequest || {};
  const organization = details.organization || {};
  const response = request?.response || {};

  return <div className="min-h-screen bg-canvas">
    <header className="no-print border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <BrandLogo />
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Supplier pricing portal</span>
          <PrintButton label="Print" />
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Private supplier response</p>
        <h1 className="display-font mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl">Purchase Order – Supplier Pricing Response</h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
          Enter your own prices for the requested items. Your response is visible to Procurement only.
        </p>
      </div>

      {loading && <PageCard title="Opening pricing request"><LoadingState label="Opening your pricing request…" /></PageCard>}
      {!loading && error && !request && <PageCard title="Pricing link"><ErrorState message={error} onRetry={load} /></PageCard>}
      {!loading && error && request && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{error}</div>}
      {validationError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{validationError}</div>}
      {notice && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{notice}</div>}
      {locked && <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>Your quotation was submitted{response.submittedAt ? ` on ${dateTimeLabel(response.submittedAt)}` : ''}. It is read-only while Procurement reviews it.</span>
      </div>}

      {!loading && request && <>
        <PageCard title="Purchase Order Details" description="Details of the request you are pricing.">
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Purchase order reference</dt><dd className="mt-1 text-sm font-extrabold">{details.purchaseOrderReference || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Request reference</dt><dd className="mt-1 text-sm font-bold">{details.reference || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Type</dt><dd className="mt-1 text-sm font-bold">{details.purchaseOrderType || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Date</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.date)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Delivery date</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.deliveryDate)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Submission deadline</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.submissionDeadline)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Requesting organization</dt>
              <dd className="mt-1 text-sm font-bold">{organization.name || '—'}</dd>
              {(organization.caption || organization.title) && <dd className="mt-0.5 text-xs text-muted">{[organization.caption, organization.title].filter(Boolean).join(' · ')}</dd>}
              {[organization.address, [organization.city, organization.country].filter(Boolean).join(', '),
                organization.phone, organization.email].filter(Boolean).map((value, index) =>
                <dd key={`organization-${index}`} className="mt-0.5 text-xs text-muted">{value}</dd>)}
            </div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Currency</dt><dd className="mt-1 text-sm font-bold">{details.currency || currencyCode}</dd></div>
            {details.message && <div className="sm:col-span-3 rounded-lg bg-emerald-50/60 p-4 text-xs leading-5 text-slate-700"><dt className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">Message from Procurement</dt><dd className="mt-1 whitespace-pre-wrap">{details.message}</dd></div>}
          </dl>
        </PageCard>

        <PageCard title="Supplier Information" description="Registered details for this pricing request.">
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Supplier name</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.name || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Contact person</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.contactName || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Email</dt><dd className="mt-1 break-all text-sm font-bold">{details.supplier?.email || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Address</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.address || '—'}</dd></div>
          </dl>
        </PageCard>

        <PageCard title="Requested Items" description="Enter your own unit prices. Requested quantities and descriptions cannot be changed.">
          {items.length ? <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>{['Item No.', 'Quantity', 'Unit', 'Description', 'Supplier Unit Price', 'Supplier Total Price'].map((heading) =>
                  <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {quotedItems.map((item, index) => {
                  const id = Number(item.purchaseOrderItemId ?? item.id);
                  const hasPrice = form.items[id] !== '' && form.items[id] !== undefined && form.items[id] !== null;
                  return <tr key={id || `item-${index}`} className="align-top">
                    <td className="px-4 py-3 font-bold">{item.itemNo ?? index + 1}</td>
                    <td className="px-4 py-3">{item.quantity}</td>
                    <td className="px-4 py-3">{item.unit || '—'}</td>
                    <td className="max-w-[320px] px-4 py-3 text-muted">{item.description || '—'}</td>
                    <td className="px-4 py-3">
                      {locked
                        ? <span className="font-bold">{item.unitPrice === '' ? '—' : money(item.unitPrice, currencyCode)}</span>
                        : <input type="number" min="0" step="0.01" inputMode="decimal" value={form.items[id] ?? ''}
                          onChange={(event) => updatePrice(id, event.target.value)} aria-label={`Supplier Unit Price for item ${item.itemNo || index + 1}`}
                          placeholder="0.00" className="field mt-0 w-32" />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold">{hasPrice ? money(totals.lines[index]?.lineTotal || 0, currencyCode) : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div> : <EmptyState>No requested items were supplied with this link.</EmptyState>}
        </PageCard>

        <PageCard title="Your Quotation" description="Your own prices only. These figures are never shared with other suppliers.">
          <div className="space-y-5 p-5">
            <dl className="grid gap-2 rounded-lg bg-slate-50 p-4 text-xs sm:max-w-md">
              <div className="flex justify-between"><dt className="text-muted">Your subtotal</dt><dd className="font-bold">{money(totals.subtotal, currencyCode)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">VAT ({vatRate}%)</dt><dd className="font-bold">{money(totals.vatAmount, currencyCode)}</dd></div>
              {otherCharges > 0 && <div className="flex justify-between"><dt className="text-muted">Other charges</dt><dd className="font-bold">{money(totals.otherCharges, currencyCode)}</dd></div>}
              <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="font-bold">Your total</dt><dd className="font-extrabold text-brand">{money(totals.total, currencyCode)}</dd></div>
            </dl>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-bold">Currency
                <input value={currencyCode} readOnly className="field mt-1" />
              </label>
              <label className="block text-xs font-bold">Other charges
                <input type="number" min="0" step="0.01" inputMode="decimal" value={form.otherCharges}
                  readOnly={locked} onChange={(event) => updateField('otherCharges', event.target.value)}
                  className="field mt-1" />
              </label>
              <label className="block text-xs font-bold">Quotation validity period
                <input value={form.quotationValidity} readOnly={locked} onChange={(event) => updateField('quotationValidity', event.target.value)}
                  placeholder="e.g. 30 days" className="field mt-1" />
              </label>
              <label className="block text-xs font-bold">Delivery lead time
                <input value={form.deliveryLeadTime} readOnly={locked} onChange={(event) => updateField('deliveryLeadTime', event.target.value)}
                  placeholder="e.g. 14 days" className="field mt-1" />
              </label>
              <label className="block text-xs font-bold sm:col-span-2">Pricing comments
                <textarea rows="3" value={form.comments} readOnly={locked} onChange={(event) => updateField('comments', event.target.value)}
                  placeholder="Explain any assumptions behind your prices…" className="field mt-1 h-auto py-2" />
              </label>
              <label className="block text-xs font-bold sm:col-span-2">Technical / commercial remarks (optional)
                <textarea rows="3" value={form.technicalRemarks} readOnly={locked} onChange={(event) => updateField('technicalRemarks', event.target.value)}
                  className="field mt-1 h-auto py-2" />
              </label>
            </div>

            {!locked && <div className="no-print flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={saveDraft} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save Draft
              </button>
              <button type="button" onClick={() => { const problem = validate(); if (problem) { setValidationError(problem); return; } setValidationError(''); setSubmitConfirmed(false); setSubmitOpen(true); }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                <Send size={14} />Submit Quotation
              </button>
            </div>}
            {response.status && <p className="text-[11px] text-muted">Response status: {response.status}</p>}
          </div>
        </PageCard>
      </>}
    </main>

    {submitOpen && <Modal title="Submit your quotation" onClose={() => setSubmitOpen(false)}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-brand/20 bg-brand/5 p-4 text-xs leading-5 text-slate-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-brand" />
          <p>Once submitted, your quotation becomes read-only. Make sure every unit price, your validity period and your delivery lead time are correct.</p>
        </div>
        <dl className="grid gap-2 rounded-lg bg-slate-50 p-4 text-xs sm:grid-cols-2">
          <div><dt className="text-[10px] text-muted">Supplier total</dt><dd className="font-extrabold text-brand">{money(totals.total, currencyCode)}</dd></div>
          <div><dt className="text-[10px] text-muted">Items priced</dt><dd className="font-bold">{items.length}</dd></div>
        </dl>
        <label className="flex items-start gap-2 text-xs font-semibold">
          <input type="checkbox" checked={submitConfirmed} onChange={(event) => setSubmitConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
          I confirm this is my final quotation for {details.purchaseOrderReference || 'this purchase order'}.
        </label>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={() => setSubmitOpen(false)} disabled={busy} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submitQuotation} disabled={busy || !submitConfirmed}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Submitting…' : 'Confirm and submit'}
          </button>
        </div>
      </div>
    </Modal>}
  </div>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save, Send } from 'lucide-react';
import PageCard, { EmptyState } from '../ui/PageCard.jsx';
import Modal from '../ui/Modal.jsx';
import PublicPrintToolbar from '../ui/PublicPrintToolbar.jsx';
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
  return { items: {}, comments: '' };
}

function formFromResponse(response, items) {
  // Prices already recorded on the purchase order are the supplier's starting
  // figures. They can be edited before the quotation is submitted.
  const quoted = new Map((response?.items || []).map((item) => [
    Number(item.purchaseOrderItemId ?? item.id), item
  ]));
  const prices = {};
  (items || []).forEach((item) => {
    const id = Number(item.purchaseOrderItemId ?? item.id);
    const price = quoted.get(id)?.unitPrice;
    prices[id] = price === undefined || price === null ? '' : String(price);
  });
  return { items: prices, comments: response?.comments || '' };
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
  // StrictMode and parent re-renders can run this effect more than once. Load
  // each token only once so the form never resets itself while being edited.
  const loadedTokenRef = useRef(null);
  const submitAttemptedRef = useRef(false);

  const load = useCallback(async (force = false) => {
    if (!token) {
      setError('This supplier pricing link is missing its access token.');
      setLoading(false);
      return;
    }
    if (!force && loadedTokenRef.current === token) return;
    loadedTokenRef.current = token;
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
  const quotedItems = useMemo(() => items.map((item) => ({
    ...item,
    unitPrice: form.items[Number(item.purchaseOrderItemId ?? item.id)] ?? ''
  })), [items, form.items]);
  const totals = useMemo(
    () => calculateSupplierTotals(quotedItems, vatRate, 0),
    [quotedItems, vatRate]
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
      comments: String(form.comments || '').trim()
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
    // A quotation can be submitted only once: block repeat clicks while the
    // request is in flight and after a successful submission.
    if (submitAttemptedRef.current || busy || locked) return;
    const problem = validate();
    if (problem) { setSubmitOpen(false); setValidationError(problem); return; }
    submitAttemptedRef.current = true;
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
      // A transport failure can be retried; a completed submission cannot.
      if (exception?.status === 409) setLocked(true);
      else submitAttemptedRef.current = false;
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
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black">Supplier pricing portal</span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      {details.reference && <PublicPrintToolbar
        title="Supplier pricing response"
        reference={details.reference}
        label="Print pricing response"
        note="Print the signed-link pricing request and your submitted prices for your records."
      />}
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-black">Private supplier response</p>
        <h1 className="display-font mt-1 text-2xl font-extrabold text-black sm:text-3xl">Purchase Order – Supplier Pricing Response</h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-black">
          Enter your own prices for the requested items. Your response is visible to Procurement only.
        </p>
      </div>

      {loading && <PageCard title="Opening pricing request"><LoadingState label="Opening your pricing request…" /></PageCard>}
      {!loading && error && !request && <PageCard title="Pricing link"><ErrorState message={error} onRetry={() => load(true)} /></PageCard>}
      {!loading && error && request && <div role="alert" className="rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black">{error}</div>}
      {validationError && <div role="alert" className="rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black">{validationError}</div>}
      {notice && <div className="flex items-start gap-2 rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{notice}</div>}
      {locked && <div className="flex items-start gap-2 rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>Your quotation was submitted{response.submittedAt ? ` on ${dateTimeLabel(response.submittedAt)}` : ''}. It is read-only while Procurement reviews it.</span>
      </div>}

      {!loading && request && <>
        <PageCard title="Purchase Order Details" description="Details of the request you are pricing.">
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Purchase order reference</dt><dd className="mt-1 text-sm font-extrabold">{details.purchaseOrderReference || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Request reference</dt><dd className="mt-1 text-sm font-bold">{details.reference || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Type</dt><dd className="mt-1 text-sm font-bold">{details.purchaseOrderType || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Date</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.date)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Delivery date</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.deliveryDate)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Submission deadline</dt><dd className="mt-1 text-sm font-bold">{dateLabel(details.submissionDeadline)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Requesting organization</dt>
              <dd className="mt-1 text-sm font-bold">{organization.name || '—'}</dd>
              {(organization.caption || organization.title) && <dd className="mt-0.5 text-xs text-black">{[organization.caption, organization.title].filter(Boolean).join(' · ')}</dd>}
              {[organization.address, [organization.city, organization.country].filter(Boolean).join(', '),
                organization.phone, organization.email].filter(Boolean).map((value, index) =>
                <dd key={`organization-${index}`} className="mt-0.5 text-xs text-black">{value}</dd>)}
            </div>
            {details.message && <div className="sm:col-span-3 rounded-lg border border-brand bg-white p-4 text-xs leading-5 text-black"><dt className="text-[10px] font-extrabold uppercase tracking-wide text-black">Message from Procurement</dt><dd className="mt-1 whitespace-pre-wrap">{details.message}</dd></div>}
          </dl>
        </PageCard>

        <PageCard title="Supplier Information" description="Registered details for this pricing request.">
          <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Supplier name</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.name || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Contact person</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.contactName || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Email</dt><dd className="mt-1 break-all text-sm font-bold">{details.supplier?.email || '—'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-wide text-black">Address</dt><dd className="mt-1 text-sm font-bold">{details.supplier?.address || '—'}</dd></div>
          </dl>
        </PageCard>

        <PageCard title="Requested Items" description="Enter your own unit prices. Requested quantities and descriptions cannot be changed.">
          {items.length ? <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black">
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
                    <td className="max-w-[320px] px-4 py-3 text-black">{item.description || '—'}</td>
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

        <PageCard title="Comments" description="Add any notes for Procurement about your prices.">
          <div className="space-y-4 p-5">
            <label className="block text-xs font-bold">Comments
              <textarea rows="3" value={form.comments} readOnly={locked} onChange={(event) => updateField('comments', event.target.value)}
                placeholder="Add a note about your prices…" className="field mt-1 h-auto py-2" />
            </label>

            {!locked && <div className="no-print flex flex-wrap gap-2 border-t border-subtle pt-4">
              <button type="button" onClick={saveDraft} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-brand px-4 py-2 text-xs font-bold disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save Draft
              </button>
              <button type="button" onClick={() => { const problem = validate(); if (problem) { setValidationError(problem); return; } setValidationError(''); setSubmitConfirmed(false); setSubmitOpen(true); }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
                <Send size={14} />Submit Quotation
              </button>
            </div>}
            {response.status && <p className="text-[11px] text-black">Response status: {response.status}</p>}
          </div>
        </PageCard>
      </>}
    </main>

    {submitOpen && <Modal title="Submit your quotation" onClose={() => setSubmitOpen(false)}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-brand bg-white p-4 text-xs leading-5 text-black">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-black" />
          <p>Once submitted, your quotation becomes read-only. Make sure every unit price is correct.</p>
        </div>
        <dl className="grid gap-2 rounded-lg border border-brand bg-white p-4 text-xs sm:grid-cols-2">
          <div><dt className="text-[10px] text-black">Supplier total</dt><dd className="font-extrabold text-black">{money(totals.total, currencyCode)}</dd></div>
          <div><dt className="text-[10px] text-black">Items priced</dt><dd className="font-bold">{items.length}</dd></div>
        </dl>
        <label className="flex items-start gap-2 text-xs font-semibold">
          <input type="checkbox" checked={submitConfirmed} onChange={(event) => setSubmitConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
          I confirm this is my final quotation for {details.purchaseOrderReference || 'this purchase order'}.
        </label>
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <button type="button" onClick={() => setSubmitOpen(false)} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submitQuotation} disabled={busy || !submitConfirmed}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Submitting…' : 'Confirm and submit'}
          </button>
        </div>
      </div>
    </Modal>}
  </div>;
}

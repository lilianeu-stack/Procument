import { useEffect, useMemo, useState } from 'react';
import { Award, Info, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import { EmptyState, ErrorMessage } from '../ui/PageCard.jsx';
import { api } from '../../services/api.js';
import { dateLabel } from '../../utils/format.js';
import { roundMoney } from '../../utils/purchaseCalculations.js';

const money = (value, currency = 'RWF') => `${new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(roundMoney(value))} ${currency || 'RWF'}`;

function itemFor(response, purchaseOrderItemId) {
  return (response?.items || []).find((item) => String(item.purchaseOrderItemId) === String(purchaseOrderItemId));
}

function finalTotal(response) {
  if (response?.total !== undefined && response?.total !== null) return Number(response.total) || 0;
  return roundMoney((Number(response?.subtotal) || 0)
    + (Number(response?.vatAmount) || 0)
    + (Number(response?.otherCharges) || 0));
}

export default function SupplierQuoteComparisonModal({
  requestId, columns = [], responses = [], onClose, onAward
}) {
  const supplied = (Array.isArray(columns) && columns.length > 0) || (Array.isArray(responses) && responses.length > 0);
  const [loading, setLoading] = useState(!supplied);
  const [error, setError] = useState('');
  const [comparison, setComparison] = useState({
    request: null,
    columns: Array.isArray(columns) ? columns : [],
    responses: Array.isArray(responses) ? responses : []
  });

  useEffect(() => {
    if (supplied) return;
    if (!requestId) { setError('No pricing request was selected for comparison.'); setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError('');
    api(`/purchase-order-pricing/requests/${requestId}/comparison`)
      .then((result) => {
        if (!active) return;
        setComparison({
          request: result.request || null,
          columns: Array.isArray(result.columns) ? result.columns : [],
          responses: Array.isArray(result.responses) ? result.responses : []
        });
      })
      .catch((exception) => { if (active) setError(exception.message || 'The comparison could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestId, supplied]);

  const rows = comparison.columns;
  const quotes = comparison.responses;
  const currencyCode = comparison.request?.currency || quotes[0]?.currency || 'RWF';

  const lowestUnit = useMemo(() => {
    const result = {};
    for (const row of rows) {
      const prices = quotes
        .map((response) => Number(itemFor(response, row.purchaseOrderItemId)?.unitPrice))
        .filter((value) => Number.isFinite(value));
      if (prices.length) result[row.purchaseOrderItemId] = Math.min(...prices);
    }
    return result;
  }, [rows, quotes]);

  const totals = useMemo(() => quotes.map((response) => finalTotal(response)), [quotes]);
  const lowestTotal = totals.length ? Math.min(...totals) : null;
  const lowestResponseIds = useMemo(() => new Set(
    quotes.filter((response, index) => totals[index] === lowestTotal).map((response) => Number(response.id))
  ), [quotes, totals, lowestTotal]);

  return <Modal title="Supplier quotation comparison" size="xl" onClose={onClose}>
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-black">Private procurement review</p>
          <h3 className="display-font mt-1 text-lg font-extrabold">{comparison.request?.reference || `Pricing request ${requestId || '—'}`}</h3>
          <p className="mt-1 text-xs text-muted">
            {comparison.request?.poReference || comparison.request?.purchaseOrderReference || 'Purchase order'}
            {comparison.request?.submissionDeadline ? ` · Deadline ${dateLabel(comparison.request.submissionDeadline)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton label="Print comparison" />
          <DownloadButton type="supplierQuoteComparison" id={requestId} format="pdf" label="Download PDF" />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-brand bg-white px-4 py-3 text-xs font-semibold text-black">
        <Info size={16} className="mt-0.5 shrink-0" />
        Comparison is advisory only. Procurement must make the award decision.
      </div>

      {loading && <div className="flex items-center gap-2 py-8 text-xs text-muted"><Loader2 size={14} className="animate-spin" />Loading comparison…</div>}
      <ErrorMessage>{error}</ErrorMessage>

      {!loading && !error && <section>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-black">Requested items · supplier prices</h4>
        {!rows.length || !quotes.length ? <EmptyState>No submitted quotations are available to compare yet.</EmptyState>
          : <div className="max-h-[45vh] overflow-auto rounded-lg border border-brand">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 bg-white text-[10px] uppercase text-muted">
                <tr>
                  <th className="px-3 py-3 font-bold">Item</th>
                  <th className="px-3 py-3 font-bold">Qty</th>
                  {quotes.map((response) => <th key={response.id} className="px-3 py-3 font-bold">
                    {response.supplierName || `Supplier ${response.supplierId}`}
                  </th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, rowIndex) => <tr key={row.purchaseOrderItemId || `row-${rowIndex}`} className="align-top">
                  <td className="px-3 py-3">
                    <div className="font-bold">{row.itemNo ? `${row.itemNo}. ` : ''}{row.itemName || 'Requested item'}</div>
                    {row.description && <div className="mt-0.5 max-w-[220px] text-[10px] text-muted">{row.description}</div>}
                    <div className="text-[10px] text-muted">{row.unit || 'unit'}</div>
                  </td>
                  <td className="px-3 py-3">{row.quantity}</td>
                  {quotes.map((response) => {
                    const item = itemFor(response, row.purchaseOrderItemId);
                    const price = Number(item?.unitPrice);
                    const hasPrice = Number.isFinite(price);
                    const isLowest = hasPrice && lowestUnit[row.purchaseOrderItemId] === price;
                    return <td key={response.id} className={`px-3 py-3 ${isLowest ? 'bg-white' : ''}`}>
                      <div className="font-bold">{hasPrice ? money(price, currencyCode) : '—'}</div>
                      <div className="mt-0.5 text-[10px] text-muted">Line: {hasPrice ? money(item?.lineTotal ?? roundMoney((Number(row.quantity) || 0) * price), currencyCode) : '—'}</div>
                      {isLowest && <span className="mt-1 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-black">Lowest</span>}
                    </td>;
                  })}
                </tr>)}
              </tbody>
            </table>
          </div>}
      </section>}

      {!loading && !error && quotes.length > 0 && <section>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-black">Supplier summary</h4>
        <div className="overflow-x-auto rounded-lg border border-brand">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-muted">
              <tr>{['Supplier', 'Status', 'Subtotal', 'VAT', 'Other', 'Final total', 'Lead time', 'Validity', 'Remarks', ''].map((heading) =>
                <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {quotes.map((response, index) => {
                const isLowest = lowestResponseIds.has(Number(response.id));
                return <tr key={response.id} className={isLowest ? 'bg-white' : ''}>
                  <td className="px-3 py-3 font-bold">{response.supplierName || `Supplier ${response.supplierId}`}</td>
                  <td className="px-3 py-3"><StatusBadge value={response.status || 'Submitted'} /></td>
                  <td className="px-3 py-3">{money(response.subtotal, currencyCode)}</td>
                  <td className="px-3 py-3">{money(response.vatAmount, currencyCode)}</td>
                  <td className="px-3 py-3">{money(response.otherCharges, currencyCode)}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-extrabold">
                    {money(totals[index], currencyCode)}
                    {isLowest && <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-black">Lowest</span>}
                  </td>
                  <td className="px-3 py-3">{response.deliveryLeadTime || '—'}</td>
                  <td className="px-3 py-3">{response.quotationValidity || '—'}</td>
                  <td className="max-w-[220px] px-3 py-3 text-muted">{[response.comments, response.technicalRemarks].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-3">
                    {onAward && ['submitted', 'delivered', 'opened'].includes(String(response.status || '').toLowerCase()) && !response.awarded
                      ? <button type="button" onClick={() => onAward(response)}
                        className="no-print inline-flex items-center gap-1 rounded-lg border border-brand bg-white px-2 py-1 text-[11px] font-bold text-black">
                        <Award size={12} />Award
                      </button>
                      : <span className="text-[10px] text-muted">{response.awarded ? 'Awarded' : '—'}</span>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>}

      <div className="flex justify-end border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Close</button>
      </div>
    </div>
  </Modal>;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Award, CheckCircle2, Eye, Loader2, MailWarning, RefreshCw, RotateCcw
} from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage } from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Modal from '../ui/Modal.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import SupplierQuoteComparisonModal from './SupplierQuoteComparisonModal.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import { roundMoney } from '../../utils/purchaseCalculations.js';

const money = (value, currency = 'RWF') => `${new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(roundMoney(value))} ${currency || 'RWF'}`;

const CLOSED_STATUSES = ['submitted', 'awarded', 'revoked', 'expired'];

function canRevoke(response) {
  if (!response?.id) return false;
  if (response.awarded) return false;
  return !CLOSED_STATUSES.includes(String(response.status || '').toLowerCase()) && !response.submittedAt;
}

function emailFailed(response) {
  const status = String(response?.emailStatus || '').toLowerCase();
  return Boolean(response?.emailError) || ['failed', 'failure', 'bounced', 'bounce', 'rejected', 'error'].includes(status);
}

function finalTotal(response) {
  return roundMoney((Number(response?.subtotal) || 0)
    + (Number(response?.vatAmount) || 0)
    + (Number(response?.otherCharges) || 0));
}

export default function SupplierResponsesPage({
  orders = [], rfqs = [], request = null, actions = {}, query = {}
}) {
  const availableOrders = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);
  const requestedId = Number(query.po || query.purchaseOrder || query.order);
  const firstId = availableOrders[0]?.id;
  const [poId, setPoId] = useState(
    Number.isInteger(requestedId) && requestedId > 0 ? requestedId : firstId || null
  );
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [quotation, setQuotation] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [awardTarget, setAwardTarget] = useState(null);
  const [awardComment, setAwardComment] = useState('');
  const [awardConfirmed, setAwardConfirmed] = useState(false);

  useEffect(() => {
    if (!poId && firstId) setPoId(firstId);
  }, [firstId, poId]);

  const load = useCallback(async () => {
    if (!poId) { setPayload(null); return; }
    if (!actions.getPurchaseOrderSupplierResponses) {
      setError('Loading supplier responses is not available.');
      return;
    }
    setLoading(true); setError('');
    try {
      const result = await actions.getPurchaseOrderSupplierResponses(poId);
      setPayload(result || { requests: [], responses: [] });
    } catch (exception) {
      setError(exception.message || 'Supplier responses could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [actions, poId]);

  useEffect(() => { load(); }, [load]);

  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const responses = Array.isArray(payload?.responses) ? payload.responses : [];
  const selectedOrder = availableOrders.find((order) => Number(order.id) === Number(poId)) || null;

  function performAction(message, task) {
    setBusy(true); setError(''); setNotice('');
    return Promise.resolve()
      .then(task)
      .then((result) => { setNotice(result?.message || message); return result; })
      .catch((exception) => { setError(exception.message || 'The request could not be completed.'); })
      .finally(() => setBusy(false));
  }

  async function revoke(response) {
    const result = await performAction('Pricing link revoked.', async () => {
      if (!actions.revokeSupplierPricingResponse) throw new Error('Revoking pricing links is not available.');
      return actions.revokeSupplierPricingResponse(response.id);
    });
    if (result) { setRevokeTarget(null); await load(); }
  }

  async function retry(requestRow) {
    await performAction('Failed emails are being retried.', async () => {
      if (!actions.retrySupplierPricingEmails) throw new Error('Retrying emails is not available.');
      return actions.retrySupplierPricingEmails(requestRow.id);
    });
    await load();
  }

  async function award() {
    if (!awardTarget || !awardConfirmed) return;
    const result = await performAction('Supplier awarded.', async () => {
      if (!actions.awardSupplierPricingResponse) throw new Error('Awarding a supplier is not available.');
      return actions.awardSupplierPricingResponse(awardTarget.requestId, {
        responseId: awardTarget.id,
        ...(awardComment.trim() ? { comment: awardComment.trim() } : {})
      });
    });
    if (result) {
      setAwardTarget(null); setAwardComment(''); setAwardConfirmed(false);
      setComparison(null);
      await load();
    }
  }

  const awardCurrency = awardTarget?.currency || 'RWF';

  return <div className="space-y-5">
    <PageCard
      title="Supplier responses"
      description="Private price responses, email delivery and award decisions for this purchase order."
      action={<label className="flex items-center gap-2 text-xs font-bold">
        Purchase order
        <select value={poId || ''} onChange={(event) => { setPoId(Number(event.target.value) || null); setPayload(null); }}
          className="field w-52" aria-label="Select purchase order">
          {!availableOrders.length && <option value="">No purchase orders yet</option>}
          {availableOrders.map((order) => <option key={order.id} value={order.id}>{order.reference}</option>)}
        </select>
      </label>}
    >
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {notice && <div className="px-4 pb-4"><p role="status" className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black"><CheckCircle2 size={14} />{notice}</p></div>}
      {loading && <div className="flex items-center gap-2 px-5 py-8 text-xs text-muted"><Loader2 size={14} className="animate-spin" />Loading supplier responses…</div>}
      {!loading && !error && !selectedOrder && <EmptyState>Create and send a purchase order to suppliers to see responses here.</EmptyState>}
      {!loading && !error && selectedOrder && !requests.length && !responses.length && <EmptyState>
        No pricing requests have been sent for {selectedOrder.reference}. Use “Send to Suppliers” on the purchase order to invite registered suppliers.
      </EmptyState>}

      {!loading && requests.length > 0 && <div className="space-y-5 p-5">
        {requests.map((requestRow) => {
          const rowResponses = responses.filter((response) => Number(response.requestId) === Number(requestRow.id));
          const failedCount = rowResponses.filter(emailFailed).length;
          return <section key={requestRow.id} className="overflow-hidden rounded-lg border border-brand">
            <header className="flex flex-wrap items-start justify-between gap-3 bg-white px-4 py-3">
              <div>
                <h4 className="text-sm font-extrabold">{requestRow.reference || `Pricing request ${requestRow.id}`}</h4>
                <p className="mt-1 text-[11px] text-muted">
                  PO {requestRow.poReference || selectedOrder?.reference || '—'}
                  {requestRow.rfqReference ? ` · RFQ ${requestRow.rfqReference}` : ''}
                  {requestRow.requisitionReference ? ` · Request ${requestRow.requisitionReference}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={requestRow.status || 'Sent'} />
                {failedCount > 0 && <button type="button" disabled={busy} onClick={() => retry(requestRow)}
                  className="no-print inline-flex items-center gap-1.5 rounded-lg border border-brand bg-white px-2.5 py-1.5 text-[11px] font-bold text-black disabled:opacity-50">
                  <RefreshCw size={12} />Retry failed emails ({failedCount})
                </button>}
                <button type="button" disabled={!rowResponses.length} onClick={() => setComparison({ requestId: requestRow.id })}
                  className="no-print inline-flex items-center gap-1.5 rounded-lg border border-brand bg-white px-2.5 py-1.5 text-[11px] font-bold text-black disabled:opacity-50">
                  Compare Quotations
                </button>
              </div>
            </header>
            <dl className="grid gap-3 border-b border-subtle px-4 py-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-[10px] uppercase text-muted">Currency</dt><dd className="font-bold">{requestRow.currency || 'RWF'}</dd></div>
              <div><dt className="text-[10px] uppercase text-muted">Submission deadline</dt><dd className="font-bold">{dateLabel(requestRow.submissionDeadline)}</dd></div>
              <div><dt className="text-[10px] uppercase text-muted">Created</dt><dd className="font-bold">{dateTimeLabel(requestRow.createdAt)}</dd></div>
              <div><dt className="text-[10px] uppercase text-muted">Awarded</dt>
                <dd className="font-bold">{requestRow.awardedAt ? `${dateLabel(requestRow.awardedAt)}${requestRow.awardComment ? ` · ${requestRow.awardComment}` : ''}` : '—'}</dd>
              </div>
              {requestRow.message && <div className="sm:col-span-4 rounded-lg border border-brand bg-white p-3 text-xs italic text-black">“{requestRow.message}”</div>}
            </dl>

            {!rowResponses.length ? <EmptyState>No supplier responses have arrived for this request yet.</EmptyState>
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-xs">
                  <thead className="bg-white text-[10px] uppercase text-muted">
                    <tr>{['Supplier', 'Email / delivery', 'Status', 'Submitted', 'Subtotal', 'VAT', 'Other', 'Final amount', 'Validity', 'Lead time', 'Actions'].map((heading) =>
                      <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {rowResponses.map((response) => {
                      const currencyCode = response.currency || requestRow.currency || 'RWF';
                      return <tr key={response.id} className="align-top">
                        <td className="px-3 py-3">
                          <div className="font-bold">{response.supplierName || `Supplier ${response.supplierId}`}</div>
                          {response.supplierContact && <div className="text-[10px] text-muted">{response.supplierContact}</div>}
                          {response.awarded && <span className="mt-1 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-black">Awarded</span>}
                        </td>
                        <td className="max-w-[220px] px-3 py-3">
                          <div className="break-all">{response.supplierEmail || '—'}</div>
                          <div className="mt-1"><StatusBadge value={response.emailStatus || 'Pending'} /></div>
                          {response.emailError && <div className="mt-1 flex items-start gap-1 text-[10px] text-black"><AlertCircle size={11} className="mt-0.5 shrink-0" />{response.emailError}</div>}
                          {response.sentAt && <div className="mt-1 text-[10px] text-muted">Sent {dateTimeLabel(response.sentAt)}</div>}
                        </td>
                        <td className="px-3 py-3"><StatusBadge value={response.status || 'Draft'} /></td>
                        <td className="px-3 py-3">{response.submittedAt ? dateTimeLabel(response.submittedAt) : '—'}</td>
                        <td className="px-3 py-3">{money(response.subtotal, currencyCode)}</td>
                        <td className="px-3 py-3">{money(response.vatAmount, currencyCode)}</td>
                        <td className="px-3 py-3">{money(response.otherCharges, currencyCode)}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-extrabold text-black">{money(finalTotal(response), currencyCode)}</td>
                        <td className="px-3 py-3">{response.quotationValidity || '—'}</td>
                        <td className="px-3 py-3">{response.deliveryLeadTime || '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            <button type="button" onClick={() => setQuotation(response)} className="no-print inline-flex items-center gap-1 rounded border border-brand px-2 py-1 text-black"><Eye size={12} />View Quotation</button>
                            <DownloadButton type="supplierPricingResponse" id={response.id} format="pdf" label="Download PDF" />
                            <PrintButton label="Print" />
                            <button type="button" onClick={() => setComparison({ requestId: response.requestId || requestRow.id })}
                              className="no-print rounded border border-brand bg-white px-2 py-1 font-bold text-black">Compare Quotations</button>
                            {canRevoke(response) && <button type="button" disabled={busy} onClick={() => setRevokeTarget(response)}
                              className="no-print inline-flex items-center gap-1 rounded border border-brand bg-white px-2 py-1 font-bold text-black disabled:opacity-50">
                              <RotateCcw size={12} />Revoke link
                            </button>}
                            {String(response.status || '').toLowerCase() === 'submitted' && !response.awarded && <button type="button" disabled={busy}
                              onClick={() => { setAwardTarget({ ...response, requestId: response.requestId || requestRow.id }); setAwardComment(''); setAwardConfirmed(false); }}
                              className="no-print inline-flex items-center gap-1 rounded bg-brand px-2 py-1 font-bold text-black disabled:opacity-50">
                              <Award size={12} />Award
                            </button>}
                          </div>
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>}
          </section>;
        })}
      </div>}
    </PageCard>

    {quotation && <Modal title={`Quotation · ${quotation.supplierName || 'Supplier'}`} size="xl" onClose={() => setQuotation(null)}>
      <div className="space-y-4">
        <div className="no-print flex flex-wrap justify-between gap-2">
          <PrintButton label="Print quotation" />
          <DownloadButton type="supplierPricingResponse" id={quotation.id} format="pdf" label="Download PDF" />
        </div>
        <dl className="grid gap-3 rounded-lg border border-brand bg-white p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[10px] text-muted">Supplier email</dt><dd className="break-all font-bold">{quotation.supplierEmail || '—'}</dd></div>
          <div><dt className="text-[10px] text-muted">Status</dt><dd><StatusBadge value={quotation.status || 'Draft'} /></dd></div>
          <div><dt className="text-[10px] text-muted">Submitted</dt><dd className="font-bold">{dateTimeLabel(quotation.submittedAt)}</dd></div>
          <div><dt className="text-[10px] text-muted">Email delivery</dt><dd className="font-bold">{quotation.emailStatus || '—'}{quotation.emailError ? ` · ${quotation.emailError}` : ''}</dd></div>
        </dl>
        <div className="overflow-x-auto rounded-lg border border-brand">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-muted">
              <tr>{['Item No.', 'Item', 'Quantity', 'Unit', 'Unit price', 'Line total'].map((heading) =>
                <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {(quotation.items || []).map((item, index) => <tr key={item.id || index}>
                <td className="px-3 py-3 font-bold">{item.itemNo ?? index + 1}</td>
                <td className="px-3 py-3">{item.itemName || '—'}<div className="text-[10px] text-muted">{item.description || ''}</div></td>
                <td className="px-3 py-3">{item.quantity ?? '—'}</td>
                <td className="px-3 py-3">{item.unit || '—'}</td>
                <td className="px-3 py-3">{money(item.unitPrice, quotation.currency || 'RWF')}</td>
                <td className="px-3 py-3 font-bold">{money(item.lineTotal, quotation.currency || 'RWF')}</td>
              </tr>)}
              {!quotation.items?.length && <tr><td colSpan={6} className="px-3 py-5 text-center text-muted">No priced lines were submitted.</td></tr>}
            </tbody>
          </table>
        </div>
        <dl className="grid gap-2 rounded-lg border border-brand bg-white p-4 text-xs sm:grid-cols-2">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-bold">{money(quotation.subtotal, quotation.currency || 'RWF')}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">VAT</dt><dd className="font-bold">{money(quotation.vatAmount, quotation.currency || 'RWF')}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Other charges</dt><dd className="font-bold">{money(quotation.otherCharges, quotation.currency || 'RWF')}</dd></div>
          <div className="flex justify-between"><dt className="font-bold">Final amount</dt><dd className="font-extrabold text-black">{money(finalTotal(quotation), quotation.currency || 'RWF')}</dd></div>
          <div><dt className="text-[10px] text-muted">Quotation validity</dt><dd className="font-bold">{quotation.quotationValidity || '—'}</dd></div>
          <div><dt className="text-[10px] text-muted">Delivery lead time</dt><dd className="font-bold">{quotation.deliveryLeadTime || '—'}</dd></div>
          {quotation.comments && <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Pricing comments</dt><dd className="whitespace-pre-wrap">{quotation.comments}</dd></div>}
          {quotation.technicalRemarks && <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Technical / commercial remarks</dt><dd className="whitespace-pre-wrap">{quotation.technicalRemarks}</dd></div>}
        </dl>
      </div>
    </Modal>}

    {revokeTarget && <Modal title="Revoke pricing link" onClose={() => setRevokeTarget(null)}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-brand bg-white p-4 text-xs text-black">
          <MailWarning size={18} className="mt-0.5 shrink-0" />
          <p>The private pricing link for <strong>{revokeTarget.supplierName || 'this supplier'}</strong> will stop working immediately. Any saved draft remains available to Procurement.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <button type="button" onClick={() => setRevokeTarget(null)} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => revoke(revokeTarget)} disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? 'Revoking…' : 'Revoke link'}
          </button>
        </div>
      </div>
    </Modal>}

    {awardTarget && <Modal title="Award supplier" onClose={() => setAwardTarget(null)}>
      <div className="space-y-4">
        <div className="rounded-lg border border-brand bg-white p-4 text-xs">
          <p className="font-bold text-black">Confirm the procurement award decision.</p>
          <p className="mt-2 leading-5 text-black">
            You are awarding <strong>{awardTarget.supplierName || 'this supplier'}</strong> with a final quoted amount of
            <strong> {money(finalTotal(awardTarget), awardCurrency)}</strong>. The lowest price is not selected automatically.
          </p>
        </div>
        <label className="block text-xs font-bold">Award comment (optional)
          <textarea rows="3" value={awardComment} onChange={(event) => setAwardComment(event.target.value)}
            placeholder="Record why this quotation was selected…" className="field mt-1 h-auto py-2" />
        </label>
        <label className="flex items-start gap-2 text-xs font-semibold">
          <input type="checkbox" checked={awardConfirmed} onChange={(event) => setAwardConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
          I confirm that Procurement has made this award decision.
        </label>
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <button type="button" onClick={() => setAwardTarget(null)} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button type="button" onClick={award} disabled={busy || !awardConfirmed}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
            {busy ? 'Awarding…' : 'Confirm award'}
          </button>
        </div>
      </div>
    </Modal>}

    {comparison && <SupplierQuoteComparisonModal
      requestId={comparison.requestId}
      columns={comparison.columns || []}
      responses={comparison.responses || []}
      onClose={() => setComparison(null)}
      onAward={(response) => {
        setComparison(null);
        setAwardTarget({ ...response, requestId: response.requestId || comparison.requestId });
        setAwardComment('');
        setAwardConfirmed(false);
      }}
    />}
  </div>;
}

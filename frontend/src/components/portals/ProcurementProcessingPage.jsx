import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  ErrorState, KeyValue, LoadingState, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { RFQForm, emailResultNotice } from '../../pages/RfqsPage.jsx';
import { currency, dateTimeLabel } from '../../utils/format.js';
import { RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';

export default function ProcurementProcessingPage({ data, query = {}, actions, portalApi, navigate }) {
  const requestId = Number(query.request || query.view);
  const validRequestId = Number.isInteger(requestId) && requestId > 0;
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!validRequestId) {
      setError('Open procurement processing from a department request document.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await portalApi.getReceivedRequest(requestId);
      setRequest(response.requisition);
    } catch (exception) {
      setError(exception.message || 'The department request could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, requestId, validRequestId]);

  useEffect(() => { load(); }, [load]);

  function backToDocument() {
    navigate(RECEIVED_REQUESTS_PAGE, validRequestId ? { view: requestId } : {});
  }

  async function createRfq(form) {
    const result = await actions.onCreateRFQ(form);
    setCreateOpen(false);
    setNotice(result.duplicate
      ? 'This RFQ was already created. No duplicate was made.'
      : emailResultNotice(result.emailDelivery));
  }

  return <div className="space-y-5">
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={backToDocument} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-brand">
        <ArrowLeft size={14} />Back to request document
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Procurement workflow</span>
        {request && <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass()}>
          <Plus size={14} />Create RFQ
        </button>}
      </div>
    </div>

    {notice && <div className="no-print rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</div>}
    {loading && !request ? <LoadingState label="Opening procurement workflow…" /> : null}
    {!loading && (error || !request) ? <>
      <ErrorState message={error} onRetry={load} />
      <button type="button" onClick={backToDocument} className={secondaryButtonClass()}>Back to Received Requests</button>
    </> : null}

    {request ? <PageCard title={`Processing ${request.reference}`} description={request.title}>
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Department">{request.department || '—'}</KeyValue>
        <KeyValue label="Request status"><StatusBadge value={request.status} /></KeyValue>
        <KeyValue label="Forwarded to procurement">{dateTimeLabel(request.forwardedAt)}</KeyValue>
        <KeyValue label="Estimated total">{currency(request.financials?.grandTotal ?? request.total)}</KeyValue>
      </div>
      <div className="border-t border-slate-100 px-5 py-3">
        <h3 className="text-[11px] font-extrabold uppercase tracking-[.12em] text-muted">
          Requested items ({(request.items || []).length})
        </h3>
        {(request.items || []).length ? <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5">Quantity</th>
                <th className="px-3 py-2.5">Unit</th>
                <th className="px-3 py-2.5">Unit cost</th>
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {request.items.map((item) => <tr key={item.id}>
                <td className="px-3 py-3 font-bold">{item.itemName}</td>
                <td className="px-3 py-3 text-muted">{item.description || '—'}</td>
                <td className="px-3 py-3 font-semibold">{item.quantity}</td>
                <td className="px-3 py-3">{item.unit || 'unit'}</td>
                <td className="px-3 py-3">{currency(item.estimatedUnitCost)}</td>
                <td className="px-3 py-3 text-right font-bold">{currency(item.lineTotal ?? Number(item.quantity) * Number(item.estimatedUnitCost))}</td>
              </tr>)}
            </tbody>
          </table>
          <div className="flex justify-end border-t border-slate-100 pt-3 text-sm font-extrabold">
            <span>Total</span><span className="ml-3 text-brand">{currency(request.financials?.grandTotal ?? request.total)}</span>
          </div>
        </div> : <p className="mt-2 text-xs text-muted">No items recorded.</p>}
      </div>
      <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-muted">
        Approvals and supporting documents remain available in the original document.
      </div>
    </PageCard> : null}

    {createOpen && request && <RFQForm
      suppliers={data.suppliers || []}
      initialRequisitionId={requestId}
      onClose={() => setCreateOpen(false)}
      onSubmit={createRfq}
    />}
  </div>;
}

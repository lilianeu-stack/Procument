import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Inbox, ShoppingCart } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  ErrorState, KeyValue, LoadingState, secondaryButtonClass
} from './PortalUi.jsx';
import RfqsPage from '../../pages/RfqsPage.jsx';
import PurchaseOrdersPage from '../../pages/PurchaseOrdersPage.jsx';
import SupplierResponsesPage from './SupplierResponsesPage.jsx';
import { currency, dateTimeLabel } from '../../utils/format.js';
import { PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';

const TABS = [
  { id: 'rfqs', label: 'RFQs', icon: FileText, hint: 'Invite suppliers, compare quotes and award.' },
  { id: 'purchase-orders', label: 'Purchase orders', icon: ShoppingCart, hint: 'Prepare, approve and receive orders for this request.' },
  { id: 'supplier-responses', label: 'Supplier responses', icon: Inbox, hint: 'Review private price responses and compare quotations.' }
];

// Continuation of one forwarded department request. It is deliberately not a
// sidebar destination: it reuses the existing RFQ and Purchase Order screens
// but scopes both to the selected requisition.
export default function ProcurementProcessingPage({
  data, query = {}, actions, portalApi, navigate, getPurchaseOrder, updatePurchaseOrder
}) {
  const requestId = Number(query.request || query.view);
  const validRequestId = Number.isInteger(requestId) && requestId > 0;
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const activeTab = query.tab === 'purchase-orders' || query.tab === 'supplier-responses'
    ? query.tab : 'rfqs';

  const scopedRfqs = useMemo(
    () => (data.rfqs || []).filter((rfq) => Number(rfq.requisitionId) === requestId),
    [data.rfqs, requestId]
  );
  const scopedQuotations = useMemo(() => {
    const rfqIds = new Set(scopedRfqs.map((rfq) => Number(rfq.id)));
    return (data.quotations || []).filter((quote) => rfqIds.has(Number(quote.rfqId)));
  }, [data.quotations, scopedRfqs]);
  const scopedOrders = useMemo(
    () => (data.purchaseOrders || []).filter((order) => Number(order.requisitionId) === requestId),
    [data.purchaseOrders, requestId]
  );
  const scopedRequisitions = useMemo(() => {
    const fromData = (data.requisitions || []).filter((row) => Number(row.id) === requestId);
    if (fromData.length) return fromData;
    return request ? [request] : [];
  }, [data.requisitions, request, requestId]);

  function backToDocument() {
    navigate(RECEIVED_REQUESTS_PAGE, validRequestId ? { view: requestId } : {});
  }

  function switchTab(tab) {
    navigate(PROCUREMENT_PROCESSING_PAGE, { request: requestId, tab });
  }

  const rfqActions = {
    onCreate: actions.onCreateRFQ,
    onLoadQuotes: actions.onLoadQuotes,
    onQuote: actions.onQuote,
    onAward: actions.onAward,
    onLoadEmailDeliveries: actions.onLoadEmailDeliveries,
    onRetryFailedEmails: actions.onRetryFailedEmails,
    onResendRfqEmail: actions.onResendRfqEmail
  };

  return <div className="space-y-5">
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={backToDocument} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-brand">
        <ArrowLeft size={14} />Back to request document
      </button>
      <span className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Procurement workflow</span>
    </div>

    {loading && !request ? <LoadingState label="Opening procurement workflow…" /> : null}
    {!loading && (error || !request) ? <>
      <ErrorState message={error} onRetry={load} />
      <button type="button" onClick={backToDocument} className={secondaryButtonClass()}>Back to Received Requests</button>
    </> : null}

    {request ? <>
      <PageCard
        title={`Processing ${request.reference}`}
        description={request.title}
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="Department">{request.department || '—'}</KeyValue>
          <KeyValue label="Request status"><StatusBadge value={request.status} /></KeyValue>
          <KeyValue label="Forwarded to procurement">{dateTimeLabel(request.forwardedAt)}</KeyValue>
          <KeyValue label="Estimated total">{currency(request.financials?.grandTotal ?? request.total)}</KeyValue>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-5 text-muted">
          Items, prices, supplier quotation history, approvals and the complete request history remain available in the
          original document. RFQs and purchase orders below are limited to this request.
        </div>
      </PageCard>

      <div role="tablist" aria-label="Procurement workflow sections" className="no-print flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon, hint }) => <button
          key={id} type="button" role="tab" aria-selected={activeTab === id}
          onClick={() => switchTab(id)}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-left text-xs font-bold transition ${activeTab === id ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-muted hover:border-brand hover:text-brand'}`}
        >
          <Icon size={15} />
          <span><span className="block">{label}</span><span className={`mt-0.5 block text-[10px] font-normal ${activeTab === id ? 'text-emerald-50' : 'text-muted'}`}>{hint}</span></span>
        </button>)}
      </div>

      {activeTab === 'rfqs' ? <RfqsPage
        rfqs={scopedRfqs}
        requisitions={scopedRequisitions}
        suppliers={data.suppliers || []}
        quotations={scopedQuotations}
        user={data.user}
        query={{}}
        initialRequisitionId={requestId}
        {...rfqActions}
      /> : activeTab === 'purchase-orders' ? <PurchaseOrdersPage
        orders={scopedOrders}
        rfqs={scopedRfqs}
        items={data.items || []}
        suppliers={data.suppliers || []}
        user={data.user}
        requisition={request ? { ...request, id: requestId } : { id: requestId, reference: '', items: [] }}
        onCreate={actions.onCreatePO}
        onDecision={actions.onPODecision}
        onReceive={actions.onReceivePO}
        getPurchaseOrder={getPurchaseOrder}
        updatePurchaseOrder={updatePurchaseOrder}
        loadApprovers={actions.getPurchaseOrderApprovers}
        onSendForApproval={actions.sendPurchaseOrderForApproval}
        onRevokeApproval={actions.revokePurchaseOrderApproval}
        sendPurchaseOrderToSuppliers={actions.sendPurchaseOrderToSuppliers}
      /> : <SupplierResponsesPage
        orders={scopedOrders}
        rfqs={scopedRfqs}
        request={request}
        actions={actions}
        portalApi={portalApi}
        query={query}
      />}
    </> : null}
  </div>;
}

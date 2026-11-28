import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import OverviewPage from './OverviewPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';
import InventoryPage from './InventoryPage.jsx';
import SuppliersPage from './SuppliersPage.jsx';
import ProcurementCommitteePage from './ProcurementCommitteePage.jsx';
import RfqsPage from './RfqsPage.jsx';
import PurchaseOrdersPage from './PurchaseOrdersPage.jsx';
import GoodsReceiptsPage from './GoodsReceiptsPage.jsx';
import InvoicesPage from './InvoicesPage.jsx';
import StoreRequestsPage from './StoreRequestsPage.jsx';
import { UsersPage } from './AdminPages.jsx';
import ReceivedRequests from '../components/portals/ReceivedRequests.jsx';
import ProcurementDocumentView from '../components/portals/ProcurementDocumentView.jsx';
import ProcurementProcessingPage from '../components/portals/ProcurementProcessingPage.jsx';
import PortalMessages from '../components/portals/PortalMessages.jsx';
import NotificationsPage from '../notifications/NotificationsPage.jsx';
import ReportToolbar from '../components/ui/ReportToolbar.jsx';
import {
  PROCUREMENT_COMMITTEE_PAGE, PROCUREMENT_PROCESSING_PAGE, PROFILE_PAGE, RECEIVED_REQUESTS_PAGE,
  roleLabel
} from '../utils/access.js';
import { reportForPage } from '../utils/reportFields.js';
import { SUPERVISOR_PENDING } from '../utils/status.js';
import PortalProfile from '../components/portals/PortalProfile.jsx';

const EmailInboxPage = lazy(() => import('./EmailInboxPage.jsx'));

// Page-local filters must travel with the report query. The list API and the
// export API therefore receive the same parameters for every admin register.
function baseReportParams(page, query = {}, data = {}) {
  const params = {};
  if (page === 'Requisitions' || page === 'Approvals') {
    if (data.search) params.search = data.search;
    if (page === 'Approvals') params.status = SUPERVISOR_PENDING;
  }
  if (page === 'Purchase orders') {
    if (query.status) params.statusGroup = query.status;
    if (query.request) params.requisitionId = query.request;
    if (query.rfq) params.rfqId = query.rfq;
  }
  if (page === 'Stock overview') {
    if (data.search) params.search = data.search;
    if (query.lowStock) params.lowStock = query.lowStock;
  }
  if (page === 'Suppliers' || page === PROCUREMENT_COMMITTEE_PAGE) {
    if (data.search) params.search = data.search;
  }
  return params;
}

export default function PageContent({
  page, data, query = {}, actions, portalApi, navigate, dateFilter, onDateFilterChange,
  getPurchaseOrder, updatePurchaseOrder, loading, counts, onOpenNotification
}) {
  const documentId = query.view || query.request;
  const report = reportForPage(page);
  const [localParams, setLocalParams] = useState({});
  useEffect(() => { setLocalParams({}); }, [page]);

  // ReceivedRequests and RFQs own their toolbars because their local filters,
  // sorting and pagination must be carried into the export request as well.
  const ownsToolbar = (page === RECEIVED_REQUESTS_PAGE && !documentId) || page === 'RFQs';
  const params = useMemo(
    () => ({ ...baseReportParams(page, query, data), ...localParams }),
    [page, query, data, localParams]
  );
  const reportUser = useMemo(() => data.user
    ? { name: data.user.name, roleLabel: roleLabel(data.user.role), department: data.user.department }
    : null, [data.user]);
  const toolbar = report && !documentId && !ownsToolbar
    ? <ReportToolbar
        report={report}
        dateFilter={dateFilter}
        onDateFilterChange={onDateFilterChange}
        params={params}
        user={reportUser}
      />
    : null;

  let content = null;
  if (page === 'Overview') {
    content = <OverviewPage
      dashboard={data.dashboard}
      role={data.user?.role}
      loading={loading}
      onNavigate={actions.onNavigate}
    />;
  } else if (page === PROFILE_PAGE) {
    content = <PortalProfile
      user={data.user}
      summary={data.portalSummary}
      portal="admin"
      onUpdated={actions.onProfileUpdated}
    />;
  } else if (page === 'Email Inbox') {
    content = <Suspense fallback={<div role="status" className="rounded-xl border border-slate-100 bg-white p-8 text-sm text-black">Loading email inbox…</div>}>
      <EmailInboxPage actions={actions} query={query} />
    </Suspense>;
  } else if (page === 'Messages') {
    content = <PortalMessages
      portal="admin"
      portalApi={portalApi}
      query={query}
      userId={data.user?.id}
      navigate={navigate}
      initial={data.portalExtras?.conversations}
    />;
  } else if (page === 'Notifications') {
    content = <NotificationsPage
      portal="admin"
      notifications={data.notifications}
      counts={counts}
      portalApi={portalApi}
      onOpenNotification={onOpenNotification}
      navigate={navigate}
    />;
  } else if (page === PROCUREMENT_PROCESSING_PAGE) {
    content = <ProcurementProcessingPage
      data={data} query={query} actions={actions} portalApi={portalApi} navigate={navigate}
      getPurchaseOrder={getPurchaseOrder} updatePurchaseOrder={updatePurchaseOrder}
    />;
  } else if (page === 'Requisitions' || page === 'Approvals') {
    content = <RequisitionsPage page={page} requisitions={data.requisitions} user={data.user} search={data.search} onCreate={actions.onCreateRequisition} onDecision={actions.onRequisitionDecision} />;
  } else if (page === RECEIVED_REQUESTS_PAGE) {
    // Notification links use `?request=<id>`; the in-app View uses `?view=<id>`.
    // Honour both so a copied notification link opens the full document directly.
    content = documentId
      ? <ProcurementDocumentView id={documentId} portalApi={portalApi} navigate={navigate} query={query} />
      : <ReceivedRequests
          portalApi={portalApi} query={query} navigate={navigate}
          initial={data.receivedRequests ? { requisitions: data.receivedRequests } : null}
          dateFilter={dateFilter} onDateFilterChange={onDateFilterChange}
        />;
  } else if (page === 'Stock overview' || page === 'Stock movements') {
    content = <InventoryPage page={page} items={data.items} movements={data.movements} user={data.user} search={data.search} query={query} onAddItem={actions.onAddItem} />;
  } else if (page === 'Suppliers') {
    content = <SuppliersPage
      suppliers={data.suppliers} user={data.user} search={data.search}
      onCreate={actions.onCreateSupplier} onUpdate={actions.onUpdateSupplier} onDelete={actions.onDeleteSupplier}
    />;
  } else if (page === PROCUREMENT_COMMITTEE_PAGE) {
    content = <ProcurementCommitteePage
      members={data.committeeMembers} search={data.search}
      onCreate={actions.onCreateCommitteeMember}
      onUpdate={actions.onUpdateCommitteeMember}
      onDelete={actions.onDeleteCommitteeMember}
    />;
  } else if (page === 'RFQs') {
    content = <RfqsPage
      rfqs={data.rfqs} requisitions={data.requisitions} suppliers={data.suppliers}
      quotations={data.quotations} user={data.user} query={query}
      initialRequisitionId={query.requisition} autoOpenCreate={Boolean(query.requisition)}
      committeeMembers={data.committeeMembers}
      onCreate={actions.onCreateRFQ} onLoadQuotes={actions.onLoadQuotes}
      onSendToCommittee={actions.onSendRfqToCommittee}
      onPreviewCommittee={actions.onPreviewCommittee}
      onLoadCommitteeReviews={actions.onLoadCommitteeReviews}
      onResendCommitteeReview={actions.onResendCommitteeReview}
      onQuote={actions.onQuote} onAward={actions.onAward}
      onLoadEmailDeliveries={actions.onLoadEmailDeliveries}
      onRetryFailedEmails={actions.onRetryFailedEmails}
      onResendRfqEmail={actions.onResendRfqEmail}
      listRfqs={actions.listRfqs}
      getRfqDetail={actions.getRfqDetail} onUpdateRFQ={actions.onUpdateRFQ}
      onDeleteRFQ={actions.onDeleteRFQ} onSendRFQ={actions.onSendRFQ}
      onCloseRFQ={actions.onCloseRFQ} navigate={navigate} portalApi={portalApi}
      dateFilter={dateFilter} onDateFilterChange={onDateFilterChange}
    />;
  } else if (page === 'Purchase orders') {
    content = <PurchaseOrdersPage orders={data.purchaseOrders} rfqs={data.rfqs} items={data.items}
      suppliers={data.suppliers} user={data.user} query={query} navigate={navigate}
      onCreate={actions.onCreatePO} onDecision={actions.onPODecision} onReceive={actions.onReceivePO}
      getPurchaseOrder={getPurchaseOrder} updatePurchaseOrder={updatePurchaseOrder}
      onSaveSignatures={actions.savePurchaseOrderSignatures}
      loadApprovers={actions.getPurchaseOrderApprovers}
      onLoadCommitteeRecommendations={actions.onLoadCommitteeRecommendations}
      onLoadQuotes={actions.onLoadQuotes}
      onSendForApproval={actions.sendPurchaseOrderForApproval}
      onRevokeApproval={actions.revokePurchaseOrderApproval}
      sendPurchaseOrderToSupplier={actions.sendPurchaseOrderToSupplier} />;
  } else if (page === 'Goods receipts') {
    content = <GoodsReceiptsPage
      user={data.user}
      sentSuppliers={data.grnSuppliers}
      onCreateSupplierGRN={actions.onCreateSupplierGRN}
      onSupplierDecision={actions.onSupplierDecision}
    />;
  } else if (page === 'Invoices') {
    content = <InvoicesPage invoices={data.invoices} orders={data.purchaseOrders} user={data.user} onCreate={actions.onCreateInvoice} onDecision={actions.onInvoiceDecision} />;
  } else if (page === 'Store requests') {
    content = <StoreRequestsPage requests={data.storeRequests} items={data.items} user={data.user} onCreate={actions.onCreateStoreRequest} onDecision={actions.onStoreDecision} onIssue={actions.onIssueStoreRequest} />;
  } else if (page === 'Users') {
    content = <UsersPage
      users={data.users}
      departments={data.departments}
      onCreateUser={actions.onCreateUser}
      onToggleUser={actions.onToggleUser}
      onCreateDepartment={actions.onCreateDepartment}
      onDepartmentUsers={actions.onDepartmentUsers}
      onUpdateDepartment={actions.onUpdateDepartment}
      onDeleteDepartment={actions.onDeleteDepartment}
      onUpdateUser={actions.onUpdateUser}
      onDeleteUser={actions.onDeleteUser}
      onResetPassword={actions.onResetPassword}
      onBulkValidate={actions.onBulkValidate}
      onBulkImport={actions.onBulkImport}
      onUserActivity={actions.onUserActivity}
      onReportFilters={setLocalParams}
    />;
  }

  return <>{toolbar}{content}</>;
}

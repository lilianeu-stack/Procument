import { lazy, Suspense } from 'react';
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
import ReportToolbar from '../components/ui/ReportToolbar.jsx';
import {
  PROCUREMENT_COMMITTEE_PAGE, PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE
} from '../utils/access.js';
import { reportForPage } from '../utils/reportFields.js';
import SettingsPage from '../components/portals/SettingsPage.jsx';
import { SETTINGS_PAGE } from '../utils/access.js';

const EmailInboxPage = lazy(() => import('./EmailInboxPage.jsx'));

export default function PageContent({
  page, data, query = {}, actions, portalApi, navigate, dateFilter, onDateFilterChange,
  getPurchaseOrder, updatePurchaseOrder, loading
}) {
  const documentId = query.view || query.request;
  const report = reportForPage(page);
  // ReceivedRequests and RFQs own their toolbars because their local filters,
  // sorting and pagination must be carried into the export request as well.
  const ownsToolbar = (page === RECEIVED_REQUESTS_PAGE && !documentId) || page === 'RFQs';
  const toolbar = report && !documentId && !ownsToolbar
    ? <ReportToolbar
        report={report}
        dateFilter={dateFilter}
        onDateFilterChange={onDateFilterChange}
        professionalActions={['Purchase orders', 'Goods receipts', 'Invoices', 'Suppliers', 'Stock overview', 'Stock movements', 'Store requests', 'Users'].includes(page)}
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
  } else if (page === SETTINGS_PAGE) {
    content = <SettingsPage actions={actions} />;
  } else if (page === 'Email Inbox') {
    content = <Suspense fallback={<div role="status" className="rounded-xl border border-slate-100 bg-white p-8 text-sm text-muted">Loading email inbox…</div>}>
      <EmailInboxPage actions={actions} query={query} />
    </Suspense>;
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
    content = <InventoryPage page={page} items={data.items} movements={data.movements} user={data.user} search={data.search} query={query} onAddItem={actions.onAddItem} onReceive={actions.onReceive} />;
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
      quotations={data.quotations} purchaseOrders={data.purchaseOrders} user={data.user} query={query}
      initialRequisitionId={query.requisition} autoOpenCreate={Boolean(query.requisition)}
      committeeMembers={data.committeeMembers}
      onCreate={actions.onCreateRFQ} onLoadQuotes={actions.onLoadQuotes}
      onCreatePO={actions.onCreatePO}
      onSendToCommittee={actions.onSendRfqToCommittee}
      onPreviewCommittee={actions.onPreviewCommittee}
      onLoadCommitteeReviews={actions.onLoadCommitteeReviews}
      onResendCommitteeReview={actions.onResendCommitteeReview}
      onQuote={actions.onQuote} onAward={actions.onAward}
      onLoadEmailDeliveries={actions.onLoadEmailDeliveries}
      onRetryFailedEmails={actions.onRetryFailedEmails}
      onResendRfqEmail={actions.onResendRfqEmail}
      listRfqs={actions.listRfqs} getRfqStats={actions.getRfqStats}
      getRfqDetail={actions.getRfqDetail} onUpdateRFQ={actions.onUpdateRFQ}
      onDeleteRFQ={actions.onDeleteRFQ} onSendRFQ={actions.onSendRFQ}
      onCloseRFQ={actions.onCloseRFQ} navigate={navigate} portalApi={portalApi}
    />;
  } else if (page === 'Purchase orders') {
    content = <PurchaseOrdersPage orders={data.purchaseOrders} rfqs={data.rfqs} items={data.items} user={data.user} query={query} navigate={navigate}
      onCreate={actions.onCreatePO} onDecision={actions.onPODecision} onReceive={actions.onReceivePO}
      getPurchaseOrder={getPurchaseOrder} updatePurchaseOrder={updatePurchaseOrder}
      loadApprovers={actions.getPurchaseOrderApprovers}
      onSendForApproval={actions.sendPurchaseOrderForApproval}
      onRevokeApproval={actions.revokePurchaseOrderApproval} />;
  } else if (page === 'Goods receipts') {
    content = <GoodsReceiptsPage receipts={data.goodsReceipts} />;
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
    />;
  }

  return <>{toolbar}{content}</>;
}

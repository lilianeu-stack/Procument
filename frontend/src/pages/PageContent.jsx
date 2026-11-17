import OverviewPage from './OverviewPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';
import InventoryPage from './InventoryPage.jsx';
import SuppliersPage from './SuppliersPage.jsx';
import RfqsPage from './RfqsPage.jsx';
import PurchaseOrdersPage from './PurchaseOrdersPage.jsx';
import GoodsReceiptsPage from './GoodsReceiptsPage.jsx';
import InvoicesPage from './InvoicesPage.jsx';
import StoreRequestsPage from './StoreRequestsPage.jsx';
import { AuditLogsPage, UsersPage } from './AdminPages.jsx';

export default function PageContent({ page, data, actions }) {
  if (page === 'Overview') return <OverviewPage dashboard={data.dashboard} onNavigate={actions.onNavigate} />;
  if (page === 'Requisitions' || page === 'Approvals') return <RequisitionsPage page={page} requisitions={data.requisitions} user={data.user} search={data.search} onCreate={actions.onCreateRequisition} onDecision={actions.onRequisitionDecision} />;
  if (page === 'Stock overview' || page === 'Stock movements') return <InventoryPage page={page} items={data.items} movements={data.movements} user={data.user} search={data.search} onAddItem={actions.onAddItem} onReceive={actions.onReceive} />;
  if (page === 'Suppliers') return <SuppliersPage suppliers={data.suppliers} user={data.user} search={data.search} onCreate={actions.onCreateSupplier} />;
  if (page === 'RFQs') return <RfqsPage rfqs={data.rfqs} requisitions={data.requisitions} suppliers={data.suppliers} quotations={data.quotations} user={data.user} onCreate={actions.onCreateRFQ} onLoadQuotes={actions.onLoadQuotes} onQuote={actions.onQuote} onAward={actions.onAward} />;
  if (page === 'Purchase orders') return <PurchaseOrdersPage orders={data.purchaseOrders} rfqs={data.rfqs} items={data.items} user={data.user} onCreate={actions.onCreatePO} onDecision={actions.onPODecision} onReceive={actions.onReceivePO} />;
  if (page === 'Goods receipts') return <GoodsReceiptsPage receipts={data.goodsReceipts} />;
  if (page === 'Invoices') return <InvoicesPage invoices={data.invoices} orders={data.purchaseOrders} user={data.user} onCreate={actions.onCreateInvoice} onDecision={actions.onInvoiceDecision} />;
  if (page === 'Store requests') return <StoreRequestsPage requests={data.storeRequests} items={data.items} user={data.user} onCreate={actions.onCreateStoreRequest} onDecision={actions.onStoreDecision} onIssue={actions.onIssueStoreRequest} />;
  if (page === 'Users') return <UsersPage users={data.users} departments={data.departments} onCreateUser={actions.onCreateUser} onToggleUser={actions.onToggleUser} onCreateDepartment={actions.onCreateDepartment} />;
  if (page === 'Audit logs') return <AuditLogsPage auditLogs={data.auditLogs} />;
  return null;
}

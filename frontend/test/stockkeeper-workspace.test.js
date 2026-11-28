import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STOCKKEEPER_PAGES } from '../src/utils/access.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const reports = read('../src/components/portals/StockKeeperInventoryReports.jsx');
const toolbar = read('../src/components/ui/ReportToolbar.jsx');
const sidebar = read('../src/components/portals/StockKeeperSidebar.jsx');
const portalFrame = read('../src/components/portals/PortalSidebarFrame.jsx');
const dashboard = read('../src/components/portals/StockKeeperDashboard.jsx');
const requests = read('../src/components/portals/StockKeeperSupervisorRequests.jsx');
const stockIn = read('../src/components/portals/StockKeeperStockIn.jsx');
const stockOut = read('../src/components/portals/StockKeeperStockOut.jsx');
const overview = read('../src/components/portals/StockKeeperStockOverview.jsx');
const binCards = read('../src/components/portals/StockKeeperBinCards.jsx');
const notificationsPage = read('../src/components/portals/StockKeeperNotifications.jsx');
const sharedNotifications = read('../src/notifications/NotificationsPage.jsx');
const detail = read('../src/components/portals/RequestDetail.jsx');
const supervisorSidebar = read('../src/components/portals/SupervisorSidebar.jsx');
const statusUtils = read('../src/utils/status.js');

const REPORT_KEYS = [
  ['stockkeeperStockIn', 'Stock In'],
  ['stockkeeperStockOut', 'Stock Out'],
  ['stockkeeperCurrentBalance', 'Current Stock Balance'],
  ['stockkeeperDepartmentStock', 'Department Stock'],
  ['stockkeeperStockMovement', 'Stock Movement'],
  ['stockkeeperLowStock', 'Low Stock'],
  ['stockkeeperDamagedGoods', 'Damaged / Rejected Goods'],
  ['stockkeeperSupplierDeliveries', 'Supplier Delivery / Receiving']
];

test('inventory reports expose all eight required registers with shared filters', () => {
  assert.ok(!reports.includes('eyebrow="Inventory reporting"'));
  assert.ok(!reports.includes('title="Inventory Reports"'));
  assert.ok(reports.includes('>Refresh</button>'), 'refresh action must remain');
  assert.ok(reports.includes('Report filters'), 'report filters must remain');
  assert.ok(reports.includes('<ReportToolbar'), 'report exports must remain');
  for (const [key, title] of REPORT_KEYS) {
    assert.ok(reports.includes(`key: '${key}', title: '${title}'`), `missing inventory report: ${title}`);
  }
  for (const filter of ['Report type', 'Department', 'Item', 'Transaction type', 'Year']) {
    assert.ok(reports.includes(`label="${filter}"`), `missing report filter: ${filter}`);
  }
  assert.match(reports, /getInventoryReport\(params\)/);
  assert.match(reports, /dateQueryForFilter/);
  assert.match(reports, /transactionTypes: \['Receipt', 'Issue', 'Adjustment'\]/);
});

test('print, PDF, Excel and CSV all use the same complete filtered rows', () => {
  assert.ok(toolbar.includes("'Print Register'"));
  for (const label of ['Download PDF', 'Download Excel', 'Download CSV']) {
    assert.ok(toolbar.includes(`label="${label}"`), `missing export control: ${label}`);
  }
  assert.match(toolbar, /const query = \{ \.\.\.dateQueryForFilter\(value\), \.\.\.params \}/);
  assert.match(toolbar, /fetchReportRows\(\{ key: report\.exportKey, params: query, reference \}\)/);
  for (const format of ['pdf', 'xlsx', 'csv']) {
    assert.match(toolbar, new RegExp(`format="${format}" params=\\{query\\}`));
  }
  assert.match(toolbar, /<ReportPrintTable[\s\S]*columns=\{printRows\.length \? Object\.keys\(printRows\[0\]\) : \[\]\}/);
});

test('App wires every redesigned Stock Keeper page and its portal APIs', () => {
  const pages = [
    'StockKeeperSupervisorRequests', 'StockKeeperStockOverview', 'StockKeeperStockIn',
    'StockKeeperStockOut', 'StockKeeperInventoryReports'
  ];
  for (const page of pages) {
    assert.ok(app.includes(`const ${page} = lazy(() => import('./components/portals/${page}.jsx'));`), `${page} must be lazily loaded`);
  }
  for (const page of ['Requests from Supervisors', 'Stock Overview', 'Stock In', 'Stock Out', 'Inventory Reports']) {
    assert.ok(app.includes(`activePage === '${page}'`), `${page} must have a route`);
  }
  for (const method of [
    'getRoutedRequests', 'getRoutedRequest', 'decideStockRequest', 'issueRequest',
    'reportStockShortage', 'getExpectedDeliveries', 'receiveAll', 'receiveItems',
    'getInventoryReport', 'updateStockLocation'
  ]) {
    assert.ok(app.includes(`${method}:`), `${method} must be available to the Stock Keeper workspace`);
  }
  assert.match(app, /<StockKeeperDashboard summary=\{data\.portalSummary\}/);
  assert.ok(STOCKKEEPER_PAGES.every((page) => app.includes(`'${page}'`)));
});

test('sidebar uses every canonical Stock Keeper page and every link can carry a real badge', () => {
  assert.match(sidebar, /STOCKKEEPER_PAGES\.map/);
  for (const page of STOCKKEEPER_PAGES) {
    const key = /^[A-Za-z]+$/.test(page) ? page : `'${page}'`;
    assert.ok(sidebar.includes(`${key}:`), `sidebar icon missing for ${page}`);
  }
  assert.match(portalFrame, /<SidebarBadge count=\{counts\[name\]\}/);
  assert.match(portalFrame, /relative flex min-h-10/);
  assert.match(dashboard, /stats\.pendingRequests/);
  assert.match(dashboard, /stats\.expectedDeliveries/);
  assert.match(dashboard, /summary\?\.requestsAwaitingAction/);
  assert.match(dashboard, /summary\?\.expectedDeliveries/);
  assert.match(dashboard, /stats\.unreadNotifications/);
});

test('Stock Keeper dashboard removes its heading while preserving dashboard content and notifications', () => {
  assert.ok(!dashboard.includes('eyebrow="Inventory operations"'));
  assert.ok(!dashboard.includes('title="Stock Keeper Dashboard"'));
  assert.ok(dashboard.includes('aria-label="Open notifications"'));
  assert.ok(dashboard.includes('Requests awaiting decision'));
  assert.ok(dashboard.includes('Recent stock-in transactions'));
});

test('stock workflows post decisions, receipts and issues instead of changing local state only', () => {
  assert.match(requests, /portalApi\.decideStockRequest\(decision\.requestId/);
  assert.match(requests, /comments: decision\.comments/);
  assert.match(requests, /reason: decision\.reason/);
  assert.match(requests, /portalApi\.reportStockShortage\(shortage\.requestId/);
  assert.match(requests, /detail\.request\?\.stockkeeperComments/);
  assert.match(stockIn, /portalApi\.receiveAll\(receipt\.purchaseOrderId, payload\)/);
  assert.match(stockIn, /portalApi\.receiveItems\(receipt\.purchaseOrderId, payload\)/);
  assert.match(stockIn, /deliveredQuantity: number\(line\.acceptedQuantity\) \+ number\(line\.rejectedQuantity\)/);
  assert.match(stockIn, /condition: line\.condition/);
  assert.match(stockOut, /portalApi\.issueRequest\(issue\.requestId/);
  assert.match(stockOut, /receivedBy: issue\.receivedBy/);
  assert.match(stockOut, /line\.authorizedQuantity/);
  assert.match(stockOut, /line\.remainingQuantity\), number\(line\.availableBalance\)/);
  assert.match(overview, /item\.openingBalance/);
  assert.match(overview, /item\.totalStockIn/);
  assert.match(overview, /item\.totalStockOut/);
  assert.match(overview, /item\.currentBalance/);
  assert.match(overview, /item\.storageLocation/);
});

test('Stock In removes its heading and summary cards while retaining the register and refresh', () => {
  assert.ok(!stockIn.includes('Receiving goods'));
  assert.ok(!stockIn.includes('title="Stock In"'));
  for (const summaryCard of ['Authorized deliveries', 'Units outstanding', 'Receipt rule', 'units expected']) {
    assert.ok(!stockIn.includes(summaryCard), `summary card should be removed: ${summaryCard}`);
  }
  assert.ok(stockIn.includes('Expected deliveries'), 'expected delivery register must remain');
  assert.ok(stockIn.includes('>Refresh</button>'), 'refresh action must remain');
});

test('Stock Out removes its heading while retaining the accepted requests register and refresh', () => {
  assert.ok(!stockOut.includes('Physical issue'));
  assert.ok(!stockOut.includes('title="Stock Out"'));
  assert.ok(stockOut.includes('>Refresh</button>'), 'refresh action must remain');
  assert.ok(stockOut.includes('Accepted requests ready for issue'), 'accepted requests register must remain');
});

test('Stock Overview removes its heading while preserving export and refresh actions', () => {
  assert.ok(!overview.includes('Stock workspace'));
  assert.ok(!overview.includes('title="Stock Overview"'));
  for (const action of ['label="Excel"', 'label="CSV"', '>Refresh</button>']) {
    assert.ok(overview.includes(action), `Stock Overview action should remain: ${action}`);
  }
  assert.ok(overview.includes('Current stock by Department and location'));
});

test('Bin Card list removes its heading while preserving transaction actions and ledger', () => {
  assert.ok(!binCards.includes('eyebrow="Inventory ledger"'));
  assert.ok(!binCards.includes('title="Bin Card"'));
  assert.ok(binCards.includes('<div className="mb-4 flex justify-end">{actions}</div>'));
  assert.ok(binCards.includes('<ReportToolbar'));
  assert.ok(binCards.includes('Inventory Items'));
});

test('Stock Keeper notifications uses the shared center without a duplicated heading', () => {
  assert.match(notificationsPage, /NotificationsPage/);
  assert.match(notificationsPage, /portal="stockkeeper"/);
  assert.match(notificationsPage, /id="stock-notification-type"/);
  assert.match(sharedNotifications, /title="All notifications"/);
  assert.match(sharedNotifications, />Mark all as read/);
  assert.match(sharedNotifications, /id=\{id\}/);
  assert.match(sharedNotifications, /\['unread', 'Unread'\]/);
  assert.match(sharedNotifications, /\['information', 'Information'\]/);
});

test('Supervisor request register shows every required column and all eight states', () => {
  assert.ok(!requests.includes('Stock keeper workspace'));
  assert.ok(!requests.includes('title="Requests from Supervisors"'));
  for (const action of ['>Requests</button>', '>List of Requesters</button>', '>Refresh</button>']) {
    assert.ok(requests.includes(action), `Supervisor request action should remain: ${action}`);
  }
  assert.ok(requests.includes('Supervisor request register'));
  for (const summaryCard of ['Awaiting decision', 'Decision rule', 'authorized for preparation']) {
    assert.ok(!requests.includes(summaryCard), `summary card should be removed: ${summaryCard}`);
  }
  for (const heading of [
    'Request Reference', 'Requester', 'Department', 'Request Date', 'Date Forwarded',
    'Items', 'Quantities', 'Available Stock', 'Supervisor', 'Comments', 'Status', 'Actions'
  ]) {
    assert.ok(requests.includes(`'${heading}'`), `missing register column: ${heading}`);
  }
  for (const state of [
    'New Request', 'Pending Stock Keeper Review', 'Accepted', 'Rejected',
    'Partially Issued', 'Issued', 'Completed', 'Returned to Supervisor'
  ]) {
    assert.ok(statusUtils.includes(`'${state}'`), `missing status label: ${state}`);
    assert.ok(new RegExp(`(?:'${state}'|${state}):\\s*'`).test(statusUtils), `missing status tone: ${state}`);
  }
  assert.match(requests, /statusTone\(group\.status\)/);
  assert.match(requests, /statusLabel\(group\.status\)/);
  assert.match(requests, /deriveGroupStatus\(group\)/);
  assert.match(requests, /loading \? <LoadingState label="Loading Supervisor requests/);
  assert.match(requests, /<ErrorState message=\{error\} onRetry=\{load\} \/>/);
  assert.match(requests, /<EmptyState title="No Supervisor requests"/);
});

test('register actions are limited to the state of the routed request', () => {
  assert.match(requests, /\['New Request', 'Pending Stock Keeper Review'\]\.includes\(group\.status\)/);
  assert.match(requests, /\['Accepted', 'Partially Issued'\]\.includes\(group\.status\)/);
  assert.match(requests, /Number\(line\.remainingQuantity\) > 0 && line\.itemId/);
  assert.match(requests, /Number\(line\.remainingQuantity\) > 0\)\s*\.map\(\(line\) => <button/);
  assert.doesNotMatch(requests, /group\.decision === 'Pending' && <>/);
});

test('Supervisor can send unmatched or insufficient stock to the Stock Keeper', () => {
  assert.match(detail, /!line\.matched[\s\S]{0,80}availableQuantity/);
  assert.doesNotMatch(detail, /canRouteToStock/);
  assert.match(detail, /Route every requested line/);
  assert.match(detail, /destination: routingChoice === 'procurement' \? 'Procurement' : partialRouting \? 'Split' : 'Stock Keeper'/);
  assert.match(detail, /role="status"/);
});

test('Supervisor sidebar exposes Approvals and notification links use canonical pages', () => {
  assert.ok(supervisorSidebar.includes('SUPERVISOR_PAGES[5]'), 'Approvals must be reachable from the Supervisor sidebar');
  assert.ok(supervisorSidebar.includes('ClipboardCheck'));
  assert.match(app, /const routedDestination = canonicalPage\(parsed\.page\) \|\| defaultPageForPortal\(parsed\.portal\)/);
  assert.match(app, /canAccessPage\(user\.role, routedDestination\)/);
  assert.doesNotMatch(app, /canAccessPage\(user\.role, parsed\.page \|\| defaultPageForPortal\(parsed\.portal\)\)/);
});

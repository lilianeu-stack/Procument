import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('one shared toolbar drives print, PDF, Excel and CSV from the same filtered query', () => {
  const toolbar = read('../src/components/ui/ReportToolbar.jsx');
  assert.match(toolbar, /const query = \{ \.\.\.dateQueryForFilter\(value\), \.\.\.params \}/);
  assert.match(toolbar, /fetchReportRows\(\{ key: report\.exportKey, params: query/);
  for (const format of ['pdf', 'xlsx', 'csv']) {
    assert.match(toolbar, new RegExp(`format="${format}" params=\\{query\\}`));
  }
  assert.match(toolbar, /PrintHeader title=\{report\.title\}/);
  assert.match(toolbar, /ReportPrintTable/);
});

test('every applicable admin register has a report definition and generic toolbar wiring', () => {
  const fields = read('../src/utils/reportFields.js');
  for (const key of [
    'requisitions', 'receivedRequests', 'rfqs', 'purchaseOrders', 'goodsReceipts',
    'invoices', 'storeRequests', 'inventory', 'inventoryMovements', 'suppliers',
    'users', 'committeeMembers'
  ]) {
    assert.match(fields, new RegExp(`exportKey: '${key}'`), `${key} is missing from the report map`);
  }

  const pageContent = read('../src/pages/PageContent.jsx');
  assert.match(pageContent, /<ReportToolbar[\s\S]*?report=\{report\}/);
  assert.match(pageContent, /params=\{params\}/);
  assert.match(pageContent, /user=\{reportUser\}/);
});

test('department portals expose the shared register actions', () => {
  const components = [
    'SupervisorRequesters.jsx', 'SupervisorRequests.jsx', 'SupervisorApprovals.jsx',
    'SupervisorStock.jsx', 'StockKeeperRequesters.jsx', 'StockKeeperBinCards.jsx'
  ];
  for (const name of components) {
    const source = read(`../src/components/portals/${name}`);
    assert.match(source, /<ReportToolbar/, `${name} is missing the shared toolbar`);
  }

  const history = read('../src/components/portals/StockKeeperRequesters.jsx');
  assert.match(history, /exportKey: 'stockkeeperTransactions'/);
  const binCards = read('../src/components/portals/StockKeeperBinCards.jsx');
  assert.match(binCards, /exportKey: 'stockkeeperItems'/);
  assert.match(binCards, /exportKey: 'stockkeeperBinCard'/);
});

test('RFQ detail modal exports the selected record in all formats', () => {
  const source = read('../src/pages/RfqsPage.jsx');
  for (const format of ['pdf', 'xlsx', 'csv']) {
    assert.match(source, new RegExp(`<DownloadButton type="rfq" id=\\{detailRfq\\.id\\} format="${format}"`));
  }
});

test('My Procurement Requests keeps its custom full-dataset print action', () => {
  const source = read('../src/components/portals/RequesterRequests.jsx');
  assert.match(source, /printLabel="Print My purchase requisitions"/);
  assert.match(source, /renderPrintTable=\{false\}/);
  assert.match(source, /fetchAllMatchingRows/);
});

test('signed-link pages are print-only and never call authenticated download APIs', () => {
  const pages = [
    'SupplierRfqPage.jsx', 'RequestResponsePage.jsx', 'CommitteeReviewPage.jsx',
    'SupplierPricingPage.jsx', 'PurchaseOrderApprovalPage.jsx'
  ];
  for (const name of pages) {
    const source = read(`../src/components/portals/${name}`);
    assert.match(source, /PublicPrintToolbar/, `${name} is missing the print action`);
    assert.doesNotMatch(source, /DownloadButton|downloadReport|downloadRecord/);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const sidebar = read('../src/components/portals/StockKeeperSidebar.jsx');
const page = read('../src/components/portals/StockKeeperDisplayBeforeDelivery.jsx');

test('Storekeeper sidebar exposes the exact Display before delivery label', () => {
  const access = read('../src/utils/access.js');
  assert.match(access, /'Display before delivery'/);
  assert.match(sidebar, /'Display before delivery': PackageCheck/);
});

test('App wires the pre-delivery page and its scoped API methods', () => {
  assert.match(app, /import StockKeeperDisplayBeforeDelivery from '\.\/components\/portals\/StockKeeperDisplayBeforeDelivery\.jsx'/);
  assert.match(app, /activePage === 'Display before delivery'/);
  assert.match(app, /getPurchaseOrderDeliveries: \(params = \{\}\) => api\(`\/portal\/stockkeeper\/deliveries\$\{toQuery\(params\)\}`\)/);
  assert.match(app, /acceptPurchaseOrderDelivery: async/);
  assert.match(app, /rejectPurchaseOrderDelivery: async/);
  assert.match(app, /\/deliveries\/\$\{id\}\/accept/);
  assert.match(app, /\/deliveries\/\$\{id\}\/reject/);
});

test('pre-delivery UI offers accept and reject only for pending items', () => {
  assert.match(page, /title="Display before delivery"/);
  assert.match(page, /row\.status === 'Pending'/);
  assert.match(page, /openDecision\(row, 'accept'\)/);
  assert.match(page, /openDecision\(row, 'reject'\)/);
  assert.match(page, /portalApi\.acceptPurchaseOrderDelivery\(decision\.row\.id/);
  assert.match(page, /portalApi\.rejectPurchaseOrderDelivery\(decision\.row\.id/);
  assert.match(page, /decision\.type === 'reject' && !trimmed/);
  assert.match(page, /Accepting this item creates a stock receipt/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPage, defaultPageForPortal, PORTALS } from '../src/utils/access.js';
import { buildRoute, parseRoute } from '../src/utils/routes.js';

test('supplier quotation links parse as their own public portal', () => {
  const route = parseRoute('#/supplier/RFQ?token=v1.payload.signature');
  assert.equal(route.portal, PORTALS.SUPPLIER);
  assert.equal(route.page, 'RFQ');
  assert.equal(route.query.token, 'v1.payload.signature');
  assert.equal(defaultPageForPortal(PORTALS.SUPPLIER), 'RFQ');
  assert.equal(canAccessPage('supplier', 'RFQ'), true);
  assert.equal(canAccessPage('requestor', 'RFQ'), false);
});

test('supplier links survive route building with a signed token', () => {
  const hash = buildRoute('supplier', 'RFQ', { token: 'v1.a.b-c_d' });
  assert.equal(hash, '#/supplier/RFQ?token=v1.a.b-c_d');
  assert.equal(parseRoute(hash).query.token, 'v1.a.b-c_d');
});

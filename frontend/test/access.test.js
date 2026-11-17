import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPage } from '../src/utils/access.js';

const roles = ['admin', 'requestor', 'approver', 'procurement', 'storekeeper', 'finance', 'committee'];
const sharedPages = ['Overview', 'Requisitions', 'Purchase orders', 'RFQs', 'Goods receipts', 'Invoices', 'Suppliers', 'Stock overview', 'Store requests'];

test('all configured roles can access shared procurement pages', () => {
  for (const role of roles) {
    for (const page of sharedPages) assert.equal(canAccessPage(role, page), true, `${role} should see ${page}`);
  }
});

test('restricted pages match the backend role policy', () => {
  assert.equal(canAccessPage('approver', 'Approvals'), true);
  assert.equal(canAccessPage('requestor', 'Approvals'), false);
  assert.equal(canAccessPage('storekeeper', 'Stock movements'), true);
  assert.equal(canAccessPage('finance', 'Stock movements'), false);
  assert.equal(canAccessPage('admin', 'Users'), true);
  assert.equal(canAccessPage('committee', 'Audit logs'), false);
});

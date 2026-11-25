import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPage, canonicalPage, COMMITTEE_REVIEW_PAGES, defaultPageForPortal, portalForRole, PORTALS,
  PROCUREMENT_COMMITTEE_PAGE, PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE, REQUESTER_PAGES, RESPONSE_PAGES,
  PURCHASE_ORDERS_PAGE, SETTINGS_PAGE, STOCKKEEPER_PAGES, SUPPLIER_PRICING_PAGES,
  SUPERVISOR_INCOMING_PAGE, SUPERVISOR_PAGES
} from '../src/utils/access.js';
import { parseRoute, readRouteFromLocation } from '../src/utils/routes.js';

const adminSideRoles = ['admin', 'approver', 'procurement', 'finance', 'committee'];
const sharedPages = ['Overview', 'RFQs', 'Goods receipts', 'Invoices', 'Suppliers', 'Stock overview', 'Store requests'];
const adminPortalRoles = ['admin', 'procurement'];
const hiddenAdminPages = ['Requisitions', 'Approvals', 'Audit logs'];

test('administrator-side roles can access shared procurement pages', () => {
  for (const role of adminSideRoles) {
    for (const page of sharedPages) assert.equal(canAccessPage(role, page), true, `${role} should see ${page}`);
  }
});

test('restricted pages match the backend role policy', () => {
  assert.equal(canAccessPage('approver', 'Approvals'), true);
  assert.equal(canAccessPage('storekeeper', 'Stock movements'), false);
  assert.equal(canAccessPage('finance', 'Stock movements'), false);
  assert.equal(canAccessPage('admin', 'Users'), true);
});

test('only administrators can access the Settings Center', () => {
  assert.equal(canAccessPage('admin', SETTINGS_PAGE), true);
  assert.equal(canAccessPage('procurement', SETTINGS_PAGE), false);
  assert.equal(canAccessPage('requestor', SETTINGS_PAGE), false);
  assert.equal(canAccessPage('supervisor', SETTINGS_PAGE), false);
});

test('removed administrator pages cannot be reached through direct routes', () => {
  for (const role of adminPortalRoles) {
    for (const page of hiddenAdminPages) {
      assert.equal(canAccessPage(role, page), false, `${role} must not reach ${page}`);
    }
  }
  // Department portals still own their own approval queue.
  assert.equal(canAccessPage('supervisor', 'Approvals'), true);
});

test('Overview can open the existing global purchase orders workspace', () => {
  assert.equal(canAccessPage('admin', PURCHASE_ORDERS_PAGE), true);
  assert.equal(canAccessPage('procurement', PURCHASE_ORDERS_PAGE), true);
  assert.equal(canAccessPage('approver', PURCHASE_ORDERS_PAGE), false);
  assert.equal(canAccessPage('finance', PURCHASE_ORDERS_PAGE), false);
});

test('public supplier pricing and purchase-order approval portals stay token-gated', () => {
  assert.equal(defaultPageForPortal(PORTALS.SUPPLIER_PRICING), 'Quote');
  for (const page of SUPPLIER_PRICING_PAGES) {
    assert.equal(canAccessPage(PORTALS.SUPPLIER_PRICING, page), true);
    assert.equal(canAccessPage('admin', page), false);
  }
  assert.equal(defaultPageForPortal(PORTALS.PURCHASE_ORDER_APPROVAL), 'Approval');
  assert.equal(canAccessPage(PORTALS.PURCHASE_ORDER_APPROVAL, 'Approval'), true);
  assert.equal(canAccessPage(PORTALS.PURCHASE_ORDER_APPROVAL, 'Overview'), false);
});

test('procurement processing is an internal workflow page opened by the admin shell', () => {
  assert.equal(canAccessPage('admin', PROCUREMENT_PROCESSING_PAGE), true);
  assert.equal(canAccessPage('procurement', PROCUREMENT_PROCESSING_PAGE), true);
  assert.equal(canAccessPage('approver', PROCUREMENT_PROCESSING_PAGE), false);
  assert.equal(canAccessPage('supervisor', PROCUREMENT_PROCESSING_PAGE), false);
  assert.equal(canAccessPage('requestor', PROCUREMENT_PROCESSING_PAGE), false);
});

test('Procurement Committee is restricted to administrators and procurement staff', () => {
  assert.equal(canAccessPage('admin', PROCUREMENT_COMMITTEE_PAGE), true);
  assert.equal(canAccessPage('procurement', PROCUREMENT_COMMITTEE_PAGE), true);
  assert.equal(canAccessPage('committee', PROCUREMENT_COMMITTEE_PAGE), false);
  assert.equal(canAccessPage('finance', PROCUREMENT_COMMITTEE_PAGE), false);
  assert.equal(canAccessPage('requestor', PROCUREMENT_COMMITTEE_PAGE), false);
});

test('portal roles can only open pages in their own portal', () => {
  for (const page of REQUESTER_PAGES) assert.equal(canAccessPage('requestor', page), true, `requestor should see ${page}`);
  for (const page of SUPERVISOR_PAGES) assert.equal(canAccessPage('supervisor', page), true, `supervisor should see ${page}`);

  assert.equal(canAccessPage('requestor', 'Overview'), false);
  assert.equal(canAccessPage('requestor', 'Users'), false);
  assert.equal(canAccessPage('requestor', 'Approvals'), false);
  assert.equal(canAccessPage('supervisor', 'Users'), false);
  assert.equal(canAccessPage('supervisor', 'My Procurement Requests'), false);
  assert.equal(canAccessPage('supervisor', 'Department Stock Overview'), true);
});

test('public requisition response links remain outside the staff portals', () => {
  const token = 'a'.repeat(32);
  const route = parseRoute(`#/response?token=${token}`);
  assert.equal(route.portal, PORTALS.RESPONSE);
  assert.equal(route.query.token, token);
  assert.equal(defaultPageForPortal(PORTALS.RESPONSE), 'Response');
  for (const page of RESPONSE_PAGES) assert.equal(canAccessPage('response', page), true);
  assert.equal(canAccessPage('response', 'Overview'), false);
  assert.equal(portalForRole('response'), null);
});

test('public committee decision links remain outside the staff portals', () => {
  const token = 'b'.repeat(64);
  const route = parseRoute(`#/committee-review/Review?token=${token}`);
  assert.equal(route.portal, PORTALS.COMMITTEE_REVIEW);
  assert.equal(route.query.token, token);
  assert.equal(defaultPageForPortal(PORTALS.COMMITTEE_REVIEW), 'Review');
  for (const page of COMMITTEE_REVIEW_PAGES) {
    assert.equal(canAccessPage(PORTALS.COMMITTEE_REVIEW, page), true);
  }
  assert.equal(canAccessPage(PORTALS.COMMITTEE_REVIEW, 'Overview'), false);
  assert.equal(portalForRole(PORTALS.COMMITTEE_REVIEW), null);

  const pathRoute = readRouteFromLocation({
    hash: '',
    pathname: '/committee-review',
    search: `?token=${token}`
  });
  assert.equal(pathRoute.portal, PORTALS.COMMITTEE_REVIEW);
  assert.equal(pathRoute.page, 'Review');
  assert.equal(pathRoute.query.token, token);
});

test('Stock Keepers have a dedicated portal with only its five pages', () => {
  assert.equal(portalForRole('storekeeper'), 'stockkeeper');
  assert.equal(defaultPageForPortal('stockkeeper'), 'Dashboard');
  assert.deepEqual(STOCKKEEPER_PAGES, ['Dashboard', 'List of Requesters', 'Notification', 'Bin Card', 'Profile']);
  for (const page of STOCKKEEPER_PAGES) {
    assert.equal(canAccessPage('storekeeper', page), true, `Stock Keeper should see ${page}`);
  }
  for (const page of ['Overview', 'Users', 'Approvals', 'Stock movements', 'Requesters', 'My Profile']) {
    assert.equal(canAccessPage('storekeeper', page), false, `Stock Keeper must not access ${page}`);
  }
});

test('supervisor incoming requests label resolves to the existing review queue', () => {
  assert.equal(canonicalPage(SUPERVISOR_INCOMING_PAGE), 'Approvals');
  assert.equal(canonicalPage('Supervisor Incoming Requests'), 'Approvals');
  assert.equal(canAccessPage('supervisor', SUPERVISOR_INCOMING_PAGE), true);
  assert.equal(canAccessPage('requestor', SUPERVISOR_INCOMING_PAGE), false);
});

test('procurement opens the administrator shell but only its permitted pages', () => {
  assert.equal(portalForRole('procurement'), 'admin');
  assert.equal(canAccessPage('procurement', RECEIVED_REQUESTS_PAGE), true);
  assert.equal(canAccessPage('admin', RECEIVED_REQUESTS_PAGE), true);
  assert.equal(canAccessPage('supervisor', RECEIVED_REQUESTS_PAGE), false);
  assert.equal(canAccessPage('requestor', RECEIVED_REQUESTS_PAGE), false);
  assert.equal(canAccessPage('procurement', 'Users'), false);
  assert.equal(canAccessPage('procurement', 'Audit logs'), false);
  assert.equal(canAccessPage('procurement', 'Approvals'), false);
});

test('approver, finance, and committee roles receive the Administrator-side portal', () => {
  for (const role of ['approver', 'finance', 'committee']) {
    assert.equal(portalForRole(role), 'admin');
    for (const page of sharedPages) assert.equal(canAccessPage(role, page), true);
    assert.equal(canAccessPage(role, 'Users'), false);
    assert.equal(canAccessPage(role, SETTINGS_PAGE), false);
    assert.equal(canAccessPage(role, RECEIVED_REQUESTS_PAGE), false);
  }
  assert.equal(canAccessPage('approver', 'Approvals'), true);
  assert.equal(canAccessPage('finance', 'Approvals'), false);
  assert.equal(canAccessPage('committee', 'Approvals'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canAccessPage, canonicalPage, defaultPageForPortal, portalForRole, PROCUREMENT_PROCESSING_PAGE,
  PROFILE_PAGE, PURCHASE_ORDERS_PAGE, RECEIVED_REQUESTS_PAGE, REQUESTER_PAGES, SETTINGS_PAGE,
  STOCKKEEPER_PAGES, SUPERVISOR_INCOMING_PAGE, SUPERVISOR_PAGES
} from '../src/utils/access.js';

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

test('the Administrator Settings page is no longer a user-facing route', () => {
  for (const role of ['admin', 'procurement', 'approver', 'requestor', 'supervisor', 'storekeeper']) {
    assert.equal(canAccessPage(role, SETTINGS_PAGE), false, `${role} must not open the retired Settings page`);
  }
});

test('every authenticated role has a personal Profile page', () => {
  for (const role of ['admin', 'procurement', 'approver', 'finance', 'committee', 'supervisor', 'requestor', 'storekeeper']) {
    assert.equal(canAccessPage(role, PROFILE_PAGE), true, `${role} should see Profile`);
  }
  assert.equal(canonicalPage('My Profile'), PROFILE_PAGE);
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

test('procurement processing is an internal workflow page opened by the admin shell', () => {
  assert.equal(canAccessPage('admin', PROCUREMENT_PROCESSING_PAGE), true);
  assert.equal(canAccessPage('procurement', PROCUREMENT_PROCESSING_PAGE), true);
  assert.equal(canAccessPage('approver', PROCUREMENT_PROCESSING_PAGE), false);
  assert.equal(canAccessPage('supervisor', PROCUREMENT_PROCESSING_PAGE), false);
  assert.equal(canAccessPage('requestor', PROCUREMENT_PROCESSING_PAGE), false);
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

test('Stock Keepers have a dedicated portal with only its five pages', () => {
  assert.equal(portalForRole('storekeeper'), 'stockkeeper');
  assert.equal(defaultPageForPortal('stockkeeper'), 'Dashboard');
  assert.deepEqual(STOCKKEEPER_PAGES, ['Dashboard', 'List of Requesters', 'Notification', 'Bin Card', 'Profile']);
  for (const page of STOCKKEEPER_PAGES) {
    assert.equal(canAccessPage('storekeeper', page), true, `Stock Keeper should see ${page}`);
  }
  for (const page of ['Overview', 'Users', 'Approvals', 'Stock movements', 'Requesters', SETTINGS_PAGE]) {
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

test('each portal sidebar has one Profile link and Administrator has no Settings link', () => {
  const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
  const admin = read('../src/components/layout/Sidebar.jsx');
  assert.match(admin, /PROFILE_PAGE/);
  assert.doesNotMatch(admin, /SETTINGS_PAGE|icon: Settings/);

  const requester = read('../src/components/portals/RequesterSidebar.jsx');
  const stockkeeper = read('../src/components/portals/StockKeeperSidebar.jsx');
  const supervisor = read('../src/components/portals/SupervisorSidebar.jsx');
  assert.match(requester, /PROFILE_PAGE/);
  assert.match(stockkeeper, /Profile: UserRound/);
  assert.match(supervisor, /SUPERVISOR_PAGES\[9\]/);
  assert.ok(SUPERVISOR_PAGES.includes(PROFILE_PAGE));
  assert.ok(REQUESTER_PAGES.includes(PROFILE_PAGE));
  assert.ok(STOCKKEEPER_PAGES.includes(PROFILE_PAGE));
});

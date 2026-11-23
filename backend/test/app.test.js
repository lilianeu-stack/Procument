import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool, { applySchemaMigrations } from '../src/config/db.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-characters';
const PASSWORD = 'QaPortalTest!2026';
let server;
let baseUrl;
let admin;
let departments;
let users;
const createdUserIds = [];
const createdDepartmentIds = [];
const createdRequisitionIds = [];
const createdItemIds = [];
const createdMovementIds = [];
const createdStoreRequestIds = [];
const createdRfqIds = [];
const createdPurchaseOrderIds = [];
const createdSupplierIds = [];

function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

async function request(path, { method = 'GET', user, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function binaryRequest(path, user) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}
  });
  return { response, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function createDepartment(name) {
  const [result] = await pool.execute('INSERT INTO departments (name, description) VALUES (?, ?)', [name, 'QA portal test department']);
  createdDepartmentIds.push(Number(result.insertId));
  return { id: Number(result.insertId), name };
}

async function createUser(name, email, role, departmentId, active = true) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password_hash, role, department_id, active) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, passwordHash, role, departmentId, active]
  );
  createdUserIds.push(Number(result.insertId));
  return { id: Number(result.insertId), name, email, role, departmentId, active };
}

async function submitRequest(user, suffix, extra = {}) {
  const response = await request('/portal/requester/requisitions', {
    method: 'POST',
    user,
    body: {
      title: `QA workflow request ${suffix}`,
      justification: 'Replace worn-out department equipment.',
      budgetCode: `QA-${suffix}`,
      priority: 'High',
      action: 'submit',
      items: [{ itemName: `QA item ${suffix}`, description: 'Test line', quantity: 2, unit: 'unit', estimatedUnitCost: 25 }],
      ...extra
    }
  });
  if (response.response.status === 201) createdRequisitionIds.push(response.data.id);
  return response;
}

async function createInventoryItem(name, quantity, reorderLevel = 2) {
  const sku = `QA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const [result] = await pool.execute(
    `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level)
     VALUES (?, ?, ?, 'QA', 'unit', ?, ?)`,
    [departments.a.id, sku, name, quantity, reorderLevel]
  );
  createdItemIds.push(Number(result.insertId));
  return { id: Number(result.insertId), sku, name };
}

async function createApprovedStoreRequest(itemId, requester, quantity, suffix) {
  const reference = `QA-SR-${Date.now()}-${suffix}`;
  const [result] = await pool.execute(
    `INSERT INTO store_requests
       (reference, requester_id, department_id, purpose, status, approved_at)
     VALUES (?, ?, ?, 'QA stock issue', 'Approved', UTC_TIMESTAMP())`,
    [reference, requester.id, requester.departmentId]
  );
  const id = Number(result.insertId);
  createdStoreRequestIds.push(id);
  await pool.execute(
    'INSERT INTO store_request_items (store_request_id, item_id, quantity) VALUES (?, ?, ?)',
    [id, itemId, quantity]
  );
  return { id, reference };
}

before(async () => {
  await applySchemaMigrations();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const [admins] = await pool.execute("SELECT id, name, email, role FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1");
  assert.ok(admins.length, 'An active admin account is required for portal API tests.');
  admin = admins[0];

  const stamp = Date.now();
  departments = {
    a: await createDepartment(`QA Dept A ${stamp}`),
    b: await createDepartment(`QA Dept B ${stamp}`)
  };
  users = {
    supervisorA: await createUser('QA Supervisor A', `qa.supervisor.a.${stamp}@example.org`, 'supervisor', departments.a.id),
    requesterA: await createUser('QA Requester A', `qa.requester.a.${stamp}@example.org`, 'requestor', departments.a.id),
    supervisorB: await createUser('QA Supervisor B', `qa.supervisor.b.${stamp}@example.org`, 'supervisor', departments.b.id),
    requesterB: await createUser('QA Requester B', `qa.requester.b.${stamp}@example.org`, 'requestor', departments.b.id),
    requesterInactive: await createUser('QA Inactive Requester', `qa.requester.inactive.${stamp}@example.org`, 'requestor', departments.b.id, false),
    procurement: await createUser('QA Procurement', `qa.procurement.${stamp}@example.org`, 'procurement', null),
    stockkeeper: await createUser('QA Stock Keeper', `qa.stockkeeper.${stamp}@example.org`, 'storekeeper', departments.a.id),
    roleChange: await createUser('QA Role Change', `qa.role.change.${stamp}@example.org`, 'requestor', departments.a.id),
    legacy: await createUser('QA Legacy Role', `qa.legacy.${stamp}@example.org`, 'approver', departments.a.id)
  };
});

after(async () => {
  const departmentIds = createdDepartmentIds.length ? createdDepartmentIds : [0];
  await pool.execute(
    `DELETE ma FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
      WHERE m.department_id IN (${departmentIds.map(() => '?').join(',')})`,
    departmentIds
  );
  await pool.execute(
    `DELETE mr FROM message_recipients mr JOIN messages m ON m.id = mr.message_id
      WHERE m.department_id IN (${departmentIds.map(() => '?').join(',')})`,
    departmentIds
  );
  await pool.execute(`DELETE FROM messages WHERE department_id IN (${departmentIds.map(() => '?').join(',')})`, departmentIds);
  if (createdMovementIds.length) {
    const placeholders = createdMovementIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM inventory_movement_attachments WHERE movement_id IN (${placeholders})`, createdMovementIds);
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'inventory_movement' AND entity_id IN (${placeholders})`,
      createdMovementIds.map(String)
    );
    await pool.execute(`DELETE FROM inventory_movements WHERE id IN (${placeholders})`, createdMovementIds);
  }
  if (createdStoreRequestIds.length) {
    const placeholders = createdStoreRequestIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM store_request_items WHERE store_request_id IN (${placeholders})`, createdStoreRequestIds);
    await pool.execute(`DELETE FROM store_requests WHERE id IN (${placeholders})`, createdStoreRequestIds);
  }
  if (createdUserIds.length) {
    await pool.execute(`DELETE FROM notifications WHERE user_id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
  }
  if (createdRequisitionIds.length) {
    const placeholders = createdRequisitionIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM requisition_attachments WHERE requisition_id IN (${placeholders})`, createdRequisitionIds);
    await pool.execute(`DELETE FROM requisition_activity WHERE requisition_id IN (${placeholders})`, createdRequisitionIds);
    await pool.execute(`DELETE FROM requisition_items WHERE requisition_id IN (${placeholders})`, createdRequisitionIds);
  }
  if (createdPurchaseOrderIds.length) {
    const placeholders = createdPurchaseOrderIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (${placeholders})`, createdPurchaseOrderIds);
    await pool.execute(`DELETE FROM purchase_orders WHERE id IN (${placeholders})`, createdPurchaseOrderIds);
  }
  if (createdRfqIds.length) {
    await pool.execute(`DELETE FROM rfqs WHERE id IN (${createdRfqIds.map(() => '?').join(',')})`, createdRfqIds);
  }
  if (createdSupplierIds.length) {
    await pool.execute(`DELETE FROM suppliers WHERE id IN (${createdSupplierIds.map(() => '?').join(',')})`, createdSupplierIds);
  }
  if (createdRequisitionIds.length) {
    const placeholders = createdRequisitionIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM requisitions WHERE id IN (${placeholders})`, createdRequisitionIds);
  }
  if (createdItemIds.length) {
    await pool.execute(`DELETE FROM items WHERE id IN (${createdItemIds.map(() => '?').join(',')})`, createdItemIds);
  }
  if (createdUserIds.length) {
    await pool.execute(`DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds.map(String));
    await pool.execute(`DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
  }
  if (createdDepartmentIds.length) {
    await pool.execute(`DELETE FROM audit_logs WHERE entity_type = 'department' AND entity_id IN (${createdDepartmentIds.map(() => '?').join(',')})`, createdDepartmentIds.map(String));
    await pool.execute(`DELETE FROM departments WHERE id IN (${createdDepartmentIds.map(() => '?').join(',')})`, createdDepartmentIds);
  }
  if (server?.listening) {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await closed;
  }
  await pool.end();
});

test('health endpoint is public and reports database availability', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const result = await response.json();
  assert.ok([200, 503].includes(response.status));
  assert.equal(result.success, response.status === 200);
  assert.equal(result.application, 'Procurement Management System');
  assert.equal(result.server, 'running');
  assert.equal(result.database, response.status === 200 ? 'connected' : 'disconnected');
  assert.equal(result.environment, process.env.NODE_ENV || 'development');
  assert.ok(Number.isFinite(Date.parse(result.timestamp)));
  assert.ok(Number.isFinite(result.uptime));
});

test('protected API rejects requests without a token', async () => {
  const { response, data } = await request('/auth/me');
  assert.equal(response.status, 401);
  assert.equal(data.message, 'Sign in to continue.');
});

test('login returns the portal derived from the database role and department', async () => {
  for (const [key, expectedPortal] of [
    ['supervisorA', 'supervisor'], ['requesterA', 'requester'],
    ['supervisorB', 'supervisor'], ['requesterB', 'requester'],
    ['stockkeeper', 'stockkeeper']
  ]) {
    const user = users[key];
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: PASSWORD })
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.message);
    assert.equal(result.user.portal, expectedPortal);
    assert.equal(result.user.departmentId, user.departmentId);
    assert.ok(!('role' in JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString())),
      'The JWT must not carry a trusted role claim.');
  }
});

test('administrator creates assigned Stock Keeper accounts and login resolves the dedicated portal', async () => {
  const email = `qa.stockkeeper.unassigned.${Date.now()}@example.org`;
  const payload = {
    name: 'QA New Stock Keeper', email, password: PASSWORD, role: 'storekeeper'
  };
  const missingDepartment = await request('/admin/users', { method: 'POST', user: admin, body: payload });
  assert.equal(missingDepartment.response.status, 400);
  assert.match(missingDepartment.data.message, /Stock Keeper.*Department/i);

  const created = await request('/admin/users', {
    method: 'POST', user: admin, body: { ...payload, departmentId: departments.a.id }
  });
  assert.equal(created.response.status, 201, created.data.message);
  createdUserIds.push(created.data.id);
  assert.equal(created.data.role, 'storekeeper');
  assert.equal(created.data.departmentId, departments.a.id);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const result = await login.json();
  assert.equal(login.status, 200, result.message);
  assert.equal(result.user.portal, 'stockkeeper');
  assert.equal(result.user.roleLabel, 'Stock Keeper');
});

test('Stock Keeper APIs are isolated from Administrator and Supervisor functions', async () => {
  assert.equal((await request('/portal/stockkeeper/summary', { user: users.stockkeeper })).response.status, 200);
  assert.equal((await request('/portal/supervisor/summary', { user: users.stockkeeper })).response.status, 403);
  assert.equal((await request('/admin/users', { user: users.stockkeeper })).response.status, 403);
  assert.equal((await request('/purchase-orders', { user: users.stockkeeper })).response.status, 403);
  assert.equal((await request('/inventory', { user: users.stockkeeper })).response.status, 403);
  assert.equal((await request('/portal/stockkeeper/summary', { user: users.supervisorA })).response.status, 403);
});

test('Stock Keeper records stock-in, authorized partial issues, adjustments, and immutable history', async () => {
  const item = await createInventoryItem(`QA Bin Card ${Date.now()}`, 10, 4);
  const stockInKey = `qa-stock-in-${Date.now()}-unique`;
  const attachmentText = 'QA stock receipt document';
  const stockIn = await request('/portal/stockkeeper/transactions/stock-in', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, quantity: 5, date: '2026-11-18',
      referenceNo: `QA-IN-${Date.now()}`, source: 'QA Supplier',
      description: 'Initial test receipt', idempotencyKey: stockInKey,
      attachments: [{
        fileName: 'receipt.txt', mimeType: 'text/plain',
        data: Buffer.from(attachmentText).toString('base64')
      }]
    }
  });
  assert.equal(stockIn.response.status, 201, stockIn.data.message);
  assert.equal(stockIn.data.balance, 15);
  createdMovementIds.push(stockIn.data.id);

  const duplicateStockIn = await request('/portal/stockkeeper/transactions/stock-in', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, quantity: 5, date: '2026-11-18',
      referenceNo: `QA-IN-${Date.now()}`, source: 'QA Supplier', idempotencyKey: stockInKey
    }
  });
  assert.equal(duplicateStockIn.response.status, 200);
  assert.equal(duplicateStockIn.data.duplicate, true);
  const storedItem = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(storedItem[0][0].quantity), 15);

  const issueRequest = await createApprovedStoreRequest(item.id, users.requesterA, 20, 'PARTIAL');
  const overAvailable = await request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, storeRequestId: issueRequest.id, quantity: 16,
      idempotencyKey: `qa-out-invalid-${Date.now()}`
    }
  });
  assert.equal(overAvailable.response.status, 409);
  assert.match(overAvailable.data.message, /Insufficient stock/i);

  const stockOutKey = `qa-stock-out-${Date.now()}-unique`;
  const stockOut = await request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, storeRequestId: issueRequest.id, quantity: 5,
      referenceNo: `QA-OUT-${Date.now()}`, idempotencyKey: stockOutKey
    }
  });
  assert.equal(stockOut.response.status, 201, stockOut.data.message);
  assert.equal(stockOut.data.balance, 10);
  createdMovementIds.push(stockOut.data.id);
  assert.equal(stockOut.data.requestStatus, 'Approved');

  const duplicateStockOut = await request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, storeRequestId: issueRequest.id, quantity: 5,
      idempotencyKey: stockOutKey
    }
  });
  assert.equal(duplicateStockOut.response.status, 200);
  assert.equal(duplicateStockOut.data.duplicate, true);

  const secondIssue = await request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, storeRequestId: issueRequest.id, quantity: 10,
      idempotencyKey: `qa-stock-out-second-${Date.now()}`
    }
  });
  assert.equal(secondIssue.response.status, 201);
  assert.equal(secondIssue.data.balance, 0);
  createdMovementIds.push(secondIssue.data.id);
  assert.equal(secondIssue.data.requestStatus, 'Approved');

  const replenishment = await request('/portal/stockkeeper/transactions/stock-in', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, quantity: 5, source: 'QA Replenishment',
      idempotencyKey: `qa-stock-in-replenish-${Date.now()}`
    }
  });
  assert.equal(replenishment.response.status, 201);
  assert.equal(replenishment.data.balance, 5);
  createdMovementIds.push(replenishment.data.id);

  const finalIssue = await request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, storeRequestId: issueRequest.id, quantity: 5,
      idempotencyKey: `qa-stock-out-final-${Date.now()}`
    }
  });
  assert.equal(finalIssue.response.status, 201);
  assert.equal(finalIssue.data.balance, 0);
  assert.equal(finalIssue.data.requestStatus, 'Issued');
  createdMovementIds.push(finalIssue.data.id);

  const adjustment = await request('/portal/stockkeeper/transactions/adjustment', {
    method: 'POST', user: users.stockkeeper,
    body: {
      itemId: item.id, quantity: 2, direction: 'In', reason: 'QA count correction',
      idempotencyKey: `qa-adjust-${Date.now()}`
    }
  });
  assert.equal(adjustment.response.status, 201);
  assert.equal(adjustment.data.balance, 2);
  createdMovementIds.push(adjustment.data.id);

  const card = await request(`/portal/stockkeeper/items/${item.id}`, { user: users.stockkeeper });
  assert.equal(card.response.status, 200, card.data.message);
  assert.equal(card.data.openingBalance, 10);
  assert.equal(card.data.item.balance, 2);
  assert.equal(card.data.movements.length, 6);
  assert.equal(card.data.movements.find((movement) => Number(movement.id) === stockIn.data.id).attachments.length, 1);
  assert.equal(card.data.movements.find((movement) => Number(movement.id) === stockOut.data.id).requester, users.requesterA.name);

  const document = await binaryRequest(
    `/portal/stockkeeper/items/${item.id}/movements/${stockIn.data.id}/attachments/${card.data.movements.find((movement) => Number(movement.id) === stockIn.data.id).attachments[0].id}`,
    users.stockkeeper
  );
  assert.equal(document.response.status, 200);
  assert.equal(document.buffer.toString(), attachmentText);

  const requesterDetails = await request(`/portal/stockkeeper/requesters/${users.requesterA.id}`, { user: users.stockkeeper });
  assert.equal(requesterDetails.response.status, 200);
  assert.equal(requesterDetails.data.requester.departmentId, departments.a.id);
  assert.equal(requesterDetails.data.requester.supervisorName, users.supervisorA.name);
  assert.equal(requesterDetails.data.issueSummary.totalIssues, 3);
  assert.equal(requesterDetails.data.issueSummary.totalUnits, 20);
  assert.equal(requesterDetails.data.recentIssues.length, 3);

  const issueHistoryUrl = new URLSearchParams({
    item: item.name, from: '2026-11-01', to: '2026-11-30', limit: '10'
  });
  const requesterHistory = await request(
    `/portal/stockkeeper/requesters/${users.requesterA.id}/history?${issueHistoryUrl}`,
    { user: users.stockkeeper }
  );
  assert.equal(requesterHistory.response.status, 200);
  assert.equal(requesterHistory.data.movements.length, 3);
  assert.ok(requesterHistory.data.movements.some((movement) => Number(movement.id) === stockOut.data.id));
  assert.ok(requesterHistory.data.movements.every((movement) => movement.department === departments.a.name));
  assert.ok(requesterHistory.data.movements.every((movement) => movement.issuedBy === users.stockkeeper.name));
  assert.ok(requesterHistory.data.movements.every((movement) => movement.direction === 'Out'));

  const noMatchingHistory = await request(
    `/portal/stockkeeper/requesters/${users.requesterA.id}/history?from=2025-01-01&to=2025-01-02`,
    { user: users.stockkeeper }
  );
  assert.equal(noMatchingHistory.response.status, 200);
  assert.equal(noMatchingHistory.data.pagination.total, 0);

  const requesters = await request('/portal/stockkeeper/requesters', { user: users.stockkeeper });
  assert.equal(requesters.response.status, 200);
  assert.ok(requesters.data.requesters.some((requester) => requester.id === users.requesterA.id));
  assert.equal('password_hash' in requesters.data.requesters[0], false);

  const notifications = await request('/notifications', { user: users.stockkeeper });
  assert.equal(notifications.response.status, 200);
  assert.ok(notifications.data.notifications.some((notification) => notification.category === 'stock_in'));
  assert.equal((await request('/portal/stockkeeper/notifications/read-all', {
    method: 'PATCH', user: users.stockkeeper
  })).response.status, 200);
});

test('Stock Keeper requester directory filters, sorts, and paginates safely', async () => {
  const stamp = Date.now();
  const directoryUsers = [];
  for (let index = 0; index < 11; index += 1) {
    const suffix = String(index).padStart(2, '0');
    directoryUsers.push(await createUser(
      `QA Directory ${suffix} ${stamp}`,
      `qa.directory.${suffix}.${stamp}@example.org`,
      'requestor',
      departments.a.id
    ));
  }

  const directoryFilter = new URLSearchParams({
    name: 'QA Directory', email: `qa.directory.%${stamp}@example.org`, departmentId: String(departments.a.id),
    sort: 'name', direction: 'asc', page: '1', limit: '10'
  });
  const firstPage = await request(`/portal/stockkeeper/requesters?${directoryFilter}`, { user: users.stockkeeper });
  assert.equal(firstPage.response.status, 200, firstPage.data.message);
  assert.equal(firstPage.data.pagination.total, 11);
  assert.equal(firstPage.data.pagination.pages, 2);
  assert.equal(firstPage.data.requesters.length, 10);
  assert.deepEqual(firstPage.data.requesters.map((requester) => requester.name),
    [...firstPage.data.requesters.map((requester) => requester.name)].sort((a, b) => a.localeCompare(b)));

  directoryFilter.set('page', '2');
  const secondPage = await request(`/portal/stockkeeper/requesters?${directoryFilter}`, { user: users.stockkeeper });
  assert.equal(secondPage.response.status, 200);
  assert.equal(secondPage.data.requesters.length, 1);
  assert.notEqual(firstPage.data.requesters[0].id, secondPage.data.requesters[0].id);

  directoryFilter.set('page', '1');
  directoryFilter.set('direction', 'desc');
  const descending = await request(`/portal/stockkeeper/requesters?${directoryFilter}`, { user: users.stockkeeper });
  assert.equal(descending.response.status, 200);
  assert.equal(descending.data.requesters[0].name, secondPage.data.requesters[0].name);

  const emailSearch = await request(
    `/portal/stockkeeper/requesters?${new URLSearchParams({ email: users.requesterA.email })}`,
    { user: users.stockkeeper }
  );
  assert.deepEqual(emailSearch.data.requesters.map((requester) => requester.id), [users.requesterA.id]);

  const departmentSearch = await request(
    `/portal/stockkeeper/requesters?${new URLSearchParams({ name: 'QA Requester A', department: departments.a.name })}`,
    { user: users.stockkeeper }
  );
  assert.equal(departmentSearch.response.status, 200);
  assert.ok(departmentSearch.data.requesters.some((requester) => requester.id === users.requesterA.id));
  assert.ok(departmentSearch.data.requesters.every((requester) => requester.department === departments.a.name));

  const inactive = await request(
    `/portal/stockkeeper/requesters?${new URLSearchParams({ name: 'QA Inactive Requester', status: 'inactive' })}`,
    { user: users.stockkeeper }
  );
  assert.equal(inactive.response.status, 200);
  assert.ok(inactive.data.requesters.some((requester) => requester.id === users.requesterInactive.id));
  assert.ok(inactive.data.requesters.every((requester) => !requester.active));

  const [[expectedStats]] = await pool.execute(
    `SELECT COUNT(*) AS totalRequesters, COALESCE(SUM(active = TRUE), 0) AS activeRequesters,
        COALESCE(SUM(active = FALSE), 0) AS inactiveRequesters,
        COUNT(DISTINCT department_id) AS departments
     FROM users WHERE role = 'requestor'`
  );
  const fullDirectory = await request('/portal/stockkeeper/requesters?limit=25&sort=status&direction=asc', {
    user: users.stockkeeper
  });
  assert.equal(fullDirectory.response.status, 200);
  for (const [key, value] of Object.entries(expectedStats)) {
    assert.equal(fullDirectory.data.stats[key], Number(value), `${key} should reflect database records`);
  }
  assert.equal(fullDirectory.data.pagination.limit, 25);
  assert.equal('password_hash' in fullDirectory.data.requesters[0], false);

  const invalidPageSize = await request('/portal/stockkeeper/requesters?limit=5', { user: users.stockkeeper });
  assert.equal(invalidPageSize.response.status, 400);
});

test('concurrent Stock Keeper issues cannot overdraw an inventory balance', async () => {
  const item = await createInventoryItem(`QA Concurrent Bin ${Date.now()}`, 5, 1);
  const requestA = await createApprovedStoreRequest(item.id, users.requesterA, 4, 'CONC-A');
  const requestB = await createApprovedStoreRequest(item.id, users.requesterB, 4, 'CONC-B');
  const [first, second] = await Promise.all([requestA, requestB].map((storeRequest, index) =>
    request('/portal/stockkeeper/transactions/stock-out', {
      method: 'POST', user: users.stockkeeper,
      body: {
        itemId: item.id, storeRequestId: storeRequest.id, quantity: 4,
        idempotencyKey: `qa-concurrent-${Date.now()}-${index}`
      }
    })
  ));
  const results = [first, second];
  assert.equal(results.filter((result) => result.response.status === 201).length, 1);
  assert.equal(results.filter((result) => result.response.status === 409).length, 1);
  for (const result of results) if (result.data.id) createdMovementIds.push(result.data.id);
  const [[balance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(balance.quantity), 1);
});

test('back-office roles sign in to the Administrator-side portal', async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: users.legacy.email, password: PASSWORD })
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.message);
  assert.equal(result.user.role, 'approver');
  assert.equal(result.user.portal, 'admin');

  for (const path of [
    '/dashboard',
    '/requisitions',
    '/inventory',
    '/suppliers',
    '/rfqs',
    '/purchase-orders',
    '/goods-receipts',
    '/invoices',
    '/store-requests',
    '/notifications'
  ]) {
    const data = await request(path, { user: result.user });
    assert.equal(data.response.status, 200, `${path}: ${data.data.message || data.response.statusText}`);
  }
  assert.equal((await request('/procurement/received-requests', { user: result.user })).response.status, 403);
});

test('authentication resolves role changes even with an older token', async () => {
  await pool.execute("UPDATE users SET role = 'supervisor' WHERE id = ?", [users.roleChange.id]);
  const { response, data } = await request('/auth/me', { user: users.roleChange });
  assert.equal(response.status, 200);
  assert.equal(data.user.role, 'supervisor');
  assert.equal(data.user.portal, 'supervisor');
  assert.equal(data.user.departmentId, departments.a.id);
});

test('supervisor portal is scoped to the assigned department', async () => {
  const own = await request('/portal/supervisor/summary', { user: users.supervisorA });
  assert.equal(own.response.status, 200, own.data.message);
  assert.equal(own.data.department.id, departments.a.id);
  assert.equal(own.data.department.name, departments.a.name);

  const other = await request(`/portal/department/${departments.b.id}`, { user: users.supervisorA });
  assert.equal(other.response.status, 403);
  assert.match(other.data.message, /assigned Department/i);

  const mismatched = await request(`/portal/department/${departments.a.id}`, { user: users.supervisorB });
  assert.equal(mismatched.response.status, 403);
});

test('requester cannot enter supervisor or administrator areas', async () => {
  assert.equal((await request('/portal/supervisor/summary', { user: users.requesterA })).response.status, 403);
  assert.equal((await request('/admin/users', { user: users.requesterA })).response.status, 403);
  assert.equal((await request('/requisitions', { user: users.requesterA })).response.status, 403);
  const own = await request('/portal/requester/summary', { user: users.requesterA });
  assert.equal(own.response.status, 200, own.data.message);
  assert.equal(own.data.department.id, departments.a.id);
});

test('supervisor cannot access administrator APIs', async () => {
  assert.equal((await request('/admin/users', { user: users.supervisorA })).response.status, 403);
  assert.equal((await request('/dashboard', { user: users.supervisorA })).response.status, 403);
});

test('administrator keeps system-wide management access', async () => {
  const { response, data } = await request('/admin/users', { user: admin });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(data.users));
});

test('administrator settings are validated, persisted and restricted', async () => {
  const denied = await request('/admin/settings', { user: users.procurement });
  assert.equal(denied.response.status, 403);

  const initial = await request('/admin/settings', { user: admin });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.data.settings.system_name, 'Procurement Management System');

  const saved = await request('/admin/settings', {
    method: 'PUT', user: admin,
    body: { settings: { system_name: 'Hope Haven Procurement', table_page_size: 25 } }
  });
  assert.equal(saved.response.status, 200);

  const reloaded = await request('/admin/settings', { user: admin });
  assert.equal(reloaded.data.settings.system_name, 'Hope Haven Procurement');
  assert.equal(reloaded.data.settings.table_page_size, 25);

  const invalid = await request('/admin/settings', {
    method: 'PUT', user: admin,
    body: { settings: { table_page_size: 7 } }
  });
  assert.equal(invalid.response.status, 400);

  await request('/admin/settings/reset', {
    method: 'POST', user: admin,
    body: { keys: ['system_name', 'table_page_size'] }
  });
});

test('requisition validation returns a client error for an empty request', async () => {
  const { response, data } = await request('/requisitions', { method: 'POST', user: admin, body: {} });
  assert.equal(response.status, 400);
  assert.match(data.message, /item/i);
});

test('requester submits a request routed only to the assigned Department Supervisor', async () => {
  const attachmentData = Buffer.from('QA attachment contents').toString('base64');
  const created = await submitRequest(users.requesterA, 'A', {
    attachments: [{ fileName: 'notes.txt', mimeType: 'text/plain', data: attachmentData }]
  });
  assert.equal(created.response.status, 201, created.data.message);
  assert.equal(created.data.status, 'Pending Supervisor Approval');
  const requisitionId = created.data.id;

  const own = await request(`/portal/requester/requisitions/${requisitionId}`, { user: users.requesterA });
  assert.equal(own.response.status, 200, own.data.message);
  assert.equal(own.data.requisition.items.length, 1);
  assert.equal(own.data.requisition.attachmentCount, 1);
  assert.equal(own.data.requisition.total, 50);

  const supervisorA = await request('/portal/supervisor/requisitions', { user: users.supervisorA });
  assert.equal(supervisorA.response.status, 200);
  assert.ok(supervisorA.data.requisitions.some((row) => row.id === requisitionId));

  const supervisorB = await request('/portal/supervisor/requisitions', { user: users.supervisorB });
  assert.equal(supervisorB.response.status, 200);
  assert.ok(!supervisorB.data.requisitions.some((row) => row.id === requisitionId));

  const otherRequester = await request(`/portal/requester/requisitions/${requisitionId}`, { user: users.requesterB });
  assert.equal(otherRequester.response.status, 404);

  const attachmentId = own.data.requisition.attachments[0].id;
  const download = await fetch(`${baseUrl}/portal/requisitions/${requisitionId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${tokenFor(users.requesterA)}`, Connection: 'close' }
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'QA attachment contents');
});

test('supervisor approval never forwards; explicit forward is the only route into Procurement', async () => {
  const attachmentData = Buffer.from('Forwarded supporting document').toString('base64');
  const created = await submitRequest(users.requesterA, 'FORWARD', {
    attachments: [{ fileName: 'forwarded.txt', mimeType: 'text/plain', data: attachmentData }]
  });
  assert.equal(created.response.status, 201, created.data.message);
  const id = created.data.id;

  // A Requester can never call the forwarding endpoint, even by guessing the URL.
  const directForward = await request(`/portal/supervisor/requisitions/${id}/forward`, {
    method: 'POST', user: users.requesterA, body: {}
  });
  assert.equal(directForward.response.status, 403);

  const decided = await request(`/portal/supervisor/requisitions/${id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve' }
  });
  assert.equal(decided.response.status, 200, decided.data.message);
  assert.equal(decided.data.status, 'Approved by Supervisor');

  // Approved is NOT the same as forwarded.
  const beforeForward = await request('/procurement/received-requests', { user: users.procurement });
  assert.equal(beforeForward.response.status, 200, beforeForward.data.message);
  assert.ok(!beforeForward.data.requisitions.some((row) => row.id === id));
  const detailBefore = await request(`/procurement/received-requests/${id}`, { user: users.procurement });
  assert.equal(detailBefore.response.status, 404);

  const [suppliers] = await pool.execute("SELECT id FROM suppliers WHERE status = 'Active' ORDER BY id LIMIT 2");
  assert.equal(suppliers.length, 2);
  const earlyRfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId: id, supplierIds: suppliers.map((row) => row.id) }
  });
  assert.equal(earlyRfq.response.status, 409);

  const approverDetail = await request(`/portal/requester/requisitions/${id}`, { user: users.requesterA });
  assert.equal(approverDetail.data.requisition.status, 'Approved by Supervisor');
  assert.ok(approverDetail.data.requisition.activity.some((entry) => entry.action === 'approved_by_supervisor'));
  assert.ok(!approverDetail.data.requisition.activity.some((entry) => entry.action === 'forwarded_to_procurement'));

  // A Supervisor from a different Department cannot forward this request.
  const wrongDepartment = await request(`/portal/supervisor/requisitions/${id}/forward`, {
    method: 'POST', user: users.supervisorB, body: {}
  });
  assert.equal(wrongDepartment.response.status, 404);

  const forwarded = await request(`/portal/supervisor/requisitions/${id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(forwarded.response.status, 200, forwarded.data.message);
  assert.equal(forwarded.data.status, 'Forwarded to Procurement');
  assert.ok(forwarded.data.forwardedAt);

  const duplicate = await request(`/portal/supervisor/requisitions/${id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(duplicate.response.status, 409);

  const received = await request('/procurement/received-requests', { user: users.procurement });
  assert.equal(received.response.status, 200, received.data.message);
  const row = received.data.requisitions.find((entry) => entry.id === id);
  assert.ok(row, 'forwarded request must appear in the Procurement received queue');
  assert.equal(row.reference, created.data.reference);
  assert.equal(row.department, departments.a.name);
  assert.equal(row.requester, users.requesterA.name);
  assert.equal(row.supervisorName, users.supervisorA.name);
  assert.equal(row.supervisorDecision, 'Approved');
  assert.equal(row.attachmentCount, 1);
  assert.ok(row.forwardedAt);

  const receivedDetail = await request(`/procurement/received-requests/${id}`, { user: users.procurement });
  assert.equal(receivedDetail.response.status, 200, receivedDetail.data.message);
  const document = receivedDetail.data.requisition;
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0].itemName, `QA item FORWARD`);
  assert.equal(document.attachments.length, 1);
  assert.equal(document.financials.subtotal, 50);
  assert.equal(document.financials.grandTotal, 50);
  assert.ok(document.activity.some((entry) => entry.action === 'created'));
  assert.ok(document.activity.some((entry) => entry.action === 'submitted'));
  assert.ok(document.activity.some((entry) => entry.action === 'approved_by_supervisor'));
  assert.ok(document.activity.some((entry) => entry.action === 'forwarded_to_procurement'));
  assert.ok(document.activity.some((entry) => entry.action === 'received_by_procurement'));

  const attachmentId = document.attachments[0].id;
  const download = await fetch(`${baseUrl}/procurement/received-requests/${id}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${tokenFor(users.procurement)}`, Connection: 'close' }
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'Forwarded supporting document');

  const requesterNotice = await request('/notifications', { user: users.requesterA });
  assert.ok(requesterNotice.data.notifications.some((notice) => notice.title === 'Request forwarded to Procurement'));

  const adminQueue = await request('/requisitions', { user: admin });
  const queued = adminQueue.data.requisitions.find((entry) => entry.id === id);
  assert.ok(queued, 'forwarded request must remain in the existing admin queue');
  assert.equal(queued.supervisorDecision, 'Approved');
  assert.equal(queued.supervisorName, users.supervisorA.name);
  assert.equal(queued.reference, created.data.reference);

  const rfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId: id, supplierIds: suppliers.map((row) => row.id) }
  });
  assert.equal(rfq.response.status, 201, rfq.data.message);
  createdRfqIds.push(rfq.data.id);
  const afterRfq = await request('/requisitions', { user: admin });
  assert.equal(afterRfq.data.requisitions.find((row) => row.id === id).status, 'Under Procurement Review');
});

test('supervisor rejection records the reason and notifies the requester', async () => {
  const created = await submitRequest(users.requesterA, 'REJECT');
  const id = created.data.id;
  const reason = 'Budget code does not match the approved allocation.';
  const decided = await request(`/portal/supervisor/requisitions/${id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Reject', reason }
  });
  assert.equal(decided.response.status, 200, decided.data.message);
  assert.equal(decided.data.status, 'Rejected by Supervisor');

  const detail = await request(`/portal/requester/requisitions/${id}`, { user: users.requesterA });
  assert.equal(detail.data.requisition.supervisorNotes, reason);
  assert.equal(detail.data.requisition.supervisorDecision, 'Rejected');

  const notices = await request('/notifications', { user: users.requesterA });
  assert.ok(notices.data.notifications.some((notice) => notice.title.includes('rejected') && notice.body.includes(reason)));
});

test('exports are scoped by portal role and require authentication', async () => {
  const adminExports = await request('/exports/available', { user: admin });
  assert.equal(adminExports.response.status, 200);
  const adminKeys = adminExports.data.exports.map((item) => item.key);
  assert.ok(adminKeys.includes('requisitions'));
  assert.ok(adminKeys.includes('auditLogs'));
  assert.ok(!adminKeys.includes('portalRequisitions'), 'Administrators use the global requisitions export instead.');

  const supervisorExports = await request('/exports/available', { user: users.supervisorA });
  assert.deepEqual(supervisorExports.data.exports.map((item) => item.key), ['portalRequisitions']);
  const requesterExports = await request('/exports/available', { user: users.requesterA });
  assert.deepEqual(requesterExports.data.exports.map((item) => item.key), ['portalRequisitions']);
  const procurementExports = await request('/exports/available', { user: users.procurement });
  const procurementKeys = procurementExports.data.exports.map((item) => item.key);
  assert.ok(procurementKeys.includes('receivedRequests'));
  assert.ok(!procurementKeys.includes('portalRequisitions'));

  const anonymous = await request('/exports/available');
  assert.equal(anonymous.response.status, 401);

  for (const format of ['pdf', 'xlsx', 'csv']) {
    const report = await binaryRequest(`/exports/requisitions/${format}`, admin);
    assert.equal(report.response.status, 200, `${format} report`);
    assert.match(report.response.headers.get('content-disposition') || '', /attachment; filename=/);
    if (format === 'pdf') assert.equal(report.buffer.subarray(0, 5).toString(), '%PDF-');
    if (format === 'xlsx') assert.equal(report.buffer.subarray(0, 2).toString(), 'PK');
  }
});

test('portal requisition exports only return rows the user can see', async () => {
  const createdA = await submitRequest(users.requesterA, 'EXPORT-A');
  const createdB = await submitRequest(users.requesterB, 'EXPORT-B');
  assert.equal(createdA.response.status, 201);
  assert.equal(createdB.response.status, 201);
  const [[rowA]] = await pool.execute('SELECT reference FROM requisitions WHERE id = ?', [createdA.data.id]);
  const [[rowB]] = await pool.execute('SELECT reference FROM requisitions WHERE id = ?', [createdB.data.id]);

  for (const [label, user, included, excluded] of [
    ['requester A', users.requesterA, rowA.reference, rowB.reference],
    ['supervisor A', users.supervisorA, rowA.reference, rowB.reference],
    ['requester B', users.requesterB, rowB.reference, rowA.reference],
    ['supervisor B', users.supervisorB, rowB.reference, rowA.reference]
  ]) {
    const result = await binaryRequest('/exports/portalRequisitions/csv', user);
    assert.equal(result.response.status, 200, label);
    assert.match(result.response.headers.get('content-type') || '', /text\/csv/);
    assert.match(result.response.headers.get('content-disposition') || '', /attachment; filename=/);
    const text = result.buffer.toString('utf8');
    assert.ok(text.includes(included), `${label} should see ${included}`);
    assert.ok(!text.includes(excluded), `${label} should not see ${excluded}`);
  }

  const invalid = await request('/exports/portalRequisitions/csv?from=2026-02-01&to=2026-01-01', { user: users.requesterA });
  assert.equal(invalid.response.status, 400);
});

test('record exports are role-scoped and render the requested formats', async () => {
  const created = await submitRequest(users.requesterA, 'EXPORT-RECORD');
  assert.equal(created.response.status, 201);
  const [[row]] = await pool.execute('SELECT reference FROM requisitions WHERE id = ?', [created.data.id]);
  const path = `/exports/record/requisition/${created.data.id}`;

  const forbiddenRequester = await binaryRequest(`${path}/pdf`, users.requesterB);
  assert.equal(forbiddenRequester.response.status, 403);
  const forbiddenSupervisor = await binaryRequest(`${path}/pdf`, users.supervisorB);
  assert.equal(forbiddenSupervisor.response.status, 403);

  const pdf = await binaryRequest(`${path}/pdf`, users.requesterA);
  assert.equal(pdf.response.status, 200);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  const xlsx = await binaryRequest(`${path}/xlsx`, users.supervisorA);
  assert.equal(xlsx.response.status, 200);
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
  const csv = await binaryRequest(`${path}/csv`, users.supervisorA);
  assert.equal(csv.response.status, 200);
  assert.ok(csv.buffer.toString('utf8').includes(row.reference));
  assert.match(csv.response.headers.get('content-disposition') || '', new RegExp(row.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('supervisor decision filters and activity include status transitions', async () => {
  const created = await submitRequest(users.requesterA, 'DECISION-META');
  assert.equal(created.response.status, 201);
  const decided = await request(`/portal/supervisor/requisitions/${created.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve', reason: '' }
  });
  assert.equal(decided.response.status, 200);

  const filtered = await request('/portal/supervisor/requisitions?hasDecision=1&status=Approved%20by%20Supervisor', {
    user: users.supervisorA
  });
  assert.equal(filtered.response.status, 200);
  assert.ok(filtered.data.requisitions.length > 0);
  for (const item of filtered.data.requisitions) {
    assert.ok(item.supervisorDecision);
    assert.ok(item.supervisorDecisionAt);
    assert.equal(item.status, 'Approved by Supervisor');
  }

  const detail = await request(`/portal/requester/requisitions/${created.data.id}`, { user: users.requesterA });
  assert.equal(detail.response.status, 200);
  const transition = detail.data.requisition.activity.find(
    (entry) => entry.previousStatus === 'Pending Supervisor Approval'
      && entry.newStatus === 'Approved by Supervisor'
  );
  assert.ok(transition, 'approval activity should record the previous and new status');
  assert.equal(transition.actor, users.supervisorA.name);

  const invalidRange = await request('/portal/supervisor/requisitions?from=2026-03-01&to=2026-02-01', {
    user: users.supervisorA
  });
  assert.equal(invalidRange.response.status, 400);
});

test('request information can be answered and resubmitted', async () => {
  const created = await submitRequest(users.requesterA, 'INFO');
  const id = created.data.id;
  const reason = 'Attach the revised quotation.';
  const asked = await request(`/portal/supervisor/requisitions/${id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Request Information', reason }
  });
  assert.equal(asked.response.status, 200, asked.data.message);
  assert.equal(asked.data.status, 'Information Required');

  const updated = await request(`/portal/requester/requisitions/${id}/resubmit`, {
    method: 'POST', user: users.requesterA, body: { response: 'Revised quotation attached.' }
  });
  assert.equal(updated.response.status, 200, updated.data.message);
  assert.equal(updated.data.status, 'Pending Supervisor Approval');

  const supervisorDetail = await request(`/portal/supervisor/requisitions/${id}`, { user: users.supervisorA });
  assert.equal(supervisorDetail.data.requisition.informationResponse, 'Revised quotation attached.');
  assert.ok(supervisorDetail.data.requisition.activity.some((entry) => entry.action === 'information_requested'));
  assert.ok(supervisorDetail.data.requisition.activity.some((entry) => entry.action === 'resubmitted'));
});

test('draft, rejected, and information-required requests stay invisible to Procurement', async () => {
  const draft = await request('/portal/requester/requisitions', {
    method: 'POST', user: users.requesterA,
    body: {
      title: `QA draft ${Date.now()}`, justification: 'Not submitted yet.', budgetCode: 'QA-DRAFT',
      action: 'draft', items: [{ itemName: 'Draft item', quantity: 1, unit: 'unit', estimatedUnitCost: 10 }]
    }
  });
  assert.equal(draft.response.status, 201, draft.data.message);
  createdRequisitionIds.push(draft.data.id);

  const rejected = await submitRequest(users.requesterA, 'HIDDEN-REJECT');
  await request(`/portal/supervisor/requisitions/${rejected.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Reject', reason: 'Duplicate request.' }
  });
  const hiddenRejectForward = await request(`/portal/supervisor/requisitions/${rejected.data.id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(hiddenRejectForward.response.status, 409);

  const information = await submitRequest(users.requesterA, 'HIDDEN-INFO');
  await request(`/portal/supervisor/requisitions/${information.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Request Information', reason: 'Attach the revised quote.' }
  });
  const hiddenInfoForward = await request(`/portal/supervisor/requisitions/${information.data.id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(hiddenInfoForward.response.status, 409);

  const received = await request('/procurement/received-requests', { user: users.procurement });
  const visibleIds = received.data.requisitions.map((row) => row.id);
  assert.ok(!visibleIds.includes(draft.data.id));
  assert.ok(!visibleIds.includes(rejected.data.id));
  assert.ok(!visibleIds.includes(information.data.id));

  for (const id of [draft.data.id, rejected.data.id, information.data.id]) {
    assert.equal((await request(`/procurement/received-requests/${id}`, { user: users.procurement })).response.status, 404);
    assert.equal((await request(`/procurement/received-requests/${id}/attachments/1`, { user: users.procurement })).response.status, 404);
  }
  assert.equal((await request('/procurement/received-requests', { user: users.requesterA })).response.status, 403);
  assert.equal((await request('/procurement/received-requests', { user: users.supervisorA })).response.status, 403);
});

test('received requests support search, filters, sorting, and pagination', async () => {
  const response = await request('/procurement/received-requests?search=FORWARD&sort=forwardedAt&direction=asc&page=1&limit=1', {
    user: users.procurement
  });
  assert.equal(response.response.status, 200, response.data.message);
  assert.equal(response.data.pagination.limit, 1);
  assert.ok(response.data.requisitions.length <= 1);
  assert.ok(response.data.requisitions.every((row) => row.forwardedAt));

  const fresh = await submitRequest(users.requesterA, 'FILTER');
  await request(`/portal/supervisor/requisitions/${fresh.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve' }
  });
  await request(`/portal/supervisor/requisitions/${fresh.data.id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  const filtered = await request(`/procurement/received-requests?department=${encodeURIComponent(departments.a.name)}&status=Forwarded%20to%20Procurement`, {
    user: users.procurement
  });
  assert.equal(filtered.response.status, 200, filtered.data.message);
  assert.ok(filtered.data.requisitions.some((row) => row.department === departments.a.name && row.status === 'Forwarded to Procurement'));
  assert.ok(filtered.data.requisitions.every((row) => row.status === 'Forwarded to Procurement'));

  const badSort = await request('/procurement/received-requests?sort=id;DROP TABLE requisitions&direction=desc', { user: users.procurement });
  assert.equal(badSort.response.status, 200, badSort.data.message);
});

test('messages and announcements stay inside the assigned Department', async () => {
  const [requestRow] = await pool.execute('SELECT id FROM requisitions WHERE requester_id = ? ORDER BY id DESC LIMIT 1', [users.requesterA.id]);
  const requisitionId = requestRow[0].id;
  const sent = await request('/portal/messages', {
    method: 'POST', user: users.requesterA,
    body: { recipientId: users.supervisorA.id, body: 'Please review the attached detail.', requisitionId }
  });
  assert.equal(sent.response.status, 201, sent.data.message);

  const wrongSupervisor = await request('/portal/messages', {
    method: 'POST', user: users.requesterA,
    body: { recipientId: users.supervisorB.id, body: 'This should be blocked.' }
  });
  assert.equal(wrongSupervisor.response.status, 403);

  const conversationsA = await request('/portal/messages/conversations', { user: users.supervisorA });
  assert.ok(conversationsA.data.conversations.some((row) => row.id === users.requesterA.id));
  const conversationsB = await request('/portal/messages/conversations', { user: users.supervisorB });
  assert.ok(!conversationsB.data.conversations.some((row) => row.id === users.requesterA.id));

  const threadA = await request(`/portal/messages/thread?userId=${users.requesterA.id}`, { user: users.supervisorA });
  assert.equal(threadA.response.status, 200);
  assert.ok(threadA.data.messages.some((row) => row.body === 'Please review the attached detail.'));

  const reply = await request('/portal/messages', {
    method: 'POST', user: users.supervisorA,
    body: { recipientId: users.requesterA.id, body: 'Received, thank you.', requisitionId }
  });
  assert.equal(reply.response.status, 201, reply.data.message);
  const requesterThread = await request(`/portal/messages/thread?userId=${users.supervisorA.id}`, { user: users.requesterA });
  assert.ok(requesterThread.data.messages.some((row) => row.body === 'Received, thank you.'));

  const announcement = await request('/portal/messages', {
    method: 'POST', user: users.supervisorA,
    body: { announcement: true, body: 'Department meeting on Friday.' }
  });
  assert.equal(announcement.response.status, 201, announcement.data.message);
  const supervisorConversations = await request('/portal/messages/conversations', { user: users.supervisorA });
  assert.ok(supervisorConversations.data.announcements.some((row) => row.body === 'Department meeting on Friday.' && row.isRead));
  const requesterConversations = await request('/portal/messages/conversations', { user: users.requesterA });
  assert.ok(requesterConversations.data.announcements.some((row) => row.body === 'Department meeting on Friday.'));
  const otherConversations = await request('/portal/messages/conversations', { user: users.requesterB });
  assert.ok(!otherConversations.data.announcements.some((row) => row.body === 'Department meeting on Friday.'));
});

test('supervisor stock view is read-only and scoped to the assigned Department', async () => {
  const [inserted] = await pool.execute(
    `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level, unit_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [departments.a.id, `QA-STOCK-${Date.now()}`, 'QA scoped stock item', 'Test supplies', 'unit', 4, 10, 12.5]
  );
  const itemId = Number(inserted.insertId);
  createdItemIds.push(itemId);

  const stockA = await request('/portal/supervisor/stock', { user: users.supervisorA });
  assert.equal(stockA.response.status, 200, stockA.data.message);
  assert.ok(stockA.data.items.some((row) => row.id === itemId && row.stockStatus === 'Low Stock'));

  const stockB = await request('/portal/supervisor/stock', { user: users.supervisorB });
  assert.equal(stockB.response.status, 200);
  assert.ok(!stockB.data.items.some((row) => row.id === itemId));

  const detailA = await request(`/portal/supervisor/stock/${itemId}`, { user: users.supervisorA });
  assert.equal(detailA.response.status, 200);
  const detailB = await request(`/portal/supervisor/stock/${itemId}`, { user: users.supervisorB });
  assert.equal(detailB.response.status, 404);
});

test('a department cannot have conflicting active supervisors without replacement', async () => {
  const conflict = await request('/admin/users', {
    method: 'POST',
    user: admin,
    body: {
      name: 'QA Second Supervisor', email: `qa.second.supervisor.${Date.now()}@example.org`,
      password: PASSWORD, role: 'supervisor', departmentId: departments.a.id
    }
  });
  assert.equal(conflict.response.status, 400);
  assert.match(conflict.data.message, /already the active Supervisor/i);

  const email = `qa.replacement.supervisor.${Date.now()}@example.org`;
  const replacement = await request('/admin/users', {
    method: 'POST',
    user: admin,
    body: {
      name: 'QA Replacement Supervisor', email, password: PASSWORD,
      role: 'supervisor', departmentId: departments.a.id, replaceSupervisor: true
    }
  });
  assert.equal(replacement.response.status, 201, replacement.data.message);
  createdUserIds.push(replacement.data.id);
  assert.equal(replacement.data.replacedSupervisor, true);

  const [[oldSupervisor]] = await pool.execute('SELECT active FROM users WHERE id = ?', [users.supervisorA.id]);
  assert.equal(Boolean(oldSupervisor.active), false);
});

function futureBusinessDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function startTestSmtp() {
  return new Promise((resolve) => {
    const messages = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      let buffer = '';
      let data = '';
      let dataMode = false;
      let authStep = null;
      socket.setEncoding('utf8');
      socket.write('220 localhost ESMTP test relay\r\n');
      const send = (line) => socket.write(`${line}\r\n`);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (chunk) => {
        buffer += chunk;
        for (;;) {
          if (dataMode) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end < 0) break;
            data += buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            messages.push(data);
            data = '';
            dataMode = false;
            send('250 2.0.0 Ok: queued');
            continue;
          }
          const end = buffer.indexOf('\r\n');
          if (end < 0) break;
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (/^(EHLO|HELO)\b/i.test(line)) {
            send('250-localhost');
            send('250 AUTH LOGIN');
          } else if (/^AUTH LOGIN\s+(.+)$/i.test(line)) {
            Buffer.from(line.match(/^AUTH LOGIN\s+(.+)$/i)[1], 'base64').toString('utf8');
            authStep = 'pass';
            send('334 UGFzc3dvcmQ6');
          } else if (/^AUTH LOGIN$/i.test(line)) {
            authStep = 'user';
            send('334 VXNlcm5hbWU6');
          } else if (authStep === 'user') {
            authStep = 'pass';
            send('334 UGFzc3dvcmQ6');
          } else if (authStep === 'pass') {
            authStep = null;
            send('235 2.7.0 Authentication successful');
          } else if (/^MAIL FROM:/i.test(line) || /^RCPT TO:/i.test(line) || /^(RSET|NOOP)$/i.test(line)) {
            send('250 2.1.0 Ok');
          } else if (/^DATA$/i.test(line)) {
            dataMode = true;
            send('354 End data with <CR><LF>.<CR><LF>');
          } else if (/^QUIT$/i.test(line)) {
            send('221 2.0.0 Bye');
            socket.end();
          } else {
            send('250 2.0.0 Ok');
          }
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      messages,
      port: server.address().port,
      async close() {
        for (const socket of sockets) socket.destroy();
        await new Promise((done) => server.close(done));
      }
    }));
  });
}

function normalizedMessage(raw) {
  return String(raw || '').replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
}

function linksIn(message) {
  return [...normalizedMessage(message).matchAll(/https?:\/\/[^\s"<>']+/g)]
    .map((match) => match[0])
    .filter((link) => link.includes('/supplier/RFQ?token='));
}

function tokenFrom(link) {
  return /token=([^&\s"']+)/.exec(link)?.[1] || '';
}

test('purchase orders stay linked to their original department request', async () => {
  const stamp = Date.now();
  const department = await createDepartment(`QA PO Dept ${stamp}`);
  const supervisor = await createUser('QA PO Supervisor', `qa.po.supervisor.${stamp}@example.org`, 'supervisor', department.id);
  const requester = await createUser('QA PO Requester', `qa.po.requester.${stamp}@example.org`, 'requestor', department.id);

  const created = await submitRequest(requester, 'POLINK');
  assert.equal(created.response.status, 201, created.data.message);
  const requisitionId = created.data.id;

  const approved = await request(`/portal/supervisor/requisitions/${requisitionId}/decision`, {
    method: 'POST', user: supervisor, body: { decision: 'Approve' }
  });
  assert.equal(approved.response.status, 200, approved.data.message);
  const forwarded = await request(`/portal/supervisor/requisitions/${requisitionId}/forward`, {
    method: 'POST', user: supervisor, body: {}
  });
  assert.equal(forwarded.response.status, 200, forwarded.data.message);

  const supplierName = `QA PO Supplier ${stamp}`;
  const supplierResponse = await request('/suppliers', {
    method: 'POST', user: admin, body: { name: supplierName, email: `qa.po.supplier.${stamp}@example.test` }
  });
  assert.equal(supplierResponse.response.status, 201, supplierResponse.data.message);
  const supplierId = supplierResponse.data.id;
  createdSupplierIds.push(supplierId);

  const rfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId, supplierIds: [supplierId], dueDate: futureBusinessDate() }
  });
  assert.equal(rfq.response.status, 201, rfq.data.message);
  createdRfqIds.push(rfq.data.id);

  const [quoteRows] = await pool.execute(
    `INSERT INTO quotations (rfq_id, supplier_id, amount, delivery_days, quality_score, rating_score, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [rfq.data.id, supplierId, 150, 5, 4, 4]
  );
  const award = await request(`/rfqs/${rfq.data.id}/award`, {
    method: 'POST', user: admin, body: { quotationId: Number(quoteRows.insertId) }
  });
  assert.equal(award.response.status, 200, award.data.message);

  const purchaseOrder = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: { rfqId: rfq.data.id, deliveryDate: futureBusinessDate() }
  });
  assert.equal(purchaseOrder.response.status, 201, purchaseOrder.data.message);
  createdPurchaseOrderIds.push(purchaseOrder.data.id);

  const orders = await request('/purchase-orders', { user: admin });
  assert.equal(orders.response.status, 200);
  const linkedOrder = orders.data.purchaseOrders.find((row) => Number(row.id) === purchaseOrder.data.id);
  assert.ok(linkedOrder, 'the new purchase order must appear in the purchase order list');
  assert.equal(Number(linkedOrder.requisitionId), requisitionId);
  assert.equal(Number(linkedOrder.rfqId), rfq.data.id);
  assert.equal(linkedOrder.requisition, created.data.reference);
  assert.equal(linkedOrder.supplier, supplierName);

  const document = await request(`/procurement/received-requests/${requisitionId}`, { user: users.procurement });
  assert.equal(document.response.status, 200);
  assert.ok(document.data.requisition.activity.some((entry) => entry.action === 'forwarded_to_procurement'));

  // Removing the Administrator Audit Logs screen must not remove backend audit
  // tracking or historical records.
  const audit = await request('/admin/audit-logs?entityType=purchase_order', { user: admin });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.data.logs.some((log) =>
    log.action === 'created' && String(log.entityId) === String(purchaseOrder.data.id)
  ));
});

test('supplier RFQ email delivery, secure links, statuses and retry use the real SMTP path', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL', 'EMAIL_WEBHOOK_SECRET'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  let retryRelay = null;
  const stamp = Date.now();
  const emailDepartment = await createDepartment(`QA Email Dept ${stamp}`);
  const emailSupervisor = await createUser('QA Email Supervisor', `qa.email.supervisor.${stamp}@example.org`, 'supervisor', emailDepartment.id);
  const emailRequester = await createUser('QA Email Requester', `qa.email.requester.${stamp}@example.org`, 'requestor', emailDepartment.id);

  async function makeSupplier(name, email) {
    const response = await request('/suppliers', { method: 'POST', user: admin, body: { name, email } });
    assert.equal(response.response.status, 201, response.data.message);
    createdSupplierIds.push(response.data.id);
    return { id: response.data.id, name, email };
  }

  async function forwardedRequest(suffix) {
    const created = await submitRequest(emailRequester, suffix);
    assert.equal(created.response.status, 201, created.data.message);
    if (created.response.status === 201) createdRequisitionIds.push(created.data.id);
    const approved = await request(`/portal/supervisor/requisitions/${created.data.id}/decision`, {
      method: 'POST', user: emailSupervisor, body: { decision: 'Approve' }
    });
    assert.equal(approved.response.status, 200, approved.data.message);
    const forwarded = await request(`/portal/supervisor/requisitions/${created.data.id}/forward`, {
      method: 'POST', user: emailSupervisor, body: {}
    });
    assert.equal(forwarded.response.status, 200, forwarded.data.message);
    return created.data;
  }

  try {
    const initialConfig = await request('/email/config', { user: users.procurement });
    assert.equal(initialConfig.response.status, 200);
    assert.equal(initialConfig.data.config.configured, false);
    assert.ok(initialConfig.data.config.missing.includes('SMTP_HOST'));

    const unauthenticatedWebhook = await fetch(`${baseUrl}/email/webhooks/generic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered', providerMessageId: 'fake' })
    });
    assert.equal(unauthenticatedWebhook.status, 401);

    relay = await startTestSmtp();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.smtp.${stamp}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = `qa.sender.${stamp}@hopehaven.test`;
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    process.env.EMAIL_WEBHOOK_SECRET = `qa-webhook-secret-${stamp}`;

    const configured = await request('/email/config', { user: users.procurement });
    assert.equal(configured.data.config.configured, true);
    assert.deepEqual(configured.data.config.missing, []);
    assert.ok(!JSON.stringify(configured.data.config).includes(process.env.SMTP_PASS));

    const verified = await request('/email/verify', { method: 'POST', user: users.procurement });
    assert.equal(verified.response.status, 200, verified.data.message);

    const testMail = await request('/email/test', { method: 'POST', user: users.procurement });
    assert.equal(testMail.response.status, 200, testMail.data.message);
    assert.equal(testMail.data.result.status, 'Accepted by Email Provider');
    assert.ok(testMail.data.result.providerMessageId);
    assert.equal(relay.messages.length, 1);

    const supplierA = await makeSupplier(`QA Email Supplier A ${stamp}`, `qa.supplier.a.${stamp}@example.test`);
    const supplierB = await makeSupplier(`QA Email Supplier B ${stamp}`, `qa.supplier.b.${stamp}@example.test`);
    const supplierC = await makeSupplier(`QA Email Supplier C ${stamp}`, `qa.supplier.c.${stamp}@example.test`);
    const requisition = await forwardedRequest('EMAIL3');

    const idempotencyKey = `qa-rfq-${stamp}`;
    const rfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: {
        requisitionId: requisition.id,
        supplierIds: [supplierA.id, supplierB.id, supplierC.id],
        dueDate: futureBusinessDate(),
        idempotencyKey
      }
    });
    assert.equal(rfq.response.status, 201, rfq.data.message);
    createdRfqIds.push(rfq.data.id);
    assert.equal(rfq.data.emailDelivery.accepted, 3);
    assert.equal(rfq.data.emailDelivery.failed, 0);
    assert.equal(relay.messages.length, 4);

    const duplicate = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: {
        requisitionId: requisition.id,
        supplierIds: [supplierA.id, supplierB.id, supplierC.id],
        dueDate: futureBusinessDate(),
        idempotencyKey
      }
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.id, rfq.data.id);
    assert.equal(relay.messages.length, 4, 'a duplicate submission must not send another RFQ email');

    const deliveryResponse = await request(`/rfqs/${rfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(deliveryResponse.response.status, 200);
    assert.equal(deliveryResponse.data.deliveries.length, 3);
    assert.equal(deliveryResponse.data.summary['Accepted by Email Provider'], 3);
    assert.equal(deliveryResponse.data.summary.Delivered, 0, 'SMTP acceptance must never be reported as Delivered');
    const tokens = [];
    relay.messages.slice(1).forEach((message, index) => {
      const supplier = [supplierA, supplierB, supplierC][index];
      const links = linksIn(message);
      // Multipart HTML + plain text legitimately repeat the same URL.
      assert.equal(new Set(links).size, 1, 'each email must contain only one distinct Supplier-specific link');
      tokens.push(tokenFrom(links[0]));
      assert.ok(tokens[index], 'RFQ link must contain a token');
      assert.match(normalizedMessage(message), new RegExp(rfq.data.reference));
      const others = [supplierA, supplierB, supplierC].filter((entry) => entry.id !== supplier.id);
      for (const other of others) assert.ok(!normalizedMessage(message).includes(other.email));
    });
    assert.equal(new Set(tokens).size, 3, 'each Supplier must receive a unique link');

    for (let index = 0; index < 3; index += 1) {
      const supplier = [supplierA, supplierB, supplierC][index];
      const opened = await fetch(`${baseUrl}/supplier/rfq/${encodeURIComponent(tokens[index])}`);
      assert.equal(opened.status, 200);
      const document = await opened.json();
      assert.equal(document.rfq.supplier.name, supplier.name);
      assert.equal(document.rfq.reference, rfq.data.reference);
      assert.ok(Array.isArray(document.rfq.items));

      const quote = await fetch(`${baseUrl}/supplier/rfq/${encodeURIComponent(tokens[index])}/quotation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 + index, deliveryDays: 5 + index, notes: `QA quote ${index}` })
      });
      assert.equal(quote.status, 200, await quote.text());
    }
    const quotes = await request(`/rfqs/${rfq.data.id}/quotations`, { user: users.procurement });
    assert.equal(quotes.data.quotations.length, 3);
    const openedStatus = await request(`/rfqs/${rfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(openedStatus.data.summary.Opened, 3);

    const noFailedRetry = await request(`/rfqs/${rfq.data.id}/emails/retry-failed`, { method: 'POST', user: users.procurement });
    assert.equal(noFailedRetry.data.result.accepted, 0, 'retry must not resend to Suppliers already accepted');
    assert.equal(relay.messages.length, 4);

    const singleSupplier = await makeSupplier(`QA Email Single Supplier ${stamp}`, `qa.supplier.single.${stamp}@example.test`);
    const singleRequisition = await forwardedRequest('EMAIL1');
    const singleRfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: { requisitionId: singleRequisition.id, supplierIds: [singleSupplier.id], dueDate: futureBusinessDate() }
    });
    assert.equal(singleRfq.response.status, 201, singleRfq.data.message);
    createdRfqIds.push(singleRfq.data.id);
    assert.equal(singleRfq.data.emailDelivery.accepted, 1);
    assert.equal(singleRfq.data.emailDelivery.failed, 0);
    assert.equal(relay.messages.length, 5);
    const singleDeliveries = await request(`/rfqs/${singleRfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(singleDeliveries.data.deliveries.length, 1);
    assert.equal(singleDeliveries.data.deliveries[0].recipientEmail, singleSupplier.email);
    assert.equal(singleDeliveries.data.deliveries[0].status, 'Accepted by Email Provider');
    assert.equal(linksIn(relay.messages[4]).length > 0, true);

    const invalidSupplier = await makeSupplier(`QA Invalid Email ${stamp}`, 'not-an-email');
    const validSupplier = await makeSupplier(`QA Valid Email ${stamp}`, `qa.valid.${stamp}@example.test`);
    const secondRequisition = await forwardedRequest('EMAILINV');
    const invalidRfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: { requisitionId: secondRequisition.id, supplierIds: [invalidSupplier.id, validSupplier.id], dueDate: futureBusinessDate() }
    });
    assert.equal(invalidRfq.response.status, 201, invalidRfq.data.message);
    createdRfqIds.push(invalidRfq.data.id);
    assert.equal(invalidRfq.data.emailDelivery.failed, 1);
    assert.equal(relay.messages.length, 6);
    const invalidDeliveries = await request(`/rfqs/${invalidRfq.data.id}/email-deliveries`, { user: users.procurement });
    const invalidRecord = invalidDeliveries.data.deliveries.find((row) => row.supplierId === invalidSupplier.id);
    assert.equal(invalidRecord.status, 'Failed');
    assert.equal(invalidRecord.errorDetails.code, 'INVALID_RECIPIENT');

    const probe = net.createServer();
    await new Promise((done) => probe.listen(0, '127.0.0.1', done));
    const closedPort = probe.address().port;
    await new Promise((done) => probe.close(done));
    process.env.SMTP_PORT = String(closedPort);
    const failureRequisition = await forwardedRequest('EMAILFAIL');
    const failedSupplierA = await makeSupplier(`QA Failure Supplier A ${stamp}`, `qa.failure.a.${stamp}@example.test`);
    const failedSupplierB = await makeSupplier(`QA Failure Supplier B ${stamp}`, `qa.failure.b.${stamp}@example.test`);
    const failedRfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: { requisitionId: failureRequisition.id, supplierIds: [failedSupplierA.id, failedSupplierB.id], dueDate: futureBusinessDate() }
    });
    assert.equal(failedRfq.response.status, 201, failedRfq.data.message);
    createdRfqIds.push(failedRfq.data.id);
    assert.equal(failedRfq.data.emailDelivery.failed, 2);
    assert.equal(relay.messages.length, 6, 'a provider failure must not produce a queued message');
    const failedDeliveries = await request(`/rfqs/${failedRfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(failedDeliveries.data.summary.Failed, 2);
    assert.ok(failedDeliveries.data.deliveries.every((row) => row.errorDetails?.message));

    retryRelay = await startTestSmtp();
    process.env.SMTP_PORT = String(retryRelay.port);
    const retried = await request(`/rfqs/${failedRfq.data.id}/emails/retry-failed`, { method: 'POST', user: users.procurement });
    assert.equal(retried.data.result.accepted, 2);
    assert.equal(retried.data.summary.Failed, 0);
    assert.equal(retryRelay.messages.length, 2);

    const acceptedDelivery = retried.data.deliveries.find((row) => row.providerMessageId);
    const webhook = await fetch(`${baseUrl}/email/webhooks/generic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-email-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
      body: JSON.stringify({ status: 'delivered', providerMessageId: acceptedDelivery.providerMessageId, recipient: acceptedDelivery.recipientEmail })
    });
    assert.equal(webhook.status, 202);
    const afterWebhook = await request(`/rfqs/${failedRfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.ok(afterWebhook.data.deliveries.some((row) => row.status === 'Delivered' && row.deliveredAt));
  } finally {
    if (relay) await relay.close();
    if (retryRelay) await retryRelay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

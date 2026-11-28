import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import app from '../src/app.js';
import pool, { applySchemaMigrations } from '../src/config/db.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-characters';
const PASSWORD = 'QaPortalTest!2026';
let server;
let baseUrl;
let admin;
let departments;
let users;
let testDepartmentRoot;
const createdUserIds = [];
const createdDepartmentIds = [];
const createdRequisitionIds = [];
const createdItemIds = [];
const createdMovementIds = [];
const createdStoreRequestIds = [];
const createdRfqIds = [];
const createdPurchaseOrderIds = [];
const createdSupplierIds = [];
const createdCommitteeMemberIds = [];

function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

async function imageSignature() {
  const buffer = await sharp({
    create: { width: 240, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function request(path, { method = 'GET', user, body } = {}) {
  // RFQs cannot be issued without the Procurement signature. Supply a valid
  // generated image by default so committee tests keep testing committee behavior.
  const needsRfqSignature = method === 'POST' && /\/rfqs(?:\/\d+\/send)?$/.test(path);
  const rfqBody = needsRfqSignature && body
    ? { senderSignature: await imageSignature(), ...body }
    : body;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
      ...(rfqBody ? { 'Content-Type': 'application/json' } : {})
    },
    ...(rfqBody ? { body: JSON.stringify(rfqBody) } : {})
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
  // Departments in the test suite are subdepartments under one test root,
  // matching the production hierarchy (department -> subdepartment -> user).
  const [result] = await pool.execute(
    'INSERT INTO departments (name, description, parent_id) VALUES (?, ?, ?)',
    [name, 'QA portal test department', testDepartmentRoot?.id || null]
  );
  createdDepartmentIds.push(Number(result.insertId));
  return { id: Number(result.insertId), name, parentId: testDepartmentRoot?.id || null };
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
      location: `QA Store ${suffix}`,
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

async function createInventoryItem(name, quantity, reorderLevel = 2, departmentId = departments.a.id) {
  const sku = `QA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const [result] = await pool.execute(
    `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level)
     VALUES (?, ?, ?, 'QA', 'unit', ?, ?)`,
    [departmentId, sku, name, quantity, reorderLevel]
  );
  createdItemIds.push(Number(result.insertId));
  return { id: Number(result.insertId), sku, name, departmentId };
}

async function createApprovedStoreRequest(itemId, requester, quantity, suffix) {
  // store_requests.reference is VARCHAR(30), so keep the generated value short.
  const reference = `QASR-${Date.now().toString(36).toUpperCase()}`;
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

async function createRequisitionInDepartment(departmentId, requesterId, suffix) {
  // requisitions.reference is VARCHAR(30), so keep the generated value short.
  const reference = `QADEL-${Date.now().toString(36).toUpperCase()}`;
  const [result] = await pool.execute(
    `INSERT INTO requisitions
      (reference, requester_id, department_id, title, justification, budget_code, priority)
     VALUES (?, ?, ?, ?, ?, ?, 'Medium')`,
    [reference, requesterId, departmentId, `QA delete test ${suffix}`, 'Delete dependency test', `QA-${suffix}`]
  );
  const id = Number(result.insertId);
  createdRequisitionIds.push(id);
  return { id };
}

async function createMessageInDepartment(departmentId, senderId, suffix) {
  const [result] = await pool.execute(
    'INSERT INTO messages (department_id, sender_id, body, is_announcement) VALUES (?, ?, ?, FALSE)',
    [departmentId, senderId, `QA delete dependency message ${suffix}`]
  );
  return Number(result.insertId);
}

async function createMovementInDepartment(itemId, departmentId, suffix) {
  // inventory_movements.reference_no is VARCHAR(40), so keep this short too.
  const reference = `QAMV-${Date.now().toString(36).toUpperCase()}`;
  const [result] = await pool.execute(
    `INSERT INTO inventory_movements
      (item_id, department_id, movement_type, direction, quantity, reference_no, source, balance_after)
     VALUES (?, ?, 'Receipt', 'In', 5, ?, 'QA delete dependency test', 5)`,
    [itemId, departmentId, reference]
  );
  const id = Number(result.insertId);
  createdMovementIds.push(id);
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
  const [rootResult] = await pool.execute(
    'INSERT INTO departments (name, description) VALUES (?, ?)',
    [`QA Hierarchy Root ${stamp}`, 'QA test hierarchy root']
  );
  testDepartmentRoot = { id: Number(rootResult.insertId), name: `QA Hierarchy Root ${stamp}` };
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
    await pool.execute(`DELETE FROM requisition_email_comments WHERE requisition_id IN (${placeholders})`, createdRequisitionIds);
    await pool.execute(`DELETE FROM requisition_email_threads WHERE requisition_id IN (${placeholders})`, createdRequisitionIds);
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
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'supplier' AND entity_id IN (${createdSupplierIds.map(() => '?').join(',')})`,
      createdSupplierIds.map(String)
    );
    await pool.execute(`DELETE FROM suppliers WHERE id IN (${createdSupplierIds.map(() => '?').join(',')})`, createdSupplierIds);
  }
  if (createdCommitteeMemberIds.length) {
    const ids = createdCommitteeMemberIds.map(String);
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'procurement_committee_member' AND entity_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    await pool.execute(
      `DELETE FROM procurement_committee_members WHERE id IN (${createdCommitteeMemberIds.map(() => '?').join(',')})`,
      createdCommitteeMemberIds
    );
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
  if (testDepartmentRoot) {
    await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'department' AND entity_id = ?", [String(testDepartmentRoot.id)]);
    await pool.execute('DELETE FROM departments WHERE id = ?', [testDepartmentRoot.id]);
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

  const requesters = await request(
    `/portal/stockkeeper/requesters?search=${encodeURIComponent(users.requesterA.email)}`,
    { user: users.stockkeeper }
  );
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

test('procurement can edit and safely remove suppliers', async () => {
  const suffix = Date.now();
  const created = await request('/suppliers', {
    method: 'POST', user: admin,
    body: {
      name: `QA Editable Supplier ${suffix}`,
      email: `qa.supplier.${suffix}@example.test`,
      phone: '12345',
      city: 'Kigali',
      district: 'Gasabo',
      sector: 'Kimihurura',
      cell: 'Kamutwa'
    }
  });
  assert.equal(created.response.status, 201, created.data.message);
  createdSupplierIds.push(created.data.id);

  const listed = await request('/suppliers', { user: admin });
  assert.equal(listed.response.status, 200, listed.data.message);
  const listedSupplier = listed.data.suppliers.find((supplier) => supplier.id === created.data.id);
  assert.deepEqual(
    {
      city: listedSupplier.city,
      district: listedSupplier.district,
      sector: listedSupplier.sector,
      cell: listedSupplier.cell,
      address: listedSupplier.address
    },
    {
      city: 'Kigali',
      district: 'Gasabo',
      sector: 'Kimihurura',
      cell: 'Kamutwa',
      address: 'Kigali, Gasabo, Kimihurura, Kamutwa'
    }
  );

  const denied = await request(`/suppliers/${created.data.id}`, {
    method: 'PATCH', user: users.requesterA,
    body: { name: 'Unauthorized edit' }
  });
  assert.equal(denied.response.status, 403);

  const invalid = await request(`/suppliers/${created.data.id}`, {
    method: 'PATCH', user: users.procurement, body: { name: '  ' }
  });
  assert.equal(invalid.response.status, 400);

  const updated = await request(`/suppliers/${created.data.id}`, {
    method: 'PATCH', user: users.procurement,
    body: {
      name: 'QA Updated Supplier',
      email: 'updated@example.test',
      phone: '67890',
      city: 'Huye',
      district: 'Ngoma',
      sector: 'Tumba',
      cell: 'Matyazo'
    }
  });
  assert.equal(updated.response.status, 200, updated.data.message);
  const [rowsAfterUpdate] = await pool.execute(
    'SELECT name, email, phone, address, city, district, sector, cell, status FROM suppliers WHERE id = ?', [created.data.id]
  );
  assert.deepEqual(
    {
      name: rowsAfterUpdate[0].name,
      email: rowsAfterUpdate[0].email,
      phone: rowsAfterUpdate[0].phone,
      address: rowsAfterUpdate[0].address,
      city: rowsAfterUpdate[0].city,
      district: rowsAfterUpdate[0].district,
      sector: rowsAfterUpdate[0].sector,
      cell: rowsAfterUpdate[0].cell,
      status: rowsAfterUpdate[0].status
    },
    {
      name: 'QA Updated Supplier',
      email: 'updated@example.test',
      phone: '67890',
      address: 'Huye, Ngoma, Tumba, Matyazo',
      city: 'Huye',
      district: 'Ngoma',
      sector: 'Tumba',
      cell: 'Matyazo',
      status: 'Active'
    }
  );

  const removed = await request(`/suppliers/${created.data.id}`, {
    method: 'DELETE', user: users.procurement, body: {}
  });
  assert.equal(removed.response.status, 200, removed.data.message);
  assert.equal(removed.data.softDeleted, true);
  const [rowsAfterRemoval] = await pool.execute('SELECT status FROM suppliers WHERE id = ?', [created.data.id]);
  assert.equal(rowsAfterRemoval[0].status, 'Inactive');
});

test('procurement committee contacts support authorized create, edit, and delete', async () => {
  const suffix = Date.now();
  const member = {
    firstName: 'QA',
    lastName: `Committee ${suffix}`,
    email: `qa.committee.${suffix}@example.test`,
    phone: '+250 700 000 000'
  };
  const denied = await request('/procurement-committee', { user: users.requesterA });
  assert.equal(denied.response.status, 403);

  const invalid = await request('/procurement-committee', {
    method: 'POST', user: admin, body: { ...member, email: 'not-an-email' }
  });
  assert.equal(invalid.response.status, 400);

  const created = await request('/procurement-committee', { method: 'POST', user: admin, body: member });
  assert.equal(created.response.status, 201, created.data.message);
  createdCommitteeMemberIds.push(created.data.id);

  const duplicate = await request('/procurement-committee', { method: 'POST', user: admin, body: member });
  assert.equal(duplicate.response.status, 409);

  const listed = await request('/procurement-committee', { user: users.procurement });
  assert.equal(listed.response.status, 200);
  assert.ok(listed.data.members.some((item) => item.id === created.data.id && item.email === member.email));

  const updatedMember = { ...member, firstName: 'Updated', phone: '+250 700 111 111' };
  const updated = await request(`/procurement-committee/${created.data.id}`, {
    method: 'PATCH', user: users.procurement, body: updatedMember
  });
  assert.equal(updated.response.status, 200, updated.data.message);
  const [rowsAfterUpdate] = await pool.execute(
    'SELECT first_name AS firstName, last_name AS lastName, email, phone FROM procurement_committee_members WHERE id = ?',
    [created.data.id]
  );
  assert.deepEqual(rowsAfterUpdate[0], updatedMember);

  const deleted = await request(`/procurement-committee/${created.data.id}`, {
    method: 'DELETE', user: users.procurement, body: {}
  });
  assert.equal(deleted.response.status, 200, deleted.data.message);
  const [remaining] = await pool.execute(
    'SELECT id FROM procurement_committee_members WHERE id = ?', [created.data.id]
  );
  assert.equal(remaining.length, 0);
});

test('committee reviews endpoint is restricted to procurement staff', async () => {
  const denied = await request('/rfqs/999999/committee-reviews', { user: users.requesterA });
  assert.equal(denied.response.status, 403);

  const allowed = await request('/rfqs/999999/committee-reviews', { user: users.procurement });
  assert.equal(allowed.response.status, 404);
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

test('Google inbox endpoints require authorized staff and expose no OAuth secrets', async () => {
  const anonymous = await request('/email/google/status');
  assert.equal(anonymous.response.status, 401);

  const requester = await request('/email/google/status', { user: users.requesterA });
  assert.equal(requester.response.status, 403);

  const adminStatus = await request('/email/google/status', { user: admin });
  assert.equal(adminStatus.response.status, 200, adminStatus.data.message);
  assert.equal(typeof adminStatus.data.configured, 'boolean');
  assert.equal('clientSecret' in adminStatus.data, false);

  const procurementStatus = await request('/email/google/status', { user: users.procurement });
  assert.equal(procurementStatus.response.status, 200);

  const invalidMessage = await request('/email/send', {
    method: 'POST', user: admin, body: { to: 'not-an-email', subject: 'Test', text: 'Body' }
  });
  assert.equal(invalidMessage.response.status, 400);

  const invalidCallback = await fetch(`${baseUrl}/email/google/callback`);
  assert.equal(invalidCallback.status, 400);
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

test('requester can submit a request without a budget code', async () => {
  const created = await submitRequest(users.requesterA, 'NO-BUDGET', {
    budgetCode: '',
    items: [
      { itemName: 'QA item one', description: 'First item purpose.', quantity: 2, unit: 'box', estimatedUnitCost: 25 },
      { itemName: 'QA item two', description: 'Second item purpose.', quantity: 3, unit: 'piece', estimatedUnitCost: 10 }
    ]
  });
  assert.equal(created.response.status, 201, created.data.message);

  const detail = await request(`/portal/requester/requisitions/${created.data.id}`, { user: users.requesterA });
  assert.equal(detail.response.status, 200, detail.data.message);
  assert.equal(detail.data.requisition.budgetCode, '');
  assert.equal(detail.data.requisition.title, 'QA workflow request NO-BUDGET');
  assert.equal(detail.data.requisition.items.length, 2);
  assert.equal(detail.data.requisition.items[0].itemName, 'QA item one');
  assert.equal(detail.data.requisition.items[1].itemName, 'QA item two');
  assert.equal(detail.data.requisition.total, 80);
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

test('a requisition response link lets an external recipient submit a comment directly', async () => {
  const created = await submitRequest(users.requesterA, 'RESPONSE-LINK');
  assert.equal(created.response.status, 201, created.data.message);
  const requisitionId = created.data.id;
  await request(`/portal/supervisor/requisitions/${requisitionId}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve' }
  });
  const forwarded = await request(`/portal/supervisor/requisitions/${requisitionId}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(forwarded.response.status, 200, forwarded.data.message);

  const token = randomBytes(16).toString('hex');
  const recipientEmail = 'external.recipient@example.test';
  const procurementMessage = 'Please confirm the quantities and comment if anything needs changing.';
  await pool.execute(
    `INSERT INTO requisition_email_threads (requisition_id, token, recipient_email, message, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [requisitionId, token, recipientEmail, procurementMessage, admin.id]
  );

  const invalidLink = await request('/request-response/not-a-valid-token');
  assert.equal(invalidLink.response.status, 404);

  const opened = await request(`/request-response/${token}`);
  assert.equal(opened.response.status, 200, opened.data.message);
  assert.equal(opened.data.request.reference, created.data.reference);
  assert.equal(opened.data.request.recipientEmail, recipientEmail);
  assert.equal(opened.data.request.message, procurementMessage, 'the Procurement message must reach the response form');
  assert.equal(opened.data.request.items.length, 1);
  assert.equal(opened.data.request.items[0].quantity, 2);
  assert.equal(opened.data.comments.length, 0);

  const emptyComment = await request(`/request-response/${token}/comment`, {
    method: 'POST', body: { comment: '   ' }
  });
  assert.equal(emptyComment.response.status, 400);

  const submitted = await request(`/request-response/${token}/comment`, {
    method: 'POST',
    body: { responderName: 'Recipient One', comment: 'Please add two more units and deliver on Tuesday.' }
  });
  assert.equal(submitted.response.status, 201, submitted.data.message);
  assert.equal(submitted.data.reference, created.data.reference);

  const duplicateSubmission = await request(`/request-response/${token}/comment`, {
    method: 'POST',
    body: { responderName: 'Recipient One', comment: 'A second response must not be accepted.' }
  });
  assert.equal(duplicateSubmission.response.status, 409);
  assert.match(duplicateSubmission.data.message, /already been submitted/i);

  const afterComment = await request(`/request-response/${token}`);
  assert.equal(afterComment.response.status, 200);
  assert.equal(afterComment.data.request.responded, true);
  assert.equal(afterComment.data.comments.length, 1);
  assert.equal(afterComment.data.comments[0].comment, 'Please add two more units and deliver on Tuesday.');
  assert.equal(afterComment.data.comments[0].sender, `Recipient One <${recipientEmail}>`);

  const detail = await request(`/procurement/received-requests/${requisitionId}`, { user: users.procurement });
  assert.equal(detail.response.status, 200, detail.data.message);
  assert.equal(detail.data.requisition.emailComments.length, 1);
  assert.equal(detail.data.requisition.emailComments[0].comment, 'Please add two more units and deliver on Tuesday.');
  const activity = detail.data.requisition.activity.find((entry) => entry.action === 'email_comment_received');
  assert.ok(activity, 'the response comment must appear in request history');
  assert.equal(activity.details.source, 'response_form');

  const notices = await request('/notifications', { user: users.procurement });
  assert.ok(notices.data.notifications.some((notice) => notice.title === 'Response comment received'));
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
  assert.deepEqual(
    supervisorExports.data.exports.map((item) => item.key).sort(),
    ['portalRequisitions', 'supervisorRequesters', 'supervisorStock']
  );
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

test('delete endpoints reject non-administrator direct API calls', async () => {
  for (const user of [users.requesterA, users.requesterB, users.stockkeeper]) {
    const userDelete = await request(`/admin/users/${users.requesterA.id}`, { method: 'DELETE', user });
    assert.equal(userDelete.response.status, 403);
    const departmentDelete = await request('/admin/departments/999999', { method: 'DELETE', user, body: {} });
    assert.equal(departmentDelete.response.status, 403);
  }
});

test('deleting an account soft-deletes it, preserves history, and records an audit event', async () => {
  const stamp = Date.now();
  const person = await createUser('QA Delete Account', `qa.delete.account.${stamp}@example.org`, 'requestor', departments.a.id);
  const submitted = await submitRequest(person, `DEL${stamp}`);
  assert.equal(submitted.response.status, 201, submitted.data.message);
  const requisitionId = submitted.data.id;

  const deleted = await request(`/admin/users/${person.id}`, { method: 'DELETE', user: admin });
  assert.equal(deleted.response.status, 200, deleted.data.message);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.softDeleted, true);

  const [[storedUser]] = await pool.execute('SELECT active FROM users WHERE id = ?', [person.id]);
  assert.equal(Boolean(storedUser.active), false);
  const [[history]] = await pool.execute('SELECT requester_id FROM requisitions WHERE id = ?', [requisitionId]);
  assert.equal(Number(history.requester_id), person.id);
  const [[audit]] = await pool.execute(
    "SELECT id FROM audit_logs WHERE user_id = ? AND action = 'user_deleted' AND entity_type = 'user' AND entity_id = ? LIMIT 1",
    [admin.id, String(person.id)]
  );
  assert.ok(audit, 'A user deletion must be recorded in the audit log.');
  const auth = await request('/auth/me', { user: person });
  assert.equal(auth.response.status, 401);
});

test('self-delete and last active administrator delete are blocked', async () => {
  const stamp = Date.now();
  const created = await request('/admin/users', {
    method: 'POST',
    user: admin,
    body: {
      name: 'QA Second Admin', email: `qa.second.admin.${stamp}@example.org`,
      password: PASSWORD, role: 'admin'
    }
  });
  assert.equal(created.response.status, 201, created.data.message);
  createdUserIds.push(created.data.id);

  const selfDelete = await request(`/admin/users/${admin.id}`, { method: 'DELETE', user: admin });
  assert.equal(selfDelete.response.status, 400);
  assert.match(selfDelete.data.message, /own account/i);

  const secondDelete = await request(`/admin/users/${created.data.id}`, { method: 'DELETE', user: admin });
  assert.equal(secondDelete.response.status, 200, secondDelete.data.message);

  const [[{ total }]] = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = TRUE");
  if (Number(total) === 1) {
    const lastAdmin = await request(`/admin/users/${admin.id}`, { method: 'DELETE', user: admin });
    assert.equal(lastAdmin.response.status, 400);
    assert.match(lastAdmin.data.message, /last active administrator/i);
  }
});

test('department deletion checks every dependency and reassigns historical records', async () => {
  const stamp = Date.now();
  const source = await createDepartment(`QA Delete Source ${stamp}`);
  const destination = await createDepartment(`QA Delete Destination ${stamp}`);
  const supervisorDestination = await createDepartment(`QA Delete Supervisor Destination ${stamp}`);
  const requester = await createUser('QA Delete Requester', `qa.delete.requester.${stamp}@example.org`, 'requestor', source.id);
  const supervisor = await createUser('QA Delete Supervisor', `qa.delete.supervisor.${stamp}@example.org`, 'supervisor', source.id);
  await createUser('QA Delete Destination Supervisor', `qa.delete.dest.supervisor.${stamp}@example.org`, 'supervisor', supervisorDestination.id);

  const requisition = await createRequisitionInDepartment(source.id, requester.id, `DEPT${stamp}`);
  const item = await createInventoryItem(`QA Delete Item ${stamp}`, 2, 1, source.id);
  const storeRequest = await createApprovedStoreRequest(item.id, requester, 1, `DEPT${stamp}`);
  const movement = await createMovementInDepartment(item.id, source.id, `DEPT${stamp}`);
  const messageId = await createMessageInDepartment(source.id, requester.id, `DEPT${stamp}`);

  const listed = await request('/admin/departments', { user: admin });
  assert.equal(listed.response.status, 200);
  const listedSource = listed.data.departments.find((department) => Number(department.id) === source.id);
  assert.equal(Number(listedSource.userCount), 2);
  assert.equal(Number(listedSource.requisitionCount), 1);
  assert.equal(Number(listedSource.storeRequestCount), 1);
  assert.equal(Number(listedSource.itemCount), 1);
  assert.equal(Number(listedSource.stockMovementCount), 1);
  assert.equal(Number(listedSource.messageCount), 1);

  const blocked = await request(`/admin/departments/${source.id}`, { method: 'DELETE', user: admin, body: {} });
  assert.equal(blocked.response.status, 400);
  assert.match(blocked.data.message, /referenced by/i);
  assert.match(blocked.data.message, /message\(s\)/i);

  const sameDepartment = await request(`/admin/departments/${source.id}`, {
    method: 'DELETE', user: admin, body: { reassignTo: source.id }
  });
  assert.equal(sameDepartment.response.status, 400);

  const missingDestination = await request(`/admin/departments/${source.id}`, {
    method: 'DELETE', user: admin, body: { reassignTo: 999999999 }
  });
  assert.equal(missingDestination.response.status, 400);
  assert.match(missingDestination.data.message, /does not exist/i);

  const conflictingSupervisor = await request(`/admin/departments/${source.id}`, {
    method: 'DELETE', user: admin, body: { reassignTo: supervisorDestination.id }
  });
  assert.equal(conflictingSupervisor.response.status, 400);
  assert.match(conflictingSupervisor.data.message, /active Supervisor/i);

  const deleted = await request(`/admin/departments/${source.id}`, {
    method: 'DELETE', user: admin, body: { reassignTo: destination.id }
  });
  assert.equal(deleted.response.status, 200, deleted.data.message);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.reassigned, destination.id);

  const [[remainingDepartment]] = await pool.execute('SELECT id FROM departments WHERE id = ?', [source.id]);
  assert.equal(remainingDepartment, undefined);
  for (const [table, id] of [
    ['users', requester.id], ['users', supervisor.id],
    ['requisitions', requisition.id], ['store_requests', storeRequest.id],
    ['items', item.id], ['inventory_movements', movement.id], ['messages', messageId]
  ]) {
    const [[row]] = await pool.execute(`SELECT department_id FROM ${table} WHERE id = ?`, [id]);
    assert.ok(row, `${table} row ${id} must not be deleted.`);
    assert.equal(Number(row.department_id), destination.id, `${table} row ${id} must be reassigned.`);
  }
  const [[audit]] = await pool.execute(
    "SELECT id, details FROM audit_logs WHERE user_id = ? AND action = 'department_deleted' AND entity_type = 'department' AND entity_id = ? LIMIT 1",
    [admin.id, String(source.id)]
  );
  assert.ok(audit, 'A department deletion must be recorded in the audit log.');
  assert.equal(JSON.parse(audit.details).reassignedTo, destination.id);

  const empty = await createDepartment(`QA Delete Empty ${stamp}`);
  const emptyDelete = await request(`/admin/departments/${empty.id}`, { method: 'DELETE', user: admin, body: {} });
  assert.equal(emptyDelete.response.status, 200, emptyDelete.data.message);
  assert.equal(emptyDelete.data.reassigned, null);
});

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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

  const badDates = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId, supplierIds: [supplierId], startDate: futureBusinessDate(), dueDate: todayIsoDate() }
  });
  assert.equal(badDates.response.status, 400);
  assert.match(badDates.data.message, /End date \(deadline\) must be on or after Send start date/);

  const rfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId, supplierIds: [supplierId], startDate: todayIsoDate(), dueDate: futureBusinessDate() }
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
    body: {
      rfqId: rfq.data.id, deliveryDate: futureBusinessDate(),
      preparedBySignature: await imageSignature(), approvedBySignature: await imageSignature()
    }
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
    const unauthenticatedWebhook = await fetch(`${baseUrl}/email/webhooks/generic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered', providerMessageId: 'fake' })
    });
    assert.equal(unauthenticatedWebhook.status, 401);

    for (const endpoint of [
      { path: '/email/config', method: 'GET' },
      { path: '/email/verify', method: 'POST' },
      { path: '/email/test', method: 'POST' }
    ]) {
      const removed = await request(endpoint.path, { method: endpoint.method, user: users.procurement });
      assert.equal(removed.response.status, 404, `${endpoint.path} must no longer be exposed`);
    }

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

    const supplierA = await makeSupplier(`QA Email Supplier A ${stamp}`, `qa.supplier.a.${stamp}@example.test`);
    const supplierB = await makeSupplier(`QA Email Supplier B ${stamp}`, `qa.supplier.b.${stamp}@example.test`);
    const supplierC = await makeSupplier(`QA Email Supplier C ${stamp}`, `qa.supplier.c.${stamp}@example.test`);
    const requisition = await forwardedRequest('EMAIL3');
    const supplierMessage = 'Please quote including delivery to the school.';
    const rfqDay = futureBusinessDate();
    const startAt = `${rfqDay}T09:15`;
    const dueAt = `${rfqDay}T16:45`;

    const idempotencyKey = `qa-rfq-${stamp}`;
    const rfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: {
        requisitionId: requisition.id,
        supplierIds: [supplierA.id, supplierB.id, supplierC.id],
        startDate: startAt, dueDate: dueAt,
        message: supplierMessage,
        idempotencyKey
      }
    });
    assert.equal(rfq.response.status, 201, rfq.data.message);
    createdRfqIds.push(rfq.data.id);
    assert.equal(rfq.data.emailDelivery.accepted, 3);
    assert.equal(rfq.data.emailDelivery.failed, 0);
    assert.equal(relay.messages.length, 3);

    const duplicate = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: {
        requisitionId: requisition.id,
        supplierIds: [supplierA.id, supplierB.id, supplierC.id],
        startDate: startAt, dueDate: dueAt,
        idempotencyKey
      }
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.id, rfq.data.id);
    assert.equal(relay.messages.length, 3, 'a duplicate submission must not send another RFQ email');

    const deliveryResponse = await request(`/rfqs/${rfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(deliveryResponse.response.status, 200);
    assert.equal(deliveryResponse.data.deliveries.length, 3);
    assert.equal(deliveryResponse.data.summary['Accepted by Email Provider'], 3);
    assert.equal(deliveryResponse.data.summary.Delivered, 0, 'SMTP acceptance must never be reported as Delivered');
    const tokens = [];
    relay.messages.forEach((message, index) => {
      const supplier = [supplierA, supplierB, supplierC][index];
      const links = linksIn(message);
      // Multipart HTML + plain text legitimately repeat the same URL.
      assert.equal(new Set(links).size, 1, 'each email must contain only one distinct Supplier-specific link');
      tokens.push(tokenFrom(links[0]));
      assert.ok(tokens[index], 'RFQ link must contain a token');
      assert.match(normalizedMessage(message), new RegExp(rfq.data.reference));
      assert.match(normalizedMessage(message), /Request for Quotation/);
      assert.match(normalizedMessage(message), /Quotation deadline:/);
      assert.match(normalizedMessage(message), /View RFQ & Submit Quotation/);
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

      const pricedItems = document.rfq.items.map((item, itemIndex) => ({
        requisitionItemId: item.requisitionItemId,
        unitPrice: 100 + index + itemIndex,
        comment: `QA item comment ${index}-${itemIndex}`
      }));
      const quote = await fetch(`${baseUrl}/supplier/rfq/${encodeURIComponent(tokens[index])}/quotation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 100 + index,
          deliveryDays: 5 + index,
          notes: `QA quote ${index}`,
          items: pricedItems
        })
      });
      assert.equal(quote.status, 200, await quote.text());

      const duplicateQuote = await fetch(`${baseUrl}/supplier/rfq/${encodeURIComponent(tokens[index])}/quotation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 100 + index,
          deliveryDays: 5 + index,
          notes: `Duplicate quote ${index}`,
          items: pricedItems
        })
      });
      assert.equal(duplicateQuote.status, 409);
      assert.match((await duplicateQuote.json()).message, /already been submitted/i);

      const afterQuote = await fetch(`${baseUrl}/supplier/rfq/${encodeURIComponent(tokens[index])}`);
      assert.equal(afterQuote.status, 200);
      assert.equal((await afterQuote.json()).rfq.quotation.notes, `QA quote ${index}`);
    }
    const quotes = await request(`/rfqs/${rfq.data.id}/quotations`, { user: users.procurement });
    assert.equal(quotes.data.quotations.length, 3);
    assert.equal(quotes.data.rfq.reference, rfq.data.reference);
    assert.equal(quotes.data.rfq.message, supplierMessage);
    assert.ok(quotes.data.rfq.requestedItems.length > 0);
    assert.ok(quotes.data.quotations.every((quote) => quote.items.length >= 1));
    assert.ok(quotes.data.quotations.every((quote) => quote.supplierEmail));
    assert.match(JSON.stringify(quotes.data.quotations), /QA item comment/);
    const rfqList = await request('/rfqs', { user: users.procurement });
    const listedRfq = rfqList.data.rfqs.find((entry) => entry.id === rfq.data.id);
    assert.equal(listedRfq.responses.length, 3);
    assert.ok(listedRfq.responses.every((response) => response.items.length >= 1));
    assert.match(JSON.stringify(listedRfq.responses), /QA item comment/);

    const committeeMember = {
      firstName: 'QA',
      lastName: `RFQ Committee ${stamp}`,
      email: `qa.rfq.committee.${stamp}@example.test`,
      phone: '+250 700 000 000'
    };
    const createdCommitteeMember = await request('/procurement-committee', {
      method: 'POST', user: admin, body: committeeMember
    });
    assert.equal(createdCommitteeMember.response.status, 201, createdCommitteeMember.data.message);
    createdCommitteeMemberIds.push(createdCommitteeMember.data.id);
    const deniedCommitteeSend = await request('/rfqs/send-to-committee', {
      method: 'POST', user: users.requesterA, body: { rfqIds: [rfq.data.id] }
    });
    assert.equal(deniedCommitteeSend.response.status, 403);

    const openedStatus = await request(`/rfqs/${rfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(openedStatus.data.summary.Opened, 3);

    const noFailedRetry = await request(`/rfqs/${rfq.data.id}/emails/retry-failed`, { method: 'POST', user: users.procurement });
    assert.equal(noFailedRetry.data.result.accepted, 0, 'retry must not resend to Suppliers already accepted');
    assert.equal(relay.messages.length, 3);

    const singleSupplier = await makeSupplier(`QA Email Single Supplier ${stamp}`, `qa.supplier.single.${stamp}@example.test`);
    const singleRequisition = await forwardedRequest('EMAIL1');
    const singleRfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: { requisitionId: singleRequisition.id, supplierIds: [singleSupplier.id], startDate: todayIsoDate(), dueDate: futureBusinessDate() }
    });
    assert.equal(singleRfq.response.status, 201, singleRfq.data.message);
    createdRfqIds.push(singleRfq.data.id);
    assert.equal(singleRfq.data.emailDelivery.accepted, 1);
    assert.equal(singleRfq.data.emailDelivery.failed, 0);
    assert.equal(relay.messages.length, 4);
    const prematureCommitteeSend = await request('/rfqs/send-to-committee', {
      method: 'POST', user: users.procurement, body: { rfqIds: [singleRfq.data.id] }
    });
    assert.equal(prematureCommitteeSend.response.status, 409);

    const recordedQuote = await request(`/rfqs/${singleRfq.data.id}/quotations`, {
      method: 'POST',
      user: users.procurement,
      body: {
        supplierId: singleSupplier.id,
        amount: 456,
        deliveryDays: 3,
        qualityScore: 4,
        ratingScore: 4,
        notes: 'QA batch response'
      }
    });
    assert.equal(recordedQuote.response.status, 201, recordedQuote.data.message);

    const committeeSend = await request('/rfqs/send-to-committee', {
      method: 'POST', user: users.procurement,
      body: { rfqIds: [rfq.data.id, singleRfq.data.id], memberIds: [createdCommitteeMember.data.id] }
    });
    assert.equal(committeeSend.response.status, 200, committeeSend.data.message);
    assert.equal(committeeSend.data.failed, 0);
    assert.equal(committeeSend.data.accepted, committeeSend.data.total);
    assert.equal(committeeSend.data.rfqCount, 2);
    assert.equal(committeeSend.data.responseCount, 4);
    assert.ok(committeeSend.data.deliveries.some((delivery) => delivery.email === committeeMember.email));
    const committeeMessages = relay.messages.slice(4);
    assert.equal(committeeMessages.length, committeeSend.data.total);
    assert.ok(committeeMessages.every((message) => normalizedMessage(message).includes(rfq.data.reference)));
    assert.ok(committeeMessages.every((message) => normalizedMessage(message).includes(singleRfq.data.reference)));
    assert.ok(committeeMessages.some((message) => normalizedMessage(message).includes(supplierA.name)));
    assert.ok(committeeMessages.some((message) => normalizedMessage(message).includes('QA item EMAIL3')));
    assert.ok(committeeMessages.some((message) => normalizedMessage(message).includes('QA item EMAIL1')));
    assert.ok(committeeMessages.some((message) => normalizedMessage(message).includes('QA item comment 0-0')));
    assert.equal(committeeSend.data.reviewsCreated, 2);
    for (const message of committeeMessages) {
      const text = normalizedMessage(message);
      assert.match(text, /OPEN YOUR DECISION FORM\(S\)/);
      assert.match(text, /Message from Procurement: Please quote including delivery to the school\./);
      assert.match(text, /Send date and time:/);
      assert.match(text, /Response deadline:/);
      assert.match(text, /Supplier response total: RWF/);
      assert.match(text, /Decision required: open the decision link, choose one Accept or Deny for Procurement/);
      assert.match(text, /give a reason for that decision\./);
      assert.match(text, /OPEN DECISION FORM/);
      assert.match(text, /Accept/);
      assert.match(text, /Deny/);
      assert.doesNotMatch(text, /Procurement recommendation/);
    }

    const committeeLinks = [...new Set(committeeMessages.flatMap((message) =>
      [...normalizedMessage(message).matchAll(/https?:\/\/[^\s"<>']+/g)]
        .map((match) => match[0])
        .filter((link) => /\/committee-review(?:\?token=|\/)/.test(link))
    ))];
    assert.equal(committeeLinks.length, 2, 'each selected RFQ must produce its own committee decision link');
    assert.ok(committeeMessages.every((message) => {
      const hrefs = [...normalizedMessage(message).matchAll(/href="([^"]*)"/g)]
        .map((match) => match[1])
        .filter((href) => /\/committee-review(?:\?token=|\/)/.test(href));
      return hrefs.length > 0 && hrefs.every((href) => committeeLinks.includes(href));
    }), 'the HTML buttons must contain the full decision links');
    assert.ok(committeeMessages.every((message) =>
      !normalizedMessage(message).includes('href=""')), 'the HTML button must never have an empty href');
    const formsByReference = new Map();
    for (const link of committeeLinks) {
      const token = (/token=([^&\s"']+)/.exec(link)
        || /\/committee-review\/([a-f0-9]{64})/i.exec(link))?.[1] || '';
      assert.match(token, /^[a-f0-9]{64}$/i);
      const formResponse = await fetch(`${baseUrl}/committee-review/${token}`);
      assert.equal(formResponse.status, 200);
      const { review } = await formResponse.json();
      assert.ok(review.responses.length >= 1);
      assert.ok(review.requestedItems.length >= 1);
      assert.ok(review.responses.every((response) => response.supplier && response.amount !== null));
      formsByReference.set(review.reference, { token, review });
    }
    assert.ok(formsByReference.has(rfq.data.reference));
    assert.ok(formsByReference.has(singleRfq.data.reference));
    const mainCommitteeForm = formsByReference.get(rfq.data.reference);
    assert.equal(mainCommitteeForm.review.message, supplierMessage);

    const reviewList = await request(`/rfqs/${rfq.data.id}/committee-reviews`, {
      method: 'GET', user: users.procurement
    });
    assert.equal(reviewList.response.status, 200);
    const pendingReview = reviewList.data.reviews.find((review) => !review.submittedAt);
    assert.ok(pendingReview);
    const relayCountBeforeResend = relay.messages.length;
    const resentReview = await request(`/rfqs/${rfq.data.id}/committee-reviews/${pendingReview.id}/resend`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(resentReview.response.status, 200, resentReview.data.message);
    assert.equal(relay.messages.length, relayCountBeforeResend + 1);
    assert.match(normalizedMessage(relay.messages.at(-1)), /\/committee-review(?:\?token=|\/)/);

    const invalidToken = await fetch(`${baseUrl}/committee-review/${'a'.repeat(64)}`);
    assert.equal(invalidToken.status, 404);

    const decisionUrl = `${baseUrl}/committee-review/${mainCommitteeForm.token}/decisions`;
    const invalidDecision = await fetch(decisionUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responderName: 'QA Committee Reviewer',
        decision: 'Deny',
        reason: ''
      })
    });
    assert.equal(invalidDecision.status, 400, 'a Deny decision must include a reason');
    assert.match((await invalidDecision.json()).message, /reason for denying/i);

    const invalidAccept = await fetch(decisionUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responderName: 'QA Committee Reviewer',
        decision: 'Accept',
        reason: ''
      })
    });
    assert.equal(invalidAccept.status, 400, 'an Accept decision must include a reason');
    assert.match((await invalidAccept.json()).message, /reason for accepting/i);

    const missingDecision = await fetch(decisionUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responderName: 'QA Committee Reviewer',
        decision: '',
        reason: 'QA committee reason'
      })
    });
    assert.equal(missingDecision.status, 400, 'one Accept or Deny choice is required');

    const validDecisionBody = JSON.stringify({
      responderName: 'QA Committee Reviewer',
      decision: 'Deny',
      reason: 'QA committee denial reason'
    });
    const submittedDecision = await fetch(decisionUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: validDecisionBody
    });
    assert.equal(submittedDecision.status, 201);
    assert.equal((await submittedDecision.json()).decisionCount, 1);

    const duplicateDecision = await fetch(decisionUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: validDecisionBody
    });
    assert.equal(duplicateDecision.status, 409, 'one emailed link must accept only one decision');

    const afterDecision = await fetch(`${baseUrl}/committee-review/${mainCommitteeForm.token}`);
    const afterDecisionPayload = await afterDecision.json();
    assert.equal(afterDecisionPayload.review.responded, true);
    assert.equal(afterDecisionPayload.review.overallDecision.decision, 'Rejected');
    assert.ok(afterDecisionPayload.review.decisions.some((decision) =>
      decision.decision === 'Rejected' && decision.reason === 'QA committee denial reason' &&
      decision.responderName === 'QA Committee Reviewer'));

    const committeeReviewList = await request(`/rfqs/${rfq.data.id}/committee-reviews`, { user: users.procurement });
    assert.equal(committeeReviewList.response.status, 200);
    assert.equal(committeeReviewList.data.reviews.length, 1);
    assert.ok(committeeReviewList.data.reviews[0].submittedAt);
    assert.ok(committeeReviewList.data.reviews[0].decisions.some((decision) =>
      decision.decision === 'Rejected' && decision.reason === 'QA committee denial reason'));
    const decisionNotice = await request('/notifications', { user: users.procurement });
    assert.ok(decisionNotice.data.notifications.some((notice) =>
      notice.title === 'Committee decision received' &&
      notice.body.includes('QA Committee Reviewer') &&
      notice.body.includes('QA committee denial reason')));
    const messagesAfterCommittee = relay.messages.length;

    const singleDeliveries = await request(`/rfqs/${singleRfq.data.id}/email-deliveries`, { user: users.procurement });
    assert.equal(singleDeliveries.data.deliveries.length, 1);
    assert.equal(singleDeliveries.data.deliveries[0].recipientEmail, singleSupplier.email);
    assert.equal(singleDeliveries.data.deliveries[0].status, 'Accepted by Email Provider');
    assert.equal(linksIn(relay.messages[3]).length > 0, true);

    const invalidSupplier = await makeSupplier(`QA Invalid Email ${stamp}`, 'not-an-email');
    const validSupplier = await makeSupplier(`QA Valid Email ${stamp}`, `qa.valid.${stamp}@example.test`);
    const secondRequisition = await forwardedRequest('EMAILINV');
    const invalidRfq = await request('/rfqs', {
      method: 'POST', user: users.procurement,
      body: { requisitionId: secondRequisition.id, supplierIds: [invalidSupplier.id, validSupplier.id], startDate: todayIsoDate(), dueDate: futureBusinessDate() }
    });
    assert.equal(invalidRfq.response.status, 201, invalidRfq.data.message);
    createdRfqIds.push(invalidRfq.data.id);
    assert.equal(invalidRfq.data.emailDelivery.failed, 1);
    assert.equal(relay.messages.length, messagesAfterCommittee + 1);
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
      body: { requisitionId: failureRequisition.id, supplierIds: [failedSupplierA.id, failedSupplierB.id], startDate: todayIsoDate(), dueDate: futureBusinessDate() }
    });
    assert.equal(failedRfq.response.status, 201, failedRfq.data.message);
    createdRfqIds.push(failedRfq.data.id);
    assert.equal(failedRfq.data.emailDelivery.failed, 2);
    assert.equal(relay.messages.length, messagesAfterCommittee + 1, 'a provider failure must not produce a queued message');
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

test('a sent request form can be resent with the current public response link', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL', 'CLIENT_ORIGIN'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  try {
    relay = await startTestSmtp();
    const stamp = Date.now();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.form.smtp.${stamp}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = `qa.form.sender.${stamp}@hopehaven.test`;
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'https://public.example.test';
    process.env.CLIENT_ORIGIN = 'https://public.example.test';

    const formDepartment = await createDepartment(`QA Form Dept ${stamp}`);
    const formSupervisor = await createUser('QA Form Supervisor', `qa.form.supervisor.${stamp}@example.org`, 'supervisor', formDepartment.id);
    const formRequester = await createUser('QA Form Requester', `qa.form.requester.${stamp}@example.org`, 'requestor', formDepartment.id);
    const created = await submitRequest(formRequester, 'RESENDLINK');
    assert.equal(created.response.status, 201, created.data.message);
    const requisitionId = created.data.id;
    assert.equal((await request(`/portal/supervisor/requisitions/${requisitionId}/decision`, {
      method: 'POST', user: formSupervisor, body: { decision: 'Approve' }
    })).response.status, 200);
    assert.equal((await request(`/portal/supervisor/requisitions/${requisitionId}/forward`, {
      method: 'POST', user: formSupervisor, body: {}
    })).response.status, 200);

    const token = randomBytes(16).toString('hex');
    const [inserted] = await pool.execute(
      `INSERT INTO requisition_email_threads
         (requisition_id, token, recipient_email, recipient_phone, message, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [requisitionId, token, 'qa.form.recipient@example.test', '+250700000000', 'Please confirm the quantities.', admin.id]
    );
    const threadId = Number(inserted.insertId);

    const forms = await request(`/email/requisitions/${requisitionId}/forms`, { user: users.procurement });
    assert.equal(forms.response.status, 200, forms.data.message);
    const form = forms.data.forms.find((row) => Number(row.id) === threadId);
    assert.ok(form, 'the sent form must appear in the Procurement sent-forms list');
    assert.equal(form.responded, false);
    assert.equal(form.message, 'Please confirm the quantities.');
    assert.match(form.responseUrl, /^https:\/\/public\.example\.test\/response\/[a-f0-9]{32}$/);

    const denied = await request(`/email/requisitions/${requisitionId}/forms/${threadId}/resend`, {
      method: 'POST', user: users.requesterA
    });
    assert.equal(denied.response.status, 403);

    const resent = await request(`/email/requisitions/${requisitionId}/forms/${threadId}/resend`, {
      method: 'POST', user: users.procurement
    });
    assert.equal(resent.response.status, 200, resent.data.message);
    assert.equal(resent.data.threadId, threadId);
    assert.equal(relay.messages.length, 1, 'resend must deliver exactly one message');
    const message = normalizedMessage(relay.messages[0]);
    assert.ok(message.includes('https://public.example.test/response/' + token), 'resend must use the current public link and the original token');
    assert.match(message, /Please confirm the quantities\./);

    const opened = await fetch(`${baseUrl}/request-response/${token}`);
    assert.equal(opened.status, 200, 'the resent link must still open the response form');
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('sending requested items stores and emails the sender name and signature', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL', 'CLIENT_ORIGIN'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  try {
    relay = await startTestSmtp();
    const stamp = Date.now();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.sender.smtp.${stamp}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = `qa.sender.${stamp}@hopehaven.test`;
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'https://public.example.test';
    process.env.CLIENT_ORIGIN = 'https://public.example.test';

    const formDepartment = await createDepartment(`QA Sender Dept ${stamp}`);
    const formSupervisor = await createUser('QA Sender Supervisor', `qa.sender.supervisor.${stamp}@example.org`, 'supervisor', formDepartment.id);
    const formRequester = await createUser('QA Sender Requester', `qa.sender.requester.${stamp}@example.org`, 'requestor', formDepartment.id);
    const created = await submitRequest(formRequester, 'SENDERSIGN');
    assert.equal(created.response.status, 201, created.data.message);
    const requisitionId = created.data.id;
    assert.equal((await request(`/portal/supervisor/requisitions/${requisitionId}/decision`, {
      method: 'POST', user: formSupervisor, body: { decision: 'Approve' }
    })).response.status, 200);
    assert.equal((await request(`/portal/supervisor/requisitions/${requisitionId}/forward`, {
      method: 'POST', user: formSupervisor, body: {}
    })).response.status, 200);

    const signature = await imageSignature();
    const missingSignature = await request(`/email/requisitions/${requisitionId}/send`, {
      method: 'POST', user: users.procurement,
      body: { to: 'qa.sender.recipient@example.test', senderName: 'Jane Procurement' }
    });
    assert.equal(missingSignature.response.status, 400);
    assert.match(missingSignature.data.message, /signature/i);

    const sent = await request(`/email/requisitions/${requisitionId}/send`, {
      method: 'POST', user: users.procurement,
      body: {
        to: 'qa.sender.recipient@example.test',
        recipientPhone: '+250700000222',
        senderName: 'Jane Procurement',
        senderSignature: signature,
        message: 'Please confirm these quantities.'
      }
    });
    assert.equal(sent.response.status, 200, sent.data.message);

    const forms = await request(`/email/requisitions/${requisitionId}/forms`, { user: users.procurement });
    const form = forms.data.forms.find((row) => Number(row.id) === Number(sent.data.threadId));
    assert.ok(form, 'the sent form must appear in Procurement forms');
    assert.equal(form.senderName, 'Jane Procurement');
    const token = /\/response\/([a-f0-9]{32})/.exec(form.responseUrl)?.[1];
    assert.ok(token);

    const [[stored]] = await pool.execute(
      'SELECT sender_name AS senderName, sender_signature AS senderSignature FROM requisition_email_threads WHERE id = ?',
      [sent.data.threadId]
    );
    assert.equal(stored.senderName, 'Jane Procurement');
    assert.match(stored.senderSignature, /^data:image\/webp;base64,/);

    const opened = await fetch(`${baseUrl}/request-response/${token}`);
    assert.equal(opened.status, 200);
    const document = await opened.json();
    assert.equal(document.request.senderName, 'Jane Procurement');
    assert.equal(document.request.senderSignature, stored.senderSignature);

    assert.equal(relay.messages.length, 1, 'the signed form must be sent exactly once');
    const message = normalizedMessage(relay.messages[0]);
    assert.match(message, /Sent by: Jane Procurement/);
    assert.match(message, /cid:requisition-sender-signature/);
    assert.match(message, /Content-ID: <requisition-sender-signature>/i);
    assert.match(message, /https:\/\/public\.example\.test\/response\//);
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('a Procurement-recommended supplier appears in purchase orders and opens a PO', async () => {
  const stamp = Date.now();
  const supplierResponse = await request('/suppliers', {
    method: 'POST', user: admin,
    body: { name: `QA Recommended Supplier ${stamp}`, email: `qa.recommended.${stamp}@example.test`, contactName: 'QA Contact', phone: '+250700000111' }
  });
  assert.equal(supplierResponse.response.status, 201, supplierResponse.data.message);
  const supplierId = Number(supplierResponse.data.id);
  createdSupplierIds.push(supplierId);
  await pool.execute('UPDATE suppliers SET address = ? WHERE id = ?', ['QA Recommended Address', supplierId]);

  const department = await createDepartment(`QA Recommendation Dept ${stamp}`);
  const supervisor = await createUser('QA Recommendation Supervisor', `qa.rec.supervisor.${stamp}@example.org`, 'supervisor', department.id);
  const requester = await createUser('QA Recommendation Requester', `qa.rec.requester.${stamp}@example.org`, 'requestor', department.id);
  const created = await submitRequest(requester, 'PORECOMMEND');
  assert.equal(created.response.status, 201, created.data.message);
  assert.equal((await request(`/portal/supervisor/requisitions/${created.data.id}/decision`, {
    method: 'POST', user: supervisor, body: { decision: 'Approve' }
  })).response.status, 200);
  assert.equal((await request(`/portal/supervisor/requisitions/${created.data.id}/forward`, {
    method: 'POST', user: supervisor, body: {}
  })).response.status, 200);

  const rfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId: created.data.id, supplierIds: [supplierId], startDate: todayIsoDate(), dueDate: futureBusinessDate() }
  });
  assert.equal(rfq.response.status, 201, rfq.data.message);
  createdRfqIds.push(rfq.data.id);

  const [quoteRows] = await pool.execute(
    `INSERT INTO quotations (rfq_id, supplier_id, amount, delivery_days, quality_score, rating_score, notes, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [rfq.data.id, supplierId, 250, 4, 5, 5, 'Best value for the school']
  );
  const quotationId = Number(quoteRows.insertId);
  const [[requestLine]] = await pool.execute('SELECT id FROM requisition_items WHERE requisition_id = ? ORDER BY id LIMIT 1', [created.data.id]);
  await pool.execute(
    `INSERT INTO quotation_items
      (quotation_id, requisition_item_id, item_name, description, quantity, unit, unit_price, line_total, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [quotationId, requestLine.id, 'QA item PORECOMMEND', 'Recommended line', 2, 'unit', 125, 250, 'Included in quotation']
  );

  const committeeMember = await request('/procurement-committee', {
    method: 'POST', user: admin,
    body: { firstName: 'QA', lastName: `Recommendation ${stamp}`, email: `qa.rec.member.${stamp}@example.test`, phone: '+250700000222' }
  });
  assert.equal(committeeMember.response.status, 201, committeeMember.data.message);
  createdCommitteeMemberIds.push(committeeMember.data.id);

  const snapshot = {
    suppliers: [{
      supplierId,
      name: `QA Recommended Supplier ${stamp}`,
      items: [{
        quotationItemId: 0,
        itemName: 'QA item PORECOMMEND',
        description: 'Recommended line',
        quantity: 2,
        unit: 'unit',
        unitPrice: 125,
        lineTotal: 250,
        comment: 'Included in quotation'
      }]
    }]
  };
  await pool.execute(
    `INSERT INTO rfq_committee_reviews
      (rfq_id, token, committee_member_id, created_by, recipient_name, recipient_email,
       recommended_supplier_id, reason, report_snapshot, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sent', UTC_TIMESTAMP())`,
    [rfq.data.id, randomBytes(32).toString('hex'), committeeMember.data.id, users.procurement.id,
      'QA Recommendation Member', `qa.rec.member.${stamp}@example.test`, supplierId,
      'Lowest quoted price with the shortest delivery time', JSON.stringify(snapshot)]
  );

  const recommendationList = await request('/committee-recommendations', { user: users.procurement });
  assert.equal(recommendationList.response.status, 200, recommendationList.data.message);
  const recommendation = recommendationList.data.recommendations.find((entry) => Number(entry.rfqId) === Number(rfq.data.id));
  assert.ok(recommendation, 'the recommended supplier must appear in the Purchase orders recommendations feed');
  assert.equal(Number(recommendation.supplierId), supplierId);
  assert.equal(recommendation.recommendedSupplier, `QA Recommended Supplier ${stamp}`);
  assert.equal(recommendation.reason, 'Lowest quoted price with the shortest delivery time');
  assert.equal(Number(recommendation.quotationAmount), 250);
  assert.ok(recommendation.items.some((item) => item.itemName === 'QA item PORECOMMEND'));
  assert.equal(recommendation.purchaseOrderId, null);
  assert.equal((await request('/committee-recommendations', { user: requester })).response.status, 403);

  const missingSignature = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: { rfqId: rfq.data.id, deliveryDate: futureBusinessDate() }
  });
  assert.equal(missingSignature.response.status, 400);
  assert.match(missingSignature.data.message, /prepared by signature image/i);

  const missingApprovedSignature = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: { rfqId: rfq.data.id, deliveryDate: futureBusinessDate(), preparedBySignature: await imageSignature() }
  });
  assert.equal(missingApprovedSignature.response.status, 400);
  assert.match(missingApprovedSignature.data.message, /approved by signature image/i);

  const invalidSupplier = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: {
      rfqId: rfq.data.id, supplierId: supplierId + 1000, deliveryDate: futureBusinessDate(),
      preparedBySignature: await imageSignature(), approvedBySignature: await imageSignature()
    }
  });
  assert.equal(invalidSupplier.response.status, 409);
  assert.match(invalidSupplier.data.message, /not Procurement/i);

  const purchaseOrder = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: {
      rfqId: rfq.data.id, supplierId, deliveryDate: futureBusinessDate(), type: 'Standard',
      preparedBySignature: await imageSignature(), approvedBySignature: await imageSignature()
    }
  });
  assert.equal(purchaseOrder.response.status, 201, purchaseOrder.data.message);
  createdPurchaseOrderIds.push(purchaseOrder.data.id);

  const [[awarded]] = await pool.execute('SELECT status, selected_quotation_id FROM rfqs WHERE id = ?', [rfq.data.id]);
  assert.equal(awarded.status, 'Awarded');
  assert.equal(Number(awarded.selected_quotation_id), quotationId);

  const orders = await request('/purchase-orders', { user: admin });
  assert.equal(orders.response.status, 200);
  const listed = orders.data.purchaseOrders.find((order) => Number(order.id) === purchaseOrder.data.id);
  assert.ok(listed);
  assert.equal(Number(listed.supplierId), supplierId);
  assert.equal(Number(listed.recommendedSupplierId), supplierId);
  assert.equal(listed.recommendedSupplier, `QA Recommended Supplier ${stamp}`);

  const refreshedRecommendation = await request('/committee-recommendations', { user: users.procurement });
  const linked = refreshedRecommendation.data.recommendations.find((entry) => Number(entry.rfqId) === Number(rfq.data.id));
  assert.equal(Number(linked.purchaseOrderId), Number(purchaseOrder.data.id));
  assert.equal(linked.purchaseOrderReference, purchaseOrder.data.reference);

  const detail = await request(`/purchase-orders/${purchaseOrder.data.id}`, { user: admin });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.purchaseOrder.reference, purchaseOrder.data.reference);
  assert.equal(detail.data.purchaseOrder.supplier, `QA Recommended Supplier ${stamp}`);
  assert.ok(detail.data.purchaseOrder.items.length > 0, 'the recommended supplier PO must open with item details');
  assert.match(detail.data.purchaseOrder.preparedSignature, /^data:image\/webp;base64,/);
  assert.match(detail.data.purchaseOrder.approvedSignature, /^data:image\/webp;base64,/);

  const signature = await imageSignature();
  const signaturePath = `/purchase-orders/${purchaseOrder.data.id}/signatures`;
  const forbiddenSignature = await request(signaturePath, {
    method: 'PATCH', user: requester, body: { preparedBySignature: signature }
  });
  assert.equal(forbiddenSignature.response.status, 403);

  const preparedUpload = await request(signaturePath, {
    method: 'PATCH', user: users.procurement, body: { preparedBySignature: signature }
  });
  assert.equal(preparedUpload.response.status, 200, preparedUpload.data.message);
  assert.match(preparedUpload.data.purchaseOrder.preparedSignature, /^data:image\/webp;base64,/);

  const approvedUpload = await request(signaturePath, {
    method: 'PATCH', user: admin, body: { approvedBySignature: signature }
  });
  assert.equal(approvedUpload.response.status, 200, approvedUpload.data.message);
  assert.match(approvedUpload.data.purchaseOrder.approvedSignature, /^data:image\/webp;base64,/);

  const signedDetail = await request(`/purchase-orders/${purchaseOrder.data.id}`, { user: admin });
  assert.match(signedDetail.data.purchaseOrder.preparedSignature, /^data:image\/webp;base64,/);
  assert.match(signedDetail.data.purchaseOrder.approvedSignature, /^data:image\/webp;base64,/);

  const invalidSignature = await request(signaturePath, {
    method: 'PATCH', user: users.procurement, body: { preparedBySignature: 'data:image/png;base64,not-an-image' }
  });
  assert.equal(invalidSignature.response.status, 400);
});

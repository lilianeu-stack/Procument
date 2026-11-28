import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import app from '../src/app.js';
import pool, { DEPARTMENT_HIERARCHY, applySchemaMigrations } from '../src/config/db.js';
import { amountInWords } from '../src/utils/money.js';
import { createRfqToken } from '../src/utils/rfq-link.js';

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
const createdGoodsReceiptIds = [];
const createdStoreRequestIds = [];
const createdRfqIds = [];
const createdPurchaseOrderIds = [];
const createdSupplierIds = [];
const createdPricingRequestIds = [];
const createdPricingResponseIds = [];
const createdGmailMessageIds = [];
const createdNotificationIds = [];

function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

async function imageSignature() {
  const buffer = await sharp({
    create: { width: 240, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function webpSignature() {
  const buffer = await sharp({
    create: { width: 240, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }
  }).webp().toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
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

// PDFKit writes text as hexadecimal strings inside TJ arrays, using numeric
// operands for kerning between fragments. Decode the text operands and ignore
// the kerning numbers so tests can assert the exact labels users see on paper.
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const token = /<([0-9A-Fa-f]+)>|\(((?:\\.|[^()\\])*)\)/g;
  return raw.replace(/\[([^\]]*)\]\s*TJ/g, (_, operands) => (
    [...operands.matchAll(token)].map((match) => (
      match[1] !== undefined
        ? Buffer.from(match[1], 'hex').toString('latin1')
        : match[2].replace(/\\([()\\])/g, '$1')
    )).join('')
  ));
}

function assertPdfIncludes(buffer, ...values) {
  const text = pdfText(buffer);
  for (const value of values) {
    assert.ok(text.includes(value), `Official PDF should contain "${value}"`);
  }
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

async function insertNotification(userId, title, link, category = 'general') {
  const [result] = await pool.execute(
    `INSERT INTO notifications (user_id, title, body, link, category)
     VALUES (?, ?, 'QA badge read-state test', ?, ?)`,
    [userId, title, link, category]
  );
  const id = Number(result.insertId);
  createdNotificationIds.push(id);
  return id;
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
  const reference = `QA-SR-${Date.now().toString().slice(-6)}-${String(suffix).slice(-4)}`;
  const [result] = await pool.execute(
    `INSERT INTO store_requests
       (reference, requester_id, department_id, purpose, status,
        stockkeeper_decision, stockkeeper_decision_by, stockkeeper_decision_at, approved_at)
     VALUES (?, ?, ?, 'QA stock issue', 'Approved', 'Accepted', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [reference, requester.id, requester.departmentId, users.stockkeeper.id]
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
  const shortSuffix = String(suffix).replace(/[^a-z0-9]/gi, '').slice(-6);
  const [result] = await pool.execute(
    `INSERT INTO requisitions
      (reference, requester_id, department_id, title, justification, budget_code, priority)
     VALUES (?, ?, ?, ?, ?, ?, 'Medium')`,
    [`QA-DEL-${shortSuffix}-${Date.now().toString().slice(-6)}`, requesterId, departmentId,
      `QA delete test ${suffix}`, 'Delete dependency test', `QA-${suffix}`]
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
  const reference = `QA-MV-${suffix}-${Date.now()}`;
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
  if (createdGoodsReceiptIds.length) {
    const placeholders = createdGoodsReceiptIds.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'goods_receipt' AND entity_id IN (${placeholders})`,
      createdGoodsReceiptIds.map(String)
    );
    await pool.execute(`DELETE FROM goods_receipts WHERE id IN (${placeholders})`, createdGoodsReceiptIds);
  }
  if (createdStoreRequestIds.length) {
    const placeholders = createdStoreRequestIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM store_request_items WHERE store_request_id IN (${placeholders})`, createdStoreRequestIds);
    await pool.execute(`DELETE FROM store_requests WHERE id IN (${placeholders})`, createdStoreRequestIds);
  }
  if (createdUserIds.length) {
    await pool.execute(`DELETE FROM notifications WHERE user_id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
  }
  if (createdNotificationIds.length) {
    const placeholders = createdNotificationIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM notifications WHERE id IN (${placeholders})`, createdNotificationIds);
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
    const placeholders = createdRfqIds.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'rfq' AND entity_id IN (${placeholders})`,
      createdRfqIds.map(String)
    );
    await pool.execute(`DELETE FROM rfqs WHERE id IN (${placeholders})`, createdRfqIds);
  }
  if (createdPricingResponseIds.length) {
    const placeholders = createdPricingResponseIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM purchase_order_pricing_response_items WHERE response_id IN (${placeholders})`, createdPricingResponseIds);
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'supplier_pricing_response' AND entity_id IN (${placeholders})`,
      createdPricingResponseIds.map(String)
    );
    await pool.execute(`DELETE FROM purchase_order_pricing_responses WHERE id IN (${placeholders})`, createdPricingResponseIds);
  }
  if (createdPricingRequestIds.length) {
    const placeholders = createdPricingRequestIds.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM audit_logs WHERE entity_type = 'purchase_order_pricing_request' AND entity_id IN (${placeholders})`,
      createdPricingRequestIds.map(String)
    );
    await pool.execute(`DELETE FROM purchase_order_pricing_requests WHERE id IN (${placeholders})`, createdPricingRequestIds);
  }
  if (createdGmailMessageIds.length) {
    const placeholders = createdGmailMessageIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM requisition_email_comments WHERE gmail_message_id IN (${placeholders})`, createdGmailMessageIds);
    await pool.execute(`DELETE FROM google_email_messages WHERE gmail_message_id IN (${placeholders})`, createdGmailMessageIds);
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

const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOo2OxUsdmJAUIBACjSBbWdzFdQAAAAAElFTkSuQmCC';

test('personal profile is available to every authenticated portal role', async () => {
  for (const key of ['admin', 'supervisorA', 'requesterA', 'stockkeeper', 'procurement']) {
    const { response, data } = await request('/profile', { user: users[key] || admin });
    assert.equal(response.status, 200, data.message);
    assert.equal(data.user.id, (users[key] || admin).id);
    assert.ok(!('password_hash' in data.user));
    assert.ok(!('passwordHash' in data.user));
  }
});

test('profile details allow only the user-controlled name and phone fields', async () => {
  const before = (await request('/profile', { user: users.requesterA })).data.user;
  const changed = await request('/profile', {
    method: 'PATCH',
    user: users.requesterA,
    body: {
      name: 'QA Requester A Updated', phone: '+250700000123',
      role: 'admin', active: false, departmentId: departments.b.id, email: 'changed@example.org'
    }
  });
  assert.equal(changed.response.status, 200, changed.data.message);
  assert.equal(changed.data.user.name, 'QA Requester A Updated');
  assert.equal(changed.data.user.phone, '+250700000123');
  assert.equal(changed.data.user.role, before.role);
  assert.equal(changed.data.user.active, true);
  assert.equal(changed.data.user.departmentId, before.departmentId);
  assert.equal(changed.data.user.email, before.email);

  // Restore the fixture name so later workflow assertions keep their identity.
  const restored = await request('/profile', {
    method: 'PATCH', user: users.requesterA,
    body: { name: before.name, phone: before.phone }
  });
  assert.equal(restored.response.status, 200, restored.data.message);
  assert.equal(restored.data.user.name, before.name);
});

test('profile photo accepts a valid image, rejects fakes, and is scoped to authorized viewers', async () => {
  const invalid = await request('/profile/photo', {
    method: 'POST',
    user: users.requesterA,
    body: { photo: { data: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` } }
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.message, /JPG|PNG|WebP|corrupt|unsupported/i);

  const uploaded = await request('/profile/photo', {
    method: 'POST',
    user: users.requesterA,
    body: { photo: { data: `data:image/png;base64,${VALID_PNG_BASE64}`, mimeType: 'image/png' } }
  });
  assert.equal(uploaded.response.status, 201, uploaded.data.message);
  const reference = uploaded.data.user.profilePhoto;
  assert.match(reference, /^profiles\/\d+-[0-9a-f-]+\.webp$/);

  const self = await binaryRequest(`/profile/photo/${users.requesterA.id}`, users.requesterA);
  assert.equal(self.response.status, 200);
  assert.match(self.response.headers.get('content-type'), /image\/webp/);
  assert.ok(self.buffer.length > 0);

  const colleague = await binaryRequest(`/profile/photo/${users.requesterA.id}`, users.supervisorA);
  assert.equal(colleague.response.status, 200);

  const otherDepartment = await binaryRequest(`/profile/photo/${users.requesterA.id}`, users.requesterB);
  assert.equal(otherDepartment.response.status, 404);

  const anonymous = await fetch(`${baseUrl}/profile/photo/${users.requesterA.id}`);
  assert.equal(anonymous.status, 401);

  const removed = await request('/profile/photo', { method: 'DELETE', user: users.requesterA });
  assert.equal(removed.response.status, 200, removed.data.message);
  assert.equal(removed.data.user.profilePhoto, null);
  assert.equal((await binaryRequest(`/profile/photo/${users.requesterA.id}`, users.requesterA)).response.status, 404);
});

test('password change verifies the current password and keeps credentials out of responses', async () => {
  const wrong = await request('/profile/password', {
    method: 'POST', user: users.requesterB,
    body: { currentPassword: 'WrongPassword!2026', newPassword: 'ChangedPassword!2026' }
  });
  assert.equal(wrong.response.status, 400);
  assert.match(wrong.data.message, /current password/i);

  const changed = await request('/profile/password', {
    method: 'POST', user: users.requesterB,
    body: { currentPassword: PASSWORD, newPassword: 'ChangedPassword!2026' }
  });
  assert.equal(changed.response.status, 200, changed.data.message);
  assert.ok(!('passwordHash' in changed.data));

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: users.requesterB.email, password: 'ChangedPassword!2026' })
  });
  assert.equal(login.status, 200);
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

test('requisition location and item remarks persist through portal and Procurement views', async () => {
  const location = 'Ward 3 - Main Store';
  const remarks = 'Deliver through the side entrance.';
  const created = await submitRequest(users.requesterA, 'FIELDS', {
    location,
    items: [{
      itemName: 'QA field item', description: 'Field test', quantity: 3,
      unit: 'box', estimatedUnitCost: 12, remarks
    }]
  });
  assert.equal(created.response.status, 201, created.data.message);
  const id = created.data.id;

  const list = await request('/portal/requester/requisitions?limit=100', { user: users.requesterA });
  assert.equal(list.response.status, 200, list.data.message);
  const listed = list.data.requisitions.find((row) => Number(row.id) === id);
  assert.ok(listed, 'the request must appear in the requester list');
  assert.equal(listed.location, location);

  const detail = await request(`/portal/requester/requisitions/${id}`, { user: users.requesterA });
  assert.equal(detail.response.status, 200, detail.data.message);
  assert.equal(detail.data.requisition.location, location);
  assert.equal(detail.data.requisition.items[0].remarks, remarks);

  const decided = await request(`/portal/supervisor/requisitions/${id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve' }
  });
  assert.equal(decided.response.status, 200, decided.data.message);
  const forwarded = await request(`/portal/supervisor/requisitions/${id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  assert.equal(forwarded.response.status, 200, forwarded.data.message);

  const receivedList = await request('/procurement/received-requests?limit=100', { user: users.procurement });
  assert.equal(receivedList.response.status, 200, receivedList.data.message);
  const receivedRow = receivedList.data.requisitions.find((row) => Number(row.id) === id);
  assert.ok(receivedRow, 'the forwarded request must appear in the Procurement queue');
  assert.equal(receivedRow.location, location);

  const receivedDetail = await request(`/procurement/received-requests/${id}`, { user: users.procurement });
  assert.equal(receivedDetail.response.status, 200, receivedDetail.data.message);
  assert.equal(receivedDetail.data.requisition.location, location);
  assert.equal(receivedDetail.data.requisition.items[0].remarks, remarks);
});

test('submitting a requisition without a location is rejected', async () => {
  const missing = await submitRequest(users.requesterA, 'NOLOCATION', { location: '' });
  assert.equal(missing.response.status, 400);
  assert.match(missing.data.message, /location/i);
});

test('draft requests can be corrected in place without changing workflow history', async () => {
  const draft = await request('/portal/requester/requisitions', {
    method: 'POST', user: users.requesterA,
    body: {
      title: 'QA draft before edit', location: 'Old store',
      justification: 'Old purpose', budgetCode: 'QA-DRAFT-EDIT', action: 'draft',
      items: [{
        itemName: 'Old item', description: 'Old detail', quantity: 1,
        unit: 'unit', estimatedUnitCost: 10, remarks: 'old remark'
      }]
    }
  });
  assert.equal(draft.response.status, 201, draft.data.message);
  const id = draft.data.id;
  createdRequisitionIds.push(id);

  const before = await request(`/portal/requester/requisitions/${id}`, { user: users.requesterA });
  assert.equal(before.response.status, 200, before.data.message);
  const originalItemId = before.data.requisition.items[0].id;
  const originalActivityCount = before.data.requisition.activity.length;

  const patch = await request(`/portal/requester/requisitions/${id}`, {
    method: 'PATCH', user: users.requesterA,
    body: {
      title: 'QA draft after edit', location: 'New store', justification: 'New purpose',
      budgetCode: 'QA-DRAFT-EDIT-2', priority: 'Urgent',
      items: [
        {
          id: originalItemId, itemName: 'Updated item', description: 'Updated detail',
          quantity: 2, unit: 'carton', estimatedUnitCost: 15, remarks: 'updated remark'
        },
        {
          itemName: 'Added item', quantity: 4, unit: 'each',
          estimatedUnitCost: 5, remarks: 'added remark'
        }
      ]
    }
  });
  assert.equal(patch.response.status, 200, patch.data.message);
  assert.equal(patch.data.reference, draft.data.reference);
  assert.equal(patch.data.status, 'Draft');
  assert.equal(patch.data.requisition.title, 'QA draft after edit');
  assert.equal(patch.data.requisition.location, 'New store');
  assert.equal(patch.data.requisition.items.length, 2);
  const kept = patch.data.requisition.items.find((item) => Number(item.id) === Number(originalItemId));
  assert.ok(kept, 'the existing item should be updated by id');
  assert.equal(kept.itemName, 'Updated item');
  assert.equal(kept.remarks, 'updated remark');
  const added = patch.data.requisition.items.find((item) => item.itemName === 'Added item');
  assert.ok(added?.id, 'a new item should be inserted');
  assert.equal(patch.data.requisition.activity.length, originalActivityCount);

  const pruned = await request(`/portal/requester/requisitions/${id}`, {
    method: 'PATCH', user: users.requesterA,
    body: {
      title: 'QA draft after edit', location: 'New store', justification: 'New purpose',
      budgetCode: 'QA-DRAFT-EDIT-2', priority: 'Urgent',
      items: [{
        id: added.id, itemName: 'Added item', quantity: 6, unit: 'each',
        estimatedUnitCost: 5, remarks: 'added remark'
      }]
    }
  });
  assert.equal(pruned.response.status, 200, pruned.data.message);
  assert.deepEqual(pruned.data.requisition.items.map((item) => Number(item.id)), [Number(added.id)]);
  assert.equal(pruned.data.requisition.activity.length, originalActivityCount);

  const wrongOwner = await request(`/portal/requester/requisitions/${id}`, {
    method: 'PATCH', user: users.requesterB, body: { items: [{ itemName: 'Hijack', quantity: 1, estimatedUnitCost: 1 }] }
  });
  assert.equal(wrongOwner.response.status, 404);

  const submitted = await request(`/portal/requester/requisitions/${id}/submit`, {
    method: 'POST', user: users.requesterA, body: {}
  });
  assert.equal(submitted.response.status, 200, submitted.data.message);
  assert.equal(submitted.data.status, 'Pending Supervisor Approval');

  const afterSubmit = await request(`/portal/requester/requisitions/${id}`, {
    method: 'PATCH', user: users.requesterA,
    body: { items: [{ itemName: 'Too late', quantity: 1, estimatedUnitCost: 1 }] }
  });
  assert.equal(afterSubmit.response.status, 409);
  assert.match(afterSubmit.data.message, /draft/i);
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

test('bin card exports isolate the selected item and keep transactions in date order', async () => {
  const itemA = await createInventoryItem('Export bin card item A', 10);
  const itemB = await createInventoryItem('Export bin card item B', 7);
  const movementA = await createMovementInDepartment(itemA.id, departments.a.id, 'BCA');
  const movementB = await createMovementInDepartment(itemB.id, departments.a.id, 'BCB');

  const report = await binaryRequest(`/exports/stockkeeperBinCard/csv?itemId=${itemA.id}`, admin);
  assert.equal(report.response.status, 200);
  const csv = report.buffer.toString('utf8');
  assert.match(csv, new RegExp(movementA.reference));
  assert.doesNotMatch(csv, new RegExp(movementB.reference));
  assert.equal((csv.match(/"Opening balance","Opening balance"/g) || []).length, 1, csv);
  assert.match(csv, /"Item code","Item","Unit","Reference"/);
  assert.doesNotMatch(csv, /sortOrder/);
});

test('admin report downloads use genuine file formats with UTF-8 CSV', async () => {
  const csv = await binaryRequest('/exports/inventory/csv', admin);
  assert.equal(csv.response.status, 200);
  assert.equal(csv.buffer[0], 0xef);
  assert.equal(csv.buffer[1], 0xbb);
  assert.equal(csv.buffer[2], 0xbf);
  assert.match(csv.buffer.toString('utf8'), /\r\n/);

  const xlsx = await binaryRequest('/exports/inventory/xlsx', admin);
  assert.equal(xlsx.response.status, 200);
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');

  const pdf = await binaryRequest('/exports/inventory/pdf', admin);
  assert.equal(pdf.response.status, 200);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
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

test('portal exports apply the same search and status filters as the list', async () => {
  const created = await submitRequest(users.requesterA, 'FILTER-PARITY', {
    title: 'Lenovo laptop request',
    items: [{
      itemName: 'Lenovo laptop', description: '16GB RAM 512GB SSD',
      quantity: 1, unit: 'unit', estimatedUnitCost: 1200
    }]
  });
  assert.equal(created.response.status, 201, created.data.message);
  const [[row]] = await pool.execute('SELECT reference FROM requisitions WHERE id = ?', [created.data.id]);

  const search = encodeURIComponent('16GB RAM');
  const list = await request(`/portal/requester/requisitions?search=${search}&limit=100`, { user: users.requesterA });
  assert.equal(list.response.status, 200);
  assert.ok(list.data.requisitions.some((item) => item.reference === row.reference), 'list should match an item description');

  const searchedCsv = await binaryRequest(`/exports/portalRequisitions/csv?search=${search}`, users.requesterA);
  assert.equal(searchedCsv.response.status, 200);
  assert.ok(searchedCsv.buffer.toString('utf8').includes(row.reference), 'export should match the same item description');

  const missingCsv = await binaryRequest(`/exports/portalRequisitions/csv?search=${encodeURIComponent('ZZ-NO-SUCH-ITEM')}`, users.requesterA);
  assert.ok(!missingCsv.buffer.toString('utf8').includes(row.reference), 'export should exclude non-matching records');

  const decided = await request(`/portal/supervisor/requisitions/${created.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve', reason: '' }
  });
  assert.equal(decided.response.status, 200, decided.data.message);

  const group = encodeURIComponent('Approved by Supervisor,Forwarded to Procurement');
  const groupedList = await request(`/portal/requester/requisitions?status=${group}&limit=100`, { user: users.requesterA });
  assert.ok(groupedList.data.requisitions.some((item) => item.reference === row.reference));
  const groupedCsv = await binaryRequest(`/exports/portalRequisitions/csv?status=${group}`, users.requesterA);
  assert.equal(groupedCsv.response.status, 200);
  assert.ok(groupedCsv.buffer.toString('utf8').includes(row.reference), 'export should support comma-separated statuses');

  const aliasCsv = await binaryRequest('/exports/portalRequisitions/csv?status=approved', users.requesterA);
  assert.ok(aliasCsv.buffer.toString('utf8').includes(row.reference), 'export should normalize status aliases');
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

test('received requests support real statistics, search, filters, sorting, pagination and exports', async () => {
  const response = await request('/procurement/received-requests?search=FORWARD&sort=forwardedAt&direction=asc&page=1&limit=1', {
    user: users.procurement
  });
  assert.equal(response.response.status, 200, response.data.message);
  assert.equal(response.data.pagination.limit, 1);
  assert.ok(response.data.requisitions.length <= 1);
  assert.ok(response.data.requisitions.every((row) => row.forwardedAt));

  const stats = await request('/procurement/received-requests/stats', { user: users.procurement });
  assert.equal(stats.response.status, 200, stats.data.message);
  assert.deepEqual(Object.keys(stats.data.stats).sort(),
    ['completed', 'new', 'processing', 'rejected', 'total', 'underReview']);
  const listTotal = await request('/procurement/received-requests?limit=1', { user: users.procurement });
  assert.equal(stats.data.stats.total, listTotal.data.pagination.total);
  assert.ok(Object.values(stats.data.stats).every((value) => Number.isInteger(value) && value >= 0));
  assert.ok(stats.data.stats.new + stats.data.stats.underReview + stats.data.stats.processing
    + stats.data.stats.completed + stats.data.stats.rejected <= stats.data.stats.total);
  assert.equal((await request('/procurement/received-requests/stats', { user: users.requesterA })).response.status, 403);
  const grouped = await request('/procurement/received-requests?statusGroup=underReview&limit=100', { user: users.procurement });
  assert.equal(grouped.response.status, 200, grouped.data.message);
  assert.ok(grouped.data.requisitions.length > 0);
  assert.ok(grouped.data.requisitions.every((row) => row.status === 'Under Procurement Review'));
  const groupedExport = await binaryRequest('/exports/receivedRequests/csv?statusGroup=underReview', users.procurement);
  assert.equal(groupedExport.response.status, 200);
  assert.ok(!groupedExport.buffer.toString('utf8').includes('Forwarded to Procurement'));

  const fresh = await submitRequest(users.requesterA, 'FILTER', {
    attachments: [{ fileName: 'filter-evidence.txt', mimeType: 'text/plain', data: Buffer.from('filter evidence').toString('base64') }]
  });
  assert.equal(fresh.response.status, 201, fresh.data.message);
  await request(`/portal/supervisor/requisitions/${fresh.data.id}/decision`, {
    method: 'POST', user: users.supervisorA, body: { decision: 'Approve' }
  });
  await request(`/portal/supervisor/requisitions/${fresh.data.id}/forward`, {
    method: 'POST', user: users.supervisorA, body: {}
  });
  const [[freshReferenceRow]] = await pool.execute('SELECT reference FROM requisitions WHERE id = ?', [fresh.data.id]);
  const reference = freshReferenceRow.reference;

  for (const [label, params] of [
    ['reference', `reference=${encodeURIComponent(reference)}`],
    ['requester', `requester=${encodeURIComponent(users.requesterA.name)}`],
    ['department query', `departmentQuery=${encodeURIComponent(departments.a.name.slice(0, 4))}`]
  ]) {
    const filteredByText = await request(`/procurement/received-requests?${params}`, { user: users.procurement });
    assert.equal(filteredByText.response.status, 200, filteredByText.data.message);
    assert.ok(filteredByText.data.requisitions.some((row) => Number(row.id) === fresh.data.id), `${label} filter`);
    assert.ok(filteredByText.data.requisitions.every((row) => Number(row.itemCount) >= 0), `${label} item count`);
  }

  const filtered = await request(`/procurement/received-requests?department=${encodeURIComponent(departments.a.name)}&status=Forwarded%20to%20Procurement`, {
    user: users.procurement
  });
  assert.equal(filtered.response.status, 200, filtered.data.message);
  assert.ok(filtered.data.requisitions.some((row) => row.department === departments.a.name && row.status === 'Forwarded to Procurement'));
  assert.ok(filtered.data.requisitions.every((row) => row.status === 'Forwarded to Procurement'));

  const freshDocument = await request(`/procurement/received-requests/${fresh.data.id}`, { user: users.procurement });
  assert.equal(freshDocument.response.status, 200, freshDocument.data.message);
  assert.equal(freshDocument.data.requisition.itemCount, 1);
  const attachmentId = freshDocument.data.requisition.attachments[0].id;
  const inlinePreview = await fetch(
    `${baseUrl}/procurement/received-requests/${fresh.data.id}/attachments/${attachmentId}?inline=1&inline=1`,
    { headers: { Authorization: `Bearer ${tokenFor(users.procurement)}`, Connection: 'close' } }
  );
  assert.equal(inlinePreview.status, 200);
  assert.match(inlinePreview.headers.get('content-disposition') || '', /inline/);

  const exportCsv = await binaryRequest(`/exports/receivedRequests/csv?reference=${encodeURIComponent(reference)}`, users.procurement);
  assert.equal(exportCsv.response.status, 200);
  assert.ok(exportCsv.buffer.toString('utf8').includes(reference));
  const exportNone = await binaryRequest('/exports/receivedRequests/csv?reference=NO-SUCH-REFERENCE', users.procurement);
  assert.equal(exportNone.response.status, 200);
  assert.ok(!exportNone.buffer.toString('utf8').includes(reference));

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

test('sidebar badge counts are real, per-user, role scoped, and clear on read', async () => {
  const supervisor = users.supervisorB;
  const requester = users.requesterB;
  const otherRequester = users.requesterA;

  for (const user of [supervisor, requester, users.procurement, users.stockkeeper]) {
    const response = await request('/sidebar-counts', { user });
    assert.equal(response.response.status, 200, response.data.message);
    assert.ok(response.data.counts && typeof response.data.counts === 'object');
  }

  const beforeSupervisor = (await request('/sidebar-counts', { user: supervisor })).data.counts;
  const beforeRequester = (await request('/sidebar-counts', { user: requester })).data.counts;
  const beforeOther = (await request('/sidebar-counts', { user: otherRequester })).data.counts;

  const [approvalNotice] = await pool.execute(
    `INSERT INTO notifications (user_id, title, body, link, category)
     VALUES (?, 'QA approval badge', 'Waiting for the Supervisor.', ?, 'general')`,
    [supervisor.id, '#/supervisor/Approvals?request=1']
  );
  const [requestNotice] = await pool.execute(
    `INSERT INTO notifications (user_id, title, body, link, category)
     VALUES (?, 'QA request badge', 'A requester update is waiting.', ?, 'general')`,
    [requester.id, '#/requester/My%20Procurement%20Requests?request=1']
  );

  const [messageResult] = await pool.execute(
    `INSERT INTO messages (department_id, sender_id, recipient_id, body, is_announcement)
     VALUES (?, ?, ?, 'QA unread sidebar badge message', FALSE)`,
    [departments.b.id, supervisor.id, requester.id]
  );
  const messageId = Number(messageResult.insertId);
  await pool.execute('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [messageId, requester.id]);
  const [messageNotice] = await pool.execute(
    `INSERT INTO notifications (user_id, title, body, link, category)
     VALUES (?, 'QA message badge', 'A new message is waiting.', ?, 'message')`,
    [requester.id, `#/requester/Messages?userId=${supervisor.id}&request=1&message=${messageId}`]
  );

  const afterSupervisor = (await request('/sidebar-counts', { user: supervisor })).data.counts;
  const afterRequester = (await request('/sidebar-counts', { user: requester })).data.counts;
  const afterOther = (await request('/sidebar-counts', { user: otherRequester })).data.counts;

  assert.equal(afterSupervisor.Approvals - (beforeSupervisor.Approvals || 0), 1);
  assert.equal(afterSupervisor['My Procurement Requests'], undefined);
  assert.equal(afterRequester.Messages - (beforeRequester.Messages || 0), 1);
  assert.equal(afterRequester['My Procurement Requests'] - (beforeRequester['My Procurement Requests'] || 0), 2);
  assert.equal((afterRequester.Notifications || 0) - (beforeRequester.Notifications || 0), 1, 'only the general request notice should count; the paired message notice must be excluded');
  assert.equal(afterRequester.Approvals, undefined);
  assert.equal(afterOther.Messages || 0, beforeOther.Messages || 0);
  assert.equal(afterOther['My Procurement Requests'] || 0, beforeOther['My Procurement Requests'] || 0);

  const marked = await request(`/notifications/${approvalNotice.insertId}/read`, { method: 'PATCH', user: supervisor });
  assert.equal(marked.response.status, 200, marked.data.message);
  const supervisorAfterRead = (await request('/sidebar-counts', { user: supervisor })).data.counts;
  assert.equal(supervisorAfterRead.Approvals || 0, beforeSupervisor.Approvals || 0);

  const thread = await request(`/portal/messages/thread?userId=${supervisor.id}`, { user: requester });
  assert.equal(thread.response.status, 200, thread.data.message);
  const unreadInThread = thread.data.messages.find((row) => Number(row.id) === messageId);
  assert.equal(unreadInThread?.isRead, false, 'loading a conversation must not mark its messages read');
  const afterNavigation = (await request('/sidebar-counts', { user: requester })).data.counts;
  assert.equal(afterNavigation.Messages, afterRequester.Messages, 'plain navigation keeps the badge unchanged');

  const markedMessage = await request(`/portal/messages/${messageId}/read`, { method: 'PATCH', user: requester });
  assert.equal(markedMessage.response.status, 200, markedMessage.data.message);
  const requesterAfterRead = (await request('/sidebar-counts', { user: requester })).data.counts;
  assert.equal(requesterAfterRead.Messages || 0, beforeRequester.Messages || 0);
  assert.equal(
    requesterAfterRead['My Procurement Requests'] || 0,
    (beforeRequester['My Procurement Requests'] || 0) + 1,
    'the conversation notice clears, while the separate request notice stays unread'
  );

  const [remainingNotice] = await pool.execute(
    'SELECT is_read AS isRead FROM notifications WHERE id = ?',
    [messageNotice.insertId]
  );
  assert.equal(Boolean(remainingNotice[0]?.isRead), true, 'opening the message clears its paired notification only for the reader');
  assert.equal(Boolean((await pool.execute('SELECT is_read AS isRead FROM notifications WHERE id = ?', [requestNotice.insertId]))[0][0]?.isRead), false);
});

test('Email Inbox sidebar count follows unread email messages and stays role scoped', async () => {
  const stamp = Date.now();
  const countsFor = async (user) => (await request('/sidebar-counts', { user })).data.counts;
  const beforeAdmin = await countsFor(admin);
  const beforeProcurement = await countsFor(users.procurement);

  const ids = [
    `qa.unread.email.${stamp}.1`,
    `qa.unread.email.${stamp}.2`,
    `qa.read.email.${stamp}.3`
  ];
  for (const [index, gmailMessageId] of ids.entries()) {
    const unread = index < 2;
    await pool.execute(
      `INSERT INTO google_email_messages
         (gmail_message_id, thread_id, sender, recipient, subject, snippet,
          body_text, labels, unread, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        gmailMessageId, `qa-thread-${gmailMessageId}`, 'qa.sender@example.test', 'procurement@example.test',
        `QA unread email badge ${stamp}-${index + 1}`, 'Unread badge fixture', 'Unread badge fixture body',
        JSON.stringify(unread ? ['UNREAD', 'INBOX'] : ['INBOX']), unread ? 1 : 0
      ]
    );
    createdGmailMessageIds.push(gmailMessageId);
  }

  const afterAdmin = await countsFor(admin);
  const afterProcurement = await countsFor(users.procurement);
  const afterRequester = await countsFor(users.requesterB);
  const afterStockkeeper = await countsFor(users.stockkeeper);

  assert.equal(
    (afterAdmin['Email Inbox'] || 0) - (beforeAdmin['Email Inbox'] || 0),
    2,
    'only unread email rows should increase the Email Inbox count'
  );
  assert.equal(
    (afterProcurement['Email Inbox'] || 0) - (beforeProcurement['Email Inbox'] || 0),
    2,
    'Procurement should receive the same Email Inbox count'
  );
  assert.equal(afterRequester['Email Inbox'], undefined, 'Requesters must not receive the Email Inbox count');
  assert.equal(afterStockkeeper['Email Inbox'], undefined, 'Stock Keepers must not receive the Email Inbox count');
});

test('sidebar badges follow real send, stepwise read, reappear, refresh, and independent recipients', async () => {
  const supervisor = users.supervisorB;
  const requester = users.requesterB;
  const stamp = Date.now();
  const secondRecipient = await createUser(
    'QA Badge Recipient', `qa.badge.recipient.${stamp}@example.org`, 'requestor', departments.b.id
  );
  const countsFor = async (account) => (await request('/sidebar-counts', { user: account })).data.counts;
  const baseline = {
    requester: await countsFor(requester),
    secondRecipient: await countsFor(secondRecipient)
  };
  const sentIds = [];

  for (let index = 1; index <= 3; index += 1) {
    const sent = await request('/portal/messages', {
      method: 'POST', user: supervisor,
      body: { recipientId: requester.id, body: `QA stepwise badge message ${stamp}-${index}` }
    });
    assert.equal(sent.response.status, 201, sent.data.message);
    sentIds.push(Number(sent.data.id));
  }

  const afterSend = await countsFor(requester);
  assert.equal(afterSend.Messages - (baseline.requester.Messages || 0), 3);
  assert.equal((await countsFor(secondRecipient)).Messages || 0, baseline.secondRecipient.Messages || 0);

  // Dashboard, conversation list, thread load, and repeated count refreshes
  // must not change the database read state.
  const summary = await request('/portal/requester/summary', { user: requester });
  assert.equal(summary.response.status, 200, summary.data.message);
  await request('/portal/messages/conversations', { user: requester });
  const thread = await request(`/portal/messages/thread?userId=${supervisor.id}`, { user: requester });
  assert.equal(thread.response.status, 200, thread.data.message);
  for (const id of sentIds) {
    assert.equal(thread.data.messages.find((row) => Number(row.id) === id)?.isRead, false);
  }
  assert.equal((await countsFor(requester)).Messages, afterSend.Messages);
  assert.equal((await countsFor(requester)).Messages, afterSend.Messages);

  for (let index = 0; index < sentIds.length; index += 1) {
    const marked = await request(`/portal/messages/${sentIds[index]}/read`, { method: 'PATCH', user: requester });
    assert.equal(marked.response.status, 200, marked.data.message);
    const afterOneRead = await countsFor(requester);
    assert.equal(afterOneRead.Messages - (baseline.requester.Messages || 0), 2 - index);

    const [readRows] = await pool.execute(
      `SELECT message_id, is_read FROM message_recipients
        WHERE user_id = ? AND message_id IN (${sentIds.map(() => '?').join(',')})`,
      [requester.id, ...sentIds]
    );
    const readById = new Map(readRows.map((row) => [Number(row.message_id), Boolean(row.is_read)]));
    for (let readIndex = 0; readIndex <= index; readIndex += 1) {
      assert.equal(readById.get(sentIds[readIndex]), true, `message ${sentIds[readIndex]} should be read`);
    }
    for (let unreadIndex = index + 1; unreadIndex < sentIds.length; unreadIndex += 1) {
      assert.equal(readById.get(sentIds[unreadIndex]), false, `message ${sentIds[unreadIndex]} should stay unread`);
    }
  }

  const newMessage = await request('/portal/messages', {
    method: 'POST', user: supervisor,
    body: { recipientId: requester.id, body: `QA reappearing badge message ${stamp}` }
  });
  assert.equal(newMessage.response.status, 201, newMessage.data.message);
  const reappeared = await countsFor(requester);
  assert.equal(reappeared.Messages - (baseline.requester.Messages || 0), 1, 'a later message must make the badge reappear');
  assert.equal((await countsFor(requester)).Messages, reappeared.Messages, 'the new count survives a later refresh');
  const markedAgain = await request(`/portal/messages/${newMessage.data.id}/read`, { method: 'PATCH', user: requester });
  assert.equal(markedAgain.response.status, 200, markedAgain.data.message);
  assert.equal((await countsFor(requester)).Messages || 0, baseline.requester.Messages || 0);

  // Announcements have one recipient row per user. Reading as one recipient
  // must not clear the other recipient's unread row or badge.
  const announcement = await request('/portal/messages', {
    method: 'POST', user: supervisor,
    body: { announcement: true, body: `QA multi-recipient badge announcement ${stamp}` }
  });
  assert.equal(announcement.response.status, 201, announcement.data.message);
  const bothUnread = {
    requester: await countsFor(requester),
    secondRecipient: await countsFor(secondRecipient)
  };
  assert.equal(bothUnread.requester.Messages - (baseline.requester.Messages || 0), 1);
  assert.equal(bothUnread.secondRecipient.Messages - (baseline.secondRecipient.Messages || 0), 1);

  const firstRecipientRead = await request(`/portal/messages/${announcement.data.id}/read`, { method: 'PATCH', user: requester });
  assert.equal(firstRecipientRead.response.status, 200, firstRecipientRead.data.message);
  assert.equal((await countsFor(requester)).Messages || 0, baseline.requester.Messages || 0);
  const otherAfterFirstRead = await countsFor(secondRecipient);
  assert.equal(otherAfterFirstRead.Messages - (baseline.secondRecipient.Messages || 0), 1, 'the second recipient stays unread');
  const [recipientRows] = await pool.execute(
    'SELECT user_id, is_read FROM message_recipients WHERE message_id = ? ORDER BY user_id',
    [announcement.data.id]
  );
  assert.equal(recipientRows.length, 2);
  assert.equal(recipientRows.find((row) => row.user_id === requester.id)?.is_read, 1);
  assert.equal(recipientRows.find((row) => row.user_id === secondRecipient.id)?.is_read, 0);
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

test('department list exposes the approved hierarchy with parent and child counts', async () => {
  const listed = await request('/admin/departments', { user: admin });
  assert.equal(listed.response.status, 200);
  const byName = new Map(listed.data.departments.map((department) => [department.name, department]));

  for (const [departmentName, subdepartments] of Object.entries(DEPARTMENT_HIERARCHY)) {
    const department = byName.get(departmentName);
    assert.ok(department, `${departmentName} must be available.`);
    assert.equal(department.parentId, null);
    assert.equal(department.parentName, null);
    assert.equal(Number(department.childCount), subdepartments.length);

    for (const subdepartmentName of subdepartments) {
      const subdepartment = byName.get(subdepartmentName);
      assert.ok(subdepartment, `${subdepartmentName} must be available.`);
      assert.equal(Number(subdepartment.parentId), Number(department.id));
      assert.equal(subdepartment.parentName, departmentName);
      assert.equal(Number(subdepartment.childCount), 0);
    }
  }
});

test('admin departments can be created and updated with a parent department', async () => {
  const stamp = Date.now();
  const parentName = `QA Hierarchy Parent ${stamp}`;
  const childName = `QA Hierarchy Child ${stamp}`;

  const parent = await request('/admin/departments', {
    method: 'POST', user: admin, body: { name: parentName, description: 'QA parent' }
  });
  assert.equal(parent.response.status, 201, parent.data.message);
  createdDepartmentIds.push(Number(parent.data.id));

  const child = await request('/admin/departments', {
    method: 'POST', user: admin, body: { name: childName, parentId: parent.data.id }
  });
  assert.equal(child.response.status, 201, child.data.message);
  assert.equal(Number(child.data.parentId), Number(parent.data.id));
  createdDepartmentIds.push(Number(child.data.id));

  const nested = await request('/admin/departments', {
    method: 'POST', user: admin,
    body: { name: `QA Hierarchy Nested ${stamp}`, parentId: child.data.id }
  });
  assert.equal(nested.response.status, 400);

  const listed = await request('/admin/departments', { user: admin });
  const listedParent = listed.data.departments.find((department) => Number(department.id) === Number(parent.data.id));
  const listedChild = listed.data.departments.find((department) => Number(department.id) === Number(child.data.id));
  assert.equal(Number(listedParent.childCount), 1);
  assert.equal(Number(listedChild.parentId), Number(parent.data.id));
  assert.equal(listedChild.parentName, parentName);

  const nestParent = await request(`/admin/departments/${parent.data.id}`, {
    method: 'PATCH', user: admin, body: { parentId: child.data.id }
  });
  assert.equal(nestParent.response.status, 400);

  const blocked = await request(`/admin/departments/${parent.data.id}`, {
    method: 'DELETE', user: admin, body: {}
  });
  assert.equal(blocked.response.status, 400);
  assert.match(blocked.data.message, /subdepartments/i);

  const childDelete = await request(`/admin/departments/${child.data.id}`, {
    method: 'DELETE', user: admin, body: {}
  });
  assert.equal(childDelete.response.status, 200, childDelete.data.message);
  const parentDelete = await request(`/admin/departments/${parent.data.id}`, {
    method: 'DELETE', user: admin, body: {}
  });
  assert.equal(parentDelete.response.status, 200, parentDelete.data.message);
});

function futureBusinessDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function createAwardedPurchaseOrder(suffix, options = {}) {
  const stamp = Date.now();
  const quoteAmount = options.quoteAmount ?? 8996000;
  const location = options.location || 'QA Purchase Order Store';
  const itemRemarks = options.itemRemarks || 'Confirm before delivery';
  const type = options.type || 'Standard';
  const department = await createDepartment(`QA PO Document Dept ${stamp}`);
  const supervisor = await createUser('QA PO Document Supervisor', `qa.po.doc.supervisor.${stamp}@example.org`, 'supervisor', department.id);
  const requester = await createUser('QA PO Document Requester', `qa.po.doc.requester.${stamp}@example.org`, 'requestor', department.id);

  const requisition = await submitRequest(requester, suffix, {
    location,
    items: [{
      itemName: `QA PO item ${suffix}`, description: 'Official form line',
      quantity: 2, unit: 'box', estimatedUnitCost: 25, remarks: itemRemarks
    }]
  });
  assert.equal(requisition.response.status, 201, requisition.data.message);
  const approvedRequest = await request(`/portal/supervisor/requisitions/${requisition.data.id}/decision`, {
    method: 'POST', user: supervisor, body: { decision: 'Approve' }
  });
  assert.equal(approvedRequest.response.status, 200, approvedRequest.data.message);
  const forwarded = await request(`/portal/supervisor/requisitions/${requisition.data.id}/forward`, {
    method: 'POST', user: supervisor, body: {}
  });
  assert.equal(forwarded.response.status, 200, forwarded.data.message);

  const supplierName = `QA PO Document Supplier ${stamp}`;
  const supplierEmail = `qa.po.doc.supplier.${stamp}@example.test`;
  const supplierResponse = await request('/suppliers', {
    method: 'POST', user: admin, body: { name: supplierName, email: supplierEmail }
  });
  assert.equal(supplierResponse.response.status, 201, supplierResponse.data.message);
  const supplierId = supplierResponse.data.id;
  createdSupplierIds.push(supplierId);
  const contactName = `QA Contact ${suffix}`;
  const phone = '0788000000';
  const address = `QA Address ${suffix}`;
  await pool.execute(
    'UPDATE suppliers SET contact_name = ?, phone = ?, address = ? WHERE id = ?',
    [contactName, phone, address, supplierId]
  );

  const rfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId: requisition.data.id, supplierIds: [supplierId], dueDate: futureBusinessDate() }
  });
  assert.equal(rfq.response.status, 201, rfq.data.message);
  createdRfqIds.push(rfq.data.id);

  const [quotes] = await pool.execute(
    `INSERT INTO quotations (rfq_id, supplier_id, amount, delivery_days, quality_score, rating_score, submitted_at)
     VALUES (?, ?, ?, 5, 4, 4, UTC_TIMESTAMP())`,
    [rfq.data.id, supplierId, quoteAmount]
  );
  const award = await request(`/rfqs/${rfq.data.id}/award`, {
    method: 'POST', user: admin, body: { quotationId: Number(quotes.insertId) }
  });
  assert.equal(award.response.status, 200, award.data.message);

  const purchaseOrder = await request('/purchase-orders', {
    method: 'POST', user: users.procurement,
    body: {
      rfqId: rfq.data.id, deliveryDate: futureBusinessDate(), type,
      preparedBySignature: await imageSignature(),
      approvedBySignature: await imageSignature()
    }
  });
  assert.equal(purchaseOrder.response.status, 201, purchaseOrder.data.message);
  createdPurchaseOrderIds.push(purchaseOrder.data.id);
  // Legacy workflow fixtures approve the PO directly. Supplier pricing is only
  // required when a test explicitly creates a supplier pricing request.
  await pool.execute(
    "UPDATE purchase_orders SET supplier_pricing_status = 'Not requested' WHERE id = ?",
    [purchaseOrder.data.id]
  );

  return {
    department, supervisor, requester,
    requisition: requisition.data,
    supplier: { id: supplierId, name: supplierName, email: supplierEmail, contactName, phone, address },
    rfq: rfq.data,
    purchaseOrder: purchaseOrder.data
  };
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

function purchaseOrderLinksIn(message) {
  return [...normalizedMessage(message).matchAll(/https?:\/\/[^\s"<>']+/g)]
    .map((match) => match[0])
    .filter((link) => link.includes('/po-approval/review?token='));
}

function tokenFrom(link) {
  return /token=([^&\s"']+)/.exec(link)?.[1] || '';
}

function attachmentBuffer(raw, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(raw || '').match(new RegExp(
    `Content-Disposition: attachment; filename="?${escaped}"?[\\s\\S]*?\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`,
    'i'
  ));
  assert.ok(match, `Email should attach ${filename}`);
  return Buffer.from(match[1].replace(/\s/g, ''), 'base64');
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

test('purchase orders calculate VAT, amount words, linkage and supplier data from the awarded quotation', async () => {
  const settingsBefore = await request('/admin/settings', { user: admin });
  assert.equal(settingsBefore.response.status, 200);
  const originalRate = settingsBefore.data.settings.tax_rate ?? 0;
  const configured = await request('/admin/settings', {
    method: 'PUT', user: admin, body: { settings: { tax_rate: 10 } }
  });
  assert.equal(configured.response.status, 200, configured.data.message);

  try {
    const context = await createAwardedPurchaseOrder('POCALC', {
      quoteAmount: 8996000, type: 'Capital', location: 'Warehouse 2',
      itemRemarks: 'Keep crates upright'
    });
    await pool.execute(
      "UPDATE purchase_orders SET supplier_pricing_status = 'Not requested' WHERE id = ?",
      [context.purchaseOrder.id]
    );
    const created = context.purchaseOrder;
    assert.equal(created.subtotal, 8996000);
    assert.equal(created.vatRate, 10);
    assert.equal(created.vatAmount, 899600);
    assert.equal(created.total, 9895600);
    assert.equal(created.amountInWords, amountInWords(9895600));

    const detail = await request(`/purchase-orders/${created.id}`, { user: users.procurement });
    assert.equal(detail.response.status, 200, detail.data.message);
    const order = detail.data.purchaseOrder;
    assert.ok(order, 'the detail response must include the purchaseOrder object');
    assert.equal(order.type, 'Capital');
    assert.equal(order.status, 'Pending approval');
    assert.equal(order.supplierContact, `${context.supplier.contactName} / ${context.supplier.phone} / ${context.supplier.email}`);
    assert.equal(order.supplierAddress, context.supplier.address);
    assert.equal(Number(order.requisitionId), context.requisition.id);
    assert.equal(Number(order.rfqId), context.rfq.id);
    assert.equal(order.requisition, context.requisition.reference);
    assert.equal(order.rfq, context.rfq.reference);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].description, 'Official form line');
    assert.equal(order.items[0].unit, 'box');
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].lineTotal, 8996000);
    assert.equal(order.subtotal, 8996000);
    assert.equal(order.vatAmount, 899600);
    assert.equal(order.total, 9895600);
    assert.equal(order.amountInWords, amountInWords(9895600));
    assert.equal(order.preparedBy, users.procurement.name);
    assert.equal(order.approvedBy, null);
    assert.equal(order.approvedAt, null);

    const requesterDetail = await request(`/purchase-orders/${created.id}`, { user: context.requester });
    assert.equal(requesterDetail.response.status, 403);
    const requesterEdit = await request(`/purchase-orders/${created.id}`, {
      method: 'PATCH', user: context.requester,
      body: { items: [{ itemName: 'Not allowed', quantity: 1, unitPrice: 1 }] }
    });
    assert.equal(requesterEdit.response.status, 403);
    const supervisorEdit = await request(`/purchase-orders/${created.id}`, {
      method: 'PATCH', user: context.supervisor,
      body: { items: [{ itemName: 'Not allowed', quantity: 1, unitPrice: 1 }] }
    });
    assert.equal(supervisorEdit.response.status, 403);

    const edited = await request(`/purchase-orders/${created.id}`, {
      method: 'PATCH', user: users.procurement,
      body: {
        type: 'Urgent', supplierContact: 'Updated contact', supplierAddress: 'Updated address',
        subtotal: 1, vatAmount: 1, total: 1, amountInWords: 'Client supplied value',
        items: [{
          id: order.items[0].id, itemName: 'Revised item', description: 'Revised detail',
          quantity: 4, unit: 'carton', unitPrice: 1000, lineTotal: 1
        }]
      }
    });
    assert.equal(edited.response.status, 200, edited.data.message);
    assert.equal(edited.data.type, 'Urgent');
    assert.equal(edited.data.supplierContact, 'Updated contact');
    assert.equal(edited.data.supplierAddress, 'Updated address');
    assert.equal(edited.data.subtotal, 4000);
    assert.equal(edited.data.vatRate, 10);
    assert.equal(edited.data.vatAmount, 400);
    assert.equal(edited.data.total, 4400);
    assert.equal(edited.data.amountInWords, amountInWords(4400));
    assert.equal(edited.data.items.length, 1);
    assert.equal(edited.data.items[0].lineTotal, 4000);
    assert.equal(edited.data.items[0].unitPrice, 1000);

    const approval = await request(`/purchase-orders/${created.id}/decision`, {
      method: 'PATCH', user: admin, body: { decision: 'Approved' }
    });
    assert.equal(approval.response.status, 200, approval.data.message);
    const approvedDetail = await request(`/purchase-orders/${created.id}`, { user: users.procurement });
    assert.equal(approvedDetail.response.status, 200);
    assert.equal(approvedDetail.data.approvedBy, admin.name);
    assert.ok(approvedDetail.data.approvedAt);

    const locked = await request(`/purchase-orders/${created.id}`, {
      method: 'PATCH', user: users.procurement,
      body: { items: [{ itemName: 'Too late', quantity: 1, unitPrice: 1 }] }
    });
    assert.equal(locked.response.status, 409);
    assert.match(locked.data.message, /pending approval/i);
  } finally {
    const restored = await request('/admin/settings', {
      method: 'PUT', user: admin, body: { settings: { tax_rate: originalRate } }
    });
    assert.equal(restored.response.status, 200);
  }
});

test('official requisition and purchase order PDFs render the supplied form templates', async () => {
  const stamp = Date.now();
  const department = await createDepartment(`QA PDF Dept ${stamp}`);
  const supervisor = await createUser('QA PDF Supervisor', `qa.pdf.supervisor.${stamp}@example.org`, 'supervisor', department.id);
  const requester = await createUser('QA PDF Requester', `qa.pdf.requester.${stamp}@example.org`, 'requestor', department.id);

  const requisition = await submitRequest(requester, 'PDFREQ', {
    location: 'Records room',
    items: [{ itemName: 'Archive boxes', quantity: 5, unit: 'box', estimatedUnitCost: 20, remarks: 'Label each box' }]
  });
  assert.equal(requisition.response.status, 201, requisition.data.message);
  const approved = await request(`/portal/supervisor/requisitions/${requisition.data.id}/decision`, {
    method: 'POST', user: supervisor, body: { decision: 'Approve' }
  });
  assert.equal(approved.response.status, 200, approved.data.message);

  const requisitionPdf = await binaryRequest(
    `/exports/record/requisition/${requisition.data.id}/pdf`, requester
  );
  assert.equal(requisitionPdf.response.status, 200);
  assert.equal(requisitionPdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assertPdfIncludes(
    requisitionPdf.buffer,
    'MATERIAL REQUEST FORM',
    'Requesting Department:',
    'Location where the items are needed:',
    'Item #', 'Item Description', 'Quantity', 'Unity of Measures', 'Remarks',
    'Purposes the goods are requested for:',
    'Name(Requested by):', 'Signature:', 'Date:', 'Name(Approved by):',
    requester.name, supervisor.name, 'Records room', 'Label each box'
  );

  const pendingRequest = await submitRequest(requester, 'PDFPENDING', {
    location: 'Front desk',
    items: [{ itemName: 'Desk lamp', quantity: 1, unit: 'unit', estimatedUnitCost: 30 }]
  });
  assert.equal(pendingRequest.response.status, 201, pendingRequest.data.message);
  const pendingPdf = await binaryRequest(
    `/exports/record/requisition/${pendingRequest.data.id}/pdf`, requester
  );
  assert.equal(pendingPdf.response.status, 200);
  assertPdfIncludes(pendingPdf.buffer, 'Name(Approved by):');
  assert.ok(!pdfText(pendingPdf.buffer).includes(supervisor.name),
    'approval details must stay blank until the Supervisor actually approves');

  const context = await createAwardedPurchaseOrder('PDFPO', { quoteAmount: 8996000 });
  const purchaseOrderId = context.purchaseOrder.id;
  await pool.execute(
    "UPDATE purchase_orders SET supplier_pricing_status = 'Not requested' WHERE id = ?",
    [purchaseOrderId]
  );
  const pendingOrderPdf = await binaryRequest(
    `/exports/record/purchaseOrder/${purchaseOrderId}/pdf`, users.procurement
  );
  assert.equal(pendingOrderPdf.response.status, 200);
  assert.equal(pendingOrderPdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assertPdfIncludes(
    pendingOrderPdf.buffer,
    'PURCHASE ORDER', 'Supplier:', 'P.O No:', 'Supplier Contact:', 'Type:',
    'Address:', 'Date:', 'Date of Delivery:',
    'Item No.', 'Quantity', 'Unit', 'Description', 'Unit Price', 'Total Price',
    'VAT:', 'Total Amount:', 'Total Amount in Words: Rwandan Francs',
    'Rwandan Francs (RWF)', 'Prepared By:', 'Approved By:',
    context.purchaseOrder.reference, context.supplier.name, context.supplier.address,
    amountInWords(context.purchaseOrder.total), users.procurement.name
  );
  assert.ok(!pdfText(pendingOrderPdf.buffer).includes(admin.name),
    'Approved By must stay blank until the purchase order is approved');

  const orderApproval = await request(`/purchase-orders/${purchaseOrderId}/decision`, {
    method: 'PATCH', user: admin, body: { decision: 'Approved' }
  });
  assert.equal(orderApproval.response.status, 200, orderApproval.data.message);
  const approvedOrderPdf = await binaryRequest(
    `/exports/record/purchaseOrder/${purchaseOrderId}/pdf`, users.procurement
  );
  assert.equal(approvedOrderPdf.response.status, 200);
  assert.ok(pdfText(approvedOrderPdf.buffer).includes(admin.name),
    'Approved By must show the approver after approval');
});

test('official purchase order PDF embeds large WebP signatures with the supplied design palette', async () => {
  const context = await createAwardedPurchaseOrder('PDFWEBP');
  const signature = await webpSignature();
  await pool.execute(
    'UPDATE purchase_orders SET prepared_signature = ?, approved_signature = ? WHERE id = ?',
    [signature, signature, context.purchaseOrder.id]
  );

  const pdf = await binaryRequest(
    `/exports/record/purchaseOrder/${context.purchaseOrder.id}/pdf`, users.procurement
  );
  assert.equal(pdf.response.status, 200);
  assertPdfIncludes(pdf.buffer, 'PURCHASE ORDER', 'Hope Haven', 'Prepared By:', 'Approved By:');

  const raw = pdf.buffer.toString('latin1');
  const imageCount = (raw.match(/\/Subtype\s*\/Image/g) || []).length;
  assert.ok(imageCount >= 3,
    `the logo and both WebP signatures should be embedded (found ${imageCount} image objects)`);
  assert.match(raw, /0\.070\d*\s+0\.239\d*\s+0\.227\d*\s+(?:scn|SCN)/,
    'the masthead and accents should use the deep teal from the design reference');
  assert.match(raw, /0\.956\d*\s+0\.968\d*\s+0\.964\d*\s+(?:scn|SCN)/,
    'the page should use the light gray outer background from the design reference');
  assert.equal((raw.match(/\/Type\s*\/Page\b/g) || []).length, 1,
    'the enlarged signatures must still fit on one page');

  const renderer = readFileSync(new URL('../src/services/exports.js', import.meta.url), 'utf8');
  assert.match(renderer, /fit: \[width - 24, 52\]/,
    'both signatures should be embedded at the enlarged size');
  const purchaseRenderer = renderer.slice(renderer.indexOf('async function drawPurchaseOrderDocument'));
  assert.match(purchaseRenderer, /emptyRows: 0/,
    'the purchase order must not add blank item rows below the real items');
  assert.doesNotMatch(purchaseRenderer, /emptyRows: Math\.max\(0, 7 - itemRows\.length\)/);
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
    assert.equal(relay.messages.length, 3);

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
    assert.equal(relay.messages.length, 3);

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
    assert.equal(relay.messages.length, 4);
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
      body: { requisitionId: secondRequisition.id, supplierIds: [invalidSupplier.id, validSupplier.id], dueDate: futureBusinessDate() }
    });
    assert.equal(invalidRfq.response.status, 201, invalidRfq.data.message);
    createdRfqIds.push(invalidRfq.data.id);
    assert.equal(invalidRfq.data.emailDelivery.failed, 1);
    assert.equal(relay.messages.length, 5);
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
    assert.equal(relay.messages.length, 5, 'a provider failure must not produce a queued message');
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

test('purchase order send-for-approval uses secure links, real SMTP, recipient-only decisions and full history', async () => {
  const envNames = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER',
    'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL', 'PO_APPROVAL_LINK_HOURS',
    'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_MAILBOX',
    'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_TOKEN_ENCRYPTION_KEY'
  ];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  const stamp = Date.now();

  // Create the procurement fixtures while email is still unconfigured so the
  // relay captures only the approval workflow messages asserted below.
  const approver = await createUser('QA PO Approver', `qa.po.approver.${stamp}@example.org`, 'approver', departments.a.id);
  const otherApprover = await createUser('QA PO Approver Two', `qa.po.approver.two.${stamp}@example.org`, 'approver', departments.a.id);
  const inactiveApprover = await createUser('QA Inactive Approver', `qa.po.approver.inactive.${stamp}@example.org`, 'approver', departments.a.id, false);
  const approveOrder = await createAwardedPurchaseOrder('POAPPA', { quoteAmount: 1234567 });
  const rejectOrder = await createAwardedPurchaseOrder('POAPPR', { quoteAmount: 2345678 });
  const securityOrder = await createAwardedPurchaseOrder('POAPPS', { quoteAmount: 3456789 });
  const missingConfigOrder = await createAwardedPurchaseOrder('POAPPM', { quoteAmount: 4567890 });
  for (const fixture of [approveOrder, rejectOrder, securityOrder, missingConfigOrder]) {
    await pool.execute(
      "UPDATE purchase_orders SET supplier_pricing_status = 'Not requested' WHERE id = ?",
      [fixture.purchaseOrder.id]
    );
  }

  function reviewTokenFor(reference) {
    const messages = relay.messages.filter((raw) => (
      purchaseOrderLinksIn(raw).length > 0 && normalizedMessage(raw).includes(reference)
    ));
    assert.ok(messages.length, `An approval email for ${reference} must be captured by the test SMTP relay.`);
    // A PO can be sent more than once; callers always want the newest link.
    const message = messages[messages.length - 1];
    const links = purchaseOrderLinksIn(message);
    assert.equal(new Set(links).size, 1, 'each approval email must contain one distinct review link');
    return tokenFrom(links[0]);
  }

  async function approvalRow(id) {
    const [[row]] = await pool.execute(
      `SELECT id, purchase_order_id AS purchaseOrderId, po_reference AS poReference,
         total, token_hash AS tokenHash, status, message, sender_email AS senderEmail,
         recipient_user_id AS recipientUserId, recipient_email AS recipientEmail,
         sent_at AS sentAt, expires_at AS expiresAt, viewed_at AS viewedAt,
         decided_at AS decidedAt, decision_comment AS decisionComment
       FROM purchase_order_approval_requests WHERE id = ?`,
      [id]
    );
    assert.ok(row, `Approval request ${id} must exist.`);
    return row;
  }

  async function auditActions(orderId) {
    const [rows] = await pool.execute(
      `SELECT action, details, previous_status AS previousStatus, new_status AS newStatus
         FROM audit_logs WHERE entity_type = 'purchase_order' AND entity_id = ? ORDER BY id`,
      [String(orderId)]
    );
    return rows;
  }

  function assertAudit(actions, action) {
    assert.ok(actions.some((row) => row.action === action), `Audit history must contain ${action}.`);
  }

  async function assertFinancialsUnchanged(orderId, before) {
    const response = await request(`/purchase-orders/${orderId}`, { user: users.procurement });
    assert.equal(response.response.status, 200);
    for (const field of ['subtotal', 'vatRate', 'vatAmount', 'total', 'deliveryDate']) {
      assert.deepEqual(response.data.purchaseOrder[field], before[field], `${field} must not change during approval`);
    }
    assert.deepEqual(
      response.data.purchaseOrder.items.map((item) => item.itemName),
      before.items.map((item) => item.itemName)
    );
  }

  try {
    const eligible = await request('/purchase-orders/approvers', { user: users.procurement });
    assert.equal(eligible.response.status, 200, eligible.data.message);
    const eligibleIds = new Set(eligible.data.users.map((user) => user.id));
    assert.ok(eligibleIds.has(approver.id), 'an active Approver must be selectable');
    assert.ok(eligibleIds.has(otherApprover.id));
    assert.ok(eligibleIds.has(admin.id), 'an active Administrator must be selectable');
    assert.ok(!eligibleIds.has(inactiveApprover.id), 'an inactive user must not be selectable');
    assert.ok(!eligibleIds.has(users.procurement.id), 'Procurement must not be selectable as its own approver');
    assert.ok(!eligibleIds.has(approveOrder.requester.id), 'a Requester must not be selectable');
    const requesterBlocked = await request('/purchase-orders/approvers', { user: users.requesterA });
    assert.equal(requesterBlocked.response.status, 403);

    relay = await startTestSmtp();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.po.smtp.${stamp}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = `qa.po.sender.${stamp}@hopehaven.test`;
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    process.env.PO_APPROVAL_LINK_HOURS = '72';

    const approveId = approveOrder.purchaseOrder.id;
    const beforeApprove = await request(`/purchase-orders/${approveId}`, { user: users.procurement });
    assert.equal(beforeApprove.response.status, 200);
    assert.equal(beforeApprove.data.purchaseOrder.status, 'Pending approval');
    const approveReference = beforeApprove.data.purchaseOrder.reference;
    const senderMessage = 'Please verify the awarded quotation totals.';

    for (const recipientId of [0, approveOrder.supplier.id, inactiveApprover.id, users.procurement.id]) {
      const rejected = await request(`/purchase-orders/${approveId}/send-for-approval`, {
        method: 'POST', user: users.procurement, body: { recipientId }
      });
      assert.equal(rejected.response.status, 400, `recipientId ${recipientId} must be rejected`);
    }
    const selfSend = await request(`/purchase-orders/${approveId}/send-for-approval`, {
      method: 'POST', user: admin, body: { recipientId: admin.id }
    });
    assert.equal(selfSend.response.status, 400);
    assert.match(selfSend.data.message, /another authorized user/i);
    assert.equal(relay.messages.length, 0, 'invalid recipients must not receive email');

    const sentApprove = await request(`/purchase-orders/${approveId}/send-for-approval`, {
      method: 'POST', user: users.procurement,
      body: { recipientId: approver.id, message: senderMessage }
    });
    assert.equal(sentApprove.response.status, 200, sentApprove.data.message);
    assert.match(sentApprove.data.message, /^Sent for approval\.$/);
    assert.equal(sentApprove.data.emailDelivery.ok, true);
    assert.equal(sentApprove.data.emailDelivery.status, 'Accepted by Email Provider');
    assert.equal(relay.messages.length, 1);
    assert.equal(sentApprove.data.approval.status, 'Pending');
    assert.equal(sentApprove.data.approval.purchaseOrder.status, 'Pending approval');
    assert.equal(sentApprove.data.approval.message, senderMessage);
    assert.equal(sentApprove.data.approval.sender.email, users.procurement.email);
    assert.equal(sentApprove.data.approval.recipient.email, approver.email);

    const reviewMessage = normalizedMessage(relay.messages[0]);
    for (const expected of [
      'View Purchase Order', approveReference, beforeApprove.data.purchaseOrder.supplier,
      `RWF ${Number(beforeApprove.data.purchaseOrder.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      String(beforeApprove.data.purchaseOrder.deliveryDate).slice(0, 10),
      senderMessage, approver.email
    ]) {
      assert.ok(reviewMessage.includes(expected), `approval email must include ${expected}`);
    }
    const approveToken = reviewTokenFor(approveReference);
    assert.match(approveToken, /^[A-Za-z0-9_-]{43}$/, 'the token must be 256 bits in base64url form');
    const approveLink = purchaseOrderLinksIn(relay.messages[0])[0];
    assert.ok(approveLink.startsWith('http://localhost:5173/#/po-approval/review?token='));
    assert.ok(!approveLink.includes('id='), 'the public URL must not contain a database identifier');
    assert.ok(!approveLink.includes(`/purchase-orders/${approveId}`));

    const sentRow = await approvalRow(sentApprove.data.approval.id);
    assert.equal(sentRow.tokenHash, createHash('sha256').update(approveToken).digest('hex'));
    assert.notEqual(sentRow.tokenHash, approveToken, 'the raw token must never be stored');
    const [[plaintextMatches]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM purchase_order_approval_requests WHERE token_hash = ?',
      [approveToken]
    );
    assert.equal(plaintextMatches.total, 0);
    assert.equal(sentRow.status, 'Pending');
    assert.equal(sentRow.recipientUserId, approver.id);
    assert.equal(sentRow.message, senderMessage);
    const sentActions = await auditActions(approveId);
    assertAudit(sentActions, 'sent_for_approval');
    assertAudit(sentActions, 'review_email_sent');
    assert.equal(JSON.parse(sentActions.find((row) => row.action === 'sent_for_approval').details).recipientEmail, approver.email);

    const publicPath = `/purchase-order-approvals/${approveToken}`;
    const anonymousView = await request(publicPath);
    assert.equal(anonymousView.response.status, 401);
    assert.match(anonymousView.data.message, /Sign in with the intended recipient/i);
    assert.ok(!JSON.stringify(anonymousView.data).includes(approveReference), 'the PO must not be revealed before sign-in');
    const wrongUserView = await request(publicPath, { user: otherApprover });
    assert.equal(wrongUserView.response.status, 403);
    assert.ok(!JSON.stringify(wrongUserView.data).includes(approveReference), 'a forwarded link must not reveal the PO');
    const wrongRoleView = await request(publicPath, { user: users.procurement });
    assert.equal(wrongRoleView.response.status, 403);

    const viewed = await request(publicPath, { user: approver });
    assert.equal(viewed.response.status, 200, viewed.data.message);
    assert.equal(viewed.data.approval.purchaseOrder.reference, approveReference);
    assert.equal(viewed.data.approval.purchaseOrder.preparedBy, users.procurement.name);
    assert.equal(viewed.data.approval.purchaseOrder.rfq, approveOrder.rfq.reference);
    assert.equal(viewed.data.approval.sender.name, users.procurement.name);
    assert.equal(viewed.data.approval.recipient.email, approver.email);
    assert.equal(viewed.data.approval.message, senderMessage);
    assert.ok(viewed.data.approval.viewedAt, 'viewing must be recorded');
    assert.ok(Array.isArray(viewed.data.approval.purchaseOrder.items));
    await request(publicPath, { user: approver });
    assert.equal((await auditActions(approveId)).filter((row) => row.action === 'approval_link_viewed').length, 1);

    const noReason = await request(`${publicPath}/decision`, {
      method: 'POST', user: approver, body: { decision: 'Rejected' }
    });
    assert.equal(noReason.response.status, 400);
    assert.match(noReason.data.message, /reason is required/i);
    const unauthorizedDecision = await request(`${publicPath}/decision`, {
      method: 'POST', user: otherApprover, body: { decision: 'Approved' }
    });
    assert.equal(unauthorizedDecision.response.status, 403);
    assert.equal(relay.messages.length, 1, 'an invalid or unauthorized decision must not notify anyone');

    const missingSignature = await request(`${publicPath}/decision`, {
      method: 'POST', user: approver,
      body: { decision: 'Approved', comment: 'Amounts verified against the awarded quotation.' }
    });
    assert.equal(missingSignature.response.status, 400);
    assert.match(missingSignature.data.message, /signature image before approving/i);

    const approvalSignature = await imageSignature();
    const approved = await request(`${publicPath}/decision`, {
      method: 'POST', user: approver,
      body: {
        decision: 'Approved', comment: 'Amounts verified against the awarded quotation.',
        signature: approvalSignature
      }
    });
    assert.equal(approved.response.status, 200, approved.data.message);
    assert.equal(approved.data.approval.status, 'Approved');
    assert.equal(approved.data.approval.purchaseOrder.status, 'Approved');
    assert.equal(approved.data.approval.purchaseOrder.approvedBy, approver.name);
    assert.match(approved.data.approval.purchaseOrder.approvedSignature, /^data:image\/webp;base64,/);
    assert.equal(approved.data.approval.decisionComment, 'Amounts verified against the awarded quotation.');
    assert.equal(approved.data.emailDelivery.ok, true);
    assert.equal(relay.messages.length, 2);
    const approvalEmail = normalizedMessage(relay.messages[1]);
    assert.ok(approvalEmail.includes(approveReference));
    assert.ok(approvalEmail.includes('has been approved'));
    assert.ok(approvalEmail.includes(approver.name));
    assert.ok(approvalEmail.includes('Amounts verified against the awarded quotation.'));
    assert.ok(approvalEmail.includes(users.procurement.email));
    assert.ok(approvalEmail.includes('/#/admin/Procurement%20Processing'));
    await assertFinancialsUnchanged(approveId, beforeApprove.data.purchaseOrder);
    const replay = await request(`${publicPath}/decision`, {
      method: 'POST', user: approver, body: { decision: 'Rejected', comment: 'Changed my mind.' }
    });
    assert.equal(replay.response.status, 409, 'a decided link must not be reusable');
    const approvedActions = await auditActions(approveId);
    assertAudit(approvedActions, 'approved');
    assertAudit(approvedActions, 'decision_email_sent');
    assert.equal(JSON.parse(approvedActions.find((row) => row.action === 'approved').details).recipientUserId, approver.id);

    const rejectId = rejectOrder.purchaseOrder.id;
    const beforeReject = await request(`/purchase-orders/${rejectId}`, { user: users.procurement });
    const rejectReference = beforeReject.data.purchaseOrder.reference;
    const sentReject = await request(`/purchase-orders/${rejectId}/send-for-approval`, {
      method: 'POST', user: users.procurement, body: { recipientId: otherApprover.id, message: 'Check supplier history.' }
    });
    assert.equal(sentReject.response.status, 200, sentReject.data.message);
    const rejectToken = reviewTokenFor(rejectReference);
    assert.notEqual(rejectToken, approveToken);
    const rejectPublicPath = `/purchase-order-approvals/${rejectToken}`;
    const rejectView = await request(rejectPublicPath, { user: otherApprover });
    assert.equal(rejectView.response.status, 200, rejectView.data.message);
    const rejected = await request(`${rejectPublicPath}/decision`, {
      method: 'POST', user: otherApprover,
      body: { decision: 'Rejected', comment: 'The supplier failed the quality review.' }
    });
    assert.equal(rejected.response.status, 200, rejected.data.message);
    assert.equal(rejected.data.approval.status, 'Rejected');
    assert.equal(rejected.data.approval.purchaseOrder.status, 'Rejected');
    assert.equal(rejected.data.approval.decisionComment, 'The supplier failed the quality review.');
    assert.equal(rejected.data.emailDelivery.ok, true);
    assert.equal(relay.messages.length, 4);
    const rejectionEmail = normalizedMessage(relay.messages[3]);
    assert.ok(rejectionEmail.includes(rejectReference));
    assert.ok(rejectionEmail.includes('has been rejected'));
    assert.ok(rejectionEmail.includes('The supplier failed the quality review.'));
    assert.ok(rejectionEmail.includes(users.procurement.email));
    await assertFinancialsUnchanged(rejectId, beforeReject.data.purchaseOrder);
    assertAudit(await auditActions(rejectId), 'rejected');

    const secureId = securityOrder.purchaseOrder.id;
    const beforeSecure = await request(`/purchase-orders/${secureId}`, { user: users.procurement });
    const secureReference = beforeSecure.data.purchaseOrder.reference;
    const firstSend = await request(`/purchase-orders/${secureId}/send-for-approval`, {
      method: 'POST', user: users.procurement, body: { recipientId: approver.id }
    });
    assert.equal(firstSend.response.status, 200, firstSend.data.message);
    const firstToken = reviewTokenFor(secureReference);
    const revoked = await request(`/purchase-orders/${secureId}/approvals/${firstSend.data.approval.id}/revoke`, {
      method: 'PATCH', user: users.procurement, body: {}
    });
    assert.equal(revoked.response.status, 200, revoked.data.message);
    assert.equal((await approvalRow(firstSend.data.approval.id)).status, 'Revoked');
    const revokedView = await request(`/purchase-order-approvals/${firstToken}`, { user: approver });
    assert.equal(revokedView.response.status, 410);
    assert.match(revokedView.data.message, /revoked/i);
    const revokedDecision = await request(`/purchase-order-approvals/${firstToken}/decision`, {
      method: 'POST', user: approver, body: { decision: 'Approved' }
    });
    assert.equal(revokedDecision.response.status, 410);
    const genericBlocked = await request(`/purchase-orders/${secureId}/decision`, {
      method: 'PATCH', user: approver, body: { decision: 'Approved' }
    });
    assert.equal(genericBlocked.response.status, 409);
    assert.match(genericBlocked.data.message, /send a new link/i);

    const secondSend = await request(`/purchase-orders/${secureId}/send-for-approval`, {
      method: 'POST', user: users.procurement, body: { recipientId: otherApprover.id }
    });
    assert.equal(secondSend.response.status, 200, secondSend.data.message);
    const secondToken = reviewTokenFor(secureReference);
    assert.notEqual(secondToken, firstToken);
    const secondWrongUser = await request(`/purchase-order-approvals/${secondToken}`, { user: approver });
    assert.equal(secondWrongUser.response.status, 403, 'a token is bound to exactly one recipient');
    const secondView = await request(`/purchase-order-approvals/${secondToken}`, { user: otherApprover });
    assert.equal(secondView.response.status, 200, secondView.data.message);

    const thirdSend = await request(`/purchase-orders/${secureId}/send-for-approval`, {
      method: 'POST', user: users.procurement, body: { recipientId: approver.id }
    });
    assert.equal(thirdSend.response.status, 200, thirdSend.data.message);
    const thirdToken = reviewTokenFor(secureReference);
    assert.equal(new Set([firstToken, secondToken, thirdToken]).size, 3);
    assert.equal((await approvalRow(secondSend.data.approval.id)).status, 'Superseded');
    const supersededView = await request(`/purchase-order-approvals/${secondToken}`, { user: otherApprover });
    assert.equal(supersededView.response.status, 410);
    assert.match(supersededView.data.message, /newer approval link/i);

    await pool.execute(
      `UPDATE purchase_order_approval_requests
          SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
        WHERE id = ?`,
      [thirdSend.data.approval.id]
    );
    const expiredView = await request(`/purchase-order-approvals/${thirdToken}`, { user: approver });
    assert.equal(expiredView.response.status, 410);
    assert.match(expiredView.data.message, /expired/i);
    assert.equal((await approvalRow(thirdSend.data.approval.id)).status, 'Expired');
    const expiredDecision = await request(`/purchase-order-approvals/${thirdToken}/decision`, {
      method: 'POST', user: approver, body: { decision: 'Approved' }
    });
    assert.equal(expiredDecision.response.status, 410);
    const genericExpired = await request(`/purchase-orders/${secureId}/decision`, {
      method: 'PATCH', user: approver, body: { decision: 'Approved' }
    });
    assert.equal(genericExpired.response.status, 409);
    const secureAfter = await request(`/purchase-orders/${secureId}`, { user: users.procurement });
    assert.equal(secureAfter.data.purchaseOrder.status, 'Pending approval');
    await assertFinancialsUnchanged(secureId, beforeSecure.data.purchaseOrder);
    for (const token of [firstToken, secondToken, thirdToken]) {
      assert.notEqual(createHash('sha256').update(token).digest('hex'), token);
      const [[match]] = await pool.execute(
        'SELECT COUNT(*) AS total FROM purchase_order_approval_requests WHERE token_hash = ?',
        [token]
      );
      assert.equal(match.total, 0, 'raw tokens must never be recoverable from the database');
    }
    const secureActions = await auditActions(secureId);
    assertAudit(secureActions, 'sent_for_approval');
    assertAudit(secureActions, 'approval_link_revoked');
    assertAudit(secureActions, 'approval_link_superseded');
    assertAudit(secureActions, 'approval_link_viewed');
    assert.equal(secureActions.filter((row) => row.action === 'sent_for_approval').length, 3);

    // With the provider configuration removed, the request is still saved but
    // the response reports the exact missing variables and never claims delivery.
    for (const name of [
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
      'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_MAILBOX',
      'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_TOKEN_ENCRYPTION_KEY'
    ]) delete process.env[name];
    const messagesBeforeMissingConfig = relay.messages.length;
    const missingConfigId = missingConfigOrder.purchaseOrder.id;
    const missingConfig = await request(`/purchase-orders/${missingConfigId}/send-for-approval`, {
      method: 'POST', user: users.procurement, body: { recipientId: approver.id }
    });
    assert.equal(missingConfig.response.status, 200, missingConfig.data.message);
    assert.equal(missingConfig.data.emailDelivery.ok, false);
    assert.equal(missingConfig.data.emailDelivery.reason, 'not_configured');
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
      assert.match(missingConfig.data.message, new RegExp(name), `the response must name missing ${name}`);
    }
    assert.match(missingConfig.data.message, /not delivered/i);
    assert.doesNotMatch(missingConfig.data.message, /email delivered|delivery confirmed|has been delivered/i);
    assert.equal(relay.messages.length, messagesBeforeMissingConfig, 'an unconfigured provider must not queue a message');
    assert.equal((await approvalRow(missingConfig.data.approval.id)).status, 'Pending');
    const missingActions = await auditActions(missingConfigId);
    assertAudit(missingActions, 'sent_for_approval');
    assert.equal(JSON.parse(missingActions.find((row) => row.action === 'review_email_sent').details).emailStatus, 'Failed');
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('supplier pricing requests keep original purchase orders, isolate private links and compare submitted quotations', async () => {
  const envNames = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER',
    'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL',
    'PO_SUPPLIER_PRICING_LINK_HOURS'
  ];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  const stamp = Date.now();
  const fixture = await createAwardedPurchaseOrder('SPRICE', { quoteAmount: 7777777 });
  const poId = fixture.purchaseOrder.id;
  await pool.execute(
    "UPDATE purchase_orders SET supplier_pricing_status = 'Required' WHERE id = ?",
    [poId]
  );
  const beforeResult = await request(`/purchase-orders/${poId}`, { user: users.procurement });
  assert.equal(beforeResult.response.status, 200, beforeResult.data.message);
  const original = beforeResult.data.purchaseOrder;
  const originalLine = original.items[0];
  const poItemId = Number(originalLine.id);
  const prematureApproval = await request(`/purchase-orders/${poId}/send-for-approval`, {
    method: 'POST', user: users.procurement, body: { recipientId: admin.id }
  });
  assert.equal(prematureApproval.response.status, 409);
  const prematureDecision = await request(`/purchase-orders/${poId}/decision`, {
    method: 'PATCH', user: admin, body: { decision: 'Approved' }
  });
  assert.equal(prematureDecision.response.status, 409);
  const deadline = futureBusinessDate();
  const senderMessage = 'Please quote the line items below for this purchase order.';

  const settingsResult = await request('/admin/settings', { user: admin });
  assert.equal(settingsResult.response.status, 200);
  const taxRate = Number(settingsResult.data.settings.tax_rate) || 0;

  function pricingLinksIn(raw) {
    return [...normalizedMessage(raw).matchAll(/https?:\/\/[^\s"<>']+/g)]
      .map((match) => match[0])
      .filter((link) => link.includes('/supplier-pricing/quote?token='));
  }

  async function makeSupplier(label, email) {
    const name = `QA Pricing ${label} ${stamp}`;
    const created = await request('/suppliers', { method: 'POST', user: admin, body: { name, email } });
    assert.equal(created.response.status, 201, created.data.message);
    createdSupplierIds.push(created.data.id);
    const contactName = `QA Pricing Contact ${label}`;
    const address = `QA Pricing Address ${label}`;
    await pool.execute(
      'UPDATE suppliers SET contact_name = ?, address = ?, status = ? WHERE id = ?',
      [contactName, address, 'Active', created.data.id]
    );
    return { id: created.data.id, name, email, contactName, address };
  }

  async function registerPricingRows(requestId) {
    const [rows] = await pool.execute(
      'SELECT id FROM purchase_order_pricing_responses WHERE request_id = ?', [requestId]
    );
    for (const row of rows) {
      if (!createdPricingResponseIds.includes(Number(row.id))) createdPricingResponseIds.push(Number(row.id));
    }
  }

  async function responseRows(requestId) {
    const [rows] = await pool.execute(
      `SELECT id, supplier_id AS supplierId, token_hash AS tokenHash, status,
         email_status AS emailStatus, email_attempts AS emailAttempts,
         submitted_at AS submittedAt, opened_at AS openedAt
        FROM purchase_order_pricing_responses WHERE request_id = ? ORDER BY id`,
      [requestId]
    );
    return rows;
  }

  function expectedTotals(unitPrice) {
    const subtotal = Math.round((unitPrice * Number(originalLine.quantity) + Number.EPSILON) * 100) / 100;
    const vatAmount = Math.round((subtotal * taxRate + Number.EPSILON)) / 100;
    return { subtotal, vatAmount, total: Math.round((subtotal + vatAmount + Number.EPSILON) * 100) / 100 };
  }

  try {
    relay = await startTestSmtp();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.pricing.smtp.${stamp}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = `qa.pricing.sender.${stamp}@hopehaven.test`;
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    process.env.PO_SUPPLIER_PRICING_LINK_HOURS = '72';

    const supplierA = await makeSupplier('A', `qa.pricing.a.${stamp}@example.test`);
    const supplierB = await makeSupplier('B', `qa.pricing.b.${stamp}@example.test`);
    const supplierC = await makeSupplier('C', `qa.pricing.c.${stamp}@example.test`);
    const supplierD = await makeSupplier('D', `qa.pricing.d.${stamp}@example.test`);
    const invalidSupplier = await makeSupplier('Invalid', 'not-an-email');
    const inactiveSupplier = await makeSupplier('Inactive', `qa.pricing.inactive.${stamp}@example.test`);
    await pool.execute('UPDATE suppliers SET status = ? WHERE id = ?', ['Inactive', inactiveSupplier.id]);

    const [foreignRows] = await pool.execute(
      'SELECT id FROM purchase_order_items WHERE purchase_order_id <> ? LIMIT 1', [poId]
    );
    let foreignItemId = foreignRows[0] ? Number(foreignRows[0].id) : null;
    if (!foreignItemId) {
      const other = await createAwardedPurchaseOrder('SPRXITEM', { quoteAmount: 123456 });
      const otherOrder = await request(`/purchase-orders/${other.purchaseOrder.id}`, { user: users.procurement });
      foreignItemId = Number(otherOrder.data.purchaseOrder.items[0].id);
    }

    const invalidAttempt = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement,
      body: { supplierIds: [supplierA.id, invalidSupplier.id, inactiveSupplier.id], submissionDeadline: deadline }
    });
    assert.equal(invalidAttempt.response.status, 400, invalidAttempt.data.message);
    assert.match(invalidAttempt.data.message, new RegExp(invalidSupplier.name));
    assert.match(invalidAttempt.data.message, new RegExp(inactiveSupplier.name));
    assert.match(invalidAttempt.data.message, /not-an-email/);
    assert.equal(relay.messages.length, 0, 'invalid suppliers must not receive a pricing link');

    const duplicateSelection = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement,
      body: { supplierIds: [supplierA.id, supplierA.id] }
    });
    assert.equal(duplicateSelection.response.status, 400);

    const sent = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement,
      body: {
        supplierIds: [supplierA.id, supplierB.id],
        message: senderMessage,
        submissionDeadline: deadline
      }
    });
    assert.equal(sent.response.status, 201, sent.data.message);
    assert.match(sent.data.message, /saved/i);
    assert.equal(sent.data.emailDelivery.total, 2);
    assert.equal(sent.data.emailDelivery.accepted, 2, JSON.stringify(sent.data.deliveries));
    assert.equal(sent.data.emailDelivery.failed, 0);
    assert.equal(relay.messages.length, 2);
    createdPricingRequestIds.push(sent.data.requestId);
    await registerPricingRows(sent.data.requestId);

    const duplicateLink = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement,
      body: { supplierIds: [supplierA.id, supplierB.id] }
    });
    assert.equal(duplicateLink.response.status, 409);
    assert.match(duplicateLink.data.message, /already exists/i);

    const tokens = [];
    const suppliers = [supplierA, supplierB];
    for (let index = 0; index < suppliers.length; index += 1) {
      const supplier = suppliers[index];
      const raw = normalizedMessage(relay.messages[index]);
      const links = pricingLinksIn(relay.messages[index]);
      assert.equal(new Set(links).size, 1, 'each invitation must carry one distinct private link');
      assert.ok(links[0].startsWith('http://localhost:5173/#/supplier-pricing/quote?token='));
      const token = tokenFrom(links[0]);
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      tokens.push(token);
      for (const expected of [
        supplier.name, original.reference, 'Official form line', '2 box', deadline,
        senderMessage, 'Open Purchase Order / Submit Prices'
      ]) {
        assert.ok(raw.includes(expected), `pricing email must include ${expected}`);
      }
      const other = suppliers.find((entry) => entry.id !== supplier.id);
      assert.ok(!raw.includes(other.name), 'an invitation must not reveal another supplier');
      assert.ok(!raw.includes(other.email), 'an invitation must not reveal another supplier email');
      for (const originalPrice of [
        String(original.total), String(original.subtotal), String(originalLine.unitPrice),
        original.amountInWords || 'amount in words sentinel'
      ]) {
        assert.ok(!raw.includes(originalPrice), `the invitation must not reveal the original price ${originalPrice}`);
      }
    }
    assert.equal(new Set(tokens).size, 2, 'each supplier must receive a different token');

    const rowsAfterSend = await responseRows(sent.data.requestId);
    assert.equal(rowsAfterSend.length, 2);
    for (const token of tokens) {
      const [[plaintextMatches]] = await pool.execute(
        'SELECT COUNT(*) AS total FROM purchase_order_pricing_responses WHERE token_hash = ?', [token]
      );
      assert.equal(plaintextMatches.total, 0, 'a raw token must never be stored');
    }
    for (const row of rowsAfterSend) {
      const matchingToken = tokens.find((token) => createHash('sha256').update(token).digest('hex') === row.tokenHash);
      assert.ok(matchingToken, 'stored hash must be SHA-256 of the emailed token');
      assert.notEqual(row.tokenHash, matchingToken);
      assert.equal(row.emailStatus, 'Accepted by Email Provider');
      assert.equal(row.status, 'Invited');
      assert.equal(row.emailAttempts, 1);
      assert.ok(row.openedAt === null);
    }

    const publicDocuments = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const opened = await request(`/supplier-pricing/${encodeURIComponent(tokens[index])}`);
      assert.equal(opened.response.status, 200, opened.data.message);
      const document = opened.data;
      publicDocuments.push(document);
      assert.equal(document.pricingRequest.reference, sent.data.reference);
      assert.equal(document.pricingRequest.purchaseOrderReference, original.reference);
      assert.equal(document.pricingRequest.organization.name, 'Hope Haven');
      assert.equal(document.pricingRequest.submissionDeadline, deadline);
      assert.equal(document.pricingRequest.supplier.name, suppliers[index].name);
      assert.equal(document.pricingRequest.supplier.email, suppliers[index].email);
      assert.equal(document.pricingRequest.isSubmitted, false);
      // The supplier's own line prices are seeded from the purchase order so
      // the form opens with unit prices and totals already filled in.
      assert.ok(document.response, 'the supplier view includes its seeded prices');
      assert.equal(document.response.items.length, 1);
      assert.equal(Number(document.response.items[0].purchaseOrderItemId), poItemId);
      assert.equal(Number(document.response.items[0].unitPrice), Number(originalLine.unitPrice));
      assert.equal(Number(document.response.items[0].lineTotal),
        Math.round((Number(originalLine.unitPrice) * Number(originalLine.quantity) + Number.EPSILON) * 100) / 100);
      // The exact purchase order created by Procurement is part of the link.
      assert.equal(document.purchaseOrder.reference, original.reference);
      assert.equal(document.purchaseOrder.supplier, original.supplier);
      assert.equal(document.purchaseOrder.status, original.status);
      assert.ok('preparedSignature' in document.purchaseOrder);
      assert.ok('approvedSignature' in document.purchaseOrder);
      assert.equal(document.purchaseOrder.items.length, 1);
      assert.equal(Number(document.purchaseOrder.items[0].unitPrice), Number(originalLine.unitPrice));
      assert.equal(document.items.length, 1);
      assert.equal(document.items[0].description, 'Official form line');
      assert.equal(Number(document.items[0].quantity), Number(originalLine.quantity));
      assert.equal(document.items[0].unit, originalLine.unit);
      const json = JSON.stringify(document);
      const other = suppliers.find((entry) => entry.id !== suppliers[index].id);
      assert.ok(!json.includes(other.name));
      assert.ok(!json.includes(other.email));
      // Line prices and line totals are intentionally shown to the supplier.
      // Raw tokens, column names and the written-out amount stay private.
      for (const secret of ['token_hash', 'tokenHash', 'unit_price', 'amount_in_words']) {
        assert.ok(!json.includes(secret), `private pricing view must not expose ${secret}`);
      }
    }
    const afterOpenRows = await responseRows(sent.data.requestId);
    assert.ok(afterOpenRows.every((row) => row.openedAt && row.status === 'Opened'));

    const foreignInjection = await request(`/supplier-pricing/${encodeURIComponent(tokens[1])}/draft`, {
      method: 'PATCH',
      body: { items: [{ purchaseOrderItemId: foreignItemId, unitPrice: 1 }] }
    });
    assert.equal(foreignInjection.response.status, 400);
    assert.match(foreignInjection.data.message, /does not belong/i);

    const priceA = 1250.75;
    const priceB = 980;
    const submittedA = await request(`/supplier-pricing/${encodeURIComponent(tokens[0])}/submit`, {
      method: 'POST',
      body: {
        items: [{ purchaseOrderItemId: poItemId, unitPrice: priceA }],
        quotationValidity: '30 days',
        deliveryLeadTime: '7 working days',
        comments: 'Includes delivery',
        technicalRemarks: 'Brand approved',
        confirm: true
      }
    });
    assert.equal(submittedA.response.status, 200, submittedA.data.message);
    assert.equal(submittedA.data.response.status, 'Submitted');
    assert.ok(submittedA.data.response.submittedAt);
    assert.equal(submittedA.data.reference, sent.data.reference);
    assert.equal(submittedA.data.response.subtotal, expectedTotals(priceA).subtotal);
    assert.equal(submittedA.data.response.vatAmount, expectedTotals(priceA).vatAmount);
    assert.equal(submittedA.data.response.total, expectedTotals(priceA).total);
    assert.equal(submittedA.data.response.items[0].unitPrice, priceA);
    assert.equal(submittedA.data.response.items[0].lineTotal, expectedTotals(priceA).subtotal);
    assert.equal(submittedA.data.response.comments, 'Includes delivery');

    const submittedB = await request(`/supplier-pricing/${encodeURIComponent(tokens[1])}/submit`, {
      method: 'POST',
      body: {
        items: [{ purchaseOrderItemId: poItemId, unitPrice: priceB }],
        quotationValidity: '45 days',
        deliveryLeadTime: '10 working days',
        comments: 'Alternative brand',
        technicalRemarks: 'Equivalent specification',
        confirm: true
      }
    });
    assert.equal(submittedB.response.status, 200, submittedB.data.message);
    assert.equal(submittedB.data.response.status, 'Submitted');
    assert.equal(submittedB.data.response.total, expectedTotals(priceB).total);
    assert.equal(submittedB.data.response.vatRate, taxRate);

    const readOnly = await request(`/supplier-pricing/${encodeURIComponent(tokens[0])}`);
    assert.equal(readOnly.response.status, 200);
    assert.equal(readOnly.data.pricingRequest.isSubmitted, true);
    assert.equal(readOnly.data.response.status, 'Submitted');
    assert.equal(readOnly.data.response.items[0].unitPrice, priceA);
    assert.equal(readOnly.data.response.items[0].lineTotal, expectedTotals(priceA).subtotal);
    assert.ok(!JSON.stringify(readOnly.data).includes(String(priceB)));
    assert.ok(readOnly.data.response.technicalRemarks === 'Brand approved');

    const replay = await request(`/supplier-pricing/${encodeURIComponent(tokens[0])}/submit`, {
      method: 'POST', body: { items: [{ purchaseOrderItemId: poItemId, unitPrice: 1 }], confirm: true }
    });
    assert.equal(replay.response.status, 409, 'a submitted quotation cannot be replayed');
    const submittedDraft = await request(`/supplier-pricing/${encodeURIComponent(tokens[0])}/draft`, {
      method: 'PATCH', body: { items: [] }
    });
    assert.equal(submittedDraft.response.status, 409);
    const missingConfirm = await request(`/supplier-pricing/${encodeURIComponent(tokens[0])}/submit`, {
      method: 'POST', body: { items: [{ purchaseOrderItemId: poItemId, unitPrice: 1 }] }
    });
    assert.equal(missingConfirm.response.status, 409, 'submission state is checked before confirmation');

    const overview = await request(`/purchase-orders/${poId}/supplier-responses`, { user: admin });
    assert.equal(overview.response.status, 200, overview.data.message);
    assert.ok(overview.data.requests.some((entry) => entry.id === sent.data.requestId));
    const overviewJson = JSON.stringify(overview.data);
    assert.ok(!overviewJson.includes('tokenHash'));
    assert.ok(!overviewJson.includes('token_hash'));
    const responseA = overview.data.responses.find((entry) => entry.supplierId === supplierA.id);
    const responseB = overview.data.responses.find((entry) => entry.supplierId === supplierB.id);
    assert.ok(responseA && responseB);
    assert.equal(responseA.status, 'Submitted');
    assert.equal(responseB.status, 'Submitted');
    assert.equal(responseA.items[0].unitPrice, priceA);
    assert.equal(responseB.items[0].unitPrice, priceB);
    assert.equal(responseA.supplierContact, supplierA.contactName);
    assert.equal(responseA.supplierAddress, supplierA.address);

    const comparison = await request(`/purchase-order-pricing/requests/${sent.data.requestId}/comparison`, { user: admin });
    assert.equal(comparison.response.status, 200, comparison.data.message);
    assert.equal(comparison.data.request.reference, sent.data.reference);
    assert.equal(comparison.data.columns.length, 1);
    assert.equal(comparison.data.columns[0].purchaseOrderItemId, poItemId);
    assert.equal(comparison.data.responses.length, 2);
    const comparedA = comparison.data.responses.find((entry) => entry.supplierId === supplierA.id);
    const comparedB = comparison.data.responses.find((entry) => entry.supplierId === supplierB.id);
    assert.equal(comparedA.items[0].unitPrice, priceA);
    assert.equal(comparedB.items[0].unitPrice, priceB);
    assert.ok(!JSON.stringify(comparison.data).includes(String(original.total)));

    const revokedSend = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement, body: { supplierIds: [supplierC.id] }
    });
    assert.equal(revokedSend.response.status, 201, revokedSend.data.message);
    createdPricingRequestIds.push(revokedSend.data.requestId);
    await registerPricingRows(revokedSend.data.requestId);
    const revokedToken = tokenFrom(pricingLinksIn(relay.messages[2])[0]);
    assert.match(revokedToken, /^[A-Za-z0-9_-]{43}$/);
    const revokedOverview = await request(`/purchase-orders/${poId}/supplier-responses`, { user: users.procurement });
    const revokedRow = revokedOverview.data.responses.find((entry) => entry.supplierId === supplierC.id);
    const revoked = await request(`/purchase-order-pricing/responses/${revokedRow.id}/revoke`, {
      method: 'PATCH', user: users.procurement, body: {}
    });
    assert.equal(revoked.response.status, 200, revoked.data.message);
    const revokedView = await request(`/supplier-pricing/${encodeURIComponent(revokedToken)}`);
    assert.equal(revokedView.response.status, 410);
    assert.match(revokedView.data.message, /revoked/i);
    const revokedEdit = await request(`/supplier-pricing/${encodeURIComponent(revokedToken)}/draft`, {
      method: 'PATCH', body: { items: [{ purchaseOrderItemId: poItemId, unitPrice: 5 }] }
    });
    assert.equal(revokedEdit.response.status, 410);
    const doubleRevoke = await request(`/purchase-order-pricing/responses/${revokedRow.id}/revoke`, {
      method: 'PATCH', user: users.procurement, body: {}
    });
    assert.equal(doubleRevoke.response.status, 409);
    const revokeSubmitted = await request(`/purchase-order-pricing/responses/${responseA.id}/revoke`, {
      method: 'PATCH', user: users.procurement, body: {}
    });
    assert.equal(revokeSubmitted.response.status, 409);

    const probe = net.createServer();
    await new Promise((done) => probe.listen(0, '127.0.0.1', done));
    const closedPort = probe.address().port;
    await new Promise((done) => probe.close(done));
    process.env.SMTP_PORT = String(closedPort);
    const failedSend = await request(`/purchase-orders/${poId}/send-to-suppliers`, {
      method: 'POST', user: users.procurement, body: { supplierIds: [supplierD.id] }
    });
    assert.equal(failedSend.response.status, 201, failedSend.data.message);
    assert.equal(failedSend.data.emailDelivery.failed, 1, JSON.stringify(failedSend.data.deliveries));
    createdPricingRequestIds.push(failedSend.data.requestId);
    await registerPricingRows(failedSend.data.requestId);
    const failedRow = (await responseRows(failedSend.data.requestId))[0];
    assert.equal(failedRow.emailStatus, 'Failed');
    assert.equal(failedRow.status, 'Email failed');

    process.env.SMTP_PORT = String(relay.port);
    const messagesBeforeRetry = relay.messages.length;
    const retried = await request(`/purchase-order-pricing/requests/${failedSend.data.requestId}/deliveries/retry-failed`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(retried.response.status, 200, retried.data.message);
    assert.equal(retried.data.emailDelivery.accepted, 1);
    assert.equal(relay.messages.length, messagesBeforeRetry + 1);
    const retryToken = tokenFrom(pricingLinksIn(relay.messages[relay.messages.length - 1])[0]);
    const [[afterRetry]] = await pool.execute(
      `SELECT token_hash AS tokenHash, status, email_status AS emailStatus,
         email_attempts AS emailAttempts
        FROM purchase_order_pricing_responses WHERE id = ?`, [failedRow.id]
    );
    assert.equal(afterRetry.tokenHash, createHash('sha256').update(retryToken).digest('hex'),
      'the retried email must contain the original private link');
    assert.equal(afterRetry.tokenHash, failedRow.tokenHash,
      'retrying a failed delivery must reuse the same token instead of rotating it');
    assert.equal(afterRetry.status, 'Invited');
    assert.equal(afterRetry.emailStatus, 'Accepted by Email Provider');
    assert.equal(afterRetry.emailAttempts, 2);
    const [[duplicateCount]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM purchase_order_pricing_responses WHERE request_id = ? AND supplier_id = ?',
      [failedSend.data.requestId, supplierD.id]
    );
    assert.equal(duplicateCount.total, 1, 'a retry must not create another active link');

    const award = await request(`/purchase-order-pricing/requests/${sent.data.requestId}/award`, {
      method: 'POST', user: admin, body: { responseId: responseA.id, comment: 'Lowest compliant quotation.' }
    });
    assert.equal(award.response.status, 200, award.data.message);
    assert.equal(award.data.award.supplierId, supplierA.id);
    assert.equal(award.data.award.comment, 'Lowest compliant quotation.');
    const [[awardedRequest]] = await pool.execute(
      `SELECT status, awarded_response_id AS awardedResponseId, awarded_by AS awardedBy,
         award_comment AS awardComment
        FROM purchase_order_pricing_requests WHERE id = ?`, [sent.data.requestId]
    );
    assert.equal(awardedRequest.status, 'Awarded');
    assert.equal(String(awardedRequest.awardedResponseId), String(responseA.id));
    assert.equal(awardedRequest.awardedBy, admin.id);
    assert.equal(awardedRequest.awardComment, 'Lowest compliant quotation.');
    const [[awardedResponse]] = await pool.execute(
      'SELECT awarded FROM purchase_order_pricing_responses WHERE id = ?', [responseA.id]
    );
    assert.equal(awardedResponse.awarded, 1);
    const closedRetryLink = await request(`/supplier-pricing/${encodeURIComponent(retryToken)}`);
    assert.equal(closedRetryLink.response.status, 410,
      'other active supplier links must close when an award is recorded');
    const duplicateAward = await request(`/purchase-order-pricing/requests/${sent.data.requestId}/award`, {
      method: 'POST', user: admin, body: { responseId: responseB.id }
    });
    assert.equal(duplicateAward.response.status, 409);
    const unsubmittedAward = await request(`/purchase-order-pricing/requests/${revokedSend.data.requestId}/award`, {
      method: 'POST', user: admin, body: { responseId: revokedRow.id }
    });
    assert.equal(unsubmittedAward.response.status, 409);

    const approvedForReview = await request(`/purchase-orders/${poId}/send-for-approval`, {
      method: 'POST', user: users.procurement,
      body: { recipientId: admin.id, message: 'Review the explicitly awarded quotation.' }
    });
    assert.equal(approvedForReview.response.status, 200, approvedForReview.data.message);

    const afterResult = await request(`/purchase-orders/${poId}`, { user: users.procurement });
    assert.equal(afterResult.response.status, 200);
    const after = afterResult.data.purchaseOrder;
    assert.equal(after.supplierPricingStatus, 'Awarded');
    assert.equal(after.supplierPricingAward.supplierId, supplierA.id);
    assert.equal(after.supplierPricingAward.supplierEmail, supplierA.email);
    assert.equal(after.supplierPricingAward.total, expectedTotals(priceA).total);
    assert.equal(after.supplierPricingAward.items[0].unitPrice, priceA);
    assert.equal(after.supplierPricingAward.items[0].lineTotal, expectedTotals(priceA).subtotal);
    for (const field of ['reference', 'status', 'subtotal', 'vatRate', 'vatAmount', 'total', 'amountInWords', 'deliveryDate']) {
      assert.deepEqual(after[field], original[field], `original purchase order ${field} must not change`);
    }
    assert.deepEqual(
      after.items.map((item) => ({
        id: item.id, name: item.itemName, unitPrice: item.unitPrice, lineTotal: item.lineTotal
      })),
      original.items.map((item) => ({
        id: item.id, name: item.itemName, unitPrice: item.unitPrice, lineTotal: item.lineTotal
      }))
    );
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('sending a purchase order to its supplier attaches the official signed PO PDF', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;

  try {
    relay = await startTestSmtp();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.po.email.${Date.now()}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = 'qa.po.sender@hopehaven.test';
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';

    const context = await createAwardedPurchaseOrder('POEMAIL');
    const purchaseOrder = context.purchaseOrder;
    const endpoint = `/purchase-orders/${purchaseOrder.id}/send-to-supplier`;
    // Creating the awarded RFQ may send its own supplier invitation. Only count
    // messages emitted by the direct purchase-order action below.
    const messageCountBeforeSend = relay.messages.length;

    const [signatures] = await pool.query(
      'SELECT prepared_signature, approved_signature FROM purchase_orders WHERE id = ?',
      [purchaseOrder.id]
    );
    await pool.execute('UPDATE purchase_orders SET prepared_signature = NULL WHERE id = ?', [purchaseOrder.id]);
    const missingSignature = await request(endpoint, { method: 'POST', user: users.procurement, body: {} });
    assert.equal(missingSignature.response.status, 409, missingSignature.data.message);
    assert.match(missingSignature.data.message, /official signatures/i);
    await pool.execute('UPDATE purchase_orders SET prepared_signature = ? WHERE id = ?', [signatures[0].prepared_signature, purchaseOrder.id]);

    const sent = await request(endpoint, { method: 'POST', user: users.procurement, body: {} });
    assert.equal(sent.response.status, 200, sent.data.message);
    assert.equal(sent.data.recipientEmail, context.supplier.email.toLowerCase());
    assert.equal(sent.data.emailDelivery.accepted, 1);
    assert.equal(relay.messages.length - messageCountBeforeSend, 1, 'only the official PO should be emailed');

    const raw = relay.messages[relay.messages.length - 1];
    const filename = `${purchaseOrder.reference}.pdf`;
    assert.ok(
      raw.includes(`filename=${filename}`) || raw.includes(`filename="${filename}"`),
      `email should name the attachment ${filename}`
    );
    const pdf = attachmentBuffer(raw, filename);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assertPdfIncludes(pdf, 'PURCHASE ORDER', purchaseOrder.reference, context.supplier.name, 'Prepared By:', 'Approved By:');
    assert.ok(pdf.includes(Buffer.from('/Subtype /Image')), 'the official PDF should embed the uploaded signatures');
    assert.ok(!raw.includes('/supplier-pricing/quote?token='));
    assert.ok(!raw.includes('/#/supplier/RFQ?token='));

    // A successful send is also the handoff to the Storekeeper pre-delivery queue.
    const [queuedLines] = await pool.execute(
      `SELECT d.id, d.purchase_order_item_id AS purchaseOrderItemId, d.status, d.item_name AS itemName
         FROM purchase_order_delivery_items d WHERE d.purchase_order_id = ? ORDER BY d.id`,
      [purchaseOrder.id]
    );
    const [orderLines] = await pool.execute(
      'SELECT id FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id',
      [purchaseOrder.id]
    );
    assert.equal(queuedLines.length, orderLines.length);
    assert.deepEqual(
      queuedLines.map((line) => Number(line.purchaseOrderItemId)),
      orderLines.map((line) => Number(line.id))
    );
    assert.ok(queuedLines.every((line) => line.status === 'Pending'));
    const [keeperNotifications] = await pool.execute(
      `SELECT id FROM notifications WHERE user_id = ?
         AND link = '#/stockkeeper/Display%20before%20delivery'
         AND title = 'Purchase order ready for delivery review'`,
      [users.stockkeeper.id]
    );
    assert.ok(keeperNotifications.length >= 1, 'storekeepers should be notified about the delivery queue');
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('a failed supplier email still queues the purchase order items for Storekeeper review', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.failed.send.${Date.now()}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = 'qa.failed.sender@hopehaven.test';
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';

    const context = await createAwardedPurchaseOrder('POFAILQ');
    const failed = await request(`/purchase-orders/${context.purchaseOrder.id}/send-to-supplier`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(failed.response.status, 502, failed.data.message);
    assert.equal(failed.data.emailDelivery.accepted, 0);
    assert.equal(failed.data.deliveryQueued, true);

    const [queuedLines] = await pool.execute(
      'SELECT id, status FROM purchase_order_delivery_items WHERE purchase_order_id = ?',
      [context.purchaseOrder.id]
    );
    const [orderLines] = await pool.execute(
      'SELECT id FROM purchase_order_items WHERE purchase_order_id = ?',
      [context.purchaseOrder.id]
    );
    assert.equal(queuedLines.length, orderLines.length);
    assert.ok(queuedLines.every((line) => line.status === 'Pending'), 'send click queues items even when email fails');
  } finally {
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('Storekeeper accepts sent items into stock but rejected items never enter stock', async () => {
  const stamp = Date.now();
  const context = await createAwardedPurchaseOrder('PODLV');
  const purchaseOrderId = context.purchaseOrder.id;
  const secondItemName = `QA PO Delivery Item ${stamp}`;
  await pool.execute(
    `INSERT INTO purchase_order_items
       (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [purchaseOrderId, secondItemName, 'Second pre-delivery line', 4, 'box', 15, 60]
  );
  const [lines] = await pool.execute(
    `SELECT id, item_name AS itemName, description, quantity, unit,
        unit_price AS unitPrice, line_total AS lineTotal
       FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id`,
    [purchaseOrderId]
  );
  assert.equal(lines.length, 2);

  const deliveryIds = [];
  for (const line of lines) {
    const [queued] = await pool.execute(
      `INSERT INTO purchase_order_delivery_items
         (purchase_order_id, purchase_order_item_id, po_reference, supplier_name, supplier_email,
          requisition_id, requisition_reference, department_id, department_name,
          item_name, description, quantity, unit, unit_price, line_total, delivery_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        purchaseOrderId, line.id, context.purchaseOrder.reference, context.supplier.name,
        context.supplier.email, context.requisition.id, context.requisition.reference,
        context.department.id, context.department.name, line.itemName, line.description,
        line.quantity, line.unit, line.unitPrice, line.lineTotal, context.purchaseOrder.deliveryDate || null
      ]
    );
    deliveryIds.push(Number(queued.insertId));
  }

  const list = await request('/portal/stockkeeper/deliveries?status=Pending&sort=item&direction=asc', {
    user: users.stockkeeper
  });
  assert.equal(list.response.status, 200, list.data.message);
  assert.ok(list.data.deliveries.some((row) => Number(row.id) === deliveryIds[0]));
  assert.ok(list.data.counts.Pending >= 2);
  assert.equal((await request('/portal/stockkeeper/deliveries', { user: users.procurement })).response.status, 403);
  assert.equal((await request('/portal/stockkeeper/deliveries?status=Unknown', { user: users.stockkeeper })).response.status, 400);

  const [rejectId, acceptId] = deliveryIds;
  const rejected = await request(`/portal/stockkeeper/deliveries/${rejectId}/reject`, {
    method: 'POST', user: users.stockkeeper, body: { reason: 'Quantity does not match the order' }
  });
  assert.equal(rejected.response.status, 200, rejected.data.message);
  assert.equal(rejected.data.status, 'Rejected');
  assert.match(rejected.data.message, /not added to stock/i);
  const [rejectedRow] = await pool.execute(
    'SELECT status, decision_reason AS reason FROM purchase_order_delivery_items WHERE id = ?',
    [rejectId]
  );
  assert.equal(rejectedRow[0].status, 'Rejected');
  assert.equal(rejectedRow[0].reason, 'Quantity does not match the order');
  const [rejectedItemRows] = await pool.execute('SELECT COUNT(*) AS total FROM items WHERE name = ?', [lines[0].itemName]);
  assert.equal(Number(rejectedItemRows[0].total), 0, 'rejected items must not be created in the catalogue');
  const [rejectedMovementRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM inventory_movements m
       JOIN items i ON i.id = m.item_id WHERE i.name = ?`,
    [lines[0].itemName]
  );
  assert.equal(Number(rejectedMovementRows[0].total), 0, 'rejected items must not create stock movements');
  assert.equal((await request(`/portal/stockkeeper/deliveries/${rejectId}/accept`, {
    method: 'POST', user: users.stockkeeper, body: {}
  })).response.status, 409, 'a rejected line cannot later enter stock');

  const missingReason = await request(`/portal/stockkeeper/deliveries/${acceptId}/reject`, {
    method: 'POST', user: users.stockkeeper, body: {}
  });
  assert.equal(missingReason.response.status, 400);
  const accepted = await request(`/portal/stockkeeper/deliveries/${acceptId}/accept`, {
    method: 'POST', user: users.stockkeeper, body: { reason: 'Delivery verified' }
  });
  assert.equal(accepted.response.status, 201, accepted.data.message);
  assert.equal(accepted.data.status, 'Accepted');
  assert.equal(Number(accepted.data.balance), Number(lines[1].quantity));
  assert.match(accepted.data.referenceNo, /^PO-DEL-/);
  createdItemIds.push(Number(accepted.data.itemId));
  createdMovementIds.push(Number(accepted.data.movementId));

  const [acceptedRow] = await pool.execute(
    `SELECT status, inventory_item_id AS inventoryItemId, inventory_movement_id AS inventoryMovementId
       FROM purchase_order_delivery_items WHERE id = ?`,
    [acceptId]
  );
  assert.equal(acceptedRow[0].status, 'Accepted');
  assert.equal(Number(acceptedRow[0].inventoryItemId), Number(accepted.data.itemId));
  assert.equal(Number(acceptedRow[0].inventoryMovementId), Number(accepted.data.movementId));
  const [stockRows] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [accepted.data.itemId]);
  assert.equal(Number(stockRows[0].quantity), Number(lines[1].quantity));
  const [movementRows] = await pool.execute(
    'SELECT movement_type AS type, direction, reference_no AS referenceNo FROM inventory_movements WHERE id = ?',
    [accepted.data.movementId]
  );
  assert.equal(movementRows[0].type, 'Receipt');
  assert.equal(movementRows[0].direction, 'In');
  assert.equal(movementRows[0].referenceNo, accepted.data.referenceNo);
  const acceptedList = await request('/portal/stockkeeper/deliveries?status=Accepted', { user: users.stockkeeper });
  assert.equal(acceptedList.response.status, 200);
  assert.ok(acceptedList.data.deliveries.some((row) => Number(row.id) === acceptId));
});

test('sent suppliers create a Good Received Note from accepted lines without adding stock twice', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.grn.send.${Date.now()}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = 'qa.grn.sender@hopehaven.test';
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';

    const stamp = Date.now();
    const context = await createAwardedPurchaseOrder('POGRN');
    const purchaseOrderId = context.purchaseOrder.id;
    const secondItemName = `QA GRN Item ${stamp}`;
    await pool.execute(
      `INSERT INTO purchase_order_items
         (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchaseOrderId, secondItemName, 'GRN fixture line', 6, 'box', 12, 72]
    );
    const sent = await request(`/purchase-orders/${purchaseOrderId}/send-to-supplier`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(sent.response.status, 502, sent.data.message);
    assert.equal(sent.data.deliveryQueued, true);

    const [queued] = await pool.execute(
      `SELECT id, purchase_order_item_id AS purchaseOrderItemId, item_name AS itemName, quantity
         FROM purchase_order_delivery_items WHERE purchase_order_id = ? ORDER BY id`,
      [purchaseOrderId]
    );
    assert.equal(queued.length, 2);
    const [rejectId, acceptId] = queued.map((row) => Number(row.id));
    const rejected = await request(`/portal/stockkeeper/deliveries/${rejectId}/reject`, {
      method: 'POST', user: users.stockkeeper, body: { reason: 'Damaged in transit' }
    });
    assert.equal(rejected.response.status, 200, rejected.data.message);
    const accepted = await request(`/portal/stockkeeper/deliveries/${acceptId}/accept`, {
      method: 'POST', user: users.stockkeeper, body: { reason: 'Delivery verified' }
    });
    assert.equal(accepted.response.status, 201, accepted.data.message);
    createdItemIds.push(Number(accepted.data.itemId));
    createdMovementIds.push(Number(accepted.data.movementId));
    const acceptedItemId = Number(accepted.data.itemId);
    const acceptedQuantity = Number(queued[1].quantity);

    const sentSuppliers = await request('/goods-receipts/sent-suppliers', { user: users.procurement });
    assert.equal(sentSuppliers.response.status, 200, sentSuppliers.data.message);
    const supplier = sentSuppliers.data.sentSuppliers.find((entry) =>
      entry.supplierName === context.supplier.name);
    assert.ok(supplier, 'the sent supplier should appear in the GRN workspace');
    assert.equal(supplier.supplierEmail.toLowerCase(), context.supplier.email.toLowerCase());
    const order = supplier.purchaseOrders.find((entry) => entry.id === purchaseOrderId);
    assert.ok(order, 'the sent purchase order should appear under its supplier');
    assert.ok(order.departmentName);
    const deliveryLines = order.lines.filter((line) =>
      queued.some((queuedLine) => Number(queuedLine.purchaseOrderItemId) === line.purchaseOrderItemId));
    assert.equal(deliveryLines.length, 2);
    assert.equal(deliveryLines.find((line) =>
      Number(line.purchaseOrderItemId) === Number(queued[0].purchaseOrderItemId)).deliveryStatus, 'Rejected');
    const acceptedLine = deliveryLines.find((line) =>
      Number(line.purchaseOrderItemId) === Number(queued[1].purchaseOrderItemId));
    assert.equal(acceptedLine.deliveryStatus, 'Accepted');
    assert.equal(Number(acceptedLine.itemId), acceptedItemId);
    assert.equal(order.grnDecision, '', 'a sent order begins without an Allow/Deny decision');

    const blocked = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement,
      body: {
        purchaseOrderId,
        lines: [{ purchaseOrderItemId: Number(queued[1].purchaseOrderItemId), quantity: acceptedQuantity }]
      }
    });
    assert.equal(blocked.response.status, 409, blocked.data.message);
    assert.match(blocked.data.message, /Allow this supplier/i);

    const invalidDecision = await request('/goods-receipts/supplier-decision', {
      method: 'POST', user: users.procurement,
      body: { purchaseOrderId, decision: 'Maybe' }
    });
    assert.equal(invalidDecision.response.status, 400, invalidDecision.data.message);

    const allowed = await request('/goods-receipts/supplier-decision', {
      method: 'POST', user: users.procurement, body: { purchaseOrderId, decision: 'Allowed' }
    });
    assert.equal(allowed.response.status, 200, allowed.data.message);
    assert.equal(allowed.data.decision, 'Allowed');
    const afterAllow = await request('/goods-receipts/sent-suppliers', { user: users.procurement });
    const allowedOrder = afterAllow.data.sentSuppliers
      .find((entry) => entry.supplierName === context.supplier.name)
      ?.purchaseOrders.find((entry) => entry.id === purchaseOrderId);
    assert.equal(allowedOrder?.grnDecision, 'Allowed');

    const signature = await imageSignature();
    const body = {
      purchaseOrderId,
      receivedByName: 'QA Receiver',
      verifiedByName: 'QA Verifier',
      receivedBySignature: signature,
      verifiedBySignature: signature,
      grnDate: new Date().toISOString().slice(0, 10),
      lines: [{
        purchaseOrderItemId: Number(queued[1].purchaseOrderItemId),
        quantity: acceptedQuantity,
        comment: 'Verified against delivery note'
      }]
    };
    const missingSignature = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement,
      body: { ...body, verifiedBySignature: null }
    });
    assert.equal(missingSignature.response.status, 400, missingSignature.data.message);
    assert.match(missingSignature.data.message, /verified by signature/i);

    const rejectedLine = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement,
      body: { ...body, lines: [{ purchaseOrderItemId: Number(queued[0].purchaseOrderItemId), quantity: 1 }] }
    });
    assert.equal(rejectedLine.response.status, 409, rejectedLine.data.message);
    assert.match(rejectedLine.data.message, /Rejected items cannot appear/i);

    const [[stockBefore]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [acceptedItemId]);
    const [[movementsBefore]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM inventory_movements WHERE item_id = ?', [acceptedItemId]
    );
    const grn = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement, body
    });
    assert.equal(grn.response.status, 201, grn.data.message);
    assert.equal(grn.data.purchaseOrderId, purchaseOrderId);
    assert.equal(grn.data.lines.length, 1);
    assert.equal(grn.data.emailDelivery.ok, false, 'an unreachable SMTP provider is reported');
    assert.match(grn.data.message, /email was not delivered/i);
    createdGoodsReceiptIds.push(Number(grn.data.id));

    const [[stockAfter]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [acceptedItemId]);
    const [[movementsAfter]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM inventory_movements WHERE item_id = ?', [acceptedItemId]
    );
    assert.equal(Number(stockAfter.quantity), Number(stockBefore.quantity), 'a GRN must not add stock twice');
    assert.equal(Number(movementsAfter.total), Number(movementsBefore.total), 'a GRN must not create a second movement');

    const [grnRows] = await pool.execute(
      `SELECT supplier_id AS supplierId, supplied_by AS suppliedBy,
         receiving_department AS receivingDepartment, received_by_name AS receivedByName,
         verified_by_name AS verifiedByName, received_signature AS receivedSignature,
         verified_signature AS verifiedSignature, DATE_FORMAT(grn_date, '%Y-%m-%d') AS grnDate
        FROM goods_receipts WHERE id = ?`,
      [grn.data.id]
    );
    assert.equal(Number(grnRows[0].supplierId), Number(context.supplier.id));
    assert.match(grnRows[0].suppliedBy, new RegExp(context.supplier.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(grnRows[0].receivingDepartment, order.departmentName);
    assert.equal(grnRows[0].receivedByName, 'QA Receiver');
    assert.equal(grnRows[0].verifiedByName, 'QA Verifier');
    assert.match(grnRows[0].receivedSignature, /^data:image\/webp;base64,/);
    assert.match(grnRows[0].verifiedSignature, /^data:image\/webp;base64,/);
    assert.equal(String(grnRows[0].grnDate).slice(0, 10), body.grnDate);

    const [grnLines] = await pool.execute(
      'SELECT item_id AS itemId, quantity, comment FROM goods_receipt_items WHERE goods_receipt_id = ?',
      [grn.data.id]
    );
    assert.equal(Number(grnLines[0].itemId), acceptedItemId);
    assert.equal(Number(grnLines[0].quantity), acceptedQuantity);
    assert.equal(grnLines[0].comment, 'Verified against delivery note');

    const register = await request('/goods-receipts', { user: users.procurement });
    assert.equal(register.response.status, 200, register.data.message);
    const recorded = register.data.goodsReceipts.find((row) => Number(row.id) === Number(grn.data.id));
    assert.equal(recorded.supplier, context.supplier.name);
    assert.equal(recorded.receivingDepartment, order.departmentName);

    const duplicate = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement, body
    });
    assert.equal(duplicate.response.status, 409, duplicate.data.message);
    assert.match(duplicate.data.message, /exceeds the ordered quantity/i);

    const denied = await request('/goods-receipts/supplier-decision', {
      method: 'POST', user: users.procurement,
      body: { purchaseOrderId, decision: 'Denied', reason: 'Supplier cancelled the delivery' }
    });
    assert.equal(denied.response.status, 200, denied.data.message);
    const afterDeny = await request('/goods-receipts/sent-suppliers', { user: users.procurement });
    assert.equal(
      afterDeny.data.sentSuppliers.some((entry) => entry.supplierName === context.supplier.name),
      false,
      'a denied purchase order must be removed from the sent-supplier workspace'
    );
    const deniedGrn = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement, body
    });
    assert.equal(deniedGrn.response.status, 409, deniedGrn.data.message);
    assert.match(deniedGrn.data.message, /Allow this supplier/i);
  } finally {
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('an allowed supplier can create a GRN before Storekeeper acceptance without adding stock', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.grn.pending.${Date.now()}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = 'qa.grn.sender@hopehaven.test';
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';

    const stamp = Date.now();
    const itemName = `QA GRN Pending Item ${stamp}`;
    const context = await createAwardedPurchaseOrder('POGRNP');
    const purchaseOrderId = context.purchaseOrder.id;
    await pool.execute(
      `INSERT INTO purchase_order_items
         (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchaseOrderId, itemName, 'Pending GRN fixture line', 3, 'piece', 20, 60]
    );
    const sent = await request(`/purchase-orders/${purchaseOrderId}/send-to-supplier`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(sent.response.status, 502, sent.data.message);
    assert.equal(sent.data.deliveryQueued, true);

    const [queued] = await pool.execute(
      `SELECT id, purchase_order_item_id AS purchaseOrderItemId, item_name AS itemName
         FROM purchase_order_delivery_items
        WHERE purchase_order_id = ? AND item_name = ?`,
      [purchaseOrderId, itemName]
    );
    assert.equal(queued.length, 1, 'the new line should be queued as pending');
    const allowed = await request('/goods-receipts/supplier-decision', {
      method: 'POST', user: users.procurement, body: { purchaseOrderId, decision: 'Allowed' }
    });
    assert.equal(allowed.response.status, 200, allowed.data.message);

    const signature = await imageSignature();
    const grn = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement,
      body: {
        purchaseOrderId,
        receivedByName: 'QA Receiver',
        verifiedByName: 'QA Verifier',
        receivedBySignature: signature,
        verifiedBySignature: signature,
        grnDate: new Date().toISOString().slice(0, 10),
        lines: [{ purchaseOrderItemId: Number(queued[0].purchaseOrderItemId), quantity: 3 }]
      }
    });
    assert.equal(grn.response.status, 201, grn.data.message);
    createdGoodsReceiptIds.push(Number(grn.data.id));

    const [items] = await pool.execute(
      'SELECT id, quantity FROM items WHERE name = ? AND unit = ?',
      [itemName, 'piece']
    );
    assert.equal(items.length, 1, 'a catalogue item is resolved for the pending line');
    createdItemIds.push(Number(items[0].id));
    assert.equal(Number(items[0].quantity), 0, 'a GRN must not add stock before Storekeeper acceptance');
    const [movements] = await pool.execute('SELECT COUNT(*) AS total FROM inventory_movements WHERE item_id = ?', [items[0].id]);
    assert.equal(Number(movements[0].total), 0, 'the GRN must not create a stock movement');

    const [delivery] = await pool.execute(
      'SELECT status, inventory_item_id AS itemId FROM purchase_order_delivery_items WHERE id = ?',
      [queued[0].id]
    );
    assert.equal(delivery[0].status, 'Pending', 'the Storekeeper decision is unchanged');
    assert.equal(Number(delivery[0].itemId), Number(items[0].id));

    const sentSuppliers = await request('/goods-receipts/sent-suppliers', { user: users.procurement });
    const order = sentSuppliers.data.sentSuppliers
      .find((entry) => entry.supplierName === context.supplier.name)
      ?.purchaseOrders.find((entry) => entry.id === purchaseOrderId);
    assert.equal(order?.grnDecision, 'Allowed');
    assert.equal(order.lines.find((line) => line.itemName === itemName).outstandingQuantity, 0);
  } finally {
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('an allowed supplier receives the Good Received Note PDF by email', async () => {
  const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'APP_BASE_URL'];
  const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let relay = null;
  try {
    relay = await startTestSmtp();
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(relay.port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_REQUIRE_TLS = 'false';
    process.env.SMTP_USER = `qa.grn.email.${Date.now()}@example.test`;
    process.env.SMTP_PASS = 'QaLocalRelayPass!2026';
    process.env.SMTP_FROM = 'qa.grn.sender@hopehaven.test';
    process.env.SMTP_FROM_NAME = 'Hope Haven QA';
    process.env.APP_BASE_URL = 'http://localhost:5173';

    const context = await createAwardedPurchaseOrder('POGRNE');
    const purchaseOrderId = context.purchaseOrder.id;
    await pool.execute(
      `INSERT INTO purchase_order_items
         (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchaseOrderId, `QA GRN Email Item ${Date.now()}`, 'GRN email fixture line', 4, 'box', 15, 60]
    );
    const sent = await request(`/purchase-orders/${purchaseOrderId}/send-to-supplier`, {
      method: 'POST', user: users.procurement, body: {}
    });
    assert.equal(sent.response.status, 200, sent.data.message);

    const [queued] = await pool.execute(
      `SELECT id, purchase_order_item_id AS purchaseOrderItemId, quantity
         FROM purchase_order_delivery_items WHERE purchase_order_id = ? ORDER BY id`,
      [purchaseOrderId]
    );
    const target = queued[queued.length - 1];
    const accepted = await request(`/portal/stockkeeper/deliveries/${target.id}/accept`, {
      method: 'POST', user: users.stockkeeper, body: { reason: 'Delivery verified' }
    });
    assert.equal(accepted.response.status, 201, accepted.data.message);
    createdItemIds.push(Number(accepted.data.itemId));
    createdMovementIds.push(Number(accepted.data.movementId));

    const allowed = await request('/goods-receipts/supplier-decision', {
      method: 'POST', user: users.procurement, body: { purchaseOrderId, decision: 'Allowed' }
    });
    assert.equal(allowed.response.status, 200, allowed.data.message);

    const messageCountBeforeGrn = relay.messages.length;
    const signature = await imageSignature();
    const grn = await request('/goods-receipts/from-supplier', {
      method: 'POST', user: users.procurement,
      body: {
        purchaseOrderId,
        receivedByName: 'QA Receiver',
        verifiedByName: 'QA Verifier',
        receivedBySignature: signature,
        verifiedBySignature: signature,
        grnDate: new Date().toISOString().slice(0, 10),
        lines: [{
          purchaseOrderItemId: Number(target.purchaseOrderItemId),
          quantity: Number(target.quantity),
          comment: 'Delivered in good condition'
        }]
      }
    });
    assert.equal(grn.response.status, 201, grn.data.message);
    createdGoodsReceiptIds.push(Number(grn.data.id));
    assert.equal(grn.data.emailDelivery.ok, true, grn.data.message);
    assert.equal(grn.data.emailDelivery.accepted, 1);
    assert.equal(grn.data.emailRecipient.toLowerCase(), context.supplier.email.toLowerCase());
    assert.equal(relay.messages.length - messageCountBeforeGrn, 1, 'only the GRN should be emailed');

    const raw = relay.messages[relay.messages.length - 1];
    const filename = `${grn.data.reference}.pdf`;
    assert.ok(
      raw.includes(`filename=${filename}`) || raw.includes(`filename="${filename}"`),
      `email should attach ${filename}`
    );
    const pdf = attachmentBuffer(raw, filename);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assertPdfIncludes(pdf, 'Goods Received Note', grn.data.reference);
    assert.ok(pdf.includes(Buffer.from('/Subtype /Image')), 'the GRN PDF should embed both signature photos');
    assert.ok(raw.includes('Good received note'));
  } finally {
    if (relay) await relay.close();
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  }
});

test('RFQ register statistics, filters, details, draft lifecycle and supplier links use real records', async () => {
  const stamp = Date.now();
  const suffix = `RFQQA${stamp.toString().slice(-8)}`;
  const [supplierResult] = await pool.execute(
    `INSERT INTO suppliers (name, contact_name, email, phone, address, status)
     VALUES (?, ?, ?, ?, ?, 'Active')`,
    [`QA RFQ Supplier ${suffix}`, 'QA RFQ Contact', `qa.rfq.${stamp}@example.org`, '+10000000000', 'QA RFQ address']
  );
  const supplierId = Number(supplierResult.insertId);
  createdSupplierIds.push(supplierId);
  const [otherSupplierResult] = await pool.execute(
    `INSERT INTO suppliers (name, contact_name, email, status)
     VALUES (?, ?, ?, 'Active')`,
    [`QA RFQ Other Supplier ${suffix}`, 'QA RFQ Other Contact', `qa.rfq.other.${stamp}@example.org`]
  );
  const otherSupplierId = Number(otherSupplierResult.insertId);
  createdSupplierIds.push(otherSupplierId);

  const [requisitionResult] = await pool.execute(
    `INSERT INTO requisitions
       (reference, requester_id, department_id, title, justification, budget_code, priority,
        status, submitted_at, forwarded_at, supervisor_id, forwarded_by_supervisor, required_by)
     VALUES (?, ?, ?, ?, ?, ?, 'High', 'Forwarded to Procurement', UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, ?)`,
    [
      `QA-RFQ-${suffix.slice(-8)}`, users.requesterA.id, departments.a.id,
      `QA RFQ request ${suffix}`, 'RFQ register regression fixture', `QA-${suffix}`,
      users.supervisorA.id, users.supervisorA.id, futureBusinessDate()
    ]
  );
  const requisitionId = Number(requisitionResult.insertId);
  createdRequisitionIds.push(requisitionId);
  await pool.execute(
    `INSERT INTO requisition_items
       (requisition_id, item_name, description, quantity, unit, estimated_unit_cost)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [requisitionId, `QA RFQ item ${suffix}`, 'Official RFQ line', 3, 'box', 125]
  );
  const committee = await createUser('QA Committee', `qa.committee.${stamp}@example.org`, 'committee', null);

  const statsBefore = await request('/rfqs/stats', { user: users.procurement });
  assert.equal(statsBefore.response.status, 200, statsBefore.data.message);
  assert.ok(statsBefore.data.stats, 'stats endpoint must return real database counts');
  assert.ok(
    ['draft', 'sent', 'evaluating', 'awarded', 'closed']
      .map((status) => statsBefore.data.stats[status]).every(Number.isInteger),
    'stats must include a database count for each RFQ lifecycle status'
  );
  assert.equal(
    statsBefore.data.stats.total,
    statsBefore.data.stats.draft + statsBefore.data.stats.sent + statsBefore.data.stats.evaluating
      + statsBefore.data.stats.awarded + statsBefore.data.stats.closed,
    'each RFQ must be counted in exactly one lifecycle status'
  );

  const draft = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: {
      requisitionId, supplierIds: [supplierId], dueDate: futureBusinessDate(),
      instructions: 'Collect sealed quotations by the stated deadline.',
      terms: 'Prices must remain valid for 30 days.',
      saveAsDraft: true,
      idempotencyKey: `qa-rfq-draft-${stamp}`
    }
  });
  assert.equal(draft.response.status, 201, draft.data.message);
  assert.equal(draft.data.status, 'Draft');
  assert.equal(draft.data.emailDelivery, null);
  createdRfqIds.push(draft.data.id);

  const filtered = await request(
    `/rfqs?status=Draft&reference=${encodeURIComponent(draft.data.reference)}&page=1&limit=10`,
    { user: users.procurement }
  );
  assert.equal(filtered.response.status, 200, filtered.data.message);
  assert.equal(filtered.data.rfqs.length, 1);
  assert.equal(Number(filtered.data.pagination.total), 1);
  assert.equal(filtered.data.rfqs[0].instructions, 'Collect sealed quotations by the stated deadline.');
  assert.equal(filtered.data.rfqs[0].terms, 'Prices must remain valid for 30 days.');

  const draftDetail = await request(`/rfqs/${draft.data.id}`, { user: users.procurement });
  assert.equal(draftDetail.response.status, 200, draftDetail.data.message);
  assert.equal(draftDetail.data.items.length, 1);
  assert.equal(draftDetail.data.items[0].itemName, `QA RFQ item ${suffix}`);
  assert.equal(draftDetail.data.suppliers.length, 1);
  assert.equal(draftDetail.data.suppliers[0].emailStatus, null);
  assert.equal(Number(draftDetail.data.suppliers[0].emailAttempts), 0);
  assert.ok(draftDetail.data.activity.some((entry) => entry.action === 'draft_created'));

  const updated = await request(`/rfqs/${draft.data.id}`, {
    method: 'PATCH', user: users.procurement,
    body: {
      requisitionId, dueDate: futureBusinessDate(), supplierIds: [supplierId],
      instructions: 'Submit pricing and delivery terms in the supplier portal.',
      terms: 'Quotations must remain valid for 60 days.'
    }
  });
  assert.equal(updated.response.status, 200, updated.data.message);
  const updatedDetail = await request(`/rfqs/${draft.data.id}`, { user: users.procurement });
  assert.equal(updatedDetail.data.rfq.instructions, 'Submit pricing and delivery terms in the supplier portal.');
  assert.equal(updatedDetail.data.rfq.terms, 'Quotations must remain valid for 60 days.');

  const sent = await request(`/rfqs/${draft.data.id}/send`, {
    method: 'POST', user: users.procurement, body: {}
  });
  assert.equal(sent.response.status, 200, sent.data.message);
  assert.equal(sent.data.status, 'Sent');
  const deliveryState = await request(`/rfqs/${draft.data.id}/email-deliveries`, { user: users.procurement });
  assert.equal(deliveryState.response.status, 200, deliveryState.data.message);
  assert.equal(deliveryState.data.deliveries.length, 1);
  assert.ok(Number(deliveryState.data.deliveries[0].attempts) >= 1);
  const sentDetail = await request(`/rfqs/${draft.data.id}`, { user: users.procurement });
  assert.ok(Number(sentDetail.data.suppliers[0].emailAttempts) >= 1);
  assert.ok(sentDetail.data.suppliers[0].emailStatus, 'sending must leave a recorded supplier email status');

  const token = createRfqToken(draft.data.id, supplierId);
  const publicRfq = await request(`/supplier/rfq/${encodeURIComponent(token)}`);
  assert.equal(publicRfq.response.status, 200, publicRfq.data.message);
  assert.equal(publicRfq.data.rfq.instructions, 'Submit pricing and delivery terms in the supplier portal.');
  assert.equal(publicRfq.data.rfq.terms, 'Quotations must remain valid for 60 days.');
  assert.equal(publicRfq.data.rfq.items.length, 1);
  const foreignToken = createRfqToken(draft.data.id, otherSupplierId);
  const foreignLink = await request(`/supplier/rfq/${encodeURIComponent(foreignToken)}`);
  assert.equal(foreignLink.response.status, 404, 'a supplier must not open another supplier link');
  const invalidLink = await request('/supplier/rfq/not-a-signed-token');
  assert.equal(invalidLink.response.status, 404);

  const quoted = await request(`/supplier/rfq/${encodeURIComponent(token)}/quotation`, {
    method: 'POST', body: { amount: 12345.67, deliveryDays: 9, notes: 'Private supplier quotation.' }
  });
  assert.equal(quoted.response.status, 200, quoted.data.message);
  const staffQuotations = await request(`/rfqs/${draft.data.id}/quotations`, { user: users.procurement });
  assert.equal(staffQuotations.response.status, 200, staffQuotations.data.message);
  assert.equal(staffQuotations.data.quotations.length, 1);
  assert.equal(Number(staffQuotations.data.quotations[0].supplierId), supplierId);
  assert.equal(staffQuotations.data.quotations[0].notes, 'Private supplier quotation.');
  const evaluatingDetail = await request(`/rfqs/${draft.data.id}`, { user: users.procurement });
  assert.equal(evaluatingDetail.data.rfq.status, 'Evaluating');
  assert.equal(Number(evaluatingDetail.data.rfq.quotations), 1);

  const award = await request(`/rfqs/${draft.data.id}/award`, {
    method: 'POST', user: committee, body: { quotationId: staffQuotations.data.quotations[0].id }
  });
  assert.equal(award.response.status, 200, award.data.message);
  const awardedDetail = await request(`/rfqs/${draft.data.id}`, { user: users.procurement });
  assert.equal(awardedDetail.data.rfq.status, 'Awarded');
  assert.equal(Number(awardedDetail.data.rfq.selectedQuotationId), Number(staffQuotations.data.quotations[0].id));
  const closedLink = await request(`/supplier/rfq/${encodeURIComponent(token)}`);
  assert.equal(closedLink.response.status, 410, 'an awarded RFQ must stop accepting supplier quotations');

  const closeRfq = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: {
      requisitionId, supplierIds: [supplierId], dueDate: futureBusinessDate(),
      instructions: 'Close workflow fixture.', terms: 'No special terms.'
    }
  });
  assert.equal(closeRfq.response.status, 201, closeRfq.data.message);
  createdRfqIds.push(closeRfq.data.id);
  const closed = await request(`/rfqs/${closeRfq.data.id}/close`, {
    method: 'POST', user: users.procurement, body: {}
  });
  assert.equal(closed.response.status, 200, closed.data.message);
  const closedDetail = await request(`/rfqs/${closeRfq.data.id}`, { user: users.procurement });
  assert.equal(closedDetail.data.rfq.status, 'Closed');

  const deletable = await request('/rfqs', {
    method: 'POST', user: users.procurement,
    body: { requisitionId, supplierIds: [supplierId], saveAsDraft: true }
  });
  assert.equal(deletable.response.status, 201, deletable.data.message);
  createdRfqIds.push(deletable.data.id);
  const deleted = await request(`/rfqs/${deletable.data.id}`, {
    method: 'DELETE', user: users.procurement, body: {}
  });
  assert.equal(deleted.response.status, 200, deleted.data.message);
  const missing = await request(`/rfqs/${deletable.data.id}`, { user: users.procurement });
  assert.equal(missing.response.status, 404);

  const statsAfter = await request('/rfqs/stats', { user: users.procurement });
  assert.equal(statsAfter.response.status, 200);
  assert.equal(statsAfter.data.stats.total, statsBefore.data.stats.total + 2);
  assert.equal(statsAfter.data.stats.receivedQuotations, statsBefore.data.stats.receivedQuotations + 1);
  assert.equal(statsAfter.data.stats.closed, statsBefore.data.stats.closed + 1);
});

test('a loaded Received Requests page clears only its own notifications, with per-user receipts for shared rows', async () => {
  const page = 'Requests Received from Departments';
  const countsFor = async (account) => (await request('/sidebar-counts', { user: account })).data.counts;
  const beforeProcurement = await countsFor(users.procurement);
  const beforeAdmin = await countsFor(admin);
  const link = '#/admin/Requests%20Received%20from%20Departments?request=91001';

  const first = await insertNotification(users.procurement.id, 'QA received request 1', link);
  const second = await insertNotification(users.procurement.id, 'QA received request 2', link);
  const shared = await insertNotification(null, 'QA shared received request', link);
  const unrelated = await insertNotification(users.procurement.id, 'QA unrelated RFQ', '#/admin/RFQs?rfq=91001');

  const afterInsert = await countsFor(users.procurement);
  assert.equal(afterInsert[page] - (beforeProcurement[page] || 0), 3);
  assert.equal(afterInsert.RFQs - (beforeProcurement.RFQs || 0), 1);
  const adminAfterInsert = await countsFor(admin);
  assert.equal(
    adminAfterInsert[page] - (beforeAdmin[page] || 0), 1,
    'a broadcast row must stay unread for the other Procurement recipient'
  );

  // A page name outside the caller's portal, and every private-message page,
  // are rejected even when the request is made directly against the API.
  for (const deniedPage of ['Approvals', 'Messages', 'Department Messages']) {
    const denied = await request('/notifications/read-module', {
      method: 'PATCH', user: users.procurement, body: { page: deniedPage }
    });
    assert.equal(denied.response.status, 403);
  }

  const marked = await request('/notifications/read-module', {
    method: 'PATCH', user: users.procurement, body: { page }
  });
  assert.equal(marked.response.status, 200, marked.data.message);
  assert.ok(marked.data.updated >= 3, 'all unread notices for this module must be marked read');

  const afterMark = await countsFor(users.procurement);
  assert.equal(afterMark[page] || 0, 0, 'the old badge must disappear immediately');
  assert.equal(afterMark.RFQs, afterInsert.RFQs, 'an unrelated module must keep its badge');
  const adminAfterMark = await countsFor(admin);
  assert.equal(adminAfterMark[page], (beforeAdmin[page] || 0) + 1, 'the other recipient keeps their badge');

  const [notificationRows] = await pool.execute(
    `SELECT id, is_read AS isRead FROM notifications WHERE id IN (?, ?, ?)`,
    [first, second, shared]
  );
  const readState = new Map(notificationRows.map((row) => [Number(row.id), Boolean(row.isRead)]));
  assert.equal(readState.get(first), true, 'user-addressed rows keep the legacy boolean contract');
  assert.equal(readState.get(second), true);
  assert.equal(readState.get(shared), false, 'a broadcast row must never be globally cleared');
  const [receipts] = await pool.execute(
    'SELECT user_id AS userId FROM notification_read_receipts WHERE notification_id = ?',
    [shared]
  );
  assert.deepEqual(receipts.map((row) => row.userId), [users.procurement.id]);

  const repeated = await request('/notifications/read-module', {
    method: 'PATCH', user: users.procurement, body: { page }
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.data.updated, 0, 'returning to the page must not revive or double-clear a badge');
  assert.equal((await countsFor(users.procurement))[page] || 0, 0);

  const fresh = await insertNotification(users.procurement.id, 'QA later received request', link);
  assert.equal((await countsFor(users.procurement))[page], 1);
  const opened = await request(`/notifications/${fresh}/read`, {
    method: 'PATCH', user: users.procurement
  });
  assert.equal(opened.response.status, 200, opened.data.message);
  assert.equal((await countsFor(users.procurement))[page] || 0, 0);
});

test('module reads work in Supervisor, Requester and Stock Keeper portals and never clear private messages', async () => {
  const cases = [
    { user: users.supervisorB, page: 'Approvals', link: '#/supervisor/Approvals?request=92001' },
    { user: users.requesterB, page: 'My Procurement Requests', link: '#/requester/My%20Procurement%20Requests?request=92002' },
    { user: users.stockkeeper, page: 'Bin Card', link: '#/stockkeeper/Bin%20Card?item=92003' }
  ];
  const countsFor = async (account) => (await request('/sidebar-counts', { user: account })).data.counts;

  for (const { user, page, link } of cases) {
    const before = await countsFor(user);
    const id = await insertNotification(user.id, `QA ${page} badge`, link);
    assert.equal((await countsFor(user))[page], (before[page] || 0) + 1);
    const marked = await request('/notifications/read-module', {
      method: 'PATCH', user, body: { page }
    });
    assert.equal(marked.response.status, 200, marked.data.message);
    assert.equal((await countsFor(user))[page] || 0, 0, `${page} badge should clear every unread notice for that module`);
    const [[row]] = await pool.execute('SELECT is_read AS isRead FROM notifications WHERE id = ?', [id]);
    assert.equal(Boolean(row.isRead), true);
  }

  const requester = users.requesterB;
  const crossPortal = await request('/notifications/read-module', {
    method: 'PATCH', user: requester, body: { page: 'Approvals' }
  });
  assert.equal(crossPortal.response.status, 403);

  const general = await insertNotification(requester.id, 'QA general notice', '#/requester/Notifications?badge=1');
  const [sent] = await pool.execute(
    `INSERT INTO messages (department_id, sender_id, recipient_id, body, is_announcement)
     VALUES (?, ?, ?, 'QA private badge notice', FALSE)`,
    [departments.b.id, users.supervisorB.id, requester.id]
  );
  const messageId = Number(sent.insertId);
  await pool.execute('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [messageId, requester.id]);
  const messageNotice = await insertNotification(
    requester.id, 'QA message notice',
    `#/requester/Messages?userId=${users.supervisorB.id}&request=92004&message=${messageId}`,
    'message'
  );

  const beforeReadAll = await countsFor(requester);
  const readAll = await request('/notifications/read-all', { method: 'PATCH', user: requester });
  assert.equal(readAll.response.status, 200, readAll.data.message);
  const afterReadAll = await countsFor(requester);
  assert.equal(afterReadAll.Notifications || 0, 0, 'mark all clears the whole Notifications badge');
  assert.equal(afterReadAll.Messages, beforeReadAll.Messages, 'mark all must not clear a private message badge');
  const [[generalRow]] = await pool.execute('SELECT is_read AS isRead FROM notifications WHERE id = ?', [general]);
  const [[messageRow]] = await pool.execute('SELECT is_read AS isRead FROM notifications WHERE id = ?', [messageNotice]);
  assert.equal(Boolean(generalRow.isRead), true);
  assert.equal(Boolean(messageRow.isRead), false, 'the paired message notice waits for the message itself');

  const openedMessage = await request(`/portal/messages/${messageId}/read`, {
    method: 'PATCH', user: requester
  });
  assert.equal(openedMessage.response.status, 200, openedMessage.data.message);
  const [[messageRowAfter]] = await pool.execute('SELECT is_read AS isRead FROM notifications WHERE id = ?', [messageNotice]);
  assert.equal(Boolean(messageRowAfter.isRead), true);
  assert.equal((await countsFor(requester)).Messages, beforeReadAll.Messages - 1);
});

test('synced email badges are per authorized reader until that email is opened', async () => {
  const gmailMessageId = `qa-badge-email-${Date.now()}`;
  const insertEmail = async () => pool.execute(
    `INSERT INTO google_email_messages
       (gmail_message_id, thread_id, sender, recipient, subject, snippet, body_text, labels, unread)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [gmailMessageId, `thread-${gmailMessageId}`, 'qa@example.test', 'procurement@example.test',
      'QA unread email', 'QA unread email', 'QA unread email body', JSON.stringify(['UNREAD'])]
  );
  const countsFor = async (account) => (await request('/sidebar-counts', { user: account })).data.counts;
  const beforeAdmin = await countsFor(admin);
  const beforeProcurement = await countsFor(users.procurement);
  try {
    await insertEmail();
    assert.equal((await countsFor(admin))['Email Inbox'], (beforeAdmin['Email Inbox'] || 0) + 1);
    assert.equal((await countsFor(users.procurement))['Email Inbox'], (beforeProcurement['Email Inbox'] || 0) + 1);

    const marked = await request(`/email/inbox/messages/${encodeURIComponent(gmailMessageId)}/read`, {
      method: 'PATCH', user: admin
    });
    assert.equal(marked.response.status, 200, marked.data.message);
    assert.equal((await countsFor(admin))['Email Inbox'], beforeAdmin['Email Inbox'] || 0);
    assert.equal(
      (await countsFor(users.procurement))['Email Inbox'], (beforeProcurement['Email Inbox'] || 0) + 1,
      'opening an email as one manager must not clear another manager\'s badge'
    );

    const [receipts] = await pool.execute(
      'SELECT user_id AS userId FROM email_message_read_receipts WHERE gmail_message_id = ?',
      [gmailMessageId]
    );
    assert.deepEqual(receipts.map((row) => row.userId), [admin.id]);
    const adminList = await request('/email/inbox/messages', { user: admin });
    const otherList = await request('/email/inbox/messages', { user: users.procurement });
    assert.equal(
      Boolean(adminList.data.messages.find((row) => row.id === gmailMessageId)?.isRead), true
    );
    assert.equal(
      Boolean(otherList.data.messages.find((row) => row.id === gmailMessageId)?.isRead), false
    );
  } finally {
    await pool.execute('DELETE FROM email_message_read_receipts WHERE gmail_message_id = ?', [gmailMessageId]);
    await pool.execute('DELETE FROM google_email_messages WHERE gmail_message_id = ?', [gmailMessageId]);
  }
});

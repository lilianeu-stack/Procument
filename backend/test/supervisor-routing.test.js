import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool, { applySchemaMigrations } from '../src/config/db.js';
import { REQUISITION_STATUS } from '../src/utils/requisition-status.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-characters';
const PASSWORD = 'QaPortalTest!2026';
let server;
let baseUrl;
let department;
let otherDepartment;
let supervisor;
let requester;
let otherSupervisor;
let procurement;
let stockkeeper;
let otherStockkeeper;
const itemIds = [];
const requisitionIds = [];
const storeRequestIds = [];
const movementReferenceNos = [];
const movementIds = [];
const userIds = [];
const departmentIds = [];
const supplierIds = [];
const purchaseOrderIds = [];
const rfqIds = [];
const quotationIds = [];
const goodsReceiptIds = [];
let approver;
let reportItem;
let issueItem;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function tokenFor(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
}

async function request(path, { method = 'GET', user, token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function createDepartment(name) {
  const [result] = await pool.execute('INSERT INTO departments (name, description) VALUES (?, ?)', [name, 'Supervisor routing QA']);
  const id = Number(result.insertId);
  departmentIds.push(id);
  return { id, name };
}

async function createUser(name, suffix, role, departmentId) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const email = `qa.route.${suffix}.${Date.now()}@example.org`;
  const [result] = await pool.execute(
    `INSERT INTO users (name, email, password_hash, role, department_id, active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [name, email, passwordHash, role, departmentId]
  );
  const id = Number(result.insertId);
  userIds.push(id);
  return { id, name, role, departmentId, email };
}

async function createItem(name, quantity, departmentId) {
  const sku = `RT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const [result] = await pool.execute(
    `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level)
     VALUES (?, ?, ?, 'Routing QA', 'unit', ?, 2)`,
    [departmentId, sku, name, quantity]
  );
  const id = Number(result.insertId);
  itemIds.push(id);
  return { id, name, sku, quantity };
}

async function submit(itemName, quantity, suffix) {
  const response = await request('/portal/requester/requisitions', {
    method: 'POST',
    user: requester,
    body: {
      action: 'submit',
      title: `Routing QA ${suffix}`,
      location: 'QA store',
      justification: `Routing workflow verification ${suffix}`,
      budgetCode: `RT-${suffix}`,
      items: [{ itemName, description: 'Routing QA line', quantity, unit: 'unit', estimatedUnitCost: 10 }]
    }
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  requisitionIds.push(response.data.id);
  return response.data;
}

async function approve(id) {
  const response = await request(`/portal/supervisor/requisitions/${id}/decision`, {
    method: 'POST',
    user: supervisor,
    body: { decision: 'Approve', reason: 'Approved for routing verification' }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
}

async function detail(id) {
  const response = await request(`/portal/supervisor/requisitions/${id}`, { user: supervisor });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.requisition;
}

async function received(id) {
  const response = await request(`/procurement/received-requests/${id}`, { user: procurement });
  return response;
}

async function route(id, destination, extra = {}) {
  return request(`/portal/supervisor/requisitions/${id}/route`, {
    method: 'POST',
    user: supervisor,
    body: { destination, comments: 'Routing QA decision', ...extra }
  });
}

async function acceptStockRequest(storeRequestId) {
  const current = await request(`/portal/stockkeeper/routed-requests/${storeRequestId}`, { user: stockkeeper });
  if (current.status === 200 && current.data?.request?.stockkeeperDecision === 'Accepted') return;
  const response = await request(`/portal/stockkeeper/requests/${storeRequestId}/decision`, {
    method: 'POST',
    user: stockkeeper,
    body: { decision: 'Accepted', comments: 'QA stock availability acceptance', lines: [] }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
}

async function issueStock(storeRequestId, itemId, quantity, suffix) {
  await acceptStockRequest(storeRequestId);
  const referenceNo = `RTISSUE-${suffix}-${Date.now()}`;
  movementReferenceNos.push(referenceNo);
  return request('/portal/stockkeeper/transactions/stock-out', {
    method: 'POST',
    user: stockkeeper,
    body: {
      storeRequestId,
      itemId,
      quantity,
      referenceNo,
      date: new Date().toISOString().slice(0, 10),
      receivedBy: requester.name,
      description: 'Physical issue recorded by routing QA',
      idempotencyKey: uniqueKey(`issue-${suffix}`)
    }
  });
}

function uniqueKey(suffix) {
  return `qa-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function rawRequest(path, user = stockkeeper) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${tokenFor(user)}` }
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    disposition: response.headers.get('content-disposition') || '',
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

async function createSupplier(suffix) {
  const name = `QA Receiving Supplier ${suffix}`;
  const [result] = await pool.execute(
    `INSERT INTO suppliers (name, contact_name, email, phone, address, status)
     VALUES (?, ?, ?, ?, ?, 'Active')`,
    [name, 'QA Contact', `qa.supplier.${Date.now()}@example.test`, '000000000', 'QA Delivery Address']
  );
  const id = Number(result.insertId);
  supplierIds.push(id);
  return { id, name };
}

async function createApprovedPurchaseOrder(item, quantity, suffix) {
  const requisition = await submit(item.name, quantity, `po-${suffix}`);
  await approve(requisition.id);
  const supplier = await createSupplier(suffix);
  const stamp = Date.now().toString(36).toUpperCase();

  const [rfqResult] = await pool.execute(
    `INSERT INTO rfqs (reference, requisition_id, due_date, status, issued_at, created_by)
     VALUES (?, ?, UTC_TIMESTAMP(), 'Awarded', UTC_TIMESTAMP(), ?)`,
    [`RTQ-${stamp}`, requisition.id, procurement.id]
  );
  const rfqId = Number(rfqResult.insertId);
  rfqIds.push(rfqId);
  const [quoteResult] = await pool.execute(
    `INSERT INTO quotations (rfq_id, supplier_id, amount, delivery_days, submitted_at)
     VALUES (?, ?, ?, 7, UTC_TIMESTAMP())`,
    [rfqId, supplier.id, quantity * 10]
  );
  const quotationId = Number(quoteResult.insertId);
  quotationIds.push(quotationId);

  const [poResult] = await pool.execute(
    `INSERT INTO purchase_orders
       (reference, rfq_id, quotation_id, supplier_id, type, supplier_contact, supplier_address,
        subtotal, vat_rate, vat_amount, total, delivery_date, status, created_by)
     VALUES (?, ?, ?, ?, 'Standard', ?, ?, ?, 0, 0, ?, '2026-12-15', 'Pending approval', ?)`,
    [`RTPO-${stamp}`, rfqId, quotationId, supplier.id, 'QA Contact', 'QA Delivery Address',
      quantity * 10, quantity * 10, procurement.id]
  );
  const id = Number(poResult.insertId);
  purchaseOrderIds.push(id);
  await pool.execute(
    `INSERT INTO purchase_order_items
       (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
     VALUES (?, ?, 'QA expected delivery line', ?, ?, 10, ?)`,
    [id, item.name, quantity, item.sku, quantity * 10]
  );
  const decision = await request(`/purchase-orders/${id}/decision`, {
    method: 'PATCH', user: approver, body: { decision: 'Approved', comment: 'QA approval' }
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.data));
  return { id, reference: `RTPO-${stamp}` };
}

async function adjustStock(itemId, quantity, direction, suffix) {
  const response = await request('/portal/stockkeeper/transactions/adjustment', {
    method: 'POST',
    user: stockkeeper,
    body: {
      itemId, quantity, direction, reason: `QA stock count adjustment ${suffix}`,
      idempotencyKey: uniqueKey(`adjust-${suffix}`)
    }
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  movementIds.push(Number(response.data.id));
  return response.data;
}

before(async () => {
  await applySchemaMigrations();
  server = app.listen(await freePort());
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const stamp = Date.now();
  department = await createDepartment(`QA Routing Dept ${stamp}`);
  otherDepartment = await createDepartment(`QA Routing Other ${stamp}`);
  supervisor = await createUser('QA Routing Supervisor', 'supervisor', 'supervisor', department.id);
  requester = await createUser('QA Routing Requester', 'requester', 'requestor', department.id);
  otherSupervisor = await createUser('QA Routing Other Supervisor', 'other-supervisor', 'supervisor', otherDepartment.id);
  procurement = await createUser('QA Routing Procurement', 'procurement', 'procurement', null);
  stockkeeper = await createUser('QA Routing Stock Keeper', 'stockkeeper', 'storekeeper', department.id);
  otherStockkeeper = await createUser('QA Routing Other Stock Keeper', 'other-stockkeeper', 'storekeeper', otherDepartment.id);
  approver = await createUser('QA Routing Approver', 'approver', 'approver', null);
});

after(async () => {
  try {
    if (server?.listening) {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await closed;
  }
  if (movementReferenceNos.length) {
    await pool.execute(`DELETE FROM inventory_movements WHERE reference_no IN (${movementReferenceNos.map(() => '?').join(',')})`, movementReferenceNos);
  }
  if (movementIds.length) {
    await pool.execute(`DELETE FROM inventory_movements WHERE id IN (${movementIds.map(() => '?').join(',')})`, movementIds);
  }
  if (goodsReceiptIds.length) {
    await pool.execute(`DELETE FROM goods_receipts WHERE id IN (${goodsReceiptIds.map(() => '?').join(',')})`, goodsReceiptIds);
  }
  if (purchaseOrderIds.length) {
    await pool.execute(`DELETE FROM purchase_orders WHERE id IN (${purchaseOrderIds.map(() => '?').join(',')})`, purchaseOrderIds);
  }
  if (quotationIds.length) {
    await pool.execute(`DELETE FROM quotations WHERE id IN (${quotationIds.map(() => '?').join(',')})`, quotationIds);
  }
  if (rfqIds.length) {
    await pool.execute(`DELETE FROM rfqs WHERE id IN (${rfqIds.map(() => '?').join(',')})`, rfqIds);
  }
  if (supplierIds.length) {
    await pool.execute(`DELETE FROM suppliers WHERE id IN (${supplierIds.map(() => '?').join(',')})`, supplierIds);
  }
  if (requisitionIds.length) {
    const placeholders = requisitionIds.map(() => '?').join(',');
    for (const id of requisitionIds) {
      await pool.execute('DELETE FROM notifications WHERE link LIKE ?', [`%request=${id}%`]);
    }
    await pool.execute(`DELETE FROM requisitions WHERE id IN (${placeholders})`, requisitionIds);
  }
  if (storeRequestIds.length) {
    await pool.execute(`DELETE FROM store_requests WHERE id IN (${storeRequestIds.map(() => '?').join(',')})`, storeRequestIds);
  }
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    const [receiptRows] = await pool.execute(
      `SELECT DISTINCT gr.id FROM goods_receipts gr
         JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
        WHERE gri.item_id IN (${placeholders})`, itemIds
    );
    const receiptIds = receiptRows.map((row) => Number(row.id));
    if (receiptIds.length) {
      const receiptPlaceholders = receiptIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM inventory_movements WHERE goods_receipt_id IN (${receiptPlaceholders})`, receiptIds);
      await pool.execute(`DELETE FROM goods_receipt_items WHERE goods_receipt_id IN (${receiptPlaceholders})`, receiptIds);
      await pool.execute(`DELETE FROM goods_receipts WHERE id IN (${receiptPlaceholders})`, receiptIds);
    }
    await pool.execute(`DELETE FROM inventory_movements WHERE item_id IN (${placeholders})`, itemIds);
    await pool.execute(`DELETE FROM items WHERE id IN (${placeholders})`, itemIds);
  }
  if (userIds.length) {
    await pool.execute(`DELETE FROM notifications WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds);
    await pool.execute(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
  }
  if (departmentIds.length) {
    await pool.execute(`DELETE FROM departments WHERE id IN (${departmentIds.map(() => '?').join(',')})`, departmentIds);
  }
  } finally {
    await pool.end();
  }
});

test('Scenario A - unavailable stock routes to Procurement only after Supervisor approval', async () => {
  const item = await createItem(`QA routing unavailable ${Date.now()}`, 0, department.id);
  const created = await submit(item.name, 3, 'procurement');
  const beforeRoute = await received(created.id);
  assert.equal(beforeRoute.status, 404, 'Approval alone must not reach Procurement');

  const verification = (await detail(created.id)).routingStock;
  assert.equal(verification[0].availableQuantity, 0);
  assert.equal(verification[0].status, 'Unavailable');

  await approve(created.id);
  const routed = await route(created.id, 'Procurement');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  assert.equal(routed.data.status, REQUISITION_STATUS.FORWARDED);

  const [row] = await pool.execute(
    `SELECT routing_destination AS destination, forwarded_by_supervisor AS forwardedBy,
       routing_comments AS comments FROM requisitions WHERE id = ?`, [created.id]
  );
  assert.equal(row[0].destination, 'Procurement');
  assert.equal(Number(row[0].forwardedBy), supervisor.id);
  assert.equal(row[0].comments, 'Routing QA decision');

  const afterRoute = await received(created.id);
  assert.equal(afterRoute.status, 200);
  assert.equal(afterRoute.data.requisition.items[0].quantity, 3);

  const [notifications] = await pool.execute(
    `SELECT id FROM notifications WHERE user_id = ? AND title LIKE '%forwarded to Procurement%'`, [procurement.id]
  );
  assert.ok(notifications.length > 0, 'Procurement should be notified');
  const [activity] = await pool.execute(
    `SELECT action FROM requisition_activity WHERE requisition_id = ? AND action = 'forwarded_to_procurement'`, [created.id]
  );
  assert.equal(activity.length, 1);
});

test('Scenario B - available stock routes to Stock Keeper and reduces stock only on physical issue', async () => {
  const item = await createItem(`QA routing available ${Date.now()}`, 20, department.id);
  const created = await submit(item.name, 10, 'stock');
  const verification = (await detail(created.id)).routingStock;
  assert.equal(verification[0].availableQuantity, 20);
  assert.equal(verification[0].status, 'Available');

  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  assert.equal(routed.data.status, REQUISITION_STATUS.AWAITING_STOCK_ISSUE);
  assert.ok(routed.data.storeRequestId);
  storeRequestIds.push(routed.data.storeRequestId);

  const procurementQueue = await request('/procurement/received-requests', { user: procurement });
  assert.ok(!procurementQueue.data.requisitions.some((row) => Number(row.id) === Number(created.id)));

  const issueQueue = await request('/portal/stockkeeper/issue-requests', { user: stockkeeper });
  assert.ok(issueQueue.data.requests.some((row) =>
    Number(row.requisitionId) === Number(created.id) && row.supervisorName === supervisor.name));

  const firstIssue = await issueStock(routed.data.storeRequestId, item.id, 4, 'stock-first');
  assert.equal(firstIssue.status, 201, JSON.stringify(firstIssue.data));
  const [afterFirst] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(afterFirst[0].quantity), 16);
  const partial = await detail(created.id);
  assert.equal(partial.status, REQUISITION_STATUS.PARTIALLY_ISSUED);

  const secondIssue = await issueStock(routed.data.storeRequestId, item.id, 6, 'stock-second');
  assert.equal(secondIssue.status, 201, JSON.stringify(secondIssue.data));
  const [afterSecond] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(afterSecond[0].quantity), 10);
  const completed = await detail(created.id);
  assert.equal(completed.status, REQUISITION_STATUS.COMPLETED);
});

test('Scenario C - split routing and physical shortage remain traceable without duplicating quantities', async () => {
  const splitItem = await createItem(`QA routing split ${Date.now()}`, 6, department.id);
  const splitRequest = await submit(splitItem.name, 10, 'split');
  await approve(splitRequest.id);
  const split = await route(splitRequest.id, 'Split');
  assert.equal(split.status, 200, JSON.stringify(split.data));
  assert.ok(split.data.storeRequestId);
  storeRequestIds.push(split.data.storeRequestId);

  const [lines] = await pool.execute(
    `SELECT destination, quantity FROM requisition_routing_lines WHERE requisition_id = ? ORDER BY destination`,
    [splitRequest.id]
  );
  assert.deepEqual(lines.map((line) => ({ destination: line.destination, quantity: Number(line.quantity) })), [
    { destination: 'Procurement', quantity: 4 },
    { destination: 'Stock Keeper', quantity: 6 }
  ]);
  const splitDetail = await received(splitRequest.id);
  assert.equal(splitDetail.status, 200);
  assert.equal(splitDetail.data.requisition.items[0].quantity, 4, 'Procurement sees only the purchase quantity');

  const splitIssue = await issueStock(split.data.storeRequestId, splitItem.id, 6, 'split-issue');
  assert.equal(splitIssue.status, 201, JSON.stringify(splitIssue.data));
  const [splitBalance] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [splitItem.id]);
  assert.equal(Number(splitBalance[0].quantity), 0);

  const returnItem = await createItem(`QA routing return ${Date.now()}`, 10, department.id);
  const returnRequest = await submit(returnItem.name, 10, 'return');
  await approve(returnRequest.id);
  const routed = await route(returnRequest.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  storeRequestIds.push(routed.data.storeRequestId);

  const returnedIssue = await issueStock(routed.data.storeRequestId, returnItem.id, 6, 'return-issue');
  assert.equal(returnedIssue.status, 201, JSON.stringify(returnedIssue.data));
  const shortage = await request(`/portal/stockkeeper/routed-requests/${routed.data.storeRequestId}/return-shortage`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      storeRequestItemId: (await pool.execute('SELECT id FROM store_request_items WHERE store_request_id = ?', [routed.data.storeRequestId]))[0][0].id,
      availableQuantity: 0,
      unavailableQuantity: 4,
      reason: 'Physical count found four units missing; authorized adjustment required.'
    }
  });
  assert.equal(shortage.status, 201, JSON.stringify(shortage.data));
  const returned = await detail(returnRequest.id);
  assert.equal(returned.status, REQUISITION_STATUS.RETURNED_TO_SUPERVISOR);
  assert.equal(returned.routing.returns[0].unavailableQuantity, 4);
  const [balanceAfterReturn] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [returnItem.id]);
  assert.equal(Number(balanceAfterReturn[0].quantity), 4, 'Reporting a shortage must not reduce stock');

  const forwardedReturn = await request(`/portal/supervisor/requisitions/${returnRequest.id}/route-return`, {
    method: 'POST', user: supervisor, body: { returnId: shortage.data.id, comments: 'Purchase the missing four units.' }
  });
  assert.equal(forwardedReturn.status, 200, JSON.stringify(forwardedReturn.data));
  const finalDetail = await received(returnRequest.id);
  assert.equal(finalDetail.status, 200);
  assert.equal(finalDetail.data.requisition.items[0].quantity, 4, 'Only the returned shortage is purchased');
  const [finalLines] = await pool.execute(
    `SELECT SUM(quantity) AS total FROM requisition_routing_lines WHERE requisition_id = ? AND destination = 'Procurement'`,
    [returnRequest.id]
  );
  assert.equal(Number(finalLines[0].total), 4, 'No procurement quantity is duplicated');
});

test('Scenario D - routing is restricted to an active Supervisor of the request Department', async () => {
  const item = await createItem(`QA routing authorization ${Date.now()}`, 5, department.id);
  const created = await submit(item.name, 1, 'authorization');
  await approve(created.id);

  const asRequester = await request(`/portal/supervisor/requisitions/${created.id}/route`, {
    method: 'POST', user: requester, body: { destination: 'Procurement' }
  });
  assert.equal(asRequester.status, 403);
  const asOtherSupervisor = await request(`/portal/supervisor/requisitions/${created.id}/route`, {
    method: 'POST', user: otherSupervisor, body: { destination: 'Procurement' }
  });
  assert.equal(asOtherSupervisor.status, 404);
  const asStockkeeper = await request(`/portal/supervisor/requisitions/${created.id}/route`, {
    method: 'POST', user: stockkeeper, body: { destination: 'Procurement' }
  });
  assert.equal(asStockkeeper.status, 403);
  const asProcurement = await request(`/portal/supervisor/requisitions/${created.id}/route`, {
    method: 'POST', user: procurement, body: { destination: 'Procurement' }
  });
  assert.equal(asProcurement.status, 403);

  const beforeRouting = await received(created.id);
  assert.equal(beforeRouting.status, 404, 'Denied routing attempts must not expose the request to Procurement');
  const unchanged = await detail(created.id);
  assert.equal(unchanged.status, REQUISITION_STATUS.APPROVED);
  assert.equal(unchanged.routedAt, null);
  assert.equal(unchanged.routing.lines.length, 0);
});

test('QA A - Supervisor request decision saves full history and notifies the Supervisor', async () => {
  const item = await createItem(`QA workspace decision ${Date.now()}`, 20, department.id);
  const created = await submit(item.name, 4, 'qa-decision');
  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  const requestId = Number(routed.data.storeRequestId);
  storeRequestIds.push(requestId);

  const list = await request('/portal/stockkeeper/routed-requests', { user: stockkeeper });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const row = list.data.requests.find((entry) => Number(entry.requestId) === requestId);
  assert.ok(row, 'the routed request must appear in the Stock Keeper workspace');
  assert.equal(row.stockkeeperDecision, 'Pending');
  assert.equal(row.requisitionReference, created.reference);
  assert.equal(row.requester, requester.name);
  assert.equal(row.department, department.name);
  assert.equal(row.supervisorName, supervisor.name);
  assert.equal(row.supervisorComments, 'Routing QA decision');
  assert.equal(row.requestedQuantity, 4);
  assert.equal(row.availableBalance, 20);
  assert.ok(row.submittedAt && (row.forwardedAt || row.routedAt), 'the workspace must show submission and forwarding/routing dates');
  assert.ok(Object.hasOwn(row, 'forwardedAt'), 'the forwarded date field must always be exposed');

  const [[line]] = await pool.execute('SELECT id FROM store_request_items WHERE store_request_id = ?', [requestId]);
  const decision = await request(`/portal/stockkeeper/requests/${requestId}/decision`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      decision: 'Accepted',
      comments: 'Three units can be prepared from current stock',
      lines: [{ storeRequestItemId: line.id, quantity: 3 }]
    }
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.data));
  assert.match(decision.data.message, /only when a physical Stock Out/i);

  const detailResponse = await request(`/portal/stockkeeper/routed-requests/${requestId}`, { user: stockkeeper });
  assert.equal(detailResponse.status, 200, JSON.stringify(detailResponse.data));
  assert.equal(detailResponse.data.request.stockkeeperDecision, 'Accepted');
  assert.equal(detailResponse.data.request.stockkeeperName, stockkeeper.name);
  assert.equal(detailResponse.data.request.stockkeeperComments, 'Three units can be prepared from current stock');
  assert.ok(detailResponse.data.request.decisionAt);
  assert.equal(detailResponse.data.items[0].acceptedQuantity, 3);
  assert.equal(detailResponse.data.items[0].issuedQuantity, 0);
  const [[unchangedBalance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(unchangedBalance.quantity), 20, 'acceptance must not move stock');

  const [notices] = await pool.execute(
    `SELECT id, title, link FROM notifications
      WHERE user_id = ? AND category = 'stock_request_decision' AND link LIKE ?`,
    [supervisor.id, `%request=${created.id}%`]
  );
  assert.ok(notices.length, 'the Supervisor must be notified of the decision');
  assert.match(notices[0].link, /supervisor\/Approvals/);
  const [activity] = await pool.execute(
    `SELECT id FROM requisition_activity WHERE requisition_id = ? AND action = 'stock_request_accepted'`,
    [created.id]
  );
  assert.equal(activity.length, 1, 'the original request history must remain append-only');

  const rejectItem = await createItem(`QA workspace rejection ${Date.now()}`, 5, department.id);
  const rejectRequest = await submit(rejectItem.name, 2, 'qa-reject');
  await approve(rejectRequest.id);
  const rejectRoute = await route(rejectRequest.id, 'Stock Keeper');
  assert.equal(rejectRoute.status, 200, JSON.stringify(rejectRoute.data));
  const rejectId = Number(rejectRoute.data.storeRequestId);
  storeRequestIds.push(rejectId);
  const [[rejectLine]] = await pool.execute('SELECT id FROM store_request_items WHERE store_request_id = ?', [rejectId]);
  const rejection = await request(`/portal/stockkeeper/requests/${rejectId}/decision`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      decision: 'Rejected',
      reason: 'Catalogue item was substituted',
      comments: 'Please review the requested specification',
      lines: [{ storeRequestItemId: rejectLine.id, quantity: 0 }]
    }
  });
  assert.equal(rejection.status, 200, JSON.stringify(rejection.data));
  const rejectedDetail = await request(`/portal/stockkeeper/routed-requests/${rejectId}`, { user: stockkeeper });
  assert.equal(rejectedDetail.data.request.stockkeeperDecision, 'Rejected');
  assert.equal(rejectedDetail.data.request.rejectionReason, 'Catalogue item was substituted');
  assert.equal(rejectedDetail.data.request.stockkeeperComments, 'Please review the requested specification');
  const [[rejectedBalance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [rejectItem.id]);
  assert.equal(Number(rejectedBalance.quantity), 5, 'rejection must not move stock');
});

test('QA B - Department Stock overview uses real locations, balances and movement totals', async () => {
  const item = await createItem(`QA department stock ${Date.now()}`, 12, otherDepartment.id);
  await pool.execute('UPDATE items SET storage_location = ? WHERE id = ?', ['Shelf B', item.id]);
  const stockIn = await request('/portal/stockkeeper/transactions/stock-in', {
    method: 'POST',
    user: stockkeeper,
    body: {
      itemId: item.id, quantity: 3, date: '2026-11-27', source: 'QA Department Stock',
      description: 'Opening count confirmation', idempotencyKey: uniqueKey('qa-b-stock-in')
    }
  });
  assert.equal(stockIn.status, 201, JSON.stringify(stockIn.data));
  movementIds.push(Number(stockIn.data.id));

  const overview = await request(
    `/portal/stockkeeper/stock-overview?search=${encodeURIComponent(item.name)}`,
    { user: stockkeeper }
  );
  assert.equal(overview.status, 200, JSON.stringify(overview.data));
  const row = overview.data.items.find((entry) => Number(entry.id) === item.id);
  assert.ok(row, 'the item must be visible in the Stock Overview');
  assert.equal(row.itemCode, item.sku);
  assert.equal(row.department, otherDepartment.name);
  assert.equal(row.storageLocation, 'Shelf B');
  assert.equal(row.unitOfMeasure, 'unit');
  assert.equal(row.openingBalance, 12);
  assert.equal(row.totalStockIn, 3);
  assert.equal(row.totalStockOut, 0);
  assert.equal(row.currentBalance, 15);
  assert.equal(row.minimumStock, 2);
  assert.equal(row.status, 'Available');
  assert.ok(row.updatedAt);

  const moved = await request(`/portal/stockkeeper/items/${item.id}/location`, {
    method: 'PATCH',
    user: stockkeeper,
    body: { departmentId: department.id, storageLocation: 'Bin A1' }
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const afterMove = await request(
    `/portal/stockkeeper/stock-overview?departmentId=${department.id}&search=${encodeURIComponent(item.name)}`,
    { user: stockkeeper }
  );
  const movedRow = afterMove.data.items.find((entry) => Number(entry.id) === item.id);
  assert.equal(movedRow.department, department.name);
  assert.equal(movedRow.storageLocation, 'Bin A1');
  assert.equal(movedRow.currentBalance, 15);
  const [audit] = await pool.execute(
    `SELECT id FROM audit_logs WHERE entity_type = 'item' AND entity_id = ? AND action = 'stock_location_updated'`,
    [String(item.id)]
  );
  assert.equal(audit.length, 1, 'location changes must be audited');
});

test('QA C - receiving goods records partial delivery, damage, Bin Card and notifications', async () => {
  const item = await createItem(`QA receiving goods ${Date.now()}`, 0, department.id);
  reportItem = item;
  const purchaseOrder = await createApprovedPurchaseOrder(item, 10, 'receiving');

  const [expectedNotice] = await pool.execute(
    `SELECT id FROM notifications WHERE user_id = ? AND category = 'expected_delivery' AND link LIKE ?`,
    [stockkeeper.id, `%purchaseOrder=${purchaseOrder.id}%`]
  );
  assert.ok(expectedNotice.length, 'PO approval must notify the Stock Keeper');
  const deliveries = await request('/portal/stockkeeper/expected-deliveries', { user: stockkeeper });
  assert.ok(deliveries.data.deliveries.some((entry) => Number(entry.id) === purchaseOrder.id));
  const deliveryDetail = await request(`/portal/stockkeeper/expected-deliveries/${purchaseOrder.id}`, { user: stockkeeper });
  assert.equal(deliveryDetail.status, 200, JSON.stringify(deliveryDetail.data));
  const expectedLine = deliveryDetail.data.delivery.items.find((entry) => Number(entry.itemId) === item.id);
  assert.equal(expectedLine.outstandingQuantity, 10);
  assert.equal(expectedLine.itemCode, item.sku);

  const receiptKey = uniqueKey('qa-c-receipt');
  const partial = await request(`/portal/stockkeeper/expected-deliveries/${purchaseOrder.id}/receive-items`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      idempotencyKey: receiptKey,
      date: '2026-11-27',
      comments: 'Two cartons damaged on arrival',
      lines: [{
        itemId: item.id, deliveredQuantity: 8, acceptedQuantity: 6, rejectedQuantity: 2,
        condition: 'Partial', comments: 'Damaged cartons', departmentId: department.id,
        storageLocation: 'Bin C2'
      }]
    }
  });
  assert.equal(partial.status, 201, JSON.stringify(partial.data));
  assert.equal(partial.data.acceptedTotal, 6);
  assert.equal(partial.data.rejectedTotal, 2);
  assert.equal(partial.data.outstanding, 2);
  assert.equal(partial.data.purchaseOrderStatus, 'Partially received');
  goodsReceiptIds.push(Number(partial.data.id));
  for (const movement of partial.data.movements) movementIds.push(Number(movement.id));

  const [[balance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(balance.quantity), 6, 'only accepted units may increase available stock');
  const [receiptLines] = await pool.execute(
    `SELECT quantity, delivered_quantity AS delivered, damaged_quantity AS damaged, storage_location AS location
       FROM goods_receipt_items WHERE goods_receipt_id = ?`,
    [partial.data.id]
  );
  assert.equal(Number(receiptLines[0].quantity), 6);
  assert.equal(Number(receiptLines[0].delivered), 8);
  assert.equal(Number(receiptLines[0].damaged), 2);
  assert.equal(receiptLines[0].location, 'Bin C2');

  const [procurementNotice] = await pool.execute(
    `SELECT id FROM notifications WHERE user_id = ? AND category = 'goods_receipt' AND link LIKE ?`,
    [procurement.id, `%purchase-orders/${purchaseOrder.id}%`]
  );
  assert.ok(procurementNotice.length, 'Procurement must be told about the delivery discrepancy');
  const [keeperNotice] = await pool.execute(
    `SELECT id FROM notifications WHERE user_id = ? AND category = 'stock_in' AND link LIKE ?`,
    [stockkeeper.id, `%purchaseOrder=${purchaseOrder.id}%`]
  );
  assert.ok(keeperNotice.length);

  const duplicate = await request(`/portal/stockkeeper/expected-deliveries/${purchaseOrder.id}/receive-items`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      idempotencyKey: receiptKey,
      date: '2026-11-27',
      lines: [{
        itemId: item.id, deliveredQuantity: 8, acceptedQuantity: 6, rejectedQuantity: 2,
        condition: 'Partial'
      }]
    }
  });
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
  assert.equal(duplicate.data.duplicate, true);
  const [[afterDuplicate]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(afterDuplicate.quantity), 6);

  const remainder = await request(`/portal/stockkeeper/expected-deliveries/${purchaseOrder.id}/receive-all`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      idempotencyKey: uniqueKey('qa-c-remainder'),
      date: '2026-11-28',
      comments: 'Remaining goods received',
      lines: [{ itemId: item.id, deliveredQuantity: 2, acceptedQuantity: 2, rejectedQuantity: 0, condition: 'Good' }]
    }
  });
  assert.equal(remainder.status, 201, JSON.stringify(remainder.data));
  assert.equal(remainder.data.outstanding, 0);
  assert.equal(remainder.data.purchaseOrderStatus, 'Received');
  goodsReceiptIds.push(Number(remainder.data.id));
  for (const movement of remainder.data.movements) movementIds.push(Number(movement.id));
  const [[finalBalance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(finalBalance.quantity), 8);
  const card = await request(`/portal/stockkeeper/items/${item.id}`, { user: stockkeeper });
  assert.equal(card.data.movements.length, 2, 'both receipts must be appended to the Bin Card');
  const afterDelivery = await request('/portal/stockkeeper/expected-deliveries', { user: stockkeeper });
  assert.ok(!afterDelivery.data.deliveries.some((entry) => Number(entry.id) === purchaseOrder.id));
});

test('QA D - Stock Out batch issue requires acceptance and never overdraws stock or authorization', async () => {
  const item = await createItem(`QA stock out ${Date.now()}`, 10, department.id);
  issueItem = item;
  const created = await submit(item.name, 8, 'qa-stock-out');
  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  const requestId = Number(routed.data.storeRequestId);
  storeRequestIds.push(requestId);
  const [[line]] = await pool.execute('SELECT id FROM store_request_items WHERE store_request_id = ?', [requestId]);

  const issueBody = (quantity, suffix) => ({
    idempotencyKey: uniqueKey(`qa-d-${suffix}`),
    date: '2026-11-27',
    receivedBy: requester.name,
    comments: `QA physical issue ${suffix}`,
    lines: [{ storeRequestItemId: line.id, quantity }]
  });
  const pending = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(1, 'pending')
  });
  assert.equal(pending.status, 409);
  assert.match(pending.data.message, /accepted request/i);

  const decision = await request(`/portal/stockkeeper/requests/${requestId}/decision`, {
    method: 'POST',
    user: stockkeeper,
    body: {
      decision: 'Accepted',
      comments: 'Six units authorized for physical issue',
      lines: [{ storeRequestItemId: line.id, quantity: 6 }]
    }
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.data));
  const overAuthorized = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(7, 'over-authorized')
  });
  assert.equal(overAuthorized.status, 409);
  assert.match(overAuthorized.data.message, /authorized outstanding quantity/i);

  await adjustStock(item.id, 8, 'Out', 'issue-count');
  const overAvailable = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(3, 'over-available')
  });
  assert.equal(overAvailable.status, 409);
  assert.match(overAvailable.data.message, /insufficient stock/i);
  await adjustStock(item.id, 8, 'In', 'issue-restore');

  const firstIssue = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(4, 'first')
  });
  assert.equal(firstIssue.status, 201, JSON.stringify(firstIssue.data));
  assert.equal(firstIssue.data.total, 4);
  assert.equal(firstIssue.data.requestStatus, 'Approved');
  assert.equal(firstIssue.data.lines[0].balance, 6);
  const secondIssue = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(2, 'second')
  });
  assert.equal(secondIssue.status, 201, JSON.stringify(secondIssue.data));
  assert.equal(secondIssue.data.requestStatus, 'Issued');
  assert.equal(secondIssue.data.lines[0].balance, 4);

  const exhausted = await request(`/portal/stockkeeper/requests/${requestId}/issue`, {
    method: 'POST', user: stockkeeper, body: issueBody(1, 'exhausted')
  });
  assert.equal(exhausted.status, 409);
  assert.match(exhausted.data.message, /authorized outstanding quantity \(0\)/i);

  const [[finalBalance]] = await pool.execute('SELECT quantity FROM items WHERE id = ?', [item.id]);
  assert.equal(Number(finalBalance.quantity), 4);
  const detailResponse = await request(`/portal/stockkeeper/routed-requests/${requestId}`, { user: stockkeeper });
  assert.equal(detailResponse.data.request.stockkeeperDecision, 'Accepted');
  assert.equal(detailResponse.data.request.requestStatus, 'Issued');
  assert.ok(detailResponse.data.request.issuedAt);
  assert.equal(detailResponse.data.items[0].authorizedQuantity, 6);
  assert.equal(detailResponse.data.items[0].issuedQuantity, 6);

  for (const [userId, role] of [[requester.id, 'requester'], [supervisor.id, 'supervisor']]) {
    const [notices] = await pool.execute(
      `SELECT id FROM notifications WHERE user_id = ? AND category = 'stock_issue'`,
      [userId]
    );
    assert.ok(notices.length, `${role} must be notified of the physical issue`);
  }
  const card = await request(`/portal/stockkeeper/items/${item.id}`, { user: stockkeeper });
  assert.equal(card.data.movements.length, 4, 'count corrections and both issues stay in the Bin Card');
});

test('QA E - Inventory Reports and PDF/Excel/CSV exports share filtered rows and totals', async () => {
  const keys = [
    'stockkeeperStockIn', 'stockkeeperStockOut', 'stockkeeperCurrentBalance',
    'stockkeeperDepartmentStock', 'stockkeeperStockMovement', 'stockkeeperLowStock',
    'stockkeeperDamagedGoods', 'stockkeeperSupplierDeliveries'
  ];
  const available = await request('/exports/available', { user: stockkeeper });
  assert.equal(available.status, 200, JSON.stringify(available.data));
  for (const key of keys) {
    assert.ok(available.data.exports.some((entry) => entry.key === key), `${key} must be exportable by a Stock Keeper`);
    const report = await request(
      `/portal/stockkeeper/inventory-report?type=${key}&itemId=${reportItem.id}`,
      { user: stockkeeper }
    );
    assert.equal(report.status, 200, `${key}: ${JSON.stringify(report.data)}`);
    assert.ok(Array.isArray(report.data.rows), `${key} must return full rows`);
    assert.ok(report.data.dateField);
    assert.ok(report.data.filters);
    const workbook = await rawRequest(`/exports/${key}/xlsx?type=${key}&itemId=${reportItem.id}`);
    assert.equal(workbook.status, 200, `${key} Excel export: ${JSON.stringify(workbook.data)}`);
    assert.equal(workbook.buffer.subarray(0, 2).toString(), 'PK', `${key} must produce a valid workbook`);
  }
  const invalid = await request('/portal/stockkeeper/inventory-report?type=not-a-report', { user: stockkeeper });
  assert.equal(invalid.status, 400);
  const forbidden = await request('/exports/requisitions/csv', { user: stockkeeper });
  assert.equal(forbidden.status, 403);

  const query = `type=stockkeeperStockMovement&itemId=${reportItem.id}`;
  const movement = await request(`/portal/stockkeeper/inventory-report?${query}`, { user: stockkeeper });
  assert.ok(movement.data.rows.length >= 2, 'receipt movements must be present');
  assert.ok(movement.data.rows.some((entry) => entry.Item === reportItem.name));
  assert.ok(movement.data.summary.some((total) => total.column === 'Stock in'));

  const pdf = await rawRequest(`/exports/stockkeeperStockMovement/pdf?${query}&reference=Stock%20Movement`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.contentType, /application\/pdf/);
  assert.match(pdf.disposition, /Stock-Movement/);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  const xlsx = await rawRequest(`/exports/stockkeeperStockMovement/xlsx?${query}&reference=Stock%20Movement`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.contentType, /spreadsheetml/);
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
  const csv = await rawRequest(`/exports/stockkeeperStockMovement/csv?${query}&reference=Stock%20Movement`);
  assert.equal(csv.status, 200);
  assert.match(csv.contentType, /text\/csv/);
  const csvText = csv.buffer.toString('utf8');
  assert.ok(csvText.startsWith('\uFEFF'), 'CSV must carry a UTF-8 BOM');
  assert.match(csvText, /Totals: Total Stock in:/);
  assert.match(csvText, new RegExp(reportItem.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const outQuery = `type=stockkeeperStockOut&itemId=${issueItem.id}`;
  const outReport = await request(`/portal/stockkeeper/inventory-report?${outQuery}`, { user: stockkeeper });
  assert.ok(outReport.data.rows.length >= 2, 'issue movements must be present');
  const outCsv = (await rawRequest(`/exports/stockkeeperStockOut/csv?${outQuery}&reference=Stock%20Out`)).buffer.toString('utf8');
  const outOccurrences = outCsv.split(issueItem.name).length - 1;
  assert.ok(outOccurrences >= outReport.data.rows.length, 'print/download output must contain every filtered row');
  assert.match(outCsv, /Totals: Total Quantity:/);

  const damaged = await request(
    `/portal/stockkeeper/inventory-report?type=stockkeeperDamagedGoods&itemId=${reportItem.id}`,
    { user: stockkeeper }
  );
  assert.equal(Number(damaged.data.rows[0]['Damaged/rejected quantity']), 2);
  const damagedCsv = (await rawRequest(
    `/exports/stockkeeperDamagedGoods/csv?type=stockkeeperDamagedGoods&itemId=${reportItem.id}&reference=Damaged%20Goods`
  )).buffer.toString('utf8');
  assert.match(damagedCsv, /Damaged\/rejected quantity/);
  assert.match(damagedCsv, /Total Damaged\/rejected quantity: 2/);
});

test('Critical regression - unmatched free-text request reaches the Stock Keeper register', async () => {
  const itemName = `VBCXFG-${Date.now()}`;
  const created = await submit(itemName, 3, 'unmatched-route');
  const verification = (await detail(created.id)).routingStock;
  assert.equal(Boolean(verification[0].matched), false, 'the free-text line must be deliberately unmatched');
  assert.equal(verification[0].availableQuantity, 0);

  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper', { comments: 'Review the free-text line for physical stock' });
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  assert.equal(routed.data.destination, 'Stock Keeper');
  assert.ok(routed.data.storeRequestId);
  const storeRequestId = Number(routed.data.storeRequestId);
  storeRequestIds.push(storeRequestId);

  const [requisitionRows] = await pool.execute(
    `SELECT routing_destination AS destination, routing_comments AS comments,
        routed_by_supervisor AS routedBy, routed_at AS routedAt,
        forwarded_by_supervisor AS forwardedBy, forwarded_at AS forwardedAt,
        supervisor_decision AS supervisorDecision
       FROM requisitions WHERE id = ?`, [created.id]
  );
  assert.equal(requisitionRows[0].destination, 'Stock Keeper');
  assert.equal(requisitionRows[0].comments, 'Review the free-text line for physical stock');
  assert.equal(Number(requisitionRows[0].routedBy), supervisor.id);
  assert.ok(requisitionRows[0].routedAt);
  assert.equal(requisitionRows[0].forwardedBy, null);
  assert.equal(requisitionRows[0].forwardedAt, null, 'Stock Keeper-only routing is not Procurement forwarding');
  assert.equal(requisitionRows[0].supervisorDecision, 'Approved');

  const [storeRows] = await pool.execute(
    `SELECT sr.id, sr.requisition_id AS requisitionId, sr.department_id AS departmentId,
        sr.routed_by_supervisor AS routedBy, sr.status, sr.stockkeeper_decision AS decision,
        sr.stockkeeper_viewed_at AS viewedAt
       FROM store_requests sr WHERE sr.id = ?`, [storeRequestId]
  );
  assert.equal(Number(storeRows[0].requisitionId), created.id);
  assert.equal(Number(storeRows[0].departmentId), department.id);
  assert.equal(Number(storeRows[0].routedBy), supervisor.id);
  assert.equal(storeRows[0].status, 'Approved');
  assert.equal(storeRows[0].decision, 'Pending');
  assert.equal(storeRows[0].viewedAt, null);

  const [routingLines] = await pool.execute(
    `SELECT destination, quantity, item_id AS itemId, requisition_item_id AS requisitionItemId
       FROM requisition_routing_lines WHERE requisition_id = ?`, [created.id]
  );
  assert.equal(routingLines.length, 1, 'only the Stock Keeper allocation is written');
  assert.equal(routingLines[0].destination, 'Stock Keeper');
  assert.equal(Number(routingLines[0].quantity), 3);
  assert.equal(routingLines[0].itemId, null);
  assert.equal(Number(routingLines[0].requisitionItemId), Number(verification[0].requisitionItemId));

  const [storeLines] = await pool.execute(
    `SELECT item_id AS itemId, requisition_item_id AS requisitionItemId,
        requested_item_name AS requestedItemName, requested_unit AS requestedUnit, quantity
       FROM store_request_items WHERE store_request_id = ?`, [storeRequestId]
  );
  assert.equal(storeLines[0].itemId, null, 'a free-text line must not be silently mapped to a catalog item');
  assert.equal(Number(storeLines[0].requisitionItemId), Number(verification[0].requisitionItemId));
  assert.equal(storeLines[0].requestedItemName, itemName);
  assert.equal(storeLines[0].requestedUnit, 'unit');
  assert.equal(Number(storeLines[0].quantity), 3);

  const [assignments] = await pool.execute(
    'SELECT user_id AS userId FROM store_request_assignments WHERE store_request_id = ?', [storeRequestId]
  );
  assert.deepEqual(assignments.map((row) => Number(row.userId)).sort(), [stockkeeper.id].sort());

  const list = await request('/portal/stockkeeper/routed-requests', { user: stockkeeper });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const row = list.data.requests.find((entry) => Number(entry.requestId) === storeRequestId);
  assert.ok(row, 'the routed request must appear in Requests from Supervisors');
  assert.equal(row.status, 'New Request');
  assert.equal(Boolean(row.isNew), true);
  assert.equal(row.itemName, itemName);
  assert.equal(Number(row.availableBalance), 0);
  assert.equal(row.supervisorName, supervisor.name);
  assert.equal(row.requisitionReference, created.reference);

  const opened = await request(`/portal/stockkeeper/routed-requests/${storeRequestId}`, { user: stockkeeper });
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  assert.equal(opened.data.request.status, 'Pending Stock Keeper Review');
  const [viewedRows] = await pool.execute(
    'SELECT stockkeeper_viewed_at AS viewedAt FROM store_requests WHERE id = ?', [storeRequestId]
  );
  assert.ok(viewedRows[0].viewedAt, 'opening the request records the view time');

  const [notifications] = await pool.execute(
    `SELECT id, title, body, link FROM notifications
      WHERE user_id = ? AND category = 'stock_routing' AND link LIKE ?`,
    [stockkeeper.id, `%request=${storeRequestId}%`]
  );
  assert.equal(notifications.length, 1, 'the authorized Stock Keeper receives exactly one route notification');
  assert.ok(notifications[0].body.includes(created.reference));
  assert.ok(notifications[0].body.includes(department.name));
  assert.match(notifications[0].link, /stockkeeper\/Requests%20from%20Supervisors/);

  const procurementQueue = await received(created.id);
  assert.equal(procurementQueue.status, 404, 'a Stock Keeper-only route must stay out of Procurement');

  const duplicate = await route(created.id, 'Stock Keeper');
  assert.equal(duplicate.status, 409, 'a repeated route must fail instead of creating a second register row');
  const [storeCount] = await pool.execute(
    'SELECT COUNT(*) AS total FROM store_requests WHERE requisition_id = ?', [created.id]
  );
  assert.equal(Number(storeCount[0].total), 1);
});

test('Critical regression - Split routing notifies Stock Keeper without moving the Procurement quantity', async () => {
  const item = await createItem(`QA critical split ${Date.now()}`, 6, department.id);
  const created = await submit(item.name, 10, 'critical-split');
  await approve(created.id);
  const split = await route(created.id, 'Split');
  assert.equal(split.status, 200, JSON.stringify(split.data));
  assert.ok(split.data.storeRequestId);
  const storeRequestId = Number(split.data.storeRequestId);
  storeRequestIds.push(storeRequestId);

  const [notifications] = await pool.execute(
    `SELECT id, body, link FROM notifications
      WHERE user_id = ? AND category = 'stock_routing' AND link LIKE ?`,
    [stockkeeper.id, `%request=${storeRequestId}%`]
  );
  assert.equal(notifications.length, 1, 'Split routes must notify Stock Keepers too');
  assert.match(notifications[0].body, /forwarded to Procurement/);
  assert.ok(notifications[0].body.includes(created.reference));

  const [assignments] = await pool.execute(
    'SELECT user_id AS userId FROM store_request_assignments WHERE store_request_id = ?', [storeRequestId]
  );
  assert.equal(assignments.length, 1);
  assert.equal(Number(assignments[0].userId), stockkeeper.id);

  const procurementQueue = await received(created.id);
  assert.equal(procurementQueue.status, 200);
  assert.equal(procurementQueue.data.requisition.items[0].quantity, 4);
  const keeperQueue = await request('/portal/stockkeeper/routed-requests', { user: stockkeeper });
  const row = keeperQueue.data.requests.find((entry) => Number(entry.requestId) === storeRequestId);
  assert.ok(row);
  assert.equal(Number(row.requestedQuantity), 6);
});

test('Critical regression - Stock Keeper scope blocks another department and failed routes notify nobody', async () => {
  const item = await createItem(`QA critical scope ${Date.now()}`, 5, department.id);
  const created = await submit(item.name, 2, 'critical-scope');
  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  const storeRequestId = Number(routed.data.storeRequestId);
  storeRequestIds.push(storeRequestId);

  const otherList = await request('/portal/stockkeeper/routed-requests', { user: otherStockkeeper });
  assert.equal(otherList.status, 200, JSON.stringify(otherList.data));
  assert.ok(!otherList.data.requests.some((row) => Number(row.requestId) === storeRequestId),
    'an unrelated Stock Keeper must not see the request');

  const otherDetail = await request(`/portal/stockkeeper/routed-requests/${storeRequestId}`, { user: otherStockkeeper });
  assert.equal(otherDetail.status, 404);
  const otherDecision = await request(`/portal/stockkeeper/requests/${storeRequestId}/decision`, {
    method: 'POST',
    user: otherStockkeeper,
    body: { decision: 'Rejected', reason: 'Unauthorized scope test' }
  });
  assert.equal(otherDecision.status, 404);

  const [stillPending] = await pool.execute(
    'SELECT stockkeeper_decision AS decision FROM store_requests WHERE id = ?', [storeRequestId]
  );
  assert.equal(stillPending[0].decision, 'Pending');

  const unassignedDepartment = await createDepartment(`QA Critical Unassigned ${Date.now()}`);
  const unassignedRequester = await createUser('QA Critical Unassigned Requester', 'unassigned-requester', 'requestor', unassignedDepartment.id);
  const unassignedSupervisor = await createUser('QA Critical Unassigned Supervisor', 'unassigned-supervisor', 'supervisor', unassignedDepartment.id);
  const submitted = await request('/portal/requester/requisitions', {
    method: 'POST',
    user: unassignedRequester,
    body: {
      action: 'submit',
      title: `Critical unassigned ${Date.now()}`,
      location: 'QA store',
      justification: 'No Stock Keeper is assigned to this department',
      budgetCode: 'QA-UNASSIGNED',
      items: [{ itemName: 'Unassigned department item', quantity: 1, unit: 'unit', estimatedUnitCost: 10 }]
    }
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  requisitionIds.push(submitted.data.id);
  const approved = await request(`/portal/supervisor/requisitions/${submitted.data.id}/decision`, {
    method: 'POST',
    user: unassignedSupervisor,
    body: { decision: 'Approve', reason: 'Approved for the failed-route test' }
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const failed = await request(`/portal/supervisor/requisitions/${submitted.data.id}/route`, {
    method: 'POST',
    user: unassignedSupervisor,
    body: { destination: 'Stock Keeper' }
  });
  assert.equal(failed.status, 409, JSON.stringify(failed.data));
  assert.match(failed.data.message, /No active Stock Keeper/i);

  const [orphanStoreRequests] = await pool.execute(
    'SELECT COUNT(*) AS total FROM store_requests WHERE requisition_id = ?', [submitted.data.id]
  );
  assert.equal(Number(orphanStoreRequests[0].total), 0, 'a failed route must not write a store request');
  const [orphanNotifications] = await pool.execute(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE category = 'stock_routing' AND link LIKE ?`, [`%request=${submitted.data.id}%`]
  );
  assert.equal(Number(orphanNotifications[0].total), 0, 'a failed route must not notify Stock Keepers');
});

test('Critical regression - routed request persists after login and its badge clears on read', async () => {
  const item = await createItem(`QA critical persistence ${Date.now()}`, 8, department.id);
  const created = await submit(item.name, 2, 'critical-persistence');
  await approve(created.id);
  const routed = await route(created.id, 'Stock Keeper');
  assert.equal(routed.status, 200, JSON.stringify(routed.data));
  const storeRequestId = Number(routed.data.storeRequestId);
  storeRequestIds.push(storeRequestId);

  // A fresh login is a new session; it must resolve the same real database row.
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: stockkeeper.email, password: PASSWORD }
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.id, stockkeeper.id);
  assert.ok(login.data.token);

  const afterLogin = await request('/portal/stockkeeper/routed-requests', { token: login.data.token });
  assert.equal(afterLogin.status, 200, JSON.stringify(afterLogin.data));
  const persisted = afterLogin.data.requests.find((row) => Number(row.requestId) === storeRequestId);
  assert.ok(persisted, 'the route must persist after logout/login');
  assert.equal(persisted.requisitionReference, created.reference);
  assert.equal(persisted.stockkeeperDecision, 'Pending');

  const page = 'Requests from Supervisors';
  const badgeBefore = await request('/sidebar-counts', { token: login.data.token });
  assert.equal(badgeBefore.status, 200, JSON.stringify(badgeBefore.data));
  assert.ok(Number(badgeBefore.data.counts[page]) >= 1, 'the route must create a real unread badge');

  const marked = await request('/notifications/read-module', {
    method: 'PATCH',
    token: login.data.token,
    body: { page }
  });
  assert.equal(marked.status, 200, JSON.stringify(marked.data));

  const badgeAfter = await request('/sidebar-counts', { token: login.data.token });
  assert.equal(Number(badgeAfter.data.counts[page] || 0), 0, 'opening the page must clear the route badge');

  const notifications = await request('/notifications', { token: login.data.token });
  assert.equal(notifications.status, 200, JSON.stringify(notifications.data));
  const notice = notifications.data.notifications.find((entry) => String(entry.link).includes(`request=${storeRequestId}`));
  assert.ok(notice);
  assert.equal(Boolean(notice.isRead), true);

  const [receipts] = await pool.execute(
    `SELECT COUNT(*) AS total FROM notification_read_receipts nr
      WHERE nr.notification_id = ? AND nr.user_id = ?`, [notice.id, stockkeeper.id]
  );
  assert.equal(Number(receipts[0].total), 1, 'read state must be persisted for the Stock Keeper');
});

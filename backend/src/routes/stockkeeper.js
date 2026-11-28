import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { UNREAD_NOTIFICATION_SQL, VALID_NOTIFICATION_SQL, markNotificationsRead } from '../lib/notification-reads.js';
import { allowRoles } from '../middleware/auth.js';
import { businessDate, isIsoDate, toUtcDateTime } from '../utils/dates.js';
import { REQUISITION_STATUS, statusLabel } from '../utils/requisition-status.js';
import { fetchExportRows } from '../services/exports.js';
import { loadStockkeeperScope, stockkeeperScopeClause } from '../services/stockkeeper-scope.js';

const router = Router();
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const REQUESTER_PAGE_SIZES = new Set([10, 25, 50, 100]);
const INVENTORY_REPORT_KEYS = new Set([
  'stockkeeperStockIn', 'stockkeeperStockOut', 'stockkeeperCurrentBalance',
  'stockkeeperDepartmentStock', 'stockkeeperStockMovement', 'stockkeeperLowStock',
  'stockkeeperDamagedGoods', 'stockkeeperSupplierDeliveries'
]);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf', 'text/plain', 'text/csv', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'image/webp'
]);

router.use(allowRoles('storekeeper'));

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function pagination(query, defaultSort, sortFields = {}) {
  const rawPage = String(query.page ?? '1');
  const rawLimit = String(query.limit ?? '10');
  const page = Number(rawPage);
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    return { error: 'Page must be a positive whole number.' };
  }
  if (!/^\d+$/.test(rawLimit) || !REQUESTER_PAGE_SIZES.has(limit)) {
    return { error: 'Page size must be 10, 25, 50, or 100.' };
  }
  const sort = String(query.sort || defaultSort);
  if (!Object.prototype.hasOwnProperty.call(sortFields, sort)) {
    return { error: 'Choose a supported sort field.' };
  }
  const direction = String(query.direction || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) {
    return { error: 'Sort direction must be asc or desc.' };
  }
  return { page, limit, sort, sortColumn: sortFields[sort], direction: direction.toUpperCase() };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The register keeps the existing decision fields but derives one clear,
// mutually exclusive status for the eight states shown in the Stock Keeper UI.
function routedStatus(row) {
  const decided = row.stockkeeperDecision || 'Pending';
  const issued = Number(row.issuedQuantity) || 0;
  const remaining = Number(row.remainingQuantity) || 0;
  if (decided === 'Rejected') return 'Rejected';
  if (row.requisitionStatus === REQUISITION_STATUS.RETURNED_TO_SUPERVISOR) return 'Returned to Supervisor';
  if (row.requisitionStatus === REQUISITION_STATUS.COMPLETED) return 'Completed';
  if ((row.requestStatus === 'Issued' || remaining === 0) && issued > 0) return 'Issued';
  if (issued > 0 && remaining > 0) return 'Partially Issued';
  if (decided === 'Accepted') return 'Accepted';
  if (decided === 'Pending') return row.isNew ? 'New Request' : 'Pending Stock Keeper Review';
  return decided;
}

function withRoutedStatus(rows) {
  return (rows || []).map((row) => ({
    ...row,
    isNew: Boolean(row.isNew),
    status: routedStatus(row)
  }));
}

// Every routed action is checked against the same department/assignment scope
// used by the register. Legacy direct store requests (no requisition_id) stay
// issueable inside the Stock Keeper's own inventory scope.
async function requireActionScope(connection, userId) {
  const scope = await loadStockkeeperScope(connection, userId);
  if (!scope) return null;
  return stockkeeperScopeClause(scope, userId);
}

function parseTransactionInput(body) {
  const itemId = parseId(body.itemId);
  const quantity = Number(body.quantity);
  const idempotencyKey = text(body.idempotencyKey, 80);
  if (!itemId || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw httpError(400, 'Choose an item and enter a positive whole-number quantity.');
  }
  if (idempotencyKey.length < 16) {
    throw httpError(400, 'A transaction idempotency key is required. Refresh and retry the form.');
  }
  const date = businessDate(body.date || new Date().toISOString().slice(0, 10), 'Transaction date');
  return {
    itemId,
    quantity,
    idempotencyKey,
    date,
    movementAt: toUtcDateTime(date),
    referenceNo: text(body.referenceNo, 40) || `BIN-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`,
    description: text(body.description, 2000)
  };
}

function parseAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw httpError(400, `Attach no more than ${MAX_ATTACHMENTS} supporting documents.`);
  }
  return value.map((attachment) => {
    const fileName = text(attachment.fileName, 255);
    const mimeType = text(attachment.mimeType, 150);
    const encoded = String(attachment.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw httpError(400, 'The supporting document type or contents are invalid.');
    }
    const fileData = Buffer.from(encoded, 'base64');
    if (!fileData.length || fileData.length > MAX_ATTACHMENT_BYTES) {
      throw httpError(400, 'The supporting document must be smaller than 5 MB.');
    }
    return { fileName, mimeType, fileData };
  });
}

async function notifyStorekeepers(connection, title, body, link, category) {
  const [users] = await connection.execute(
    "SELECT id FROM users WHERE role = 'storekeeper' AND active = TRUE"
  );
  for (const user of users) {
    await createNotification(connection, user.id, title, body, link, category);
  }
}

async function notifyUsers(connection, userIds, title, body, link, category) {
  for (const userId of new Set(userIds.map(Number))) {
    if (Number.isInteger(userId) && userId > 0) {
      await createNotification(connection, userId, title, body, link, category);
    }
  }
}

async function notifySupervisor(connection, request, title, body, link, category) {
  const [users] = await connection.execute(
    `SELECT id FROM users WHERE id = ? AND role = 'supervisor' AND active = TRUE
      UNION
      SELECT id FROM users WHERE role = 'supervisor' AND active = TRUE AND department_id = ?`,
    [request.supervisorId || 0, request.departmentId || 0]
  );
  await notifyUsers(connection, users.map((user) => user.id), title, body, link, category);
}

async function notifyProcurement(connection, purchaseOrderId, createdBy, title, body, link, category) {
  const [users] = await connection.execute(
    `SELECT id FROM users WHERE role IN ('procurement', 'admin') AND active = TRUE`
  );
  await notifyUsers(connection, [createdBy, ...users.map((user) => user.id)], title, body, link, category);
}

function transactionReference(prefix) {
  return `${prefix}-${new Date().getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseDateWindow(query) {
  const from = text(query.from, 10);
  const to = text(query.to, 10);
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    throw httpError(400, 'Dates must use YYYY-MM-DD.');
  }
  if (from && to && to < from) throw httpError(400, 'End date must be on or after start date.');
  return { from, to };
}

async function existingIdempotent(connection, key, expected) {
  const [rows] = await connection.execute(
    `SELECT id, item_id AS itemId, movement_type AS movementType, direction,
        quantity, reference_no AS referenceNo, balance_after AS balance,
        store_request_id AS storeRequestId
       FROM inventory_movements WHERE idempotency_key = ? LIMIT 1`,
    [key]
  );
  const movement = rows[0];
  if (!movement) return null;
  const same = Number(movement.itemId) === expected.itemId &&
    movement.movementType === expected.movementType &&
    movement.direction === expected.direction &&
    Number(movement.quantity) === expected.quantity &&
    (expected.storeRequestId == null || Number(movement.storeRequestId) === expected.storeRequestId);
  if (!same) throw httpError(409, 'This transaction key was already used for a different operation.');
  return movement;
}

async function attachFiles(connection, movementId, files) {
  for (const file of files) {
    await connection.execute(
      `INSERT INTO inventory_movement_attachments
         (movement_id, file_name, mime_type, file_size, file_data)
       VALUES (?, ?, ?, ?, ?)`,
      [movementId, file.fileName, file.mimeType, file.fileData.length, file.fileData]
    );
  }
}

async function recordMovement(connection, {
  itemId, userId, type, direction, quantity, referenceNo, source, description,
  requesterId = null, receivedBy = null, departmentId = null, storeRequestId = null,
  idempotencyKey, balance, movementAt, purchaseOrderId = null, goodsReceiptId = null
}) {
  const [result] = await connection.execute(
    `INSERT INTO inventory_movements
       (item_id, user_id, movement_type, direction, quantity, reference_no, source,
        description, requester_id, received_by, department_id, store_request_id, idempotency_key,
        purchase_order_id, goods_receipt_id, balance_after, movement_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      itemId, userId, type, direction, quantity, referenceNo, source, description || null,
      requesterId, receivedBy, departmentId, storeRequestId, idempotencyKey,
      purchaseOrderId, goodsReceiptId, balance, movementAt
    ]
  );
  return result.insertId;
}

const DELIVERY_STATUSES = new Set(['Pending', 'Accepted', 'Rejected']);
const DELIVERY_PAGE_LINK = '#/stockkeeper/Display%20before%20delivery';
const DELIVERY_SORT_FIELDS = {
  delivered: 'd.created_at',
  reference: 'd.po_reference',
  item: 'd.item_name',
  supplier: 'd.supplier_name',
  status: 'd.status',
  quantity: 'd.quantity',
  decided: 'd.decided_at'
};

const DELIVERY_SELECT = `
  SELECT d.id, d.purchase_order_id AS purchaseOrderId,
      d.purchase_order_item_id AS purchaseOrderItemId, d.po_reference AS poReference,
      d.supplier_name AS supplierName, d.supplier_email AS supplierEmail,
      d.requisition_id AS requisitionId, d.requisition_reference AS requisitionReference,
      d.department_id AS departmentId, d.department_name AS departmentName,
      d.item_name AS itemName, d.description, d.quantity, d.unit,
      d.unit_price AS unitPrice, d.line_total AS lineTotal,
      d.delivery_date AS deliveryDate, d.status, d.decision_reason AS decisionReason,
      d.decided_by AS decidedBy, d.decided_by_name AS decidedByName, d.decided_at AS decidedAt,
      d.inventory_item_id AS inventoryItemId, d.inventory_movement_id AS inventoryMovementId,
      d.created_at AS createdAt, d.updated_at AS updatedAt,
      i.name AS stockItemName, i.quantity AS stockBalance,
      m.reference_no AS movementReference
    FROM purchase_order_delivery_items d
    LEFT JOIN items i ON i.id = d.inventory_item_id
    LEFT JOIN inventory_movements m ON m.id = d.inventory_movement_id`;

function decisionReason(body, decision) {
  const reason = text(body.reason, 1000);
  if (decision === 'Rejected' && !reason) {
    throw httpError(400, 'Enter a reason before rejecting this item.');
  }
  return reason || null;
}

async function deliveryForUpdate(connection, id) {
  const [rows] = await connection.execute(`${DELIVERY_SELECT} WHERE d.id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function notifyDeliveryDecision(connection, delivery, decision, reason) {
  const title = decision === 'Accepted'
    ? 'Purchase order item accepted into stock'
    : 'Purchase order item rejected';
  const body = `${delivery.itemName} · ${delivery.poReference}${reason ? ` — ${reason}` : ''}`;
  await notifyStorekeepers(connection, title, body, DELIVERY_PAGE_LINK, 'purchase_order_delivery');
}

router.get('/deliveries', async (req, res, next) => {
  try {
    const paged = pagination(req.query, 'delivered', DELIVERY_SORT_FIELDS);
    if (paged.error) return res.status(400).json({ message: paged.error });

    const status = String(req.query.status || '');
    if (status && !DELIVERY_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Choose a supported delivery status.' });
    }
    const search = text(req.query.search, 180);
    const where = [];
    const params = [];
    if (status) {
      where.push('d.status = ?');
      params.push(status);
    }
    if (search) {
      where.push(`(
        d.item_name LIKE ? OR d.po_reference LIKE ? OR d.supplier_name LIKE ?
        OR COALESCE(d.department_name, '') LIKE ? OR COALESCE(d.description, '') LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [deliveries] = await pool.execute(
      `${DELIVERY_SELECT} ${whereSql}
        ORDER BY ${paged.sortColumn} ${paged.direction}, d.id DESC
        LIMIT ? OFFSET ?`,
      [...params, paged.limit, (paged.page - 1) * paged.limit]
    );
    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END), 0) AS accepted,
          COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
         FROM purchase_order_delivery_items`
    );
    return res.json({
      deliveries,
      counts: {
        all: Number(totals?.total) || 0,
        Pending: Number(totals?.pending) || 0,
        Accepted: Number(totals?.accepted) || 0,
        Rejected: Number(totals?.rejected) || 0
      },
      pagination: {
        page: paged.page,
        limit: paged.limit,
        pages: Math.max(1, Math.ceil((Number(totals?.total) || 0) / paged.limit)),
        total: Number(totals?.total) || 0
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Full filtered inventory report rows for the in-portal register. Downloads use
// the same export definitions through /exports/:key/:format.
router.get('/inventory-report', async (req, res, next) => {
  const key = String(req.query.type || 'stockkeeperStockMovement');
  if (!INVENTORY_REPORT_KEYS.has(key)) {
    return res.status(400).json({ message: 'Choose a supported inventory report.' });
  }
  try {
    const report = await fetchExportRows(key, req.query, req.user);
    return res.json(report);
  } catch (error) {
    return next(error);
  }
});

router.get('/deliveries/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid delivery item identifier.' });
    const [rows] = await pool.execute(`${DELIVERY_SELECT} WHERE d.id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Delivery item not found.' });
    return res.json({ delivery: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/deliveries/:id/accept', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid delivery item identifier.' });
  let reason;
  try {
    reason = decisionReason(req.body, 'Accepted');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const delivery = await deliveryForUpdate(connection, id);
    if (!delivery) {
      await connection.rollback();
      return res.status(404).json({ message: 'Delivery item not found.' });
    }
    if (delivery.status !== 'Pending') {
      await connection.rollback();
      return res.status(409).json({ message: `This item was already ${delivery.status.toLowerCase()}.` });
    }

    const [matches] = await connection.execute(
      'SELECT id, name, quantity FROM items WHERE name = ? AND unit = ? ORDER BY id LIMIT 1 FOR UPDATE',
      [delivery.itemName, delivery.unit]
    );
    let itemId;
    let balance;
    if (matches[0]) {
      itemId = Number(matches[0].id);
      balance = Number(matches[0].quantity) + Number(delivery.quantity);
    } else {
      const sku = `PO-${Number(delivery.purchaseOrderItemId)}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const [created] = await connection.execute(
        `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level, unit_cost)
         VALUES (?, ?, ?, 'Purchased', ?, 0, 10, ?)`,
        [
          delivery.departmentId || null, sku, delivery.itemName,
          delivery.unit, Number(delivery.unitPrice) || 0
        ]
      );
      itemId = Number(created.insertId);
      balance = Number(delivery.quantity);
    }
    if (balance > 4294967295) {
      await connection.rollback();
      return res.status(400).json({ message: 'The resulting stock balance exceeds the supported limit.' });
    }
    await connection.execute('UPDATE items SET quantity = ?, unit_cost = ? WHERE id = ?', [
      balance, Number(delivery.unitPrice) || 0, itemId
    ]);

    const referenceNo = `PO-DEL-${id}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const movementDate = businessDate(new Date().toISOString().slice(0, 10), 'Receipt date');
    const movementId = await recordMovement(connection, {
      itemId,
      userId: req.user.id,
      type: 'Receipt',
      direction: 'In',
      quantity: Number(delivery.quantity),
      referenceNo,
      source: delivery.supplierName || 'Purchase order',
      description: `Accepted from purchase order ${delivery.poReference}${reason ? ` · ${reason}` : ''}`,
      departmentId: delivery.departmentId || null,
      idempotencyKey: `PO-DELIVERY-${id}`,
      balance,
      movementAt: toUtcDateTime(movementDate)
    });

    await connection.execute(
      `UPDATE purchase_order_delivery_items
          SET status = 'Accepted', decision_reason = ?, decided_by = ?, decided_by_name = ?,
              decided_at = UTC_TIMESTAMP(), inventory_item_id = ?, inventory_movement_id = ?
        WHERE id = ?`,
      [reason, req.user.id, req.user.name || 'Storekeeper', itemId, movementId, id]
    );
    await writeAudit(connection, req.user.id, 'purchase_order_delivery_accepted', 'purchase_order_delivery_item', id, {
      purchaseOrderId: delivery.purchaseOrderId,
      purchaseOrderItemId: delivery.purchaseOrderItemId,
      itemId,
      quantity: Number(delivery.quantity),
      referenceNo
    });
    await notifyDeliveryDecision(connection, delivery, 'Accepted', reason);
    await connection.commit();
    return res.status(201).json({
      id: Number(id),
      status: 'Accepted',
      itemId,
      itemName: delivery.itemName,
      balance,
      movementId: Number(movementId),
      referenceNo,
      message: `${delivery.itemName} was accepted into stock.`
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This delivery item has already been recorded.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/deliveries/:id/reject', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid delivery item identifier.' });
  let reason;
  try {
    reason = decisionReason(req.body, 'Rejected');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const delivery = await deliveryForUpdate(connection, id);
    if (!delivery) {
      await connection.rollback();
      return res.status(404).json({ message: 'Delivery item not found.' });
    }
    if (delivery.status !== 'Pending') {
      await connection.rollback();
      return res.status(409).json({ message: `This item was already ${delivery.status.toLowerCase()}.` });
    }

    // A rejection deliberately stops here: no catalogue row, quantity change,
    // or inventory movement is created for the rejected line.
    await connection.execute(
      `UPDATE purchase_order_delivery_items
          SET status = 'Rejected', decision_reason = ?, decided_by = ?, decided_by_name = ?,
              decided_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [reason, req.user.id, req.user.name || 'Storekeeper', id]
    );
    await writeAudit(connection, req.user.id, 'purchase_order_delivery_rejected', 'purchase_order_delivery_item', id, {
      purchaseOrderId: delivery.purchaseOrderId,
      purchaseOrderItemId: delivery.purchaseOrderItemId,
      reason
    });
    await notifyDeliveryDecision(connection, delivery, 'Rejected', reason);
    await connection.commit();
    return res.json({
      id: Number(id),
      status: 'Rejected',
      itemName: delivery.itemName,
      reason,
      message: `${delivery.itemName} was rejected and was not added to stock.`
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const scope = await loadStockkeeperScope(pool, req.user.id);
    if (!scope) return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    const { clause: scopeClause, params: scopeParams } = stockkeeperScopeClause(scope, req.user.id);
    const [[stats]] = await pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM items) AS totalStockItems,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE direction = 'In') AS totalStockIn,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE direction = 'Out') AS totalStockOut,
        (SELECT COALESCE(SUM(quantity), 0) FROM items) AS availableStockBalance,
        (SELECT COUNT(*) FROM items WHERE quantity <= reorder_level) AS lowStockItems,
        (SELECT COUNT(*) FROM items WHERE quantity = 0) AS zeroStockItems,
        (SELECT COUNT(*) FROM notifications n
          WHERE ${UNREAD_NOTIFICATION_SQL} AND ${VALID_NOTIFICATION_SQL}
            AND n.user_id = ?) AS unreadNotifications,
        (SELECT COUNT(*) FROM notifications n
          WHERE ${UNREAD_NOTIFICATION_SQL} AND ${VALID_NOTIFICATION_SQL}
            AND n.user_id = ?
            AND n.category IN ('low_stock','zero_stock','stock_request')) AS attentionNotifications,
        (SELECT COUNT(*) FROM store_requests sr
           LEFT JOIN departments d ON d.id = sr.department_id
          WHERE sr.requisition_id IS NOT NULL
            AND sr.stockkeeper_decision = 'Pending' AND ${scopeClause}) AS pendingRequests,
        (SELECT COUNT(*) FROM purchase_orders
          WHERE status IN ('Approved', 'Partially received')) AS expectedDeliveries,
        (SELECT COUNT(*) FROM purchase_orders
          WHERE status = 'Partially received') AS partiallyReceivedDeliveries`,
      [req.user.id, req.user.id, req.user.id, req.user.id, ...scopeParams]
    );
    const [recentActivities] = await pool.execute(
      `SELECT m.id, m.movement_type AS type, m.direction, m.quantity,
          m.reference_no AS referenceNo, m.source, m.description,
          m.balance_after AS balance, m.movement_at AS movementAt,
          i.id AS itemId, i.name AS itemName, i.sku, i.unit,
          u.name AS updatedBy, r.name AS requester, d.name AS department
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN users r ON r.id = m.requester_id
       LEFT JOIN departments d ON d.id = m.department_id
       ORDER BY COALESCE(m.movement_at, m.created_at) DESC, m.id DESC LIMIT 8`
    );
    const [recentBinCards] = await pool.execute(
      `SELECT i.id, i.name, i.sku, i.category, i.unit, i.quantity AS balance,
          i.reorder_level AS minimumStock, i.updated_at AS updatedAt, d.name AS department
       FROM items i LEFT JOIN departments d ON d.id = i.department_id
       ORDER BY i.updated_at DESC, i.id DESC LIMIT 6`
    );
    const [lowStockItems] = await pool.execute(
      `SELECT id, name, sku, quantity AS balance, reorder_level AS minimumStock, unit
       FROM items WHERE quantity <= reorder_level ORDER BY quantity ASC, name LIMIT 8`
    );
    const [requestsAwaitingAction] = await pool.execute(
      `SELECT sr.id, sr.reference, sr.stockkeeper_decision AS decision,
          COALESCE(sr.routed_at, sr.created_at) AS routedAt,
          r.reference AS requisitionReference, u.name AS requester,
          d.name AS department, su.name AS supervisorName,
          GROUP_CONCAT(CONCAT(COALESCE(i.name, sri.requested_item_name), ' × ', sri.quantity,
            ' ', COALESCE(i.unit, sri.requested_unit, 'unit')) ORDER BY sri.id SEPARATOR ', ') AS items
       FROM store_requests sr
       JOIN requisitions r ON r.id = sr.requisition_id
       JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       LEFT JOIN users su ON su.id = sr.routed_by_supervisor
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       LEFT JOIN items i ON i.id = sri.item_id
       WHERE r.routing_destination IN ('Stock Keeper','Split')
         AND r.status <> 'Cancelled'
         AND sr.stockkeeper_decision IN ('Pending','Accepted')
         AND ${scopeClause}
       GROUP BY sr.id
       ORDER BY FIELD(sr.stockkeeper_decision, 'Pending', 'Accepted'), sr.id LIMIT 8`,
      scopeParams
    );
    const [expectedDeliveriesList] = await pool.execute(
      `SELECT p.id, p.reference, p.delivery_date AS expectedDate, p.status,
          s.name AS supplier, u.name AS procurementOfficer,
          GROUP_CONCAT(DISTINCT poi.item_name ORDER BY poi.item_name SEPARATOR ', ') AS items
       FROM purchase_orders p
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = p.id
       WHERE p.status IN ('Approved', 'Partially received')
       GROUP BY p.id ORDER BY p.delivery_date IS NULL, p.delivery_date, p.id LIMIT 8`
    );
    const [[department]] = req.user.departmentId ? await pool.execute(
      `SELECT d.id, d.name, d.description,
          (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS userCount,
          (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id
            AND u.role = 'requestor' AND u.active = TRUE) AS requesterCount
       FROM departments d WHERE d.id = ?`,
      [req.user.departmentId]
    ) : [[null]];
    return res.json({
      department: department ? {
        ...department,
        userCount: Number(department.userCount),
        requesterCount: Number(department.requesterCount)
      } : null,
      stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value) || 0])),
      recentActivities,
      recentStockIn: recentActivities.filter((movement) => movement.direction === 'In').slice(0, 5),
      recentStockOut: recentActivities.filter((movement) => movement.direction === 'Out').slice(0, 5),
      recentBinCards,
      lowStockItems,
      requestsAwaitingAction,
      expectedDeliveries: expectedDeliveriesList
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/items', async (req, res, next) => {
  const search = text(req.query.search, 100);
  try {
    const [items] = await pool.execute(
      `SELECT i.id, i.name, i.sku, i.category, i.unit, i.quantity AS balance,
          i.reorder_level AS minimumStock, i.updated_at AS updatedAt,
          i.storage_location AS storageLocation, d.id AS departmentId, d.name AS department
       FROM items i LEFT JOIN departments d ON d.id = i.department_id
       WHERE (? = '' OR i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ? OR d.name LIKE ?)
       ORDER BY i.name LIMIT 500`,
      [search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]
    );
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

router.get('/stock-overview', async (req, res, next) => {
  const search = text(req.query.search, 100);
  const departmentId = req.query.departmentId ? parseId(req.query.departmentId) : null;
  if (req.query.departmentId && !departmentId && String(req.query.departmentId) !== 'unassigned') {
    return res.status(400).json({ message: 'Invalid Department filter.' });
  }
  try {
    const filters = ["(? = '' OR i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ? OR i.storage_location LIKE ? OR d.name LIKE ?)"];
    const params = [search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
    if (departmentId) { filters.push('i.department_id = ?'); params.push(departmentId); }
    if (String(req.query.departmentId) === 'unassigned') filters.push('i.department_id IS NULL');
    const [items] = await pool.execute(
      `SELECT i.id, i.sku AS itemCode, i.name AS itemName, i.category,
          i.department_id AS departmentId, COALESCE(d.name, 'Unassigned') AS department,
          COALESCE(NULLIF(i.storage_location, ''), 'General storage') AS storageLocation,
          i.unit AS unitOfMeasure, i.reorder_level AS minimumStock, i.updated_at AS updatedAt,
          i.quantity AS currentBalance,
          COALESCE(stockIn.total, 0) AS totalStockIn, COALESCE(stockOut.total, 0) AS totalStockOut,
          i.quantity - COALESCE(stockIn.total, 0) + COALESCE(stockOut.total, 0) AS openingBalance
       FROM items i
       LEFT JOIN departments d ON d.id = i.department_id
       LEFT JOIN (SELECT item_id, SUM(quantity) AS total FROM inventory_movements WHERE direction = 'In' GROUP BY item_id) stockIn ON stockIn.item_id = i.id
       LEFT JOIN (SELECT item_id, SUM(quantity) AS total FROM inventory_movements WHERE direction = 'Out' GROUP BY item_id) stockOut ON stockOut.item_id = i.id
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(d.name, 'Unassigned'), i.storage_location, i.name`,
      params
    );
    const [departments] = await pool.execute(
      `SELECT d.id, d.name, COUNT(i.id) AS itemCount
       FROM departments d JOIN items i ON i.department_id = d.id
       GROUP BY d.id ORDER BY d.name`
    );
    return res.json({
      items: items.map((item) => ({
        ...item,
        status: Number(item.currentBalance) === 0 ? 'Out of Stock'
          : Number(item.currentBalance) <= Number(item.minimumStock) ? 'Low Stock' : 'Available'
      })),
      departments
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/items/:id/location', async (req, res, next) => {
  const itemId = parseId(req.params.id);
  const departmentId = req.body.departmentId === null || req.body.departmentId === ''
    ? null : parseId(req.body.departmentId);
  const storageLocation = text(req.body.storageLocation, 150) || 'General storage';
  if (!itemId) return res.status(400).json({ message: 'Invalid inventory item.' });
  if (req.body.departmentId && departmentId === null) {
    return res.status(400).json({ message: 'Choose a valid department.' });
  }
  try {
    if (departmentId) {
      const [[department]] = await pool.execute('SELECT id FROM departments WHERE id = ?', [departmentId]);
      if (!department) return res.status(404).json({ message: 'Department not found.' });
    }
    await pool.execute(
      'UPDATE items SET department_id = ?, storage_location = ? WHERE id = ?',
      [departmentId, storageLocation, itemId]
    );
    await writeAudit(pool, req.user.id, 'stock_location_updated', 'item', itemId, { departmentId, storageLocation });
    return res.json({ message: 'Department and storage location updated.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/items/:id', async (req, res, next) => {
  const itemId = parseId(req.params.id);
  if (!itemId) return res.status(400).json({ message: 'Invalid inventory item.' });
  try {
    const [[item]] = await pool.execute(
      `SELECT i.id, i.name, i.sku, i.category, i.unit, i.quantity AS balance,
          i.reorder_level AS minimumStock, i.updated_at AS updatedAt,
          d.name AS department
       FROM items i LEFT JOIN departments d ON d.id = i.department_id
       WHERE i.id = ?`,
      [itemId]
    );
    if (!item) return res.status(404).json({ message: 'Inventory item not found.' });
    const [[movementTotals]] = await pool.execute(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'In' THEN quantity ELSE -quantity END), 0) AS netMovement
       FROM inventory_movements WHERE item_id = ?`,
      [itemId]
    );
    const [movements] = await pool.execute(
      `SELECT m.id, m.movement_type AS type, m.direction, m.quantity,
          m.reference_no AS referenceNo, m.source, m.description,
          m.balance_after AS balance, m.movement_at AS movementAt,
          u.name AS updatedBy, r.name AS requester, m.received_by AS receivedBy, d.name AS department,
          m.store_request_id AS storeRequestId
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN users r ON r.id = m.requester_id
       LEFT JOIN departments d ON d.id = m.department_id
       WHERE m.item_id = ?
       ORDER BY COALESCE(m.movement_at, m.created_at) DESC, m.id DESC LIMIT 250`,
      [itemId]
    );
    const movementIds = movements.map((movement) => Number(movement.id));
    if (movementIds.length) {
      const placeholders = movementIds.map(() => '?').join(',');
      const [attachments] = await pool.execute(
        `SELECT id, movement_id AS movementId, file_name AS fileName,
            mime_type AS mimeType, file_size AS fileSize
         FROM inventory_movement_attachments WHERE movement_id IN (${placeholders})`,
        movementIds
      );
      const byMovement = new Map();
      for (const attachment of attachments) {
        const key = Number(attachment.movementId);
        byMovement.set(key, [...(byMovement.get(key) || []), attachment]);
      }
      for (const movement of movements) movement.attachments = byMovement.get(Number(movement.id)) || [];
    }
    return res.json({
      item,
      openingBalance: Number(item.balance) - Number(movementTotals.netMovement),
      movements
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/items/:itemId/movements/:movementId/attachments/:attachmentId', async (req, res, next) => {
  const { itemId, movementId, attachmentId } = req.params;
  try {
    const [[file]] = await pool.execute(
      `SELECT a.file_name AS fileName, a.mime_type AS mimeType, a.file_data AS fileData
       FROM inventory_movement_attachments a
       JOIN inventory_movements m ON m.id = a.movement_id
       WHERE m.item_id = ? AND m.id = ? AND a.id = ?`,
      [itemId, movementId, attachmentId]
    );
    if (!file) return res.status(404).json({ message: 'Supporting document not found.' });
    const safeName = file.fileName.replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.send(file.fileData);
  } catch (error) {
    return next(error);
  }
});

router.post('/transactions/stock-in', async (req, res, next) => {
  let input;
  let attachments;
  try {
    input = parseTransactionInput(req.body);
    attachments = parseAttachments(req.body.attachments);
    input.source = text(req.body.source, 180);
    if (!input.source) throw httpError(400, 'Enter the source or supplier for the stock received.');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const duplicate = await existingIdempotent(connection, input.idempotencyKey, {
      itemId: input.itemId, movementType: 'Receipt', direction: 'In', quantity: input.quantity
    });
    if (duplicate) {
      await connection.rollback();
      return res.json({ id: Number(duplicate.id), referenceNo: duplicate.referenceNo, balance: Number(duplicate.balance), duplicate: true });
    }
    const [[item]] = await connection.execute(
      'SELECT id, name, quantity, reorder_level AS minimumStock FROM items WHERE id = ? FOR UPDATE',
      [input.itemId]
    );
    if (!item) {
      await connection.rollback();
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    const balance = Number(item.quantity) + input.quantity;
    if (balance > 4294967295) {
      await connection.rollback();
      return res.status(400).json({ message: 'The resulting stock balance exceeds the supported limit.' });
    }
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, item.id]);
    const movementId = await recordMovement(connection, {
      itemId: item.id, userId: req.user.id, type: 'Receipt', direction: 'In',
      quantity: input.quantity, referenceNo: input.referenceNo, source: input.source,
      description: input.description, idempotencyKey: input.idempotencyKey,
      balance, movementAt: input.movementAt
    });
    await attachFiles(connection, movementId, attachments);
    await writeAudit(connection, req.user.id, 'stock_in', 'inventory_movement', movementId, {
      itemId: item.id, quantity: input.quantity, referenceNo: input.referenceNo,
      source: input.source, balance
    });
    await notifyStorekeepers(
      connection, 'Stock received', `${input.quantity} ${item.name || 'units'} received · ${input.referenceNo}.`,
      `#/stockkeeper/Bin%20Card?item=${item.id}`, 'stock_in'
    );
    await connection.commit();
    return res.status(201).json({ id: movementId, referenceNo: input.referenceNo, balance, message: 'Stock-in transaction recorded.' });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      if (error.message?.includes('idempotency')) return res.status(409).json({ message: 'This stock-in transaction was already submitted.' });
      return res.status(409).json({ message: 'That transaction reference is already in use.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

async function loadExpectedDelivery(connection, purchaseOrderId) {
  const [orders] = await connection.execute(
    `SELECT p.id, p.reference, p.delivery_date AS expectedDate, p.status,
        p.supplier_contact AS supplierContact, p.supplier_address AS supplierAddress,
        p.type, p.approved_at AS approvedAt, p.created_at AS createdAt,
        s.id AS supplierId, s.name AS supplier,
        officer.name AS procurementOfficer, officer.id AS procurementOfficerId,
        r.id AS requisitionId, r.reference AS requisitionReference
     FROM purchase_orders p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN users officer ON officer.id = p.created_by
     LEFT JOIN rfqs f ON f.id = p.rfq_id
     LEFT JOIN requisitions r ON r.id = f.requisition_id
     WHERE p.id = ? AND p.status IN ('Approved', 'Partially received') LIMIT 1`,
    [purchaseOrderId]
  );
  const order = orders[0];
  if (!order) return null;
  const [lines] = await connection.execute(
    `SELECT poi.id AS purchaseOrderItemId, poi.item_name AS itemName, poi.description,
        poi.quantity AS expectedQuantity, poi.unit
     FROM purchase_order_items poi WHERE poi.purchase_order_id = ? ORDER BY poi.id`,
    [purchaseOrderId]
  );
  const items = [];
  for (const line of lines) {
    const [[catalog]] = await connection.execute(
      'SELECT id, name, sku, unit, department_id AS departmentId, storage_location AS storageLocation FROM items WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [line.itemName]
    );
    let received = 0;
    let damaged = 0;
    if (catalog) {
      const [[totals]] = await connection.execute(
        `SELECT COALESCE(SUM(gri.quantity), 0) AS received,
            COALESCE(SUM(gri.damaged_quantity), 0) AS damaged
         FROM goods_receipt_items gri
         JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
         WHERE gr.purchase_order_id = ? AND gri.item_id = ?`,
        [purchaseOrderId, catalog.id]
      );
      received = Number(totals.received) || 0;
      damaged = Number(totals.damaged) || 0;
    }
    items.push({
      ...line,
      itemId: catalog?.id || null,
      itemCode: catalog?.sku || null,
      unit: line.unit || catalog?.unit || 'unit',
      departmentId: catalog?.departmentId || null,
      storageLocation: catalog?.storageLocation || null,
      receivedQuantity: received,
      damagedQuantity: damaged,
      // Damaged units were physically delivered, so they also reduce the
      // quantity still expected from the supplier.
      outstandingQuantity: Math.max(0, Number(line.expectedQuantity) - received - damaged)
    });
  }
  const [documents] = order.requisitionId ? await connection.execute(
    `SELECT id, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, created_at AS createdAt
     FROM requisition_attachments WHERE requisition_id = ? ORDER BY id`,
    [order.requisitionId]
  ) : [[]];
  return {
    ...order,
    supplierContact: order.supplierContact || null,
    supplierAddress: order.supplierAddress || null,
    deliveryInformation: [order.type, order.supplierContact, order.supplierAddress]
      .filter(Boolean).join(' · ') || 'Delivery details recorded on the purchase order.',
    items,
    documents
  };
}

router.get('/expected-deliveries', async (req, res, next) => {
  try {
    const [orders] = await pool.execute(
      `SELECT p.id, p.reference, p.delivery_date AS expectedDate, p.status,
          s.name AS supplier, officer.name AS procurementOfficer,
          (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = p.id) AS lineCount
       FROM purchase_orders p
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN users officer ON officer.id = p.created_by
       WHERE p.status IN ('Approved', 'Partially received')
       ORDER BY p.delivery_date IS NULL, p.delivery_date, p.id`
    );
    const deliveries = [];
    for (const order of orders) {
      deliveries.push(await loadExpectedDelivery(pool, order.id));
    }
    return res.json({ deliveries });
  } catch (error) {
    return next(error);
  }
});

router.get('/expected-deliveries/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid purchase order.' });
  try {
    const delivery = await loadExpectedDelivery(pool, id);
    if (!delivery) return res.status(404).json({ message: 'Authorized expected delivery not found.' });
    return res.json({ delivery });
  } catch (error) {
    return next(error);
  }
});

async function saveGoodsReceipt(req, res, next, id, allItems) {
  const idempotencyKey = text(req.body.idempotencyKey, 80);
  const date = businessDate(req.body.date || new Date().toISOString().slice(0, 10), 'Receiving date');
  const comments = text(req.body.comments, 2000);
  if (idempotencyKey.length < 16) return res.status(400).json({ message: 'A receiving idempotency key is required.' });
  const submitted = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!submitted.length) return res.status(400).json({ message: 'Confirm at least one delivered item.' });
  const selected = new Map();
  for (const line of submitted) {
    const itemId = parseId(line.itemId);
    const delivered = Number(line.deliveredQuantity);
    const accepted = Number(line.acceptedQuantity);
    const rejected = Number(line.rejectedQuantity ?? line.damagedQuantity ?? 0);
    if (!itemId) return res.status(400).json({ message: 'Choose a valid catalog item for each line.' });
    if (!Number.isInteger(delivered) || delivered < 0
        || !Number.isInteger(accepted) || accepted < 0
        || !Number.isInteger(rejected) || rejected < 0) {
      return res.status(400).json({ message: 'Delivered, accepted and rejected quantities must be whole numbers.' });
    }
    if (delivered !== accepted + rejected) {
      return res.status(400).json({ message: 'Delivered quantity must equal accepted plus rejected/damaged quantity.' });
    }
    if (!accepted && !rejected) return res.status(400).json({ message: 'Enter the quantity physically delivered for each line.' });
    if (selected.has(itemId)) return res.status(400).json({ message: 'An item was included more than once.' });
    selected.set(itemId, {
      itemId, delivered, accepted, rejected,
      condition: text(line.condition, 40) || (rejected ? 'Damaged/rejected' : 'Good'),
      comments: text(line.comments, 1000),
      departmentId: line.departmentId ? parseId(line.departmentId) : null,
      storageLocation: text(line.storageLocation, 150) || null
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[duplicate]] = await connection.execute(
      'SELECT id, reference FROM goods_receipts WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    if (duplicate) {
      await connection.rollback();
      return res.json({ duplicate: true, id: Number(duplicate.id), reference: duplicate.reference, message: 'This delivery was already recorded.' });
    }
    const delivery = await loadExpectedDelivery(connection, id);
    if (!delivery) {
      await connection.rollback();
      return res.status(404).json({ message: 'This purchase order is not authorized for receipt.' });
    }
    const records = [];
    for (const line of delivery.items) {
      if (!selected.has(Number(line.itemId))) continue;
      const choice = selected.get(Number(line.itemId));
      if (!line.itemId) {
        await connection.rollback();
        return res.status(409).json({ message: `Add "${line.itemName}" to the inventory catalogue before receiving it.` });
      }
      if (choice.accepted > line.outstandingQuantity) {
        await connection.rollback();
        return res.status(409).json({ message: `${line.itemName} exceeds the outstanding ordered quantity (${line.outstandingQuantity}).` });
      }
      records.push({ ...line, ...choice });
    }
    if (records.length !== selected.size) {
      await connection.rollback();
      return res.status(400).json({ message: 'One or more items are not on this purchase order.' });
    }
    if (allItems) {
      const missing = delivery.items.filter((line) => line.outstandingQuantity > 0 && !selected.has(Number(line.itemId)));
      if (missing.length) {
        await connection.rollback();
        return res.status(409).json({ message: `Receive all requires every outstanding line: ${missing.map((line) => line.itemName).join(', ')}.` });
      }
      for (const record of records) {
        if (record.accepted !== record.outstandingQuantity || record.rejected !== 0) {
          await connection.rollback();
          return res.status(409).json({ message: 'Receive All Items requires full accepted quantities with no damaged/rejected units. Use Receive Individual Items for discrepancies.' });
        }
      }
    }
    const catalogItems = new Map();
    for (const record of records) {
      const [[item]] = await connection.execute(
        `SELECT id, name, unit, quantity, reorder_level AS minimumStock,
            department_id AS departmentId, storage_location AS storageLocation
         FROM items WHERE id = ? ORDER BY id FOR UPDATE`,
        [record.itemId]
      );
      if (!item) {
        await connection.rollback();
        return res.status(404).json({ message: 'Inventory item not found.' });
      }
      catalogItems.set(Number(item.id), item);
    }
    const reference = transactionReference('GRN');
    const [receiptResult] = await connection.execute(
      `INSERT INTO goods_receipts
         (reference, purchase_order_id, source, received_by, expected_at, comments, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reference, id, delivery.supplier, req.user.id,
        delivery.expectedDate ? toUtcDateTime(delivery.expectedDate) : null, comments, idempotencyKey]
    );
    const receiptId = Number(receiptResult.insertId);
    let acceptedTotal = 0;
    let rejectedTotal = 0;
    const movements = [];
    for (const [index, record] of records.entries()) {
      const item = catalogItems.get(Number(record.itemId));
      const departmentId = record.departmentId || item.departmentId || null;
      const storageLocation = record.storageLocation || item.storageLocation || 'General storage';
      await connection.execute(
        `UPDATE items SET quantity = quantity + ?, department_id = ?, storage_location = ? WHERE id = ?`,
        [record.accepted, departmentId, storageLocation, record.itemId]
      );
      await connection.execute(
        `INSERT INTO goods_receipt_items
           (goods_receipt_id, item_id, quantity, delivered_quantity, damaged_quantity,
            \`condition\`, comments, department_id, storage_location)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiptId, record.itemId, record.accepted, record.delivered, record.rejected,
          record.condition, record.comments || null, departmentId, storageLocation]
      );
      const [[updated]] = await connection.execute('SELECT quantity FROM items WHERE id = ?', [record.itemId]);
      const balance = Number(updated.quantity);
      const movementId = await recordMovement(connection, {
        itemId: record.itemId, userId: req.user.id, type: 'Receipt', direction: 'In',
        quantity: record.accepted, referenceNo: `${reference}-${index + 1}`,
        source: delivery.reference,
        description: [comments, record.comments, record.rejected ? `${record.rejected} damaged/rejected` : ''].filter(Boolean).join(' · '),
        departmentId, idempotencyKey: `${idempotencyKey}-${index + 1}`, balance,
        movementAt: toUtcDateTime(date), purchaseOrderId: id, goodsReceiptId: receiptId
      });
      movements.push({ id: movementId, itemId: record.itemId, itemName: item.name, quantity: record.accepted, balance });
      acceptedTotal += record.accepted;
      rejectedTotal += record.rejected;
      if (balance <= Number(item.minimumStock || 0)) {
        if (balance <= 0) {
          await notifyStorekeepers(connection, 'Item is out of stock', `${item.name} has reached zero balance.`,
            `#/stockkeeper/Bin%20Card?item=${item.id}`, 'zero_stock');
        } else {
          await notifyStorekeepers(connection, 'Low stock alert', `${item.name} has ${balance} remaining.`,
            `#/stockkeeper/Bin%20Card?item=${item.id}`, 'low_stock');
        }
      }
    }
    const refreshed = await loadExpectedDelivery(connection, id);
    const outstanding = refreshed.items.reduce((sum, line) => sum + line.outstandingQuantity, 0);
    const poStatus = outstanding === 0 ? 'Received' : 'Partially received';
    await connection.execute('UPDATE purchase_orders SET status = ? WHERE id = ?', [poStatus, id]);
    await writeAudit(connection, req.user.id, 'goods_received', 'goods_receipt', receiptId, {
      reference, purchaseOrder: delivery.reference, acceptedTotal, rejectedTotal,
      poStatus, lines: records.map((record) => ({
        itemId: record.itemId, accepted: record.accepted, rejected: record.rejected
      }))
    }, { newStatus: poStatus });
    const receiptNote = rejectedTotal ? ` · ${rejectedTotal} unit(s) damaged/rejected` : '';
    await notifyProcurement(connection, id, delivery.procurementOfficerId,
      rejectedTotal ? 'Delivery discrepancy recorded' : (outstanding ? 'Partial delivery received' : 'Goods received'),
      `${delivery.reference}: ${reference} recorded ${acceptedTotal} accepted unit(s)${receiptNote}. ${outstanding} unit(s) still outstanding. ${comments || ''}`.trim(),
      `/purchase-orders/${id}`, 'goods_receipt');
    await notifyStorekeepers(connection, 'Stock received',
      `${acceptedTotal} unit(s) received against ${delivery.reference} · ${reference}.`,
      `#/stockkeeper/Stock%20In?purchaseOrder=${id}`, 'stock_in');
    await connection.commit();
    return res.status(201).json({
      id: receiptId, reference, acceptedTotal, rejectedTotal, outstanding,
      purchaseOrderStatus: poStatus, movements,
      message: outstanding ? 'Partial delivery recorded; outstanding quantities remain visible.'
        : 'All ordered goods received and recorded.'
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This receiving transaction was already submitted.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
}

router.post('/expected-deliveries/:id/receive-all', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid purchase order.' });
  try {
    return await saveGoodsReceipt(req, res, next, id, true);
  } catch (error) {
    return next(error);
  }
});

router.post('/expected-deliveries/:id/receive-items', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid purchase order.' });
  try {
    return await saveGoodsReceipt(req, res, next, id, false);
  } catch (error) {
    return next(error);
  }
});

router.get('/issue-requests', async (req, res, next) => {
  try {
    const scope = await loadStockkeeperScope(pool, req.user.id);
    if (!scope) return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    const { clause: scopeClause, params: scopeParams } = stockkeeperScopeClause(scope, req.user.id);
    const [requests] = await pool.execute(
      `SELECT sr.id AS requestId, sr.reference, sr.purpose,
          COALESCE(sr.routed_at, sr.approved_at, sr.created_at) AS routedAt,
          sr.status AS requestStatus, sr.stockkeeper_decision AS stockkeeperDecision,
          sr.stockkeeper_decision_at AS decisionAt, sr.stockkeeper_comments AS stockkeeperComments,
          sr.rejection_reason AS rejectionReason, sr.issued_at AS issuedAt,
          sr.stockkeeper_viewed_at AS viewedAt,
          CASE WHEN sr.stockkeeper_decision = 'Pending' AND sr.stockkeeper_viewed_at IS NULL
            THEN TRUE ELSE FALSE END AS isNew,
          decider.name AS stockkeeperName,
          sr.requisition_id AS requisitionId, r.reference AS requisitionReference,
          r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
          r.routing_comments AS supervisorComments, r.status AS requisitionStatus, su.name AS supervisorName,
          sr.department_id AS departmentId, d.name AS department,
          u.id AS requesterId, u.name AS requester, u.email AS requesterEmail,
          sri.id AS storeRequestItemId, sri.item_id AS itemId,
          COALESCE(i.name, sri.requested_item_name) AS itemName,
          COALESCE(i.sku, '') AS sku, COALESCE(i.unit, sri.requested_unit, 'unit') AS unit,
          COALESCE(sri.accepted_quantity, sri.quantity) AS authorizedQuantity,
          sri.quantity AS requestedQuantity, sri.issued_quantity AS issuedQuantity,
          (COALESCE(sri.accepted_quantity, sri.quantity) - sri.issued_quantity) AS remainingQuantity,
          COALESCE(i.quantity, 0) AS availableBalance
       FROM store_requests sr
       JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       JOIN requisitions r ON r.id = sr.requisition_id
       LEFT JOIN users su ON su.id = sr.routed_by_supervisor
       LEFT JOIN users decider ON decider.id = sr.stockkeeper_decision_by
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       LEFT JOIN items i ON i.id = sri.item_id
       WHERE sr.requisition_id IS NOT NULL
          AND r.routing_destination IN ('Stock Keeper','Split')
          AND r.status <> 'Cancelled'
          AND (COALESCE(sri.accepted_quantity, sri.quantity) - sri.issued_quantity) > 0
          AND ${scopeClause}
       ORDER BY COALESCE(sr.routed_at, sr.approved_at, sr.created_at), sr.id, sri.id`,
      scopeParams
    );
    return res.json({ requests: withRoutedStatus(requests) });
  } catch (error) {
    return next(error);
  }
});

// Complete list of Supervisor-routed requests, including decided and fully
// issued records, so the workspace preserves the original request history.
router.get('/routed-requests', async (req, res, next) => {
  try {
    const scope = await loadStockkeeperScope(pool, req.user.id);
    if (!scope) return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    const { clause: scopeClause, params: scopeParams } = stockkeeperScopeClause(scope, req.user.id);
    const [requests] = await pool.execute(
      `SELECT sr.id AS requestId, sr.reference, sr.purpose,
          sr.status AS requestStatus, sr.stockkeeper_decision AS stockkeeperDecision,
          sr.stockkeeper_decision_at AS decisionAt, sr.stockkeeper_comments AS stockkeeperComments,
          sr.rejection_reason AS rejectionReason, sr.issued_at AS issuedAt,
          sr.stockkeeper_viewed_at AS viewedAt,
          CASE WHEN sr.stockkeeper_decision = 'Pending' AND sr.stockkeeper_viewed_at IS NULL
            THEN TRUE ELSE FALSE END AS isNew,
          decider.name AS stockkeeperName,
          COALESCE(sr.routed_at, sr.approved_at, sr.created_at) AS routedAt,
          sr.requisition_id AS requisitionId, r.reference AS requisitionReference,
          r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
          r.routing_comments AS supervisorComments, r.status AS requisitionStatus,
          r.routing_destination AS routingDestination,
          su.name AS supervisorName, d.name AS department,
          u.id AS requesterId, u.name AS requester, u.email AS requesterEmail,
          sri.id AS storeRequestItemId, sri.item_id AS itemId,
          COALESCE(i.name, sri.requested_item_name) AS itemName,
          COALESCE(i.sku, '') AS sku, COALESCE(i.unit, sri.requested_unit, 'unit') AS unit,
          COALESCE(i.quantity, 0) AS availableBalance,
          sri.quantity AS requestedQuantity,
          COALESCE(sri.accepted_quantity, sri.quantity) AS authorizedQuantity,
          sri.issued_quantity AS issuedQuantity,
          (COALESCE(sri.accepted_quantity, sri.quantity) - sri.issued_quantity) AS remainingQuantity
       FROM store_requests sr
       JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       JOIN requisitions r ON r.id = sr.requisition_id
       LEFT JOIN users su ON su.id = sr.routed_by_supervisor
       LEFT JOIN users decider ON decider.id = sr.stockkeeper_decision_by
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       LEFT JOIN items i ON i.id = sri.item_id
       WHERE sr.requisition_id IS NOT NULL
          AND r.routing_destination IN ('Stock Keeper','Split')
          AND r.status <> 'Cancelled'
          AND ${scopeClause}
       ORDER BY COALESCE(sr.routed_at, sr.approved_at, sr.created_at) DESC, sr.id DESC, sri.id`,
      scopeParams
    );
    return res.json({ requests: withRoutedStatus(requests) });
  } catch (error) {
    return next(error);
  }
});

// Records the Stock Keeper's stock-availability decision. Acceptance only
// authorizes preparation: no inventory movement is created here.
router.post('/requests/:id/decision', async (req, res, next) => {
  const id = parseId(req.params.id);
  const decision = String(req.body.decision || '');
  const comments = text(req.body.comments, 2000);
  const reason = text(req.body.reason, 2000);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  if (!['Accepted', 'Rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Choose Accept Request or Reject Request.' });
  }
  if (decision === 'Rejected' && !reason) {
    return res.status(400).json({ message: 'A rejection reason is required.' });
  }
  const selections = new Map();
  if (Array.isArray(req.body.lines)) {
    for (const line of req.body.lines) {
      const lineId = parseId(line.storeRequestItemId);
      const quantity = Number(line.quantity);
      if (!lineId || !Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ message: 'Each confirmed item needs a valid non-negative whole-number quantity.' });
      }
      if (selections.has(lineId)) {
        return res.status(400).json({ message: 'An item was included more than once in the decision.' });
      }
      selections.set(lineId, quantity);
    }
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const scope = await requireActionScope(connection, req.user.id);
    if (!scope) {
      await connection.rollback();
      return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    }
    const [rows] = await connection.execute(
      `SELECT sr.id, sr.reference, sr.requisition_id AS requisitionId,
          sr.department_id AS departmentId, sr.status,
          sr.stockkeeper_decision AS previousDecision,
          r.reference AS requisitionReference, r.status AS requisitionStatus,
          r.supervisor_id AS supervisorId, u.id AS requesterId, u.name AS requesterName
       FROM store_requests sr
       JOIN requisitions r ON r.id = sr.requisition_id
       JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       WHERE sr.id = ? AND r.routing_destination IN ('Stock Keeper','Split')
         AND r.status <> 'Cancelled' AND ${scope.clause} FOR UPDATE`,
      [id, ...scope.params]
    );
    const request = rows[0];
    if (!request) {
      await connection.rollback();
      return res.status(404).json({ message: 'Routed request not found in your inventory scope.' });
    }
    if (request.previousDecision !== 'Pending') {
      await connection.rollback();
      return res.status(409).json({ message: 'This request already has a Stock Keeper decision.' });
    }
    const [lines] = await connection.execute(
      `SELECT sri.id, sri.item_id AS itemId, sri.quantity AS requestedQuantity,
          sri.issued_quantity AS issuedQuantity,
          COALESCE(i.name, sri.requested_item_name, 'Requested item') AS itemName,
          COALESCE(i.unit, sri.requested_unit, 'unit') AS unit,
          COALESCE(i.quantity, 0) AS availableBalance
       FROM store_request_items sri LEFT JOIN items i ON i.id = sri.item_id
       WHERE sri.store_request_id = ? FOR UPDATE`,
      [id]
    );
    if (!lines.length) {
      await connection.rollback();
      return res.status(409).json({ message: 'This request has no items to decide.' });
    }
    if (decision === 'Accepted') {
      if (!lines.some((line) => Number(line.requestedQuantity) - Number(line.issuedQuantity) > 0)) {
        await connection.rollback();
        return res.status(400).json({ message: 'This request has no outstanding quantity to accept.' });
      }
      for (const line of lines) {
        const requested = Number(line.requestedQuantity) - Number(line.issuedQuantity);
        const selected = selections.has(line.id) ? selections.get(line.id) : Math.min(requested, Number(line.availableBalance));
        if (selected > requested) {
          await connection.rollback();
          return res.status(409).json({ message: `${line.itemName} cannot exceed the outstanding requested quantity (${requested}).` });
        }
        if (selected > Number(line.availableBalance)) {
          await connection.rollback();
          return res.status(409).json({ message: `${line.itemName} cannot exceed available stock (${line.availableBalance}).` });
        }
        await connection.execute('UPDATE store_request_items SET accepted_quantity = ? WHERE id = ?', [selected, line.id]);
      }
    }
    await connection.execute(
      `UPDATE store_requests
          SET stockkeeper_decision = ?, stockkeeper_decision_by = ?, stockkeeper_decision_at = UTC_TIMESTAMP(),
              stockkeeper_comments = ?, rejection_reason = ?, status = ?
        WHERE id = ?`,
      [decision, req.user.id, comments || null, decision === 'Rejected' ? reason : null,
        decision === 'Accepted' ? 'Approved' : 'Rejected', id]
    );
    const affected = lines.filter((line) => Number(line.requestedQuantity) - Number(line.issuedQuantity) > 0)
      .map((line) => {
        const accepted = decision === 'Accepted'
          ? (selections.has(line.id) ? selections.get(line.id) : Math.min(Number(line.requestedQuantity) - Number(line.issuedQuantity), Number(line.availableBalance)))
          : 0;
        return `${line.itemName}: ${accepted} ${line.unit} accepted of ${Number(line.requestedQuantity) - Number(line.issuedQuantity)} requested`;
      }).join('; ');
    const nextStatus = decision === 'Rejected' ? REQUISITION_STATUS.RETURNED_TO_SUPERVISOR : request.requisitionStatus;
    if (decision === 'Rejected') {
      await connection.execute('UPDATE requisitions SET status = ? WHERE id = ?', [nextStatus, request.requisitionId]);
    }
    await connection.execute(
      `INSERT INTO requisition_activity (requisition_id, user_id, action, details, previous_status, new_status)
       VALUES (?, ?, ?, JSON_OBJECT('storeRequestId', ?, 'decision', ?, 'comments', ?, 'reason', ?, 'affected', ?, 'decidedBy', ?), ?, ?)`,
      [request.requisitionId, req.user.id, decision === 'Accepted' ? 'stock_request_accepted' : 'stock_request_rejected',
        id, decision, comments, decision === 'Rejected' ? reason : null, affected, req.user.name,
        request.requisitionStatus, nextStatus]
    );
    await writeAudit(connection, req.user.id, decision === 'Accepted' ? 'stock_request_accepted' : 'stock_request_rejected',
      'store_request', id, { decision, comments, reason: decision === 'Rejected' ? reason : null, affected });
    const title = decision === 'Accepted' ? 'Stock request accepted' : 'Stock request rejected';
    const body = `${req.user.name} ${decision.toLowerCase()} ${request.requisitionReference}. ${affected}. ${decision === 'Rejected' ? `Reason: ${reason}.` : ''} ${comments ? `Comments: ${comments}` : ''}`.trim();
    const link = `#/supervisor/Approvals?request=${request.requisitionId}`;
    await notifySupervisor(connection, request, title, body, link, 'stock_request_decision');
    await notifyUsers(connection, [request.requesterId], title, body,
      `#/requester/My%20Procurement%20Requests?request=${request.requisitionId}`, 'stock_request_decision');
    await notifyUsers(connection, [req.user.id], title, body, `#/stockkeeper/Requests%20from%20Supervisors?request=${id}`, 'stock_request_decision');
    await connection.commit();
    return res.json({
      id,
      decision,
      decisionAt: new Date().toISOString(),
      comments,
      reason: decision === 'Rejected' ? reason : null,
      affected,
      message: decision === 'Accepted'
        ? 'Request accepted. Stock will decrease only when a physical Stock Out is recorded.'
        : 'Request rejected and returned to the Supervisor.'
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/routed-requests/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  try {
    const scope = await requireActionScope(pool, req.user.id);
    if (!scope) return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    const [rows] = await pool.execute(
      `SELECT sr.id, sr.reference AS storeReference, sr.purpose, sr.status,
           sr.status AS requestStatus, sr.issued_at AS issuedAt,
           sr.stockkeeper_viewed_at AS viewedAt,
           CASE WHEN sr.stockkeeper_decision = 'Pending' AND sr.stockkeeper_viewed_at IS NULL
             THEN TRUE ELSE FALSE END AS isNew,
           sr.requisition_id AS requisitionId, sr.routed_at AS routedAt,
           r.reference AS requisitionReference, r.title, r.justification, r.priority,
           r.status AS requisitionStatus, r.required_by AS requiredBy,
           r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
           r.routing_comments AS supervisorComments, r.routing_destination AS routingDestination,
           sr.stockkeeper_decision AS stockkeeperDecision,
           sr.stockkeeper_decision_at AS decisionAt,
           sr.stockkeeper_comments AS stockkeeperComments,
           sr.rejection_reason AS rejectionReason,
           u.id AS requesterId, u.name AS requester, d.name AS department,
           su.name AS supervisorName, decider.name AS stockkeeperName
        FROM store_requests sr
        JOIN requisitions r ON r.id = sr.requisition_id
        JOIN users u ON u.id = sr.requester_id
        LEFT JOIN departments d ON d.id = sr.department_id
        LEFT JOIN users su ON su.id = sr.routed_by_supervisor
        LEFT JOIN users decider ON decider.id = sr.stockkeeper_decision_by
        WHERE sr.id = ? AND r.routing_destination IN ('Stock Keeper','Split')
          AND r.status <> 'Cancelled' AND ${scope.clause} LIMIT 1`,
      [id, ...scope.params]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ message: 'Routed request not found in your inventory scope.' });
    if (request.stockkeeperDecision === 'Pending' && !request.viewedAt) {
      await pool.execute(
        `UPDATE store_requests SET stockkeeper_viewed_at = UTC_TIMESTAMP()
          WHERE id = ? AND stockkeeper_viewed_at IS NULL`,
        [id]
      );
      request.viewedAt = new Date().toISOString();
      request.isNew = false;
    }
    const [items] = await pool.execute(
      `SELECT sri.id, sri.item_id AS itemId,
           COALESCE(i.name, sri.requested_item_name, 'Requested item') AS itemName,
           COALESCE(i.sku, '') AS sku, COALESCE(i.unit, sri.requested_unit, 'unit') AS unit,
           COALESCE(sri.accepted_quantity, sri.quantity) AS acceptedQuantity,
           COALESCE(sri.accepted_quantity, sri.quantity) AS authorizedQuantity,
           sri.quantity AS requestedQuantity, sri.issued_quantity AS issuedQuantity,
           (COALESCE(sri.accepted_quantity, sri.quantity) - sri.issued_quantity) AS outstandingQuantity,
           COALESCE(i.quantity, 0) AS availableBalance
        FROM store_request_items sri LEFT JOIN items i ON i.id = sri.item_id
        WHERE sri.store_request_id = ? ORDER BY sri.id`,
      [id]
    );
    const [routing] = await pool.execute(
      `SELECT rl.destination, rl.quantity, rl.available_quantity AS availableQuantity,
           rl.issued_quantity AS issuedQuantity, rl.returned_quantity AS returnedQuantity,
           rl.status, ri.item_name AS itemName, ri.unit
        FROM requisition_routing_lines rl
        JOIN requisition_items ri ON ri.id = rl.requisition_item_id
        WHERE rl.requisition_id = ? ORDER BY ri.id, rl.id`,
      [request.requisitionId]
    );
    const [returns] = await pool.execute(
      `SELECT rr.id, rr.available_quantity AS availableQuantity,
           rr.unavailable_quantity AS unavailableQuantity, rr.reason, rr.status,
           rr.created_at AS createdAt, ri.item_name AS itemName
        FROM requisition_routing_returns rr
        JOIN requisition_items ri ON ri.id = rr.requisition_item_id
        WHERE rr.store_request_id = ? ORDER BY rr.created_at DESC, rr.id DESC`,
      [id]
    );
    const [attachments] = await pool.execute(
      `SELECT id, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, created_at AS createdAt
        FROM requisition_attachments WHERE requisition_id = ? ORDER BY id`,
      [request.requisitionId]
    );
    return res.json({
      request: {
        ...request,
        requisitionReference: request.requisitionReference || request.reference,
        requisitionStatusLabel: statusLabel(request.requisitionStatus),
        ...withRoutedStatus([{
          ...request,
          remainingQuantity: items.reduce((sum, line) => sum + Math.max(0, Number(line.outstandingQuantity) || 0), 0),
          issuedQuantity: items.reduce((sum, line) => sum + Number(line.issuedQuantity || 0), 0)
        }])[0]
      },
      items,
      routing,
      returns,
      attachments
    });
  } catch (error) {
    return next(error);
  }
});

// Records a physical-count shortfall without changing stock. The unissued
// quantity is returned to the Supervisor; already-issued quantities and their
// stock transactions remain part of the permanent history.
router.post('/routed-requests/:id/return-shortage', async (req, res, next) => {
  const id = parseId(req.params.id);
  const storeRequestItemId = parseId(req.body.storeRequestItemId);
  const availableQuantity = Number(req.body.availableQuantity);
  const unavailableQuantity = Number(req.body.unavailableQuantity);
  const reason = text(req.body.reason, 2000);
  if (!id || !storeRequestItemId) {
    return res.status(400).json({ message: 'Choose a request line to report.' });
  }
  if (!Number.isInteger(availableQuantity) || availableQuantity < 0
      || !Number.isInteger(unavailableQuantity) || unavailableQuantity < 1) {
    return res.status(400).json({ message: 'Enter the available quantity and a positive unavailable quantity as whole numbers.' });
  }
  if (!reason) return res.status(400).json({ message: 'Describe the physical stock discrepancy.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const scope = await requireActionScope(connection, req.user.id);
    if (!scope) {
      await connection.rollback();
      return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    }
    const [requests] = await connection.execute(
      `SELECT sr.id, sr.reference, sr.requisition_id AS requisitionId,
           sr.department_id AS departmentId, sr.status,
           r.reference AS requisitionReference, r.supervisor_id AS supervisorId,
           u.name AS requesterName
        FROM store_requests sr
        JOIN requisitions r ON r.id = sr.requisition_id
        JOIN users u ON u.id = sr.requester_id
        LEFT JOIN departments d ON d.id = sr.department_id
        WHERE sr.id = ? AND r.routing_destination IN ('Stock Keeper','Split')
          AND r.status <> 'Cancelled' AND sr.status = 'Approved'
          AND sr.stockkeeper_decision = 'Accepted' AND ${scope.clause} FOR UPDATE`,
      [id, ...scope.params]
    );
    const request = requests[0];
    if (!request) {
      await connection.rollback();
      return res.status(409).json({ message: 'Only an open routed request in your inventory scope can report a shortage.' });
    }
    const [lines] = await connection.execute(
      `SELECT sri.id, sri.item_id AS itemId, sri.requisition_item_id AS requisitionItemId,
           sri.quantity AS requestedQuantity,
           COALESCE(sri.accepted_quantity, sri.quantity) AS acceptedQuantity,
           sri.issued_quantity AS issuedQuantity,
           COALESCE(i.name, sri.requested_item_name, 'Requested item') AS itemName
        FROM store_request_items sri
        LEFT JOIN items i ON i.id = sri.item_id
        WHERE sri.id = ? AND sri.store_request_id = ? FOR UPDATE`,
      [storeRequestItemId, id]
    );
    const line = lines[0];
    if (!line || !line.requisitionItemId) {
      await connection.rollback();
      return res.status(404).json({ message: 'The selected line is not part of this routed request.' });
    }
    const outstanding = Number(line.acceptedQuantity ?? line.requestedQuantity) - Number(line.issuedQuantity);
    if (availableQuantity + unavailableQuantity !== outstanding) {
      await connection.rollback();
      return res.status(409).json({ message: `The available and unavailable quantities must account for all ${outstanding} outstanding unit(s).` });
    }
    const [returnResult] = await connection.execute(
      `INSERT INTO requisition_routing_returns
         (requisition_id, store_request_id, requisition_item_id, item_id,
          available_quantity, unavailable_quantity, reason, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.requisitionId, id, line.requisitionItemId, line.itemId,
        availableQuantity, unavailableQuantity, reason, req.user.id]
    );
    const returnId = Number(returnResult.insertId);
    const newQuantity = Number(line.issuedQuantity) + availableQuantity;
    await connection.execute(
      'UPDATE store_request_items SET quantity = ?, accepted_quantity = ? WHERE id = ?',
      [newQuantity, newQuantity, storeRequestItemId]
    );
    const [[remaining]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM store_request_items
        WHERE store_request_id = ? AND issued_quantity < COALESCE(accepted_quantity, quantity)`,
      [id]
    );
    if (Number(remaining.total) === 0) {
      await connection.execute(
        "UPDATE store_requests SET status = 'Issued', issued_at = UTC_TIMESTAMP() WHERE id = ?",
        [id]
      );
    }
    const [routingLines] = await connection.execute(
      `SELECT id, quantity, issued_quantity AS issuedQuantity, returned_quantity AS returnedQuantity, status
        FROM requisition_routing_lines
        WHERE requisition_id = ? AND requisition_item_id = ? AND destination = 'Stock Keeper' AND status <> 'Returned'
        ORDER BY id`,
      [request.requisitionId, line.requisitionItemId]
    );
    if (routingLines[0]) {
      const updatedReturned = Number(routingLines[0].returnedQuantity) + unavailableQuantity;
      const nextStatus = updatedReturned >= Number(routingLines[0].quantity) ? 'Returned' : routingLines[0].status;
      await connection.execute(
        'UPDATE requisition_routing_lines SET returned_quantity = ?, status = ? WHERE id = ?',
        [updatedReturned, nextStatus, routingLines[0].id]
      );
    }
    await connection.execute(
      'UPDATE requisitions SET status = ? WHERE id = ?',
      [REQUISITION_STATUS.RETURNED_TO_SUPERVISOR, request.requisitionId]
    );
    await connection.execute(
      `INSERT INTO requisition_activity (requisition_id, user_id, action, details, previous_status, new_status)
       VALUES (?, ?, 'stock_shortage_returned', JSON_OBJECT('returnId', ?, 'itemId', ?, 'availableQuantity', ?, 'unavailableQuantity', ?, 'reason', ?), ?, ?)`,
      [request.requisitionId, req.user.id, returnId, line.itemId, availableQuantity, unavailableQuantity,
        reason, REQUISITION_STATUS.AWAITING_STOCK_ISSUE, REQUISITION_STATUS.RETURNED_TO_SUPERVISOR]
    );
    await writeAudit(connection, req.user.id, 'stock_shortage_returned', 'requisition', request.requisitionId, {
      returnId, storeRequestId: id, unavailableQuantity, availableQuantity, reason
    });
    const [supervisors] = await connection.execute(
      `SELECT id FROM users WHERE id = ? AND role = 'supervisor' AND active = TRUE
       UNION
       SELECT id FROM users WHERE role = 'supervisor' AND active = TRUE AND department_id = ?
       ORDER BY id LIMIT 1`,
      [request.supervisorId || 0, request.departmentId || 0]
    );
    for (const supervisor of supervisors) {
      await createNotification(connection, supervisor.id, 'Stock shortage returned for routing',
        `${req.user.name} reported ${unavailableQuantity} ${line.itemName} unavailable for ${request.requisitionReference}. Review and route the shortfall.`,
        `#/supervisor/Approvals?request=${request.requisitionId}&return=${returnId}`, 'stock_return');
    }
    await createNotification(connection, request.requesterId, 'Stock shortage reported',
      `${unavailableQuantity} ${line.itemName} for ${request.requisitionReference} was unavailable in physical stock. Your Supervisor will review the shortfall.`,
      `#/requester/My%20Procurement%20Requests?request=${request.requisitionId}`, 'stock_return');
    await connection.commit();
    return res.status(201).json({
      id: returnId,
      message: 'Shortage recorded and returned to the Supervisor. No stock was reduced.'
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/transactions/stock-out', async (req, res, next) => {
  let input;
  const storeRequestId = parseId(req.body.storeRequestId);
  try {
    input = parseTransactionInput(req.body);
    if (!storeRequestId) throw httpError(400, 'Select an approved store request before issuing stock.');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const connection = await pool.getConnection();
  const receivedBy = text(req.body.receivedBy, 150) || null;
  try {
    await connection.beginTransaction();
    const scope = await requireActionScope(connection, req.user.id);
    if (!scope) {
      await connection.rollback();
      return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    }
    const duplicate = await existingIdempotent(connection, input.idempotencyKey, {
      itemId: input.itemId, movementType: 'Issue', direction: 'Out',
      quantity: input.quantity, storeRequestId
    });
    if (duplicate) {
      await connection.rollback();
      return res.json({ id: Number(duplicate.id), referenceNo: duplicate.referenceNo, balance: Number(duplicate.balance), duplicate: true });
    }
    const [[request]] = await connection.execute(
      `SELECT sr.id, sr.reference, sr.requester_id AS requesterId, sr.department_id AS departmentId,
           sr.requisition_id AS requisitionId, sr.purpose, r.status AS requisitionStatus,
           r.supervisor_id AS supervisorId
       FROM store_requests sr
       LEFT JOIN requisitions r ON r.id = sr.requisition_id
       LEFT JOIN departments d ON d.id = sr.department_id
       WHERE sr.id = ? AND sr.status = 'Approved'
         AND sr.stockkeeper_decision = 'Accepted'
         AND (sr.requisition_id IS NULL OR (r.routing_destination IN ('Stock Keeper','Split') AND r.status <> 'Cancelled'))
         AND ${scope.clause} FOR UPDATE`,
      [storeRequestId, ...scope.params]
    );
    if (!request) {
      await connection.rollback();
      return res.status(409).json({ message: 'Only an approved stock request can be issued.' });
    }
    const [[line]] = await connection.execute(
      `SELECT COALESCE(sri.accepted_quantity, sri.quantity) AS authorizedQuantity,
          sri.quantity AS requestedQuantity, sri.issued_quantity AS issuedQuantity,
          i.id, i.name, i.quantity AS availableBalance, i.reorder_level AS minimumStock
       FROM store_request_items sri JOIN items i ON i.id = sri.item_id
       WHERE sri.store_request_id = ? AND sri.item_id = ? FOR UPDATE`,
      [storeRequestId, input.itemId]
    );
    if (!line) {
      await connection.rollback();
      return res.status(404).json({ message: 'The selected item is not part of this approved request.' });
    }
    const remaining = Number(line.authorizedQuantity) - Number(line.issuedQuantity);
    if (input.quantity > remaining) {
      await connection.rollback();
      return res.status(409).json({ message: `Issue quantity exceeds the authorized quantity still outstanding (${remaining}).` });
    }
    if (input.quantity > Number(line.availableBalance)) {
      await connection.rollback();
      return res.status(409).json({ message: `Insufficient stock for ${line.name}. Available: ${line.availableBalance}.` });
    }
    const balance = Number(line.availableBalance) - input.quantity;
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, line.id]);
    await connection.execute(
      'UPDATE store_request_items SET issued_quantity = issued_quantity + ? WHERE store_request_id = ? AND item_id = ?',
      [input.quantity, storeRequestId, input.itemId]
    );
    if (request.requisitionId) {
      await connection.execute(
        `UPDATE requisition_routing_lines
            SET issued_quantity = issued_quantity + ?, status = 'Issued'
          WHERE requisition_id = ? AND item_id = ? AND destination = 'Stock Keeper'
            AND status <> 'Returned'
          ORDER BY id LIMIT 1`,
        [input.quantity, request.requisitionId, input.itemId]
      );
    }
    const movementId = await recordMovement(connection, {
      itemId: line.id, userId: req.user.id, type: 'Issue', direction: 'Out',
      quantity: input.quantity, referenceNo: input.referenceNo, source: request.reference,
      description: input.description || request.purpose,
      requesterId: request.requesterId, receivedBy, departmentId: request.departmentId,
      storeRequestId, idempotencyKey: input.idempotencyKey, balance,
      movementAt: input.movementAt
    });
    const [[outstanding]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM store_request_items
        WHERE store_request_id = ? AND issued_quantity < COALESCE(accepted_quantity, quantity)`,
      [storeRequestId]
    );
    const completed = Number(outstanding.total) === 0;
    if (completed) {
      await connection.execute(
        "UPDATE store_requests SET status = 'Issued', issued_at = UTC_TIMESTAMP() WHERE id = ?",
        [storeRequestId]
      );
    }
    if (request.requisitionId) {
      const [[pendingPurchase]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM requisition_routing_lines
          WHERE requisition_id = ? AND destination = 'Procurement'
            AND quantity > issued_quantity + returned_quantity`,
        [request.requisitionId]
      );
      let requisitionStatus = completed ? REQUISITION_STATUS.COMPLETED : REQUISITION_STATUS.PARTIALLY_ISSUED;
      if (completed && Number(pendingPurchase?.total) > 0) requisitionStatus = REQUISITION_STATUS.FORWARDED;
      await connection.execute(
        'UPDATE requisitions SET status = ? WHERE id = ?',
        [requisitionStatus, request.requisitionId]
      );
      await connection.execute(
        `INSERT INTO requisition_activity (requisition_id, user_id, action, details, previous_status, new_status)
         VALUES (?, ?, 'stock_issued', JSON_OBJECT('storeRequestId', ?, 'itemId', ?, 'quantity', ?, 'receivedBy', ?, 'completed', ?), ?, ?)`,
        [request.requisitionId, req.user.id, storeRequestId, input.itemId, input.quantity,
          receivedBy, completed ? 1 : 0, request.requisitionStatus || REQUISITION_STATUS.AWAITING_STOCK_ISSUE, requisitionStatus]
      );
      await createNotification(connection, request.requesterId, 'Stock issued for your request',
        `${input.quantity} ${line.name} was physically issued for ${request.reference}. ${statusLabel(requisitionStatus)}.`,
        `#/requester/My%20Procurement%20Requests?request=${request.requisitionId}`, 'stock_issue');
      await notifySupervisor(connection, request,
        completed ? 'Stock fully issued' : 'Stock partially issued',
        `${input.quantity} ${line.name} was issued for ${request.reference}. ${completed ? 'All accepted quantities are now issued.' : 'Some accepted quantities remain outstanding.'}`,
        `#/supervisor/Approvals?request=${request.requisitionId}`, 'stock_issue');
    }
    await writeAudit(connection, req.user.id, 'stock_out', 'inventory_movement', movementId, {
      itemId: line.id, quantity: input.quantity, referenceNo: input.referenceNo,
      storeRequestId, requesterId: request.requesterId, departmentId: request.departmentId,
      balance, requestCompleted: completed
    });
    await notifyStorekeepers(
      connection, balance === 0 ? 'Item is out of stock' : 'Stock issued',
      `${input.quantity} ${line.name} issued for ${request.reference}. Balance: ${balance}.`,
      `#/stockkeeper/Bin%20Card?item=${line.id}`, balance === 0 ? 'zero_stock' : 'stock_out'
    );
    if (balance > 0 && balance <= Number(line.minimumStock || 0)) {
      await notifyStorekeepers(
        connection, 'Low stock alert', `${line.name} has ${balance} remaining.`,
        `#/stockkeeper/Bin%20Card?item=${line.id}`, 'low_stock'
      );
    }
    await connection.commit();
    return res.status(201).json({
      id: movementId, referenceNo: input.referenceNo, balance,
      requestStatus: completed ? 'Issued' : 'Approved',
      message: completed ? 'Stock issued and request fulfilled.' : 'Partial stock issue recorded; remaining approved quantities are still available.'
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      if (error.message?.includes('idempotency')) return res.status(409).json({ message: 'This stock-out transaction was already submitted.' });
      return res.status(409).json({ message: 'That transaction reference is already in use.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

// Physical issue of one or more lines from one accepted request. All item
// updates and Bin Card movements commit together or roll back together.
router.post('/requests/:id/issue', async (req, res, next) => {
  const id = parseId(req.params.id);
  const issueKey = text(req.body.idempotencyKey, 60);
  const date = businessDate(req.body.date || new Date().toISOString().slice(0, 10), 'Issue date');
  const receivedBy = text(req.body.receivedBy, 150);
  const comments = text(req.body.comments, 2000);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  if (issueKey.length < 16) return res.status(400).json({ message: 'A transaction idempotency key is required.' });
  if (!receivedBy) return res.status(400).json({ message: 'Record the person or department receiving the goods.' });
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!lines.length) return res.status(400).json({ message: 'Select at least one item to issue.' });
  const selections = new Map();
  for (const line of lines) {
    const lineId = parseId(line.storeRequestItemId);
    const quantity = Number(line.quantity);
    if (!lineId || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ message: 'Each issued item needs a positive whole-number quantity.' });
    }
    if (selections.has(lineId)) return res.status(400).json({ message: 'An item was included more than once.' });
    selections.set(lineId, quantity);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const scope = await requireActionScope(connection, req.user.id);
    if (!scope) {
      await connection.rollback();
      return res.status(403).json({ message: 'Your Stock Keeper assignment is no longer active.' });
    }
    const [[previous]] = await connection.execute(
      'SELECT id FROM inventory_movements WHERE idempotency_key = ? LIMIT 1', [`${issueKey}-1`]
    );
    if (previous) {
      await connection.rollback();
      return res.json({ duplicate: true, referenceNo: previous.reference_no, message: 'This stock-out was already recorded.' });
    }
    const [requests] = await connection.execute(
      `SELECT sr.id, sr.reference, sr.requester_id AS requesterId, sr.department_id AS departmentId,
          sr.requisition_id AS requisitionId, sr.purpose, sr.status AS requestStatus,
          sr.stockkeeper_decision AS stockkeeperDecision, r.status AS requisitionStatus,
          r.supervisor_id AS supervisorId
       FROM store_requests sr
       JOIN requisitions r ON r.id = sr.requisition_id
       LEFT JOIN departments d ON d.id = sr.department_id
       WHERE sr.id = ? AND r.routing_destination IN ('Stock Keeper','Split')
         AND r.status <> 'Cancelled' AND ${scope.clause} FOR UPDATE`,
      [id, ...scope.params]
    );
    const request = requests[0];
    if (!request || request.stockkeeperDecision !== 'Accepted' || request.requestStatus !== 'Approved') {
      await connection.rollback();
      if (request?.stockkeeperDecision === 'Accepted' && request.requestStatus === 'Issued') {
        return res.status(409).json({ message: 'This request is fully issued; the authorized outstanding quantity (0) is zero.' });
      }
      return res.status(409).json({ message: 'Only an accepted request can be issued.' });
    }
    const [stockLines] = await connection.execute(
      `SELECT sri.id AS storeRequestItemId, sri.item_id AS itemId,
          COALESCE(sri.accepted_quantity, sri.quantity) AS authorizedQuantity,
          sri.issued_quantity AS issuedQuantity, sri.quantity AS requestedQuantity,
          i.name AS itemName, i.unit, i.quantity AS availableBalance,
          i.reorder_level AS minimumStock, i.department_id AS itemDepartmentId
       FROM store_request_items sri JOIN items i ON i.id = sri.item_id
       WHERE sri.store_request_id = ? ORDER BY i.id FOR UPDATE`,
      [id]
    );
    const records = [];
    for (const line of stockLines) {
      if (!selections.has(Number(line.storeRequestItemId))) continue;
      const quantity = selections.get(Number(line.storeRequestItemId));
      const outstanding = Number(line.authorizedQuantity) - Number(line.issuedQuantity);
      if (quantity > outstanding) {
        await connection.rollback();
        return res.status(409).json({ message: `${line.itemName} exceeds the authorized outstanding quantity (${outstanding}).` });
      }
      if (quantity > Number(line.availableBalance)) {
        await connection.rollback();
        return res.status(409).json({ message: `Insufficient stock for ${line.itemName}. Available: ${line.availableBalance}.` });
      }
      records.push({ line, quantity, balance: Number(line.availableBalance) - quantity });
    }
    if (records.length !== selections.size) {
      await connection.rollback();
      return res.status(400).json({ message: 'One or more selected items do not belong to this request.' });
    }
    if (!records.length) {
      await connection.rollback();
      return res.status(400).json({ message: 'Select at least one item with an outstanding accepted quantity.' });
    }
    const referenceNo = transactionReference('SO');
    const movementAt = toUtcDateTime(date);
    let total = 0;
    for (const [index, record] of records.entries()) {
      const { line, quantity, balance } = record;
      total += quantity;
      await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, line.itemId]);
      await connection.execute(
        'UPDATE store_request_items SET issued_quantity = issued_quantity + ? WHERE id = ?',
        [quantity, line.storeRequestItemId]
      );
      if (request.requisitionId) {
        await connection.execute(
          `UPDATE requisition_routing_lines
              SET issued_quantity = issued_quantity + ?, status = 'Issued'
            WHERE requisition_id = ? AND item_id = ? AND destination = 'Stock Keeper' AND status <> 'Returned'
            ORDER BY id LIMIT 1`,
          [quantity, request.requisitionId, line.itemId]
        );
      }
      await recordMovement(connection, {
        itemId: line.itemId, userId: req.user.id, type: 'Issue', direction: 'Out',
        quantity, referenceNo: `${referenceNo}-${index + 1}`, source: request.reference,
        description: comments || request.purpose, requesterId: request.requesterId,
        receivedBy, departmentId: request.departmentId || line.itemDepartmentId,
        storeRequestId: id, idempotencyKey: `${issueKey}-${index + 1}`, balance, movementAt
      });
      if (balance === 0 || balance <= Number(line.minimumStock || 0)) {
        await notifyStorekeepers(connection,
          balance === 0 ? 'Item is out of stock' : 'Low stock alert',
          `${line.itemName} has ${balance} remaining after ${referenceNo}.`,
          `#/stockkeeper/Bin%20Card?item=${line.itemId}`, balance === 0 ? 'zero_stock' : 'low_stock');
      }
    }
    const [[outstanding]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM store_request_items
       WHERE store_request_id = ? AND issued_quantity < COALESCE(accepted_quantity, quantity)`,
      [id]
    );
    const completed = Number(outstanding.total) === 0;
    if (completed) {
      await connection.execute("UPDATE store_requests SET status = 'Issued', issued_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
    }
    let requisitionStatus = null;
    if (request.requisitionId) {
      const [[pendingPurchase]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM requisition_routing_lines
          WHERE requisition_id = ? AND destination = 'Procurement'
            AND quantity > issued_quantity + returned_quantity`,
        [request.requisitionId]
      );
      requisitionStatus = completed
        ? (Number(pendingPurchase?.total) > 0 ? REQUISITION_STATUS.FORWARDED : REQUISITION_STATUS.COMPLETED)
        : REQUISITION_STATUS.PARTIALLY_ISSUED;
      await connection.execute('UPDATE requisitions SET status = ? WHERE id = ?', [requisitionStatus, request.requisitionId]);
      await connection.execute(
        `INSERT INTO requisition_activity (requisition_id, user_id, action, details, previous_status, new_status)
         VALUES (?, ?, 'stock_issued', JSON_OBJECT('storeRequestId', ?, 'referenceNo', ?, 'lines', ?, 'total', ?, 'completed', ?, 'receivedBy', ?), ?, ?)`,
        [request.requisitionId, req.user.id, id, referenceNo, JSON.stringify(records.map((record) => ({
          itemId: record.line.itemId, itemName: record.line.itemName, quantity: record.quantity
        }))), total, completed ? 1 : 0, receivedBy, request.requisitionStatus, requisitionStatus]
      );
      const summary = records.map((record) => `${record.quantity} ${record.line.itemName}`).join(', ');
      await notifyUsers(connection, [request.requesterId], 'Stock issued for your request',
        `${summary} was issued for ${request.reference}. ${statusLabel(requisitionStatus)}.`,
        `#/requester/My%20Procurement%20Requests?request=${request.requisitionId}`, 'stock_issue');
      await notifySupervisor(connection, request,
        completed ? 'Stock fully issued' : 'Stock partially issued',
        `${summary} was physically issued for ${request.reference}.`,
        `#/supervisor/Approvals?request=${request.requisitionId}`, 'stock_issue');
    }
    await writeAudit(connection, req.user.id, 'stock_out', 'store_request', id, {
      referenceNo, lines: records.map((record) => ({
        itemId: record.line.itemId, quantity: record.quantity, balance: record.balance
      })), total, requestCompleted: completed, receivedBy, comments
    });
    await connection.commit();
    return res.status(201).json({
      referenceNo,
      total,
      requestStatus: completed ? 'Issued' : 'Approved',
      requisitionStatus,
      lines: records.map((record, index) => ({
        storeRequestItemId: Number(record.line.storeRequestItemId),
        itemId: Number(record.line.itemId),
        itemName: record.line.itemName,
        quantity: record.quantity,
        balance: record.balance,
        referenceNo: `${referenceNo}-${index + 1}`
      })),
      message: completed ? 'Stock issued and request fulfilled.' : 'Partial stock issue recorded.'
    });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'That stock-out reference or transaction key is already in use.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/transactions/adjustment', async (req, res, next) => {
  let input;
  const direction = req.body.direction;
  try {
    input = parseTransactionInput(req.body);
    input.reason = text(req.body.reason, 1000);
    if (!['In', 'Out'].includes(direction)) throw httpError(400, 'Choose whether the adjustment adds or removes stock.');
    if (!input.reason) throw httpError(400, 'Enter a reason for this stock adjustment.');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const duplicate = await existingIdempotent(connection, input.idempotencyKey, {
      itemId: input.itemId, movementType: 'Adjustment', direction, quantity: input.quantity
    });
    if (duplicate) {
      await connection.rollback();
      return res.json({ id: Number(duplicate.id), referenceNo: duplicate.referenceNo, balance: Number(duplicate.balance), duplicate: true });
    }
    const [[item]] = await connection.execute(
      'SELECT id, name, quantity, reorder_level AS minimumStock FROM items WHERE id = ? FOR UPDATE',
      [input.itemId]
    );
    if (!item) {
      await connection.rollback();
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    const balance = Number(item.quantity) + (direction === 'In' ? input.quantity : -input.quantity);
    if (balance < 0) {
      await connection.rollback();
      return res.status(409).json({ message: `Adjustment exceeds available stock (${item.quantity}).` });
    }
    if (balance > 4294967295) {
      await connection.rollback();
      return res.status(400).json({ message: 'The resulting stock balance exceeds the supported limit.' });
    }
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, item.id]);
    const movementId = await recordMovement(connection, {
      itemId: item.id, userId: req.user.id, type: 'Adjustment', direction,
      quantity: input.quantity, referenceNo: input.referenceNo, source: 'Stock adjustment',
      description: input.reason, idempotencyKey: input.idempotencyKey,
      balance, movementAt: input.movementAt
    });
    await writeAudit(connection, req.user.id, 'stock_adjustment', 'inventory_movement', movementId, {
      itemId: item.id, direction, quantity: input.quantity, reason: input.reason,
      referenceNo: input.referenceNo, balance
    });
    await notifyStorekeepers(
      connection, 'Stock adjusted',
      `${item.name} was adjusted ${direction === 'In' ? 'up' : 'down'} by ${input.quantity}. Balance: ${balance}.`,
      `#/stockkeeper/Bin%20Card?item=${item.id}`, 'adjustment'
    );
    if (balance === 0) {
      await notifyStorekeepers(
        connection, 'Item is out of stock', `${item.name} has reached zero balance.`,
        `#/stockkeeper/Bin%20Card?item=${item.id}`, 'zero_stock'
      );
    } else if (balance <= Number(item.minimumStock)) {
      await notifyStorekeepers(
        connection, 'Low stock alert', `${item.name} has ${balance} remaining.`,
        `#/stockkeeper/Bin%20Card?item=${item.id}`, 'low_stock'
      );
    }
    await connection.commit();
    return res.status(201).json({ id: movementId, referenceNo: input.referenceNo, balance, message: 'Stock adjustment recorded.' });
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'The reference or transaction key is already in use.' });
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/requesters', async (req, res, next) => {
  const pageOptions = pagination(req.query, 'name', {
    name: 'u.name',
    department: 'COALESCE(d.name, \'\')',
    status: 'u.active'
  });
  if (pageOptions.error) return res.status(400).json({ message: pageOptions.error });

  const search = text(req.query.search, 100);
  const name = text(req.query.name, 100);
  const email = text(req.query.email, 100);
  const department = text(req.query.department, 100);
  const departmentId = req.query.departmentId ? parseId(req.query.departmentId) : null;
  if (req.query.departmentId && !departmentId) return res.status(400).json({ message: 'Invalid Department filter.' });
  const status = text(req.query.status, 20).toLowerCase();
  if (status && !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: 'Account status must be active or inactive.' });
  }

  const filters = ["u.role = 'requestor'"];
  const parameters = [];
  if (search) {
    filters.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR d.name LIKE ?)');
    const pattern = `%${search}%`;
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (name) { filters.push('u.name LIKE ?'); parameters.push(`%${name}%`); }
  if (email) { filters.push('u.email LIKE ?'); parameters.push(`%${email}%`); }
  if (department) { filters.push('d.name LIKE ?'); parameters.push(`%${department}%`); }
  if (departmentId) { filters.push('u.department_id = ?'); parameters.push(departmentId); }
  if (status) { filters.push('u.active = ?'); parameters.push(status === 'active'); }
  const where = filters.join(' AND ');

  try {
    const [[statsRow]] = await pool.query(
      `SELECT COUNT(*) AS totalRequesters,
          COALESCE(SUM(u.active = TRUE), 0) AS activeRequesters,
          COALESCE(SUM(u.active = FALSE), 0) AS inactiveRequesters,
          COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN d.id END) AS departments
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role = 'requestor'`
    );
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE ${where}`,
      parameters
    );
    const total = Number(countRow.total) || 0;
    const pages = Math.max(1, Math.ceil(total / pageOptions.limit));
    const page = Math.min(pageOptions.page, pages);

    const [requesters] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.active,
          u.department_id AS departmentId, d.name AS department,
          u.created_at AS createdAt,
          COALESCE(issueSummary.stockIssues, 0) AS stockIssues
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN (
         SELECT requester_id, COUNT(*) AS stockIssues
         FROM inventory_movements
         WHERE movement_type = 'Issue' AND direction = 'Out'
         GROUP BY requester_id
       ) issueSummary ON issueSummary.requester_id = u.id
       WHERE ${where}
       ORDER BY ${pageOptions.sortColumn} ${pageOptions.direction}, u.name ASC, u.id ASC
       LIMIT ? OFFSET ?`,
      [...parameters, pageOptions.limit, (page - 1) * pageOptions.limit]
    );
    const [departments] = await pool.execute(
      `SELECT d.id, d.name FROM departments d
       WHERE EXISTS (
         SELECT 1 FROM users u WHERE u.role = 'requestor' AND u.department_id = d.id
       )
       ORDER BY d.name`
    );
    const stats = Object.fromEntries(
      Object.entries(statsRow).map(([key, value]) => [key, Number(value) || 0])
    );
    return res.json({
      requesters,
      departments,
      stats,
      pagination: { page, limit: pageOptions.limit, total, pages }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/requesters/:id', async (req, res, next) => {
  const requesterId = parseId(req.params.id);
  if (!requesterId) return res.status(400).json({ message: 'Invalid Requester.' });
  try {
    const [[requester]] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at AS createdAt,
          u.department_id AS departmentId, d.name AS department,
          supervisor.id AS supervisorId, supervisor.name AS supervisorName,
          supervisor.email AS supervisorEmail
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users supervisor ON supervisor.id = (
         SELECT candidate.id FROM users candidate
         WHERE candidate.role = 'supervisor' AND candidate.active = TRUE
           AND candidate.department_id = u.department_id
         ORDER BY candidate.id LIMIT 1
       )
       WHERE u.id = ? AND u.role = 'requestor'
       LIMIT 1`,
      [requesterId]
    );
    if (!requester) return res.status(404).json({ message: 'Requester not found.' });

    const [[issueSummary]] = await pool.execute(
      `SELECT COUNT(*) AS totalIssues, COALESCE(SUM(quantity), 0) AS totalUnits,
          MAX(COALESCE(movement_at, created_at)) AS mostRecentIssueAt
       FROM inventory_movements
       WHERE requester_id = ? AND movement_type = 'Issue' AND direction = 'Out'`,
      [requesterId]
    );
    const [recentIssues] = await pool.execute(
      `SELECT m.id, m.quantity, m.reference_no AS referenceNo,
          COALESCE(m.movement_at, m.created_at) AS movementAt,
          i.name AS itemName, i.sku, i.unit
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       WHERE m.requester_id = ? AND m.movement_type = 'Issue' AND m.direction = 'Out'
       ORDER BY COALESCE(m.movement_at, m.created_at) DESC, m.id DESC
       LIMIT 5`,
      [requesterId]
    );
    return res.json({
      requester,
      issueSummary: {
        totalIssues: Number(issueSummary.totalIssues) || 0,
        totalUnits: Number(issueSummary.totalUnits) || 0,
        mostRecentIssueAt: issueSummary.mostRecentIssueAt
      },
      recentIssues
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/requesters/:id/history', async (req, res, next) => {
  const requesterId = parseId(req.params.id);
  if (!requesterId) return res.status(400).json({ message: 'Invalid Requester.' });
  const pageOptions = pagination(req.query, 'date', { date: 'COALESCE(m.movement_at, m.created_at)' });
  if (pageOptions.error) return res.status(400).json({ message: pageOptions.error });
  const item = text(req.query.item, 100);
  const from = text(req.query.from, 10);
  const to = text(req.query.to, 10);
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return res.status(400).json({ message: 'Dates must be valid and use YYYY-MM-DD.' });
  }
  if (from && to && to < from) {
    return res.status(400).json({ message: 'End date must be on or after start date.' });
  }

  try {
    const [[requester]] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.active,
          u.department_id AS departmentId, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? AND u.role = 'requestor' LIMIT 1`,
      [requesterId]
    );
    if (!requester) return res.status(404).json({ message: 'Requester not found.' });

    const filters = [
      'm.requester_id = ?',
      "m.movement_type = 'Issue'",
      "m.direction = 'Out'"
    ];
    const parameters = [requesterId];
    if (item) {
      filters.push('(i.name LIKE ? OR i.sku LIKE ?)');
      parameters.push(`%${item}%`, `%${item}%`);
    }
    const dateColumn = 'COALESCE(m.movement_at, m.created_at)';
    if (from) { filters.push(`${dateColumn} >= ?`); parameters.push(`${from} 00:00:00`); }
    if (to) { filters.push(`${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`); parameters.push(to); }
    const where = filters.join(' AND ');
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       WHERE ${where}`,
      parameters
    );
    const total = Number(countRow.total) || 0;
    const pages = Math.max(1, Math.ceil(total / pageOptions.limit));
    const page = Math.min(pageOptions.page, pages);

    const [movements] = await pool.execute(
      `SELECT m.id, m.movement_type AS type, m.direction, m.quantity,
          m.reference_no AS referenceNo, m.source, m.description,
          m.balance_after AS balance, ${dateColumn} AS movementAt,
          i.name AS itemName, i.sku, i.unit, issuer.name AS issuedBy,
          issuer.name AS updatedBy,
          m.received_by AS receivedBy, COALESCE(md.name, rd.name) AS department,
          m.store_request_id AS storeRequestId, sr.reference AS storeRequestReference
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       LEFT JOIN users issuer ON issuer.id = m.user_id
       LEFT JOIN users requesterUser ON requesterUser.id = m.requester_id
       LEFT JOIN departments md ON md.id = m.department_id
       LEFT JOIN departments rd ON rd.id = requesterUser.department_id
       LEFT JOIN store_requests sr ON sr.id = m.store_request_id
       WHERE ${where}
       ORDER BY ${pageOptions.sortColumn} ${pageOptions.direction}, m.id DESC
       LIMIT ? OFFSET ?`,
      [...parameters, pageOptions.limit, (page - 1) * pageOptions.limit]
    );
    return res.json({
      requester,
      movements,
      pagination: { page, limit: pageOptions.limit, total, pages }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/notifications/read-all', async (req, res, next) => {
  try {
    // Kept for older clients. Private message notifications stay unread so a
    // message can only be cleared from the message itself.
    const ids = await markNotificationsRead(
      pool, req.user.id,
      `(n.category <> 'message' AND n.link NOT LIKE '%message=%')`
    );
    return res.json({ updated: ids.length });
  } catch (error) {
    return next(error);
  }
});

export default router;

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { businessDate, isIsoDate, toUtcDateTime } from '../utils/dates.js';

const router = Router();
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const REQUESTER_PAGE_SIZES = new Set([10, 25, 50, 100]);
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
  idempotencyKey, balance, movementAt
}) {
  const [result] = await connection.execute(
    `INSERT INTO inventory_movements
       (item_id, user_id, movement_type, direction, quantity, reference_no, source,
        description, requester_id, received_by, department_id, store_request_id, idempotency_key,
        balance_after, movement_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      itemId, userId, type, direction, quantity, referenceNo, source, description || null,
      requesterId, receivedBy, departmentId, storeRequestId, idempotencyKey, balance, movementAt
    ]
  );
  return result.insertId;
}

router.get('/summary', async (req, res, next) => {
  try {
    const [[stats]] = await pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM items) AS totalStockItems,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE direction = 'In') AS totalStockIn,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE direction = 'Out') AS totalStockOut,
        (SELECT COALESCE(SUM(quantity), 0) FROM items) AS availableStockBalance,
        (SELECT COUNT(*) FROM items WHERE quantity <= reorder_level) AS lowStockItems,
        (SELECT COUNT(*) FROM items WHERE quantity = 0) AS zeroStockItems,
        (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = FALSE) AS unreadNotifications,
        (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = FALSE
          AND category IN ('low_stock','zero_stock','stock_request')) AS attentionNotifications`,
      [req.user.id, req.user.id]
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
      lowStockItems
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
          d.name AS department
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

router.get('/issue-requests', async (_req, res, next) => {
  try {
    const [requests] = await pool.execute(
      `SELECT sr.id AS requestId, sr.reference, sr.purpose,
          sr.department_id AS departmentId, d.name AS department,
          u.id AS requesterId, u.name AS requester, u.email AS requesterEmail,
          sri.item_id AS itemId, i.name AS itemName, i.sku, i.unit,
          sri.quantity AS requestedQuantity, sri.issued_quantity AS issuedQuantity,
          (sri.quantity - sri.issued_quantity) AS remainingQuantity,
          i.quantity AS availableBalance
       FROM store_requests sr
       JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       JOIN items i ON i.id = sri.item_id
       WHERE sr.status = 'Approved' AND sri.issued_quantity < sri.quantity
       ORDER BY COALESCE(sr.approved_at, sr.created_at), sr.id, sri.id`
    );
    return res.json({ requests });
  } catch (error) {
    return next(error);
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
    const duplicate = await existingIdempotent(connection, input.idempotencyKey, {
      itemId: input.itemId, movementType: 'Issue', direction: 'Out',
      quantity: input.quantity, storeRequestId
    });
    if (duplicate) {
      await connection.rollback();
      return res.json({ id: Number(duplicate.id), referenceNo: duplicate.referenceNo, balance: Number(duplicate.balance), duplicate: true });
    }
    const [[request]] = await connection.execute(
      `SELECT id, reference, requester_id AS requesterId, department_id AS departmentId, purpose
       FROM store_requests WHERE id = ? AND status = 'Approved' FOR UPDATE`,
      [storeRequestId]
    );
    if (!request) {
      await connection.rollback();
      return res.status(409).json({ message: 'Only an approved stock request can be issued.' });
    }
    const [[line]] = await connection.execute(
      `SELECT sri.quantity AS requestedQuantity, sri.issued_quantity AS issuedQuantity,
          i.id, i.name, i.quantity AS availableBalance, i.reorder_level AS minimumStock
       FROM store_request_items sri JOIN items i ON i.id = sri.item_id
       WHERE sri.store_request_id = ? AND sri.item_id = ? FOR UPDATE`,
      [storeRequestId, input.itemId]
    );
    if (!line) {
      await connection.rollback();
      return res.status(404).json({ message: 'The selected item is not part of this approved request.' });
    }
    const remaining = Number(line.requestedQuantity) - Number(line.issuedQuantity);
    if (input.quantity > remaining) {
      await connection.rollback();
      return res.status(409).json({ message: `Issue quantity exceeds the approved quantity still outstanding (${remaining}).` });
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
    const movementId = await recordMovement(connection, {
      itemId: line.id, userId: req.user.id, type: 'Issue', direction: 'Out',
      quantity: input.quantity, referenceNo: input.referenceNo, source: request.reference,
      description: input.description || request.purpose,
      requesterId: request.requesterId, receivedBy, departmentId: request.departmentId,
      storeRequestId, idempotencyKey: input.idempotencyKey, balance,
      movementAt: input.movementAt
    });
    const [[outstanding]] = await connection.execute(
      'SELECT COUNT(*) AS total FROM store_request_items WHERE store_request_id = ? AND issued_quantity < quantity',
      [storeRequestId]
    );
    const completed = Number(outstanding.total) === 0;
    if (completed) {
      await connection.execute(
        "UPDATE store_requests SET status = 'Issued', issued_at = UTC_TIMESTAMP() WHERE id = ?",
        [storeRequestId]
      );
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
    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = TRUE WHERE (user_id = ? OR user_id IS NULL) AND is_read = FALSE',
      [req.user.id]
    );
    return res.json({ updated: result.affectedRows });
  } catch (error) {
    return next(error);
  }
});

export default router;

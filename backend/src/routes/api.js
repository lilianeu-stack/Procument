import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { allowRoles, authenticate } from '../middleware/auth.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { withPortalIdentity } from '../utils/roles.js';
import { dateFilterClause, parseDateFilter } from '../utils/dates.js';
import admin from './admin.js';
import exportsRouter from './exports.js';
import stockkeeper from './stockkeeper.js';
import portal from './portal.js';
import inventoryWorkflows from './inventory-workflows.js';
import workflows from './workflows.js';
import supplier from './supplier.js';
import purchaseOrderApprovals from './purchase-order-approvals.js';
import purchaseOrderPricing, { publicRouter as supplierPricingPublicRouter } from './purchase-order-pricing.js';
import emails from './emails.js';

const router = Router();
const procurementRoles = ['admin', 'procurement'];
const approverRoles = ['admin', 'approver'];
const storeRoles = ['admin', 'storekeeper'];

router.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.password_hash, u.role, u.active,
        u.department_id AS departmentId, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.email = ? AND u.active = TRUE LIMIT 1`,
      [email]
    );
    const account = rows[0];
    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    const user = withPortalIdentity(account);
    if (!user.portal) {
      return res.status(403).json({ message: 'Your role does not have an assigned portal. Contact an administrator.' });
    }
    // Only the account ID identifies the session. Role and Department are
    // resolved from the database on every request, so stale claims cannot grant access.
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
    // Account activity is audit metadata, not login input. Record it from the
    // server clock in UTC after credentials have been verified successfully.
    await pool.execute('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
    return res.json({ token, user });
  } catch (error) {
    return next(error);
  }
});

// Token-gated Supplier quotation links and provider delivery webhooks must be
// reachable without a staff session. They are mounted before authenticate().
router.use(supplier);
// Token-gated Purchase Order review links. They are public URLs but require the
// intended registered account before any decision can be recorded.
router.use(purchaseOrderApprovals);
// Token-gated supplier pricing links are public URLs; the 256-bit token is the
// only credential and is looked up as a hash.
router.use(supplierPricingPublicRouter);

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));

// Supervisor and Requester accounts live only in their new portals. They can
// read their session, notifications, and portal data, but never the legacy
// management/workflow APIs directly, even if a URL is entered manually.
router.use((req, res, next) => {
  if (req.user.role === 'storekeeper') {
    const allowed = req.path === '/auth/me'
      || req.path === '/notifications' || req.path.startsWith('/notifications/')
      || req.path === '/portal/stockkeeper' || req.path.startsWith('/portal/stockkeeper/');
    if (allowed) return next();
    return res.status(403).json({ message: 'This area is not available in your portal.' });
  }
  if (!['supervisor', 'requestor'].includes(req.user.role)) return next();
  const allowed = req.path === '/auth/me'
    || req.path === '/notifications' || req.path.startsWith('/notifications/')
    || req.path === '/exports' || req.path.startsWith('/exports/')
    || req.path === '/portal' || req.path.startsWith('/portal/');
  if (allowed) return next();
  return res.status(403).json({ message: 'This area is not available in your portal.' });
});

router.use('/portal/stockkeeper', stockkeeper);
router.use('/portal', portal);
router.use('/exports', exportsRouter);

router.get('/dashboard', async (req, res, next) => {
  try {
    const [[requisitionStats]] = await pool.query(
      `SELECT COUNT(*) AS total,
        SUM(status IN ('Pending', 'Pending Supervisor Approval')) AS pending,
        SUM(status IN ('Approved', 'Approved by Supervisor', 'Forwarded to Procurement')) AS approved,
        SUM(status = 'Forwarded to Procurement') AS forwarded,
        SUM(status = 'Under Procurement Review') AS underReview
       FROM requisitions`
    );
    const [[inventoryStats]] = await pool.query(
      'SELECT COUNT(*) AS items, SUM(quantity <= reorder_level) AS lowStock FROM items'
    );
    const [recent] = await pool.query(
      `SELECT r.id, r.reference, r.status, r.created_at AS createdAt, u.name AS requester,
        d.name AS department,
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total
       FROM requisitions r
       JOIN users u ON u.id = r.requester_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
       GROUP BY r.id ORDER BY r.created_at DESC LIMIT 6`
    );
    const [[supplierStats]] = await pool.query("SELECT COUNT(*) AS active FROM suppliers WHERE status = 'Active'");
    return res.json({ requisitions: requisitionStats, inventory: inventoryStats, suppliers: supplierStats, recent });
  } catch (error) {
    return next(error);
  }
});

router.get('/requisitions', async (req, res, next) => {
  try {
    const columns = {
      created: 'r.created_at', submitted: 'r.submitted_at',
      approved: 'r.supervisor_decision_at', forwarded: 'r.forwarded_at',
      required: 'r.required_by'
    };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'created' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [rows] = await pool.query(
      `SELECT r.id, r.reference, r.title, r.status, r.justification, r.budget_code AS budgetCode,
        r.priority, r.required_by AS requiredBy, r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
        r.supervisor_decision_at AS supervisorDecisionAt, r.procurement_decision_at AS procurementDecisionAt,
        r.completed_at AS completedAt,
        r.created_at AS createdAt, r.updated_at AS updatedAt, u.name AS requester, d.name AS department,
        su.name AS supervisorName, r.supervisor_decision AS supervisorDecision,
        r.supervisor_notes AS supervisorNotes,
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total,
        GROUP_CONCAT(CONCAT(ri.item_name, ' (', ri.quantity, ')') ORDER BY ri.id SEPARATOR ', ') AS items
       FROM requisitions r JOIN users u ON u.id = r.requester_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users su ON su.id = r.supervisor_id
       LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
       WHERE 1 = 1 ${clause}
       GROUP BY r.id ORDER BY COALESCE(r.submitted_at, r.created_at) DESC`,
      params
    );
    return res.json({ requisitions: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/requisitions', async (req, res, next) => {
  const { justification, budgetCode } = req.body;
  const items = Array.isArray(req.body.items) ? req.body.items : [{
    itemName: req.body.itemName,
    quantity: req.body.quantity,
    estimatedUnitCost: req.body.estimatedUnitCost
  }];
  const validatedItems = items.map((item) => ({
    itemName: String(item.itemName || '').trim(),
    quantity: Number(item.quantity),
    estimatedUnitCost: Number(item.estimatedUnitCost || 0)
  }));
  if (!validatedItems.length || validatedItems.some((item) =>
    !item.itemName || !Number.isInteger(item.quantity) || item.quantity < 1 ||
    !Number.isFinite(item.estimatedUnitCost) || item.estimatedUnitCost < 0
  ) || !String(justification || '').trim() || !String(budgetCode || '').trim()) {
    return res.status(400).json({ message: 'Add an item, positive quantity, justification, and budget code.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userRows] = await connection.execute('SELECT department_id FROM users WHERE id = ?', [req.user.id]);
    const reference = `PR-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const [result] = await connection.execute(
      'INSERT INTO requisitions (reference, requester_id, department_id, justification, budget_code) VALUES (?, ?, ?, ?, ?)',
      [reference, req.user.id, userRows[0]?.department_id || null, String(justification).trim(), String(budgetCode).trim()]
    );
    for (const item of validatedItems) {
      await connection.execute(
        'INSERT INTO requisition_items (requisition_id, item_name, quantity, estimated_unit_cost) VALUES (?, ?, ?, ?)',
        [result.insertId, item.itemName, item.quantity, item.estimatedUnitCost]
      );
    }
    await writeAudit(connection, req.user.id, 'submitted', 'requisition', result.insertId, { reference });
    await createNotification(connection, null, 'Purchase requisition submitted', `${reference} is waiting for approval.`, '/approvals');
    await connection.commit();
    return res.status(201).json({ message: 'Requisition submitted for approval.', reference, id: result.insertId });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch('/requisitions/:id/decision', allowRoles(...approverRoles), async (req, res, next) => {
  const { decision } = req.body;
  if (!['Approved', 'Rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE requisitions
         SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(),
             supervisor_decision = ?, supervisor_decision_at = UTC_TIMESTAMP()
       WHERE id = ? AND status = 'Pending'`,
      [decision, req.user.id, decision, req.params.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending requisition not found.' });
    }
    const [[request]] = await connection.execute('SELECT reference, requester_id FROM requisitions WHERE id = ?', [req.params.id]);
    await writeAudit(
      connection, req.user.id, decision.toLowerCase(), 'requisition', req.params.id,
      {}, { previousStatus: 'Pending', newStatus: decision }
    );
    await createNotification(connection, request.requester_id, `Requisition ${decision.toLowerCase()}`, `${request.reference} was ${decision.toLowerCase()}.`, '/requisitions');
    await connection.commit();
    return res.json({ message: `Requisition ${decision.toLowerCase()}.` });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

// ---------------------------------------------------------------------------
// Requests received from Departments
//
// These endpoints are the only way Procurement can read Department requests.
// Every query is anchored on forwarded_by_supervisor IS NOT NULL, so approvals,
// drafts, rejections and information-required requests can never leak here,
// regardless of what the client sends or which URL is called directly.
// ---------------------------------------------------------------------------

function receivedPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

const RECEIVED_SORT_FIELDS = {
  reference: 'q.reference',
  department: 'q.department',
  requester: 'q.requester',
  supervisor: 'q.supervisorName',
  title: 'q.title',
  submittedAt: 'q.submittedAt',
  forwardedAt: 'q.forwardedAt',
  total: 'q.total',
  status: 'q.status'
};

function receivedListQuery() {
  return `
    SELECT r.id, r.reference, r.title, r.location, r.justification, r.status, r.priority,
      r.budget_code AS budgetCode, r.required_by AS requiredBy,
      r.created_at AS createdAt, r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
      r.supervisor_decision AS supervisorDecision,
      r.supervisor_decision_at AS supervisorDecisionAt,
      r.supervisor_notes AS supervisorNotes,
      r.department_id AS departmentId, d.name AS department,
      r.requester_id AS requesterId, u.name AS requester, u.email AS requesterEmail, u.phone AS requesterPhone,
      r.supervisor_id AS supervisorId, su.name AS supervisorName,
      r.forwarded_by_supervisor AS forwardedBySupervisor, fwd.name AS forwardedByName,
      fwd_d.name AS supervisorDepartment,
      COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total,
      COUNT(DISTINCT ra.id) AS attachmentCount
    FROM requisitions r
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN users su ON su.id = r.supervisor_id
    LEFT JOIN users fwd ON fwd.id = r.forwarded_by_supervisor
    LEFT JOIN departments fwd_d ON fwd_d.id = fwd.department_id
    LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
    LEFT JOIN requisition_attachments ra ON ra.requisition_id = r.id
    WHERE r.forwarded_by_supervisor IS NOT NULL AND r.forwarded_at IS NOT NULL
    GROUP BY r.id`;
}

function mapReceivedRow(row) {
  return {
    ...row,
    title: row.title || `${row.reference} procurement request`,
    total: Number(row.total) || 0,
    attachmentCount: Number(row.attachmentCount) || 0,
    forwardedBySupervisor: row.forwardedBySupervisor == null ? null : Number(row.forwardedBySupervisor)
  };
}

router.get('/procurement/departments', allowRoles(...procurementRoles), async (_req, res, next) => {
  try {
    const [departments] = await pool.query('SELECT id, name FROM departments ORDER BY name');
    return res.json({ departments });
  } catch (error) { return next(error); }
});

router.get('/procurement/received-requests', allowRoles(...procurementRoles), async (req, res, next) => {
  try {
    const page = receivedPositiveInt(req.query.page, 1);
    const limit = Math.min(receivedPositiveInt(req.query.limit, 10), 100);
    const where = [];
    const params = [];
    const search = String(req.query.search || '').trim().slice(0, 120);
    if (search) {
      const pattern = `%${search}%`;
      where.push('(q.reference LIKE ? OR q.title LIKE ? OR q.requester LIKE ? OR q.supervisorName LIKE ? OR q.department LIKE ? OR q.justification LIKE ?)');
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const department = String(req.query.department || '').trim().slice(0, 120);
    if (department) { where.push('q.department = ?'); params.push(department); }
    const status = String(req.query.status || '').trim().slice(0, 60);
    if (status) { where.push('q.status = ?'); params.push(status); }
    const columns = {
      forwarded: 'q.forwardedAt', submitted: 'q.submittedAt',
      created: 'q.createdAt', approved: 'q.supervisorDecisionAt'
    };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'forwarded' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    if (filter.from) { where.push(`${columns[filter.field]} >= ?`); params.push(filter.from); }
    if (filter.to) { where.push(`${columns[filter.field]} <= ?`); params.push(filter.to); }

    const base = `SELECT * FROM (${receivedListQuery()}) q ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM (${base}) counted`, params);
    const sort = RECEIVED_SORT_FIELDS[String(req.query.sort || '')] || 'q.forwardedAt';
    const direction = String(req.query.direction || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const [rows] = await pool.execute(
      `${base} ORDER BY ${sort} ${direction}, q.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const total = Number(countRow?.total) || 0;
    return res.json({
      requisitions: rows.map(mapReceivedRow),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) { return next(error); }
});

async function markReceivedByProcurement(connection, requisitionId, userId) {
  await connection.execute(
    `INSERT INTO requisition_activity (requisition_id, user_id, action, details)
      SELECT ?, ?, 'received_by_procurement', JSON_OBJECT('destination', 'Procurement')
      WHERE NOT EXISTS (
        SELECT 1 FROM requisition_activity
        WHERE requisition_id = ? AND action = 'received_by_procurement'
      )`,
    [requisitionId, userId, requisitionId]
  );
}

router.get('/procurement/received-requests/:id', allowRoles(...procurementRoles), async (req, res, next) => {
  const requisitionId = Number(req.params.id);
  if (!Number.isInteger(requisitionId) || requisitionId < 1) {
    return res.status(400).json({ message: 'Invalid request identifier.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT q.* FROM (${receivedListQuery()}) q WHERE q.id = ? LIMIT 1`,
      [requisitionId]
    );
    const requisition = rows[0];
    if (!requisition) {
      await connection.rollback();
      return res.status(404).json({ message: 'Forwarded request not found.' });
    }
    await markReceivedByProcurement(connection, requisitionId, req.user.id);
    const [items] = await connection.execute(
      `SELECT id, item_name AS itemName, description, remarks, quantity, unit,
        estimated_unit_cost AS estimatedUnitCost,
        (quantity * estimated_unit_cost) AS lineTotal
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [requisitionId]
    );
    const [attachments] = await connection.execute(
      `SELECT id, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize,
        created_at AS createdAt, uploader_id AS uploaderId
       FROM requisition_attachments WHERE requisition_id = ? ORDER BY id`,
      [requisitionId]
    );
    const [activity] = await connection.execute(
      `SELECT id, action, details,
        previous_status AS previousStatus, new_status AS newStatus,
        created_at AS createdAt,
        (SELECT name FROM users WHERE users.id = requisition_activity.user_id) AS actor
       FROM requisition_activity WHERE requisition_id = ? ORDER BY created_at ASC, id ASC`,
      [requisitionId]
    );
    const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    await connection.commit();
    return res.json({
      requisition: {
        ...mapReceivedRow(requisition),
        items: items.map((item) => ({ ...item, estimatedUnitCost: Number(item.estimatedUnitCost), lineTotal: Number(item.lineTotal) })),
        attachments,
        activity: activity.map((entry) => ({
          ...entry,
          details: typeof entry.details === 'string' ? JSON.parse(entry.details) : (entry.details || {})
        })),
        financials: { subtotal, taxes: 0, otherCosts: 0, grandTotal: subtotal }
      }
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/procurement/received-requests/:id/review', allowRoles(...procurementRoles), async (req, res, next) => {
  const requisitionId = Number(req.params.id);
  if (!Number.isInteger(requisitionId) || requisitionId < 1) {
    return res.status(400).json({ message: 'Invalid request identifier.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[forwarded]] = await connection.execute(
      'SELECT id, reference FROM requisitions WHERE id = ? AND forwarded_by_supervisor IS NOT NULL LIMIT 1',
      [requisitionId]
    );
    if (!forwarded) {
      await connection.rollback();
      return res.status(404).json({ message: 'Forwarded request not found.' });
    }
    await markReceivedByProcurement(connection, requisitionId, req.user.id);
    await connection.execute(
      `INSERT INTO requisition_activity (requisition_id, user_id, action, details)
       VALUES (?, ?, 'procurement_review_started', JSON_OBJECT('reviewer', ?, 'reference', ?))`,
      [requisitionId, req.user.id, req.user.name, forwarded.reference]
    );
    await writeAudit(connection, req.user.id, 'reviewed', 'requisition', requisitionId, { reference: forwarded.reference });
    await connection.commit();
    return res.json({ message: 'Review recorded. You can continue Procurement processing.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/procurement/received-requests/:id/attachments/:attachmentId', allowRoles(...procurementRoles), async (req, res, next) => {
  const requisitionId = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(requisitionId) || requisitionId < 1 ||
      !Number.isInteger(attachmentId) || attachmentId < 1) {
    return res.status(400).json({ message: 'Invalid attachment identifier.' });
  }
  try {
    const [[forwarded]] = await pool.execute(
      'SELECT id FROM requisitions WHERE id = ? AND forwarded_by_supervisor IS NOT NULL AND forwarded_at IS NOT NULL LIMIT 1',
      [requisitionId]
    );
    if (!forwarded) return res.status(404).json({ message: 'Forwarded request not found.' });
    const [rows] = await pool.execute(
      `SELECT file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, file_data AS fileData
       FROM requisition_attachments WHERE id = ? AND requisition_id = ? LIMIT 1`,
      [attachmentId, requisitionId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Attachment not found.' });
    const disposition = String(req.query.inline || '') === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', rows[0].mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${String(rows[0].fileName).replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Content-Length', rows[0].fileSize);
    return res.send(rows[0].fileData);
  } catch (error) { return next(error); }
});

router.get('/inventory', async (req, res, next) => {
  try {
    const columns = { updated: 'i.updated_at' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'updated' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [items] = await pool.query(
      `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity,
        i.reorder_level AS reorderLevel, i.unit_cost AS unitCost,
        i.updated_at AS updatedAt
       FROM items i WHERE 1 = 1 ${clause} ORDER BY i.name`,
      params
    );
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

router.get('/inventory/categories', async (_req, res, next) => {
  try {
    const [categories] = await pool.query('SELECT DISTINCT category AS name FROM items ORDER BY category');
    return res.json({ categories });
  } catch (error) {
    return next(error);
  }
});

router.post('/inventory/items', allowRoles('admin', 'storekeeper'), async (req, res, next) => {
  const sku = String(req.body.sku || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const unit = String(req.body.unit || 'unit').trim();
  const reorderLevel = Number(req.body.reorderLevel ?? 10);
  const unitCost = Number(req.body.unitCost ?? 0);
  if (!sku || !name || !category || !unit ||
      !Number.isInteger(reorderLevel) || reorderLevel < 0 ||
      !Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ message: 'Enter a SKU, item name, category, unit, non-negative reorder level, and valid unit cost.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO items (sku, name, category, unit, reorder_level, unit_cost) VALUES (?, ?, ?, ?, ?, ?)',
      [sku, name, category, unit, reorderLevel, unitCost]
    );
    await writeAudit(connection, req.user.id, 'created', 'inventory_item', result.insertId, { sku, name });
    await connection.commit();
    return res.status(201).json({ id: result.insertId, message: 'Inventory item created.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch('/inventory/items/:id', allowRoles('admin', 'storekeeper'), async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const reorderLevel = Number(req.body.reorderLevel);
  const unitCost = Number(req.body.unitCost);
  if (!name || !category || !Number.isInteger(reorderLevel) || reorderLevel < 0 ||
      !Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ message: 'Enter a name, category, non-negative reorder level, and valid unit cost.' });
  }
  try {
    const [[item]] = await pool.execute('SELECT id FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ message: 'Inventory item not found.' });
    await pool.execute(
      'UPDATE items SET name = ?, category = ?, reorder_level = ?, unit_cost = ? WHERE id = ?',
      [name, category, reorderLevel, unitCost, req.params.id]
    );
    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'updated', 'inventory_item', req.params.id, JSON.stringify({ name, category, reorderLevel, unitCost })]
    );
    return res.json({ message: 'Inventory item updated.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/inventory/receipts', allowRoles(...storeRoles), async (req, res, next) => {
  const itemId = Number(req.body.itemId);
  const quantity = Number(req.body.quantity);
  const source = String(req.body.source || '').trim();
  if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || !source) {
    return res.status(400).json({ message: 'Choose an item, enter a positive quantity, and specify the source.' });
  }
  const connection = await pool.getConnection();
  const referenceNo = `RCV-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
  try {
    await connection.beginTransaction();
    const [items] = await connection.execute('SELECT id, quantity FROM items WHERE id = ? FOR UPDATE', [itemId]);
    if (!items.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    const balance = items[0].quantity + quantity;
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, itemId]);
    await connection.execute(
      "INSERT INTO inventory_movements (item_id, user_id, movement_type, direction, quantity, reference_no, source, balance_after, movement_at) VALUES (?, ?, 'Receipt', 'In', ?, ?, ?, ?, UTC_TIMESTAMP())",
      [itemId, req.user.id, quantity, referenceNo, source, balance]
    );
    const [stockkeepers] = await connection.execute(
      "SELECT id FROM users WHERE role = 'storekeeper' AND active = TRUE"
    );
    for (const stockkeeper of stockkeepers) {
      await createNotification(
        connection, stockkeeper.id, 'Stock received',
        `${quantity} units were received from ${source} · ${referenceNo}.`,
        `#/stockkeeper/Bin%20Card?item=${itemId}`, 'stock_in'
      );
    }
    await writeAudit(connection, req.user.id, 'stock_in', 'inventory_item', itemId, {
      quantity, source, referenceNo, balance
    });
    await connection.commit();
    return res.status(201).json({ message: 'Stock receipt recorded.', referenceNo, balance });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/inventory/movements', allowRoles(...storeRoles, ...procurementRoles), async (req, res, next) => {
  try {
    const columns = { movement: 'COALESCE(m.movement_at, m.created_at)', created: 'm.created_at' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'movement' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [movements] = await pool.query(
      `SELECT m.id, m.movement_type AS type, m.quantity, m.source, m.balance_after AS balance,
        m.movement_at AS movementAt, m.created_at AS createdAt,
        i.name AS item, i.sku, u.name AS recordedBy
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE 1 = 1 ${clause}
       ORDER BY COALESCE(m.movement_at, m.created_at) DESC LIMIT 100`,
      params
    );
    return res.json({ movements });
  } catch (error) {
    return next(error);
  }
});

router.get('/suppliers', async (_req, res, next) => {
  try {
    const [suppliers] = await pool.query(
      'SELECT id, name, contact_name AS contactName, email, phone, rating, status FROM suppliers ORDER BY name'
    );
    return res.json({ suppliers });
  } catch (error) {
    return next(error);
  }
});

router.post('/suppliers', allowRoles(...procurementRoles), async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Supplier name is required.' });
  try {
    const [result] = await pool.execute(
      'INSERT INTO suppliers (name, contact_name, email, phone) VALUES (?, ?, ?, ?)',
      [name, req.body.contactName || null, req.body.email || null, req.body.phone || null]
    );
    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'created', 'supplier', String(result.insertId), JSON.stringify({ name })]
    );
    return res.status(201).json({ id: result.insertId, message: 'Supplier added.' });
  } catch (error) {
    return next(error);
  }
});

router.use(emails);
router.use(purchaseOrderPricing);
router.use(workflows);
router.use(inventoryWorkflows);
router.use('/admin', admin);

export default router;

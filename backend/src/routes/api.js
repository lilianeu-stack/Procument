import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { allowRoles, authenticate } from '../middleware/auth.js';
import { createNotification, writeAudit } from '../lib/events.js';
import admin from './admin.js';
import inventoryWorkflows from './inventory-workflows.js';
import workflows from './workflows.js';

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
      'SELECT u.id, u.name, u.email, u.password_hash, u.role, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.email = ? AND u.active = TRUE LIMIT 1',
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    const payload = { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, user: payload });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));

router.get('/dashboard', async (req, res, next) => {
  try {
    const [[requisitionStats]] = await pool.query(
      `SELECT COUNT(*) AS total,
        SUM(status = 'Pending') AS pending,
        SUM(status = 'Approved') AS approved
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
    const [rows] = await pool.query(
      `SELECT r.id, r.reference, r.status, r.justification, r.budget_code AS budgetCode,
        r.created_at AS createdAt, u.name AS requester, d.name AS department,
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total,
        GROUP_CONCAT(CONCAT(ri.item_name, ' (', ri.quantity, ')') ORDER BY ri.id SEPARATOR ', ') AS items
       FROM requisitions r JOIN users u ON u.id = r.requester_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
       GROUP BY r.id ORDER BY r.created_at DESC`
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
      "UPDATE requisitions SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'Pending'",
      [decision, req.user.id, req.params.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending requisition not found.' });
    }
    const [[request]] = await connection.execute('SELECT reference, requester_id FROM requisitions WHERE id = ?', [req.params.id]);
    await writeAudit(connection, req.user.id, decision.toLowerCase(), 'requisition', req.params.id);
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

router.get('/inventory', async (_req, res, next) => {
  try {
    const [items] = await pool.query('SELECT id, sku, name, category, unit, quantity, reorder_level AS reorderLevel, unit_cost AS unitCost FROM items ORDER BY name');
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
      "INSERT INTO inventory_movements (item_id, user_id, movement_type, quantity, source, balance_after) VALUES (?, ?, 'Receipt', ?, ?, ?)",
      [itemId, req.user.id, quantity, source, balance]
    );
    await connection.commit();
    return res.status(201).json({ message: 'Stock receipt recorded.', balance });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/inventory/movements', allowRoles(...storeRoles, ...procurementRoles), async (_req, res, next) => {
  try {
    const [movements] = await pool.query(
      `SELECT m.id, m.movement_type AS type, m.quantity, m.source, m.balance_after AS balance,
        m.created_at AS createdAt, i.name AS item, i.sku, u.name AS recordedBy
       FROM inventory_movements m JOIN items i ON i.id = m.item_id
       LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC LIMIT 100`
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

router.use(workflows);
router.use(inventoryWorkflows);
router.use('/admin', admin);

export default router;

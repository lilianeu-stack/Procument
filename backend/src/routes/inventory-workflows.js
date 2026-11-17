import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';

const router = Router();
const approvers = ['admin', 'approver'];

router.get('/store-requests', async (_req, res, next) => {
  try {
    const [requests] = await pool.query(
      `SELECT sr.id, sr.reference, sr.purpose, sr.status, sr.created_at AS createdAt,
        u.name AS requester, d.name AS department,
        GROUP_CONCAT(CONCAT(i.name, ' × ', sri.quantity) SEPARATOR ', ') AS items
       FROM store_requests sr JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       JOIN items i ON i.id = sri.item_id
       GROUP BY sr.id ORDER BY sr.created_at DESC`
    );
    return res.json({ storeRequests: requests });
  } catch (error) { return next(error); }
});

router.post('/store-requests', async (req, res, next) => {
  const itemId = Number(req.body.itemId);
  const quantity = Number(req.body.quantity);
  const purpose = String(req.body.purpose || '').trim();
  if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || !purpose) {
    return res.status(400).json({ message: 'Choose an item, positive quantity, and purpose.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[item]] = await connection.execute('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item) {
      await connection.rollback();
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    const [[requester]] = await connection.execute('SELECT department_id FROM users WHERE id = ?', [req.user.id]);
    const reference = `SR-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const [result] = await connection.execute(
      'INSERT INTO store_requests (reference, requester_id, department_id, purpose) VALUES (?, ?, ?, ?)',
      [reference, req.user.id, requester?.department_id || null, purpose]
    );
    await connection.execute(
      'INSERT INTO store_request_items (store_request_id, item_id, quantity) VALUES (?, ?, ?)',
      [result.insertId, itemId, quantity]
    );
    await writeAudit(connection, req.user.id, 'submitted', 'store_request', result.insertId, { reference });
    await createNotification(connection, null, 'Store request submitted', `${reference} is waiting for supervisor approval.`, '/store-requests');
    await connection.commit();
    return res.status(201).json({ id: result.insertId, reference, message: 'Store request submitted for approval.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch('/store-requests/:id/decision', allowRoles(...approvers), async (req, res, next) => {
  const decision = req.body.decision;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "UPDATE store_requests SET status = ?, reviewed_by = ? WHERE id = ? AND status = 'Pending'",
      [decision, req.user.id, req.params.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending store request not found.' });
    }
    const [[request]] = await connection.execute('SELECT reference, requester_id FROM store_requests WHERE id = ?', [req.params.id]);
    await writeAudit(connection, req.user.id, decision.toLowerCase(), 'store_request', req.params.id);
    await createNotification(connection, request.requester_id, `Store request ${decision.toLowerCase()}`, `${request.reference} was ${decision.toLowerCase()}.`, '/store-requests');
    await connection.commit();
    return res.json({ message: `Store request ${decision.toLowerCase()}.` });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.post('/store-requests/:id/issue', allowRoles('admin', 'storekeeper'), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute(
      "SELECT id, reference, requester_id FROM store_requests WHERE id = ? AND status = 'Approved' FOR UPDATE",
      [req.params.id]
    );
    if (!request) {
      await connection.rollback();
      return res.status(409).json({ message: 'Only an approved store request can be issued.' });
    }
    const [lines] = await connection.execute(
      'SELECT sri.id, sri.item_id, sri.quantity, i.name, i.quantity AS stock FROM store_request_items sri JOIN items i ON i.id = sri.item_id WHERE sri.store_request_id = ? FOR UPDATE',
      [request.id]
    );
    const unavailable = lines.find((line) => line.stock < line.quantity);
    if (unavailable) {
      await connection.rollback();
      return res.status(409).json({ message: `Insufficient stock for ${unavailable.name}. Available: ${unavailable.stock}.` });
    }
    for (const line of lines) {
      const balance = line.stock - line.quantity;
      await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, line.item_id]);
      await connection.execute('UPDATE store_request_items SET issued_quantity = quantity WHERE id = ?', [line.id]);
      await connection.execute(
        "INSERT INTO inventory_movements (item_id, user_id, movement_type, quantity, source, balance_after) VALUES (?, ?, 'Issue', ?, ?, ?)",
        [line.item_id, req.user.id, line.quantity, request.reference, balance]
      );
    }
    await connection.execute("UPDATE store_requests SET status = 'Issued' WHERE id = ?", [request.id]);
    await writeAudit(connection, req.user.id, 'issued', 'store_request', request.id, { lineCount: lines.length });
    await createNotification(connection, request.requester_id, 'Store request issued', `${request.reference} has been issued from inventory.`, '/store-requests');
    await connection.commit();
    return res.json({ message: 'Stock issued and inventory updated.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

export default router;

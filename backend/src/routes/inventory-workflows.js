import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { businessDate, dateFilterClause, parseDateFilter } from '../utils/dates.js';

const router = Router();
const approvers = ['admin', 'approver'];

router.get('/store-requests', async (req, res, next) => {
  try {
    const columns = {
      submitted: 'sr.submitted_at', approved: 'sr.approved_at',
      issued: 'sr.issued_at', required: 'sr.required_by', created: 'sr.created_at'
    };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'submitted' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [requests] = await pool.query(
      `SELECT sr.id, sr.reference, sr.purpose, sr.status,
        sr.required_by AS requiredBy, sr.submitted_at AS submittedAt,
        sr.approved_at AS approvedAt, sr.issued_at AS issuedAt,
        sr.created_at AS createdAt, sr.updated_at AS updatedAt,
        u.name AS requester, d.name AS department,
        GROUP_CONCAT(CONCAT(i.name, ' × ', sri.quantity) SEPARATOR ', ') AS items
       FROM store_requests sr JOIN users u ON u.id = sr.requester_id
       LEFT JOIN departments d ON d.id = sr.department_id
       JOIN store_request_items sri ON sri.store_request_id = sr.id
       JOIN items i ON i.id = sri.item_id
       WHERE 1 = 1 ${clause}
       GROUP BY sr.id ORDER BY COALESCE(sr.submitted_at, sr.created_at) DESC`,
      params
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
  let requiredBy;
  try {
    requiredBy = businessDate(req.body.requiredBy, 'Required by date', { allowPast: false });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
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
      `INSERT INTO store_requests
         (reference, requester_id, department_id, purpose, required_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [reference, req.user.id, requester?.department_id || null, purpose, requiredBy]
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
      `UPDATE store_requests
         SET status = ?, reviewed_by = ?, approved_at = IF(?, UTC_TIMESTAMP(), approved_at)
       WHERE id = ? AND status = 'Pending'`,
      [decision, req.user.id, decision === 'Approved' ? 1 : 0, req.params.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending store request not found.' });
    }
    const [[request]] = await connection.execute('SELECT reference, requester_id FROM store_requests WHERE id = ?', [req.params.id]);
    await writeAudit(
      connection, req.user.id, decision.toLowerCase(), 'store_request', req.params.id,
      {}, { previousStatus: 'Pending', newStatus: decision }
    );
    await createNotification(connection, request.requester_id, `Store request ${decision.toLowerCase()}`, `${request.reference} was ${decision.toLowerCase()}.`, '/store-requests');
    if (decision === 'Approved') {
      const [stockkeepers] = await connection.execute(
        "SELECT id FROM users WHERE role = 'storekeeper' AND active = TRUE"
      );
      for (const stockkeeper of stockkeepers) {
        await createNotification(
          connection, stockkeeper.id, 'Approved request ready for issue',
          `${request.reference} is approved and ready for stock issuance.`,
          `#/stockkeeper/Bin%20Card?request=${req.params.id}`, 'stock_request'
        );
      }
    }
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
      "SELECT id, reference, requester_id, department_id FROM store_requests WHERE id = ? AND status = 'Approved' FOR UPDATE",
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
      const movementReference = `ISS-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
      await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, line.item_id]);
      await connection.execute('UPDATE store_request_items SET issued_quantity = quantity WHERE id = ?', [line.id]);
      await connection.execute(
        "INSERT INTO inventory_movements (item_id, user_id, movement_type, direction, quantity, reference_no, source, requester_id, department_id, store_request_id, balance_after, movement_at) VALUES (?, ?, 'Issue', 'Out', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())",
        [line.item_id, req.user.id, line.quantity, movementReference, request.reference, request.requester_id, request.department_id, request.id, balance]
      );
    }
    await connection.execute("UPDATE store_requests SET status = 'Issued', issued_at = UTC_TIMESTAMP() WHERE id = ?", [request.id]);
    await writeAudit(
      connection, req.user.id, 'issued', 'store_request', request.id,
      { lineCount: lines.length }, { previousStatus: 'Approved', newStatus: 'Issued' }
    );
    await createNotification(connection, request.requester_id, 'Store request issued', `${request.reference} has been issued from inventory.`, '/store-requests');
    await connection.commit();
    return res.json({ message: 'Stock issued and inventory updated.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

export default router;

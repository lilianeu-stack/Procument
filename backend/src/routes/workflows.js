import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';

const router = Router();
const procurement = ['admin', 'procurement'];
const approvers = ['admin', 'approver'];
const committee = ['admin', 'committee'];
const finance = ['admin', 'finance'];
const stores = ['admin', 'storekeeper', 'procurement'];

function reference(prefix) {
  return `${prefix}-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function transaction(handler, res, next) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

router.get('/rfqs', async (_req, res, next) => {
  try {
    const [rfqs] = await pool.query(
      `SELECT f.id, f.reference, f.status, f.due_date AS dueDate, f.created_at AS createdAt,
        r.reference AS requisition, r.id AS requisitionId, q.supplier_id AS selectedSupplierId,
        s.name AS selectedSupplier, COUNT(DISTINCT fs.supplier_id) AS invitedSuppliers,
        COUNT(DISTINCT qt.id) AS quotations
       FROM rfqs f JOIN requisitions r ON r.id = f.requisition_id
       LEFT JOIN rfq_suppliers fs ON fs.rfq_id = f.id
       LEFT JOIN quotations qt ON qt.rfq_id = f.id
       LEFT JOIN quotations q ON q.id = f.selected_quotation_id
       LEFT JOIN suppliers s ON s.id = q.supplier_id
       GROUP BY f.id ORDER BY f.created_at DESC`
    );
    return res.json({ rfqs });
  } catch (error) { return next(error); }
});

router.post('/rfqs', allowRoles(...procurement), async (req, res, next) => {
  const requisitionId = Number(req.body.requisitionId);
  const supplierIds = [...new Set((Array.isArray(req.body.supplierIds) ? req.body.supplierIds : []).map(Number))];
  if (!Number.isInteger(requisitionId) || supplierIds.length < 2 ||
      supplierIds.some((id) => !Number.isInteger(id) || id < 1)) {
    return res.status(400).json({ message: 'Select an approved requisition and at least two valid suppliers.' });
  }
  return transaction(async (connection) => {
    const [requests] = await connection.execute(
      "SELECT id, reference FROM requisitions WHERE id = ? AND status = 'Approved' FOR UPDATE",
      [requisitionId]
    );
    if (!requests.length) {
      const error = new Error('An approved requisition is required to create an RFQ.');
      error.status = 409;
      throw error;
    }
    const placeholders = supplierIds.map(() => '?').join(',');
    const [suppliers] = await connection.execute(
      `SELECT id FROM suppliers WHERE status = 'Active' AND id IN (${placeholders})`,
      supplierIds
    );
    if (suppliers.length !== supplierIds.length) {
      const error = new Error('One or more selected suppliers are unavailable.');
      error.status = 400;
      throw error;
    }
    const rfqReference = reference('RFQ');
    const [result] = await connection.execute(
      'INSERT INTO rfqs (reference, requisition_id, due_date, created_by) VALUES (?, ?, ?, ?)',
      [rfqReference, requisitionId, req.body.dueDate || null, req.user.id]
    );
    for (const supplierId of supplierIds) {
      await connection.execute('INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES (?, ?)', [result.insertId, supplierId]);
    }
    await connection.execute("UPDATE requisitions SET status = 'In procurement' WHERE id = ?", [requisitionId]);
    await writeAudit(connection, req.user.id, 'created', 'rfq', result.insertId, { reference: rfqReference });
    await createNotification(connection, null, 'New request for quotation', `${rfqReference} was issued to ${supplierIds.length} suppliers.`, `/rfqs/${result.insertId}`);
    return { status: 201, body: { id: result.insertId, reference: rfqReference, message: 'RFQ sent to selected suppliers.' } };
  }, res, next);
});

router.get('/rfqs/:id/quotations', async (req, res, next) => {
  try {
    const [quotations] = await pool.execute(
      `SELECT q.id, q.rfq_id AS rfqId, q.supplier_id AS supplierId, s.name AS supplier,
        q.amount, q.delivery_days AS deliveryDays, q.quality_score AS qualityScore,
        q.rating_score AS ratingScore, q.notes, q.created_at AS submittedAt,
        (rf.selected_quotation_id = q.id) AS selected
       FROM quotations q JOIN suppliers s ON s.id = q.supplier_id
       JOIN rfqs rf ON rf.id = q.rfq_id WHERE q.rfq_id = ? ORDER BY q.amount, q.delivery_days`,
      [req.params.id]
    );
    return res.json({ quotations });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/quotations', allowRoles(...committee, ...procurement), async (req, res, next) => {
  const supplierId = Number(req.body.supplierId);
  const amount = Number(req.body.amount);
  const deliveryDays = Number(req.body.deliveryDays);
  const qualityScore = Number(req.body.qualityScore);
  const ratingScore = Number(req.body.ratingScore);
  if (!Number.isInteger(supplierId) || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isInteger(deliveryDays) || deliveryDays < 1 ||
      !Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 5 ||
      !Number.isFinite(ratingScore) || ratingScore < 0 || ratingScore > 5) {
    return res.status(400).json({ message: 'Enter a positive amount and delivery time, plus quality and rating scores from 0 to 5.' });
  }
  try {
    const [[rfq]] = await pool.execute(
      "SELECT id FROM rfqs WHERE id = ? AND status IN ('Sent', 'Evaluating')",
      [req.params.id]
    );
    if (!rfq) return res.status(404).json({ message: 'Open RFQ not found.' });
    const [[invited]] = await pool.execute(
      'SELECT supplier_id FROM rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?',
      [req.params.id, supplierId]
    );
    if (!invited) return res.status(400).json({ message: 'This supplier was not invited to the RFQ.' });
    const [result] = await pool.execute(
      `INSERT INTO quotations (rfq_id, supplier_id, amount, delivery_days, quality_score, rating_score, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, supplierId, amount, deliveryDays, qualityScore, ratingScore, String(req.body.notes || '').trim() || null]
    );
    await pool.execute("UPDATE rfqs SET status = 'Evaluating' WHERE id = ?", [req.params.id]);
    return res.status(201).json({ id: result.insertId, message: 'Quotation recorded.' });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/award', allowRoles(...committee), async (req, res, next) => {
  const quotationId = Number(req.body.quotationId);
  if (!Number.isInteger(quotationId)) return res.status(400).json({ message: 'Choose a quotation to award.' });
  return transaction(async (connection) => {
    const [[quote]] = await connection.execute(
      `SELECT q.id, q.rfq_id, q.supplier_id, rf.reference
       FROM quotations q JOIN rfqs rf ON rf.id = q.rfq_id
       WHERE q.id = ? AND q.rfq_id = ? AND rf.status IN ('Sent', 'Evaluating') FOR UPDATE`,
      [quotationId, req.params.id]
    );
    if (!quote) {
      const error = new Error('The quotation is not available for this RFQ.');
      error.status = 404;
      throw error;
    }
    await connection.execute("UPDATE rfqs SET selected_quotation_id = ?, status = 'Awarded' WHERE id = ?", [quotationId, req.params.id]);
    await writeAudit(connection, req.user.id, 'awarded', 'rfq', req.params.id, { quotationId });
    await createNotification(connection, null, 'Quotation evaluation complete', `${quote.reference} has a recommended supplier and is ready for purchase order creation.`, `/rfqs/${req.params.id}`);
    return { body: { message: 'Supplier selected. Procurement can now prepare the purchase order.' } };
  }, res, next);
});

router.get('/purchase-orders', async (_req, res, next) => {
  try {
    const [orders] = await pool.query(
      `SELECT p.id, p.reference, p.total, p.status, p.delivery_date AS deliveryDate,
        p.created_at AS createdAt, s.name AS supplier, r.reference AS requisition,
        f.reference AS rfq,
        (SELECT GROUP_CONCAT(CONCAT(poi.item_name, ' × ', poi.quantity, ' @ ', FORMAT(poi.unit_price, 2)) SEPARATOR ', ')
         FROM purchase_order_items poi WHERE poi.purchase_order_id = p.id) AS items
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
       JOIN rfqs f ON f.id = p.rfq_id JOIN requisitions r ON r.id = f.requisition_id
       ORDER BY p.created_at DESC`
    );
    return res.json({ purchaseOrders: orders });
  } catch (error) { return next(error); }
});

router.post('/purchase-orders', allowRoles(...procurement), async (req, res, next) => {
  const rfqId = Number(req.body.rfqId);
  if (!Number.isInteger(rfqId)) return res.status(400).json({ message: 'Choose an awarded RFQ.' });
  return transaction(async (connection) => {
    const [[rfq]] = await connection.execute(
      `SELECT f.id, f.reference, f.requisition_id, f.selected_quotation_id,
        q.supplier_id, q.amount
       FROM rfqs f JOIN quotations q ON q.id = f.selected_quotation_id
       WHERE f.id = ? AND f.status = 'Awarded' FOR UPDATE`,
      [rfqId]
    );
    if (!rfq) {
      const error = new Error('Only an awarded RFQ can be converted to a purchase order.');
      error.status = 409;
      throw error;
    }
    const [[existing]] = await connection.execute('SELECT id FROM purchase_orders WHERE rfq_id = ?', [rfqId]);
    if (existing) {
      const error = new Error('A purchase order already exists for this RFQ.');
      error.status = 409;
      throw error;
    }
    const poReference = reference('PO');
    const [result] = await connection.execute(
      `INSERT INTO purchase_orders
       (reference, rfq_id, quotation_id, supplier_id, total, delivery_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [poReference, rfqId, rfq.selected_quotation_id, rfq.supplier_id, rfq.amount, req.body.deliveryDate || null, req.user.id]
    );
    const [requestLines] = await connection.execute(
      'SELECT item_name, quantity, estimated_unit_cost AS estimatedUnitCost FROM requisition_items WHERE requisition_id = ? ORDER BY id',
      [rfq.requisition_id]
    );
    if (!requestLines.length) {
      const error = new Error('The requisition has no items to put on the purchase order.');
      error.status = 409;
      throw error;
    }
    const totalUnits = requestLines.reduce((sum, line) => sum + line.quantity, 0);
    const estimateTotal = requestLines.reduce((sum, line) => sum + line.quantity * line.estimatedUnitCost, 0);
    const totalCents = Math.round(rfq.amount * 100);
    let remainingCents = totalCents;
    for (const [index, line] of requestLines.entries()) {
      const weight = estimateTotal > 0
        ? line.quantity * line.estimatedUnitCost / estimateTotal
        : line.quantity / totalUnits;
      const lineCents = index === requestLines.length - 1
        ? remainingCents
        : Math.round(totalCents * weight);
      remainingCents -= lineCents;
      const lineTotal = lineCents / 100;
      const unitPrice = lineTotal / line.quantity;
      await connection.execute(
        'INSERT INTO purchase_order_items (purchase_order_id, item_name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, line.item_name, line.quantity, unitPrice, lineTotal]
      );
    }
    await writeAudit(connection, req.user.id, 'created', 'purchase_order', result.insertId, { reference: poReference });
    await createNotification(connection, null, 'Purchase order prepared', `${poReference} is awaiting approval.`, `/purchase-orders/${result.insertId}`);
    return { status: 201, body: { id: result.insertId, reference: poReference, message: 'Purchase order submitted for approval.' } };
  }, res, next);
});

router.patch('/purchase-orders/:id/decision', allowRoles(...approvers), async (req, res, next) => {
  const decision = req.body.decision;
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE purchase_orders SET status = ?, reviewed_by = ? WHERE id = ? AND status = 'Pending approval'",
      [decision, req.user.id, req.params.id]
    );
    if (!result.affectedRows) {
      const error = new Error('Pending purchase order not found.');
      error.status = 404;
      throw error;
    }
    await writeAudit(connection, req.user.id, decision.toLowerCase(), 'purchase_order', req.params.id);
    await createNotification(connection, null, `Purchase order ${decision.toLowerCase()}`, `Purchase order ${req.params.id} was ${decision.toLowerCase()}.`, `/purchase-orders/${req.params.id}`);
    return { body: { message: `Purchase order ${decision.toLowerCase()}.` } };
  }, res, next);
});

router.post('/goods-receipts', allowRoles(...stores), async (req, res, next) => {
  const itemId = Number(req.body.itemId);
  const quantity = Number(req.body.quantity);
  const purchaseOrderId = req.body.purchaseOrderId ? Number(req.body.purchaseOrderId) : null;
  const source = String(req.body.source || '').trim();
  if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || !source ||
      (purchaseOrderId !== null && !Number.isInteger(purchaseOrderId))) {
    return res.status(400).json({ message: 'Choose an item, quantity, and source. Purchase order is optional for direct receipts.' });
  }
  return transaction(async (connection) => {
    if (purchaseOrderId) {
      const [[order]] = await connection.execute(
        "SELECT id, reference FROM purchase_orders WHERE id = ? AND status IN ('Approved', 'Partially received') FOR UPDATE",
        [purchaseOrderId]
      );
      if (!order) {
        const error = new Error('Goods can only be received against an approved purchase order.');
        error.status = 409;
        throw error;
      }
      const [orderLines] = await connection.execute(
        'SELECT item_name, quantity FROM purchase_order_items WHERE purchase_order_id = ?',
        [purchaseOrderId]
      );
      const [[catalogItem]] = await connection.execute('SELECT name FROM items WHERE id = ?', [itemId]);
      const matchingLines = orderLines.filter((line) => line.item_name.toLowerCase() === String(catalogItem?.name || '').toLowerCase());
      const expectedQuantity = matchingLines.reduce((sum, line) => sum + line.quantity, 0);
      const [[received]] = await connection.execute(
        `SELECT COALESCE(SUM(gri.quantity), 0) AS quantity
         FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
         WHERE gr.purchase_order_id = ? AND gri.item_id = ?`,
        [purchaseOrderId, itemId]
      );
      if (!expectedQuantity || received.quantity + quantity > expectedQuantity) {
        const error = new Error('The received item or quantity does not match the outstanding purchase order.');
        error.status = 409;
        throw error;
      }
      if (req.body.isFinal === true) {
        const expectedByName = new Map();
        for (const line of orderLines) {
          const itemName = line.item_name.toLowerCase();
          expectedByName.set(itemName, (expectedByName.get(itemName) || 0) + line.quantity);
        }
        for (const [itemName, expected] of expectedByName) {
          const [[catalogLine]] = await connection.execute('SELECT id, name FROM items WHERE LOWER(name) = ? LIMIT 1', [itemName]);
          if (!catalogLine) {
            const error = new Error(`Add "${itemName}" to the inventory catalogue before finalizing this receipt.`);
            error.status = 409;
            throw error;
          }
          const [[lineReceived]] = await connection.execute(
            `SELECT COALESCE(SUM(gri.quantity), 0) AS quantity
             FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
             WHERE gr.purchase_order_id = ? AND gri.item_id = ?`,
            [purchaseOrderId, catalogLine.id]
          );
          const addThisDelivery = catalogLine.id === itemId ? quantity : 0;
          if (lineReceived.quantity + addThisDelivery < expected) {
            const error = new Error(`There are still ${expected - lineReceived.quantity - addThisDelivery} units of "${catalogLine.name}" outstanding.`);
            error.status = 409;
            throw error;
          }
        }
      }
    }
    const [[item]] = await connection.execute('SELECT id, quantity FROM items WHERE id = ? FOR UPDATE', [itemId]);
    if (!item) {
      const error = new Error('Inventory item not found.');
      error.status = 404;
      throw error;
    }
    const grnReference = reference('GRN');
    const [receipt] = await connection.execute(
      'INSERT INTO goods_receipts (reference, purchase_order_id, source, received_by) VALUES (?, ?, ?, ?)',
      [grnReference, purchaseOrderId, source, req.user.id]
    );
    const balance = item.quantity + quantity;
    await connection.execute('INSERT INTO goods_receipt_items (goods_receipt_id, item_id, quantity) VALUES (?, ?, ?)', [receipt.insertId, itemId, quantity]);
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, itemId]);
    await connection.execute(
      "INSERT INTO inventory_movements (item_id, user_id, movement_type, quantity, source, balance_after) VALUES (?, ?, 'Receipt', ?, ?, ?)",
      [itemId, req.user.id, quantity, grnReference, balance]
    );
    if (purchaseOrderId) {
      await connection.execute(
        'UPDATE purchase_orders SET status = ? WHERE id = ?',
        [req.body.isFinal === true ? 'Received' : 'Partially received', purchaseOrderId]
      );
    }
    await writeAudit(connection, req.user.id, 'received', 'goods_receipt', receipt.insertId, { reference: grnReference, itemId, quantity });
    await createNotification(connection, null, 'Goods received', `${grnReference}: ${quantity} units were added to stock.`, `/inventory/movements`);
    return { status: 201, body: { id: receipt.insertId, reference: grnReference, balance, message: 'Goods receipt recorded and stock updated.' } };
  }, res, next);
});

router.get('/goods-receipts', async (_req, res, next) => {
  try {
    const [receipts] = await pool.query(
      `SELECT g.id, g.reference, g.source, g.received_at AS receivedAt,
        p.reference AS purchaseOrder, u.name AS receivedBy,
        GROUP_CONCAT(CONCAT(i.name, ' × ', gi.quantity) SEPARATOR ', ') AS items
       FROM goods_receipts g LEFT JOIN purchase_orders p ON p.id = g.purchase_order_id
       JOIN users u ON u.id = g.received_by
       JOIN goods_receipt_items gi ON gi.goods_receipt_id = g.id
       JOIN items i ON i.id = gi.item_id
       GROUP BY g.id ORDER BY g.received_at DESC`
    );
    return res.json({ goodsReceipts: receipts });
  } catch (error) { return next(error); }
});

router.get('/invoices', async (_req, res, next) => {
  try {
    const [invoices] = await pool.query(
      `SELECT i.id, i.reference, i.amount, i.status, i.created_at AS createdAt,
        p.reference AS purchaseOrder, s.name AS supplier, u.name AS submittedBy
       FROM invoices i JOIN purchase_orders p ON p.id = i.purchase_order_id
       JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = i.submitted_by
       ORDER BY i.created_at DESC`
    );
    return res.json({ invoices });
  } catch (error) { return next(error); }
});

router.post('/invoices', allowRoles(...procurement), async (req, res, next) => {
  const purchaseOrderId = Number(req.body.purchaseOrderId);
  const invoiceReference = String(req.body.reference || '').trim();
  const amount = Number(req.body.amount);
  if (!Number.isInteger(purchaseOrderId) || !invoiceReference || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Choose a purchase order and enter an invoice reference and positive amount.' });
  }
  try {
    const [[order]] = await pool.execute(
      `SELECT p.id FROM purchase_orders p
       WHERE p.id = ? AND p.status IN ('Approved', 'Partially received', 'Received')
         AND EXISTS (SELECT 1 FROM goods_receipts g WHERE g.purchase_order_id = p.id)`,
      [purchaseOrderId]
    );
    if (!order) return res.status(409).json({ message: 'The purchase order must be approved and have a goods receipt before invoicing.' });
    const [result] = await pool.execute(
      'INSERT INTO invoices (reference, purchase_order_id, amount, submitted_by) VALUES (?, ?, ?, ?)',
      [invoiceReference, purchaseOrderId, amount, req.user.id]
    );
    await pool.execute(
      "INSERT INTO notifications (user_id, title, body, link) VALUES (NULL, 'Invoice submitted', ?, '/invoices')",
      [`Invoice ${invoiceReference} is ready for finance review.`]
    );
    return res.status(201).json({ id: result.insertId, message: 'Invoice submitted to finance.' });
  } catch (error) { return next(error); }
});

router.patch('/invoices/:id/decision', allowRoles(...finance), async (req, res, next) => {
  const decision = req.body.decision;
  if (!['Approved', 'Rejected', 'Paid'].includes(decision)) {
    return res.status(400).json({ message: 'Decision must be Approved, Rejected, or Paid.' });
  }
  try {
    const allowedPrevious = decision === 'Paid' ? 'Approved' : 'Pending';
    const [result] = await pool.execute(
      'UPDATE invoices SET status = ?, reviewed_by = ? WHERE id = ? AND status = ?',
      [decision, req.user.id, req.params.id, allowedPrevious]
    );
    if (!result.affectedRows) return res.status(409).json({ message: `Invoice cannot be marked ${decision.toLowerCase()} from its current status.` });
    await pool.execute(
      'INSERT INTO notifications (user_id, title, body, link) SELECT submitted_by, ?, ?, ? FROM invoices WHERE id = ?',
      [`Invoice ${decision.toLowerCase()}`, `Invoice ${req.params.id} was marked ${decision.toLowerCase()}.`, '/invoices', req.params.id]
    );
    return res.json({ message: `Invoice ${decision.toLowerCase()}.` });
  } catch (error) { return next(error); }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const [notifications] = await pool.execute(
      'SELECT id, title, body, link, is_read AS isRead, created_at AS createdAt FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    return res.json({ notifications });
  } catch (error) { return next(error); }
});

router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ message: 'Notification marked as read.' });
  } catch (error) { return next(error); }
});

export default router;

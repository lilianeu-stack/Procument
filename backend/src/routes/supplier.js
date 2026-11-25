import { Router, } from 'express';
import { timingSafeEqual } from 'node:crypto';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { log } from '../lib/logger.js';
import { markRfqLinkOpened } from '../services/rfq-email.js';
import { normalizeEmail, validEmail } from '../utils/email-config.js';
import { parseRfqToken } from '../utils/rfq-link.js';

const router = Router();
const OPEN_STATUSES = ['Sent', 'Evaluating'];

async function invitedRfq(token) {
  const identity = parseRfqToken(token);
  if (!identity) return { error: 404, message: 'This quotation link is invalid or has expired.' };
  const [rows] = await pool.execute(
    `SELECT f.id, f.reference, f.due_date AS dueDate, f.status, f.message,
       r.id AS requisitionId, r.reference AS requisitionReference, r.title,
       r.priority, r.required_by AS requiredBy,
       s.id AS supplierId, s.name AS supplierName, s.contact_name AS contactName
     FROM rfqs f
     JOIN rfq_suppliers fs ON fs.rfq_id = f.id AND fs.supplier_id = ?
     JOIN requisitions r ON r.id = f.requisition_id
     JOIN suppliers s ON s.id = fs.supplier_id
     WHERE f.id = ?`,
    [identity.supplierId, identity.rfqId]
  );
  const rfq = rows[0];
  if (!rfq) return { error: 404, message: 'This quotation link is invalid or has expired.' };
  if (!OPEN_STATUSES.includes(rfq.status)) return { error: 410, message: 'This RFQ is closed and no longer accepts quotations.' };
  return { rfq, identity };
}

// Public but token-gated: a Supplier never authenticates as a system user and
// can only ever see the RFQ identified by their own signed link.
router.get('/supplier/rfq/:token', async (req, res, next) => {
  try {
    const result = await invitedRfq(req.params.token);
    if (result.error) return res.status(result.error).json({ message: result.message });
    const { rfq, identity } = result;
    await markRfqLinkOpened(rfq.id, identity.supplierId);

    const [items] = await pool.execute(
      `SELECT id AS requisitionItemId, item_name AS itemName, description, quantity, unit,
         estimated_unit_cost AS estimatedUnitCost,
         (quantity * estimated_unit_cost) AS lineTotal
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [rfq.requisitionId]
    );
    const [quotation] = await pool.execute(
      `SELECT id, amount, delivery_days AS deliveryDays, notes, submitted_at AS submittedAt
       FROM quotations WHERE rfq_id = ? AND supplier_id = ?`,
      [rfq.id, identity.supplierId]
    );
    let quotationItems = [];
    if (quotation[0]) {
      const [rows] = await pool.execute(
        `SELECT requisition_item_id AS requisitionItemId, item_name AS itemName, description,
           quantity, unit, unit_price AS unitPrice, line_total AS lineTotal, comment
         FROM quotation_items WHERE quotation_id = ? ORDER BY id`,
        [quotation[0].id]
      );
      quotationItems = rows.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice) || 0,
        lineTotal: Number(item.lineTotal) || 0
      }));
    }
    return res.json({
      rfq: {
        reference: rfq.reference,
        dueDate: rfq.dueDate,
        status: rfq.status,
        requisitionReference: rfq.requisitionReference,
        title: rfq.title,
        priority: rfq.priority,
        requiredBy: rfq.requiredBy,
        message: rfq.message || '',
        supplier: { name: rfq.supplierName, contactName: rfq.contactName },
        items: items.map((item) => ({
          ...item,
          estimatedUnitCost: Number(item.estimatedUnitCost) || 0,
          lineTotal: Number(item.lineTotal) || 0
        })),
        total: items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0),
        quotation: quotation[0] ? { ...quotation[0], items: quotationItems } : null
      }
    });
  } catch (error) { return next(error); }
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

router.post('/supplier/rfq/:token/quotation', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const result = await invitedRfq(req.params.token);
    if (result.error) return res.status(result.error).json({ message: result.message });
    const { rfq, identity } = result;
    const rawDeliveryDays = req.body.deliveryDays;
    const deliveryDays = rawDeliveryDays === undefined || rawDeliveryDays === null || rawDeliveryDays === ''
      ? 0
      : Number(rawDeliveryDays);
    const notes = String(req.body.notes || '').trim().slice(0, 2000);
    if (!Number.isInteger(deliveryDays) || deliveryDays < 0) {
      return res.status(400).json({ message: 'Enter a valid delivery time.' });
    }

    const [requestItems] = await connection.execute(
      `SELECT id, item_name AS itemName, description, quantity, unit
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [rfq.requisitionId]
    );
    const itemMap = new Map(requestItems.map((item) => [Number(item.id), item]));
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    let pricedItems = [];
    let amount;

    if (rawItems.length) {
      const seen = new Set();
      for (const entry of rawItems) {
        const requisitionItemId = Number(entry?.requisitionItemId);
        const unitPrice = Number(entry?.unitPrice);
        const source = itemMap.get(requisitionItemId);
        if (!source || !Number.isFinite(unitPrice) || unitPrice <= 0 || seen.has(requisitionItemId)) {
          return res.status(400).json({ message: 'Enter a valid unit price for each requested item.' });
        }
        seen.add(requisitionItemId);
        const quantity = Number(source.quantity) || 0;
        if (quantity <= 0) {
          return res.status(400).json({ message: 'Every requested item needs a positive quantity.' });
        }
        pricedItems.push({
          requisitionItemId,
          itemName: source.itemName,
          description: source.description || '',
          quantity,
          unit: source.unit || 'unit',
          unitPrice: roundMoney(unitPrice),
          lineTotal: roundMoney(quantity * unitPrice),
          comment: String(entry?.comment || '').trim().slice(0, 1000) || null
        });
      }
      if (pricedItems.length !== requestItems.length) {
        return res.status(400).json({ message: 'Enter a unit price for every requested item.' });
      }
      amount = roundMoney(pricedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    } else {
      amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Enter the prices for each requested item.' });
      }
      amount = roundMoney(amount);
    }

    await connection.beginTransaction();
    const [[existing]] = await connection.execute(
      'SELECT id FROM quotations WHERE rfq_id = ? AND supplier_id = ? FOR UPDATE',
      [rfq.id, identity.supplierId]
    );
    if (existing) {
      await connection.rollback();
      return res.status(409).json({ message: 'A response has already been submitted for this RFQ.' });
    }
    try {
      await connection.execute(
        `INSERT INTO quotations
           (rfq_id, supplier_id, amount, delivery_days, notes, submitted_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [rfq.id, identity.supplierId, amount, deliveryDays, notes || null]
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        await connection.rollback();
        return res.status(409).json({ message: 'A response has already been submitted for this RFQ.' });
      }
      throw error;
    }
    const [[saved]] = await connection.execute(
      'SELECT id FROM quotations WHERE rfq_id = ? AND supplier_id = ?',
      [rfq.id, identity.supplierId]
    );
    await connection.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [saved.id]);
    for (const item of pricedItems) {
      await connection.execute(
        `INSERT INTO quotation_items
           (quotation_id, requisition_item_id, item_name, description, quantity, unit, unit_price, line_total, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saved.id, item.requisitionItemId, item.itemName, item.description || null, item.quantity,
          item.unit, item.unitPrice, item.lineTotal, item.comment]
      );
    }
    await connection.execute("UPDATE rfqs SET status = 'Evaluating' WHERE id = ?", [rfq.id]);

    const firstComment = notes || pricedItems.find((item) => item.comment)?.comment || '';
    const commentPart = firstComment ? ` Comment: ${firstComment.slice(0, 140)}` : '';
    const itemPart = pricedItems.length ? ` ${pricedItems.length} item(s) were priced individually.` : '';
    await writeAudit(
      connection, null, 'submitted', 'quotation', rfq.id,
      { rfqReference: rfq.reference, supplierId: identity.supplierId, supplierName: rfq.supplierName, amount, deliveryDays, itemCount: pricedItems.length, comment: firstComment.slice(0, 300) || null }
    );
    await createNotification(
      connection, null, 'Supplier quotation received',
      `${rfq.supplierName} replied to ${rfq.reference} with a quote of RWF ${amount.toFixed(2)}.${itemPart}${commentPart}`,
      `#/admin/RFQs?rfq=${rfq.id}`
    );
    await connection.commit();
    await markRfqLinkOpened(rfq.id, identity.supplierId);
    return res.status(200).json({ message: 'Quotation submitted successfully.', reference: rfq.reference, amount });
  } catch (error) {
    try { await connection.rollback(); } catch { /* ignore rollback errors */ }
    return next(error);
  } finally {
    connection.release();
  }
});

// Optional provider-agnostic delivery webhook. Delivered/Bounced/Opened are
// only recorded when a trusted provider calls this endpoint with the secret.
const WEBHOOK_STATUSES = {
  delivered: { status: 'Delivered', column: 'delivered_at' },
  delivered_to_recipient: { status: 'Delivered', column: 'delivered_at' },
  bounce: { status: 'Bounced', column: 'bounced_at' },
  bounced: { status: 'Bounced', column: 'bounced_at' },
  hard_bounce: { status: 'Bounced', column: 'bounced_at' },
  open: { status: 'Opened', column: 'opened_at' },
  opened: { status: 'Opened', column: 'opened_at' }
};

function secretMatches(provided) {
  const configured = String(process.env.EMAIL_WEBHOOK_SECRET || '');
  if (!configured) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post('/email/webhooks/generic', async (req, res, next) => {
  try {
    if (!secretMatches(req.headers['x-email-webhook-secret'])) {
      return res.status(401).json({ message: 'Invalid webhook secret.' });
    }
    const event = WEBHOOK_STATUSES[String(req.body.status || '').toLowerCase()];
    const messageId = String(req.body.providerMessageId || '').trim();
    const recipient = normalizeEmail(req.body.recipient);
    if (!event || !messageId) return res.status(400).json({ message: 'A supported status and providerMessageId are required.' });

    const params = [event.status, messageId];
    let recipientClause = '';
    if (validEmail(recipient)) { recipientClause = ' AND recipient_email = ?'; params.push(recipient); }
    const [result] = await pool.execute(
      `UPDATE rfq_email_deliveries
          SET status = ?, ${event.column} = COALESCE(${event.column}, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP()
        WHERE provider_message_id = ?${recipientClause}`,
      params
    );
    if (Number(result.affectedRows) > 0) {
      log('INFO', `Email webhook updated ${result.affectedRows} delivery record(s) to ${event.status}.`);
    }
    return res.status(202).json({ message: 'Webhook accepted.', updated: Number(result.affectedRows) || 0 });
  } catch (error) { return next(error); }
});

export default router;

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
    `SELECT f.id, f.reference, f.due_date AS dueDate, f.status,
       f.instructions, f.terms, f.message,
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
    const [quotations] = await pool.execute(
      `SELECT id, amount, delivery_days AS deliveryDays, notes, submitted_at AS submittedAt
       FROM quotations WHERE rfq_id = ? AND supplier_id = ?`,
      [rfq.id, identity.supplierId]
    );
    let quotation = quotations[0] || null;
    if (quotation) {
      const [quotedItems] = await pool.execute(
        `SELECT requisition_item_id AS requisitionItemId, unit_price AS unitPrice,
           line_total AS lineTotal, comment
         FROM quotation_items WHERE quotation_id = ? ORDER BY id`,
        [quotation.id]
      );
      quotation = {
        ...quotation,
        id: undefined,
        amount: Number(quotation.amount) || 0,
        deliveryDays: Number(quotation.deliveryDays) || null,
        items: quotedItems.map((item) => ({
          ...item,
          requisitionItemId: Number(item.requisitionItemId),
          unitPrice: Number(item.unitPrice) || 0,
          lineTotal: Number(item.lineTotal) || 0
        }))
      };
    }
    return res.json({
      rfq: {
        reference: rfq.reference,
        dueDate: rfq.dueDate,
        status: rfq.status,
        instructions: rfq.instructions || '',
        terms: rfq.terms || '',
        message: rfq.message || '',
        requisitionReference: rfq.requisitionReference,
        title: rfq.title,
        priority: rfq.priority,
        requiredBy: rfq.requiredBy,
        supplier: { name: rfq.supplierName, contactName: rfq.contactName },
        items: items.map((item) => ({
          ...item,
          requisitionItemId: Number(item.requisitionItemId),
          quantity: Number(item.quantity) || 0,
          estimatedUnitCost: Number(item.estimatedUnitCost) || 0,
          lineTotal: Number(item.lineTotal) || 0
        })),
        total: items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0),
        quotation
      }
    });
  } catch (error) { return next(error); }
});

router.post('/supplier/rfq/:token/quotation', async (req, res, next) => {
  try {
    const result = await invitedRfq(req.params.token);
    if (result.error) return res.status(result.error).json({ message: result.message });
    const { rfq, identity } = result;
    const hasItemPrices = Array.isArray(req.body.items);
    const amount = Number(req.body.amount);
    const deliveryDays = req.body.deliveryDays === undefined ? 0 : Number(req.body.deliveryDays);
    const notes = String(req.body.notes || '').trim().slice(0, 2000);
    if (hasItemPrices && (!Number.isInteger(deliveryDays) || deliveryDays < 0)) {
      return res.status(400).json({ message: 'Enter a delivery time of at least one day.' });
    }
    if (!hasItemPrices && (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(deliveryDays) || deliveryDays < 1)) {
      return res.status(400).json({ message: 'Enter a positive quotation amount and a delivery time of at least one day.' });
    }

    let pricedItems = [];
    let quoteAmount = amount;
    if (hasItemPrices) {
      const [requestedItems] = await pool.execute(
        `SELECT id, item_name AS itemName, description, quantity, unit
         FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
        [rfq.requisitionId]
      );
      const submittedItems = req.body.items;
      const submittedById = new Map();
      for (const item of submittedItems) {
        if (!item || typeof item !== 'object') {
          return res.status(400).json({ message: 'Enter a valid unit price for every requested item.' });
        }
        const itemId = Number(item.requisitionItemId);
        const unitPrice = Number(item.unitPrice);
        if (!Number.isInteger(itemId) || !Number.isFinite(unitPrice) || unitPrice <= 0 || submittedById.has(itemId)) {
          return res.status(400).json({ message: 'Enter a valid unit price for every requested item.' });
        }
        submittedById.set(itemId, {
          unitPrice,
          comment: String(item.comment || '').trim().slice(0, 2000)
        });
      }
      if (!requestedItems.length || submittedById.size !== requestedItems.length ||
          requestedItems.some((item) => !submittedById.has(Number(item.id)))) {
        return res.status(400).json({ message: 'Enter a unit price for every requested item.' });
      }
      pricedItems = requestedItems.map((item) => {
        const submitted = submittedById.get(Number(item.id));
        const quantity = Number(item.quantity) || 0;
        const lineTotal = Math.round((quantity * submitted.unitPrice + Number.EPSILON) * 100) / 100;
        return {
          requisitionItemId: item.id,
          itemName: item.itemName,
          description: item.description,
          quantity,
          unit: item.unit,
          unitPrice: submitted.unitPrice,
          lineTotal,
          comment: submitted.comment
        };
      });
      quoteAmount = Math.round((pricedItems.reduce((sum, item) => sum + item.lineTotal, 0) + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
        return res.status(400).json({ message: 'The quotation total must be positive.' });
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[existingQuote]] = await connection.execute(
        'SELECT id FROM quotations WHERE rfq_id = ? AND supplier_id = ? FOR UPDATE',
        [rfq.id, identity.supplierId]
      );
      if (existingQuote) {
        await connection.rollback();
        return res.status(409).json({ message: 'A quotation has already been submitted for this RFQ.' });
      }
      const [insertedQuote] = await connection.execute(
        `INSERT INTO quotations
           (rfq_id, supplier_id, amount, delivery_days, notes, submitted_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [rfq.id, identity.supplierId, quoteAmount, deliveryDays, notes || null]
      );
      for (const item of pricedItems) {
        await connection.execute(
          `INSERT INTO quotation_items
             (quotation_id, requisition_item_id, item_name, description, quantity, unit, unit_price, line_total, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [insertedQuote.insertId, item.requisitionItemId, item.itemName, item.description, item.quantity,
            item.unit, item.unitPrice, item.lineTotal, item.comment || null]
        );
      }
      await connection.execute("UPDATE rfqs SET status = 'Evaluating' WHERE id = ?", [rfq.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'A quotation has already been submitted for this RFQ.' });
      }
      throw error;
    } finally {
      connection.release();
    }
    await markRfqLinkOpened(rfq.id, identity.supplierId);
    await writeAudit(
      pool, null, 'submitted', 'quotation', rfq.id,
      { rfqReference: rfq.reference, supplierId: identity.supplierId, supplierName: rfq.supplierName, amount: quoteAmount, deliveryDays }
    );
    await createNotification(
      pool, null, 'Supplier quotation received',
      `${rfq.supplierName} submitted a quotation for ${rfq.reference}.`,
      `#/admin/RFQs?rfq=${rfq.id}`
    );
    return res.status(200).json({ message: 'Quotation submitted successfully.', reference: rfq.reference });
  } catch (error) { return next(error); }
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
    const rfqUpdated = Number(result.affectedRows) || 0;
    if (rfqUpdated > 0) {
      log('INFO', `Email webhook updated ${rfqUpdated} RFQ delivery record(s) to ${event.status}.`);
    }

    // Supplier pricing invitations use the same provider message id. Keep the
    // private response status untouched; only the truthful email status and
    // provider timestamps change, and every change is audited.
    const pricingRecipientClause = validEmail(recipient) ? ' AND supplier_email = ?' : '';
    const pricingIdentityParams = validEmail(recipient) ? [messageId, recipient] : [messageId];
    const [pricingRows] = await pool.execute(
      `SELECT id, request_id AS requestId, supplier_id AS supplierId, supplier_name AS supplierName
         FROM purchase_order_pricing_responses
        WHERE provider_message_id = ?${pricingRecipientClause}`,
      pricingIdentityParams
    );
    let pricingUpdated = 0;
    if (pricingRows.length) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [pricingResult] = await connection.execute(
          `UPDATE purchase_order_pricing_responses
              SET email_status = ?, ${event.column} = COALESCE(${event.column}, UTC_TIMESTAMP()),
                updated_at = UTC_TIMESTAMP()
            WHERE provider_message_id = ?${pricingRecipientClause}`,
          [event.status, ...pricingIdentityParams]
        );
        pricingUpdated = Number(pricingResult.affectedRows) || 0;
        for (const row of pricingRows) {
          await writeAudit(
            connection, null, `pricing_email_${event.status.toLowerCase()}`,
            'supplier_pricing_response', row.id,
            {
              requestId: row.requestId, supplierId: row.supplierId,
              supplierName: row.supplierName, recipient, providerMessageId: messageId,
              status: event.status
            }
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
      log('INFO', `Email webhook updated ${pricingUpdated} supplier pricing response(s) to ${event.status}.`);
    }
    return res.status(202).json({ message: 'Webhook accepted.', updated: rfqUpdated + pricingUpdated });
  } catch (error) { return next(error); }
});

export default router;

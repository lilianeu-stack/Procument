import pool from '../config/db.js';
import { log } from '../lib/logger.js';
import { normalizeEmail, validEmail } from '../utils/email-config.js';
import { createRfqToken } from '../utils/rfq-link.js';
import { buildRfqEmail, sendEmail } from './email.js';

const OPEN_RFQ_STATUSES = ['Sent', 'Evaluating'];

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function errorText(result) {
  if (!result.error) return null;
  return JSON.stringify({ code: result.error.code, message: result.error.message, reason: result.reason || null });
}

// Called inside the RFQ creation transaction. One row per selected Supplier is
// the audit record; a failed recipient can be retried without resending to
// Suppliers whose messages were already accepted.
export async function createRfqEmailDeliveries(connection, { rfqId, reference, supplierIds }) {
  const [suppliers] = await connection.execute(
    `SELECT id, name, email FROM suppliers WHERE id IN (${placeholders(supplierIds)})`,
    supplierIds
  );
  const byId = new Map(suppliers.map((supplier) => [Number(supplier.id), supplier]));
  const created = [];
  for (const supplierId of supplierIds) {
    const supplier = byId.get(Number(supplierId));
    const email = normalizeEmail(supplier?.email);
    const valid = validEmail(email);
    const [result] = await connection.execute(
      `INSERT INTO rfq_email_deliveries
         (rfq_id, supplier_id, recipient_email, rfq_reference, status, error_details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rfqId,
        supplierId,
        email || '',
        reference,
        valid ? 'Pending' : 'Failed',
        valid ? null : JSON.stringify({ code: 'INVALID_RECIPIENT', message: 'No valid registered email address is saved for this Supplier.', reason: 'invalid_recipient' })
      ]
    );
    created.push({ id: Number(result.insertId), supplierId, email, valid });
  }
  return created;
}

async function loadDeliveries({ rfqId, onlyFailed = false, deliveryIds = null }) {
  const conditions = ['d.rfq_id = ?'];
  const params = [rfqId];
  if (onlyFailed) conditions.push("d.status = 'Failed'");
  if (deliveryIds?.length) {
    conditions.push(`d.id IN (${placeholders(deliveryIds)})`);
    params.push(...deliveryIds);
  }
  const [rows] = await pool.execute(
    `SELECT d.id, d.supplier_id AS supplierId, d.recipient_email AS recipientEmail,
       d.rfq_reference AS rfqReference, d.attempts,
       f.due_date AS dueDate, f.status AS rfqStatus, f.id AS rfqId,
       r.reference AS requisitionReference, r.title,
       s.name AS supplierName
     FROM rfq_email_deliveries d
     JOIN rfqs f ON f.id = d.rfq_id
     JOIN requisitions r ON r.id = f.requisition_id
     JOIN suppliers s ON s.id = d.supplier_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.id`,
    params
  );
  return rows;
}

// SMTP acceptance is the highest status this generic provider can truthfully
// claim. Delivered/Bounced only arrive through a provider webhook.
export async function sendRfqDeliveries({ rfqId, onlyFailed = false, deliveryIds = null, transport = null } = {}) {
  const deliveries = await loadDeliveries({ rfqId, onlyFailed, deliveryIds });
  const summary = { total: deliveries.length, accepted: 0, failed: 0, skipped: 0, messages: [] };

  for (const delivery of deliveries) {
    if (!OPEN_RFQ_STATUSES.includes(delivery.rfqStatus)) {
      await pool.execute(
        `UPDATE rfq_email_deliveries
           SET status = 'Failed', error_details = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [JSON.stringify({ code: 'RFQ_CLOSED', message: 'The RFQ is no longer open for invitations.' }), delivery.id]
      );
      summary.failed += 1;
      summary.messages.push({ supplierId: delivery.supplierId, status: 'Failed', reason: 'rfq_closed' });
      continue;
    }

    await pool.execute(
      "UPDATE rfq_email_deliveries SET status = 'Sending', error_details = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [delivery.id]
    );

    const token = createRfqToken(delivery.rfqId, delivery.supplierId);
    const message = buildRfqEmail({
      supplierName: delivery.supplierName,
      reference: delivery.rfqReference,
      requisitionReference: delivery.requisitionReference,
      title: delivery.title,
      dueDate: delivery.dueDate,
      rawToken: token
    });
    const result = await sendEmail({ ...message, to: delivery.recipientEmail }, transport);

    await pool.execute(
      `UPDATE rfq_email_deliveries
         SET status = ?, attempts = attempts + 1,
           provider_message_id = ?, provider_response = ?, error_details = ?,
           sent_at = COALESCE(sent_at, UTC_TIMESTAMP()),
           accepted_at = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        result.status,
        result.providerMessageId || null,
        result.providerResponse || null,
        errorText(result),
        result.ok ? new Date() : null,
        delivery.id
      ]
    );

    if (result.ok) summary.accepted += 1;
    else summary.failed += 1;
    summary.messages.push({
      supplierId: delivery.supplierId,
      status: result.status,
      reason: result.reason || null,
      messageId: result.providerMessageId || null
    });
  }
  log('INFO', `RFQ ${rfqId} email run: ${summary.accepted} accepted, ${summary.failed} failed, ${summary.skipped} skipped.`);
  return summary;
}

export async function createResendDelivery({ rfqId, deliveryId, userId }) {
  const [existing] = await pool.execute(
    'SELECT supplier_id AS supplierId, recipient_email AS recipientEmail, rfq_reference AS rfqReference FROM rfq_email_deliveries WHERE id = ? AND rfq_id = ?',
    [deliveryId, rfqId]
  );
  const delivery = existing[0];
  if (!delivery) return null;
  const [result] = await pool.execute(
    `INSERT INTO rfq_email_deliveries
       (rfq_id, supplier_id, recipient_email, rfq_reference, status, attempts)
     VALUES (?, ?, ?, ?, 'Pending', 0)`,
    [rfqId, delivery.supplierId, delivery.recipientEmail, delivery.rfqReference]
  );
  const newId = Number(result.insertId);
  await writeDeliveryAudit(userId, 'rfq_email_resend_requested', rfqId, deliveryId, newId);
  return newId;
}

async function writeDeliveryAudit(userId, action, rfqId, deliveryId, newId = null) {
  await pool.execute(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'rfq_email_delivery', ?, ?)`,
    [userId || null, action, String(rfqId), JSON.stringify({ deliveryId, newDeliveryId: newId })]
  );
}

export async function retryFailedDeliveries({ rfqId, userId }) {
  await writeDeliveryAudit(userId, 'rfq_email_retry_requested', rfqId, rfqId);
  return sendRfqDeliveries({ rfqId, onlyFailed: true });
}

export async function listRfqDeliveries(rfqId) {
  const [rows] = await pool.execute(
    `SELECT d.id, d.supplier_id AS supplierId, s.name AS supplier,
       d.recipient_email AS recipientEmail, d.rfq_reference AS rfqReference,
       d.status, d.attempts, d.provider_message_id AS providerMessageId,
       d.provider_response AS providerResponse, d.error_details AS errorDetails,
       d.sent_at AS sentAt, d.accepted_at AS acceptedAt,
       d.delivered_at AS deliveredAt, d.bounced_at AS bouncedAt, d.opened_at AS openedAt,
       d.created_at AS createdAt, d.updated_at AS updatedAt
     FROM rfq_email_deliveries d
     JOIN suppliers s ON s.id = d.supplier_id
     WHERE d.rfq_id = ?
     ORDER BY s.name, d.id DESC`,
    [rfqId]
  );
  const parsed = rows.map((row) => ({
    ...row,
    attempts: Number(row.attempts) || 0,
    errorDetails: typeof row.errorDetails === 'string' ? safeParse(row.errorDetails) : row.errorDetails
  }));
  return { deliveries: parsed, summary: deliverySummary(parsed) };
}

export function deliverySummary(deliveries) {
  const statuses = ['Pending', 'Sending', 'Accepted by Email Provider', 'Delivered', 'Bounced', 'Failed', 'Opened'];
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const delivery of deliveries) {
    if (Object.hasOwn(byStatus, delivery.status)) byStatus[delivery.status] += 1;
  }
  const suppliers = new Set(deliveries.map((delivery) => delivery.supplierId));
  return {
    totalAttempts: deliveries.length,
    suppliers: suppliers.size,
    ...byStatus,
    successful: byStatus['Accepted by Email Provider'] + byStatus.Delivered + byStatus.Opened
  };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return { message: String(value).slice(0, 300) }; }
}

export async function markRfqLinkOpened(rfqId, supplierId) {
  const [result] = await pool.execute(
    `UPDATE rfq_email_deliveries
        SET opened_at = COALESCE(opened_at, UTC_TIMESTAMP()),
          status = CASE WHEN status IN ('Failed', 'Bounced') THEN status ELSE 'Opened' END,
          updated_at = UTC_TIMESTAMP()
      WHERE rfq_id = ? AND supplier_id = ? AND opened_at IS NULL`,
    [rfqId, supplierId]
  );
  return Number(result.affectedRows) > 0;
}

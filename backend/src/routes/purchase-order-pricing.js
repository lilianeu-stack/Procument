import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { buildSupplierPricingEmail, sendEmail } from '../services/email.js';
import { getSettings } from '../services/settings.js';
import { emailConfigStatus, normalizeEmail, validEmail } from '../utils/email-config.js';
import { businessDate } from '../utils/dates.js';
import { roundMoney } from '../utils/money.js';
import {
  createSupplierPricingToken, hashSupplierPricingToken,
  isValidSupplierPricingTokenFormat
} from '../utils/purchase-order-pricing-token.js';

const protectedRouter = Router();
export const publicRouter = Router();

const procurementRoles = ['admin', 'procurement'];
const readRoles = ['admin', 'procurement', 'approver', 'committee', 'finance'];
const DEFAULT_LINK_HOURS = 72;
const ACTIVE_RESPONSE_STATUSES = ['Pending', 'Invited', 'Opened', 'Draft', 'Email failed'];

// Raw tokens are never written to the database. Keep them only for the lifetime
// of the process so a failed email can be retried with the SAME private link.
// After a restart the raw token is gone and a fresh request is required.
const liveTokens = new Map();

// Raw tokens are never written to the database. Keep them only for the lifetime
// of the process so a failed email can be retried with the SAME private link.
// After a restart the raw token is gone and a fresh request is required.

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boundedText(value, max, label) {
  if (value === undefined || value === null || value === '') return '';
  const trimmed = String(value).trim();
  if (trimmed.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}

function optionalText(value, max) {
  const trimmed = String(value ?? '').trim().slice(0, max);
  return trimmed || null;
}

function pricingReference() {
  return `SPR-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function linkHours() {
  const configured = Number(process.env.PO_SUPPLIER_PRICING_LINK_HOURS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 720
    ? configured : DEFAULT_LINK_HOURS;
}

function utcNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  return businessDate(value, 'Submission deadline', { allowPast: false });
}

function expiryFor(submissionDeadline, now = new Date()) {
  const linkExpiry = new Date(addHours(now, linkHours()));
  if (!submissionDeadline) return linkExpiry.toISOString().slice(0, 19).replace('T', ' ');
  const deadlineExpiry = new Date(`${String(submissionDeadline).slice(0, 10)}T23:59:59Z`);
  return new Date(Math.min(linkExpiry.getTime(), deadlineExpiry.getTime()))
    .toISOString().slice(0, 19).replace('T', ' ');
}

function configuredVatRate(settings) {
  const rate = Number(settings?.tax_rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

function notificationLink(requisitionId) {
  return requisitionId
    ? `#/admin/Procurement%20Processing?request=${requisitionId}&tab=supplier-responses`
    : '#/admin/Procurement%20Processing?tab=supplier-responses';
}

async function notifyProcurement(connection, requisitionId, title, body) {
  const [users] = await connection.execute(
    "SELECT id FROM users WHERE active = TRUE AND role IN ('admin', 'procurement')"
  );
  for (const user of users) {
    await createNotification(connection, user.id, title, body, notificationLink(requisitionId), 'supplier_pricing');
  }
}

function emailErrorDetails(delivery) {
  if (!delivery || delivery.ok) return null;
  return JSON.stringify({
    reason: delivery.reason || null,
    code: delivery.error?.code || null,
    message: delivery.error?.message || null
  });
}

function requestView(row) {
  return {
    id: row.id,
    reference: row.reference,
    purchaseOrderId: row.purchaseOrderId,
    poReference: row.poReference,
    rfqId: row.rfqId,
    rfqReference: row.rfqReference,
    requisitionId: row.requisitionId,
    requisitionReference: row.requisitionReference,
    currency: row.currency,
    submissionDeadline: row.submissionDeadline,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    awardedResponseId: row.awardedResponseId,
    awardedAt: row.awardedAt,
    awardComment: row.awardComment
  };
}

function itemView(row) {
  return {
    id: row.id,
    purchaseOrderItemId: row.purchaseOrderItemId,
    itemNo: row.itemNo,
    itemName: row.itemName,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal
  };
}

function responseView(row, items = []) {
  return {
    id: row.id,
    requestId: row.requestId,
    purchaseOrderId: row.purchaseOrderId,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierEmail: row.supplierEmail,
    supplierContact: row.supplierContact,
    supplierAddress: row.supplierAddress,
    status: row.status,
    emailStatus: row.emailStatus,
    emailAttempts: row.emailAttempts,
    emailError: row.emailError,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    deliveredAt: row.deliveredAt,
    openedAt: row.openedAt,
    expiresAt: row.expiresAt,
    draftSavedAt: row.draftSavedAt,
    submittedAt: row.submittedAt,
    revokedAt: row.revokedAt,
    currency: row.currency,
    subtotal: row.subtotal,
    vatRate: row.vatRate,
    vatAmount: row.vatAmount,
    otherCharges: row.otherCharges,
    total: row.total,
    quotationValidity: row.quotationValidity,
    deliveryLeadTime: row.deliveryLeadTime,
    comments: row.comments,
    technicalRemarks: row.technicalRemarks,
    awarded: Boolean(row.awarded),
    items: items.map(itemView)
  };
}

const RESPONSE_COLUMNS = `
  r.id, r.request_id AS requestId, r.purchase_order_id AS purchaseOrderId,
  r.supplier_id AS supplierId, r.supplier_name AS supplierName,
  r.supplier_email AS supplierEmail, r.supplier_contact AS supplierContact,
  r.supplier_address AS supplierAddress, r.status, r.email_status AS emailStatus,
  r.email_attempts AS emailAttempts, r.email_error AS emailError,
  r.sent_at AS sentAt, r.accepted_at AS acceptedAt, r.delivered_at AS deliveredAt,
  r.opened_at AS openedAt, r.expires_at AS expiresAt,
  r.draft_saved_at AS draftSavedAt, r.submitted_at AS submittedAt,
  r.revoked_at AS revokedAt, r.currency, r.subtotal, r.vat_rate AS vatRate,
  r.vat_amount AS vatAmount, r.other_charges AS otherCharges, r.total,
  r.quotation_validity AS quotationValidity, r.delivery_lead_time AS deliveryLeadTime,
  r.comments, r.technical_remarks AS technicalRemarks, r.awarded`;

async function responseItems(executor, responseId) {
  const [rows] = await executor.execute(
    `SELECT id, purchase_order_item_id AS purchaseOrderItemId, item_no AS itemNo,
       item_name AS itemName, description, quantity, unit, unit_price AS unitPrice,
       line_total AS lineTotal
      FROM purchase_order_pricing_response_items
     WHERE response_id = ? ORDER BY item_no, id`,
    [responseId]
  );
  return rows;
}

async function findResponseByToken(token, executor = pool, lock = false) {
  if (!isValidSupplierPricingTokenFormat(token)) return null;
  const [rows] = await executor.execute(
    `SELECT ${RESPONSE_COLUMNS},
       req.reference AS requestReference, req.status AS requestStatus,
       req.message AS requestMessage,
       DATE_FORMAT(req.submission_deadline, '%Y-%m-%d') AS submissionDeadline,
       req.requisition_id AS requisitionId,
       p.reference AS purchaseOrderReference, p.type AS purchaseOrderType,
       DATE_FORMAT(p.created_at, '%Y-%m-%d') AS purchaseOrderDate,
       DATE_FORMAT(p.delivery_date, '%Y-%m-%d') AS deliveryDate
      FROM purchase_order_pricing_responses r
      JOIN purchase_order_pricing_requests req ON req.id = r.request_id
      JOIN purchase_orders p ON p.id = r.purchase_order_id
     WHERE r.token_hash = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [hashSupplierPricingToken(token)]
  );
  return rows[0] || null;
}

function assertLinkUsable(response, { requireOpen = false, allowSubmittedRead = false } = {}) {
  if (!response) throw httpError(404, 'This supplier pricing link is invalid.');
  const expired = new Date(response.expiresAt).getTime() <= Date.now();
  if (response.status === 'Submitted' && allowSubmittedRead) return;
  if (response.status === 'Revoked') throw httpError(410, 'This supplier pricing link has been revoked.');
  if (response.status === 'Expired' || expired) throw httpError(410, 'This supplier pricing link has expired.');
  if (['Closed', 'Cancelled'].includes(response.requestStatus)) {
    throw httpError(410, 'This pricing request is closed and no longer accepts prices.');
  }
  if (response.submissionDeadline &&
      new Date(`${String(response.submissionDeadline).slice(0, 10)}T23:59:59Z`).getTime() <= Date.now()) {
    throw httpError(410, 'The submission deadline for this pricing request has passed.');
  }
  if (requireOpen && response.requestStatus !== 'Open') {
    throw httpError(410, 'This pricing request is no longer open for supplier prices.');
  }
}

// Supplier-supplied prices are always derived from the line snapshot on the
// response, never from the original purchase order's financial columns.
function quotedItems(value, expectedRows, { requireAll = false, allowBlank = false } = {}) {
  if (value !== undefined && !Array.isArray(value)) {
    throw httpError(400, 'Items must be supplied as an array.');
  }
  const supplied = Array.isArray(value) ? value : [];
  if (!supplied.length) {
    if (requireAll && expectedRows.length) throw httpError(400, 'Enter a unit price for every item.');
    return [];
  }
  const expected = new Map(expectedRows.map((row) => [Number(row.purchaseOrderItemId), row]));
  const seen = new Set();
  return supplied.map((raw) => {
    const purchaseOrderItemId = Number(raw?.purchaseOrderItemId);
    if (!Number.isInteger(purchaseOrderItemId) || purchaseOrderItemId < 1) {
      throw httpError(400, 'An item has an invalid identifier.');
    }
    if (seen.has(purchaseOrderItemId)) throw httpError(400, 'The same item cannot be priced twice.');
    seen.add(purchaseOrderItemId);
    const row = expected.get(purchaseOrderItemId);
    if (!row) throw httpError(400, 'An item does not belong to this quotation.');
    const rawPrice = raw.unitPrice;
    const blank = rawPrice === undefined || rawPrice === null || rawPrice === '';
    let unitPrice = null;
    if (!blank) {
      unitPrice = Number(rawPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw httpError(400, 'Each unit price must be a finite number of zero or more.');
      }
      unitPrice = Math.round(unitPrice * 10000) / 10000;
      if (unitPrice > 99999999.9999) {
        throw httpError(400, 'A unit price is outside the supported monetary range.');
      }
    } else if (!allowBlank) {
      throw httpError(400, 'Enter a unit price for every item.');
    }
    const lineTotal = unitPrice === null ? 0 : roundMoney(Number(row.quantity) * unitPrice);
    if (lineTotal > 9999999999.99) {
      throw httpError(400, 'A calculated item total is outside the supported monetary range.');
    }
    return { row, unitPrice, lineTotal };
  });
}

function quotedTotals(lines, vatRate, existing, body) {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const rate = configuredVatRate({ tax_rate: vatRate ?? existing?.vatRate ?? 0 });
  const vatAmount = roundMoney(subtotal * rate / 100);
  let otherCharges = Number(existing?.otherCharges) || 0;
  if (body.otherCharges !== undefined && body.otherCharges !== null && body.otherCharges !== '') {
    otherCharges = Number(body.otherCharges);
    if (!Number.isFinite(otherCharges) || otherCharges < 0) {
      throw httpError(400, 'Other charges must be a finite number of zero or more.');
    }
    otherCharges = roundMoney(otherCharges);
    if (otherCharges > 9999999999.99) {
      throw httpError(400, 'Other charges are outside the supported monetary range.');
    }
  }
  const total = roundMoney(subtotal + vatAmount + otherCharges);
  if (subtotal > 9999999999.99 || vatAmount > 9999999999.99 || total > 9999999999.99) {
    throw httpError(400, 'The calculated quotation total is outside the supported monetary range.');
  }
  return {
    subtotal, vatRate: rate, vatAmount, otherCharges,
    total
  };
}

async function persistQuotation(connection, response, lines, totals, body, status) {
  for (const line of lines) {
    await connection.execute(
      `INSERT INTO purchase_order_pricing_response_items
         (response_id, purchase_order_item_id, item_no, item_name, description, quantity, unit, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         item_no = VALUES(item_no), item_name = VALUES(item_name),
         description = VALUES(description), quantity = VALUES(quantity),
         unit = VALUES(unit), unit_price = VALUES(unit_price), line_total = VALUES(line_total)`,
      [response.id, line.row.purchaseOrderItemId, line.row.itemNo, line.row.itemName,
        line.row.description, line.row.quantity, line.row.unit, line.unitPrice, line.lineTotal]
    );
  }
  const currency = response.currency || 'RWF';
  const stamp = status === 'Submitted' ? utcNow() : null;
  await connection.execute(
    `UPDATE purchase_order_pricing_responses
        SET currency = ?, subtotal = ?, vat_rate = ?, vat_amount = ?, other_charges = ?, total = ?,
          quotation_validity = ?, delivery_lead_time = ?, comments = ?, technical_remarks = ?,
          status = ?, draft_saved_at = COALESCE(draft_saved_at, UTC_TIMESTAMP()),
          submitted_at = COALESCE(?, submitted_at)
      WHERE id = ?`,
    [currency.toUpperCase(), totals.subtotal, totals.vatRate, totals.vatAmount,
      totals.otherCharges, totals.total,
      optionalText(body.quotationValidity, 120), optionalText(body.deliveryLeadTime, 120),
      optionalText(body.comments, 2000), optionalText(body.technicalRemarks, 2000),
      status, stamp, response.id]
  );
}

// ---------------------------------------------------------------------------
// Protected Procurement / Committee APIs
// ---------------------------------------------------------------------------

protectedRouter.post('/purchase-orders/:id/send-to-suppliers', allowRoles(...procurementRoles), async (req, res, next) => {
  let connection;
  try {
    const purchaseOrderId = positiveId(req.params.id);
    if (!purchaseOrderId) throw httpError(400, 'Invalid purchase order identifier.');
    if (!Array.isArray(req.body.supplierIds)) throw httpError(400, 'Choose at least one supplier.');
    const supplierIds = req.body.supplierIds.map(Number);
    if (!supplierIds.length || supplierIds.length > 100 ||
        supplierIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw httpError(400, 'Choose at least one valid supplier.');
    }
    if (new Set(supplierIds).size !== supplierIds.length) {
      throw httpError(400, 'The same supplier cannot be selected twice.');
    }
    const message = boundedText(req.body.message, 1000, 'Message');
    const submissionDeadline = parseDate(req.body.submissionDeadline);

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      `SELECT p.id, p.reference, p.rfq_id, p.quotation_id, p.delivery_date,
         p.status, p.supplier_pricing_status AS pricingStatus,
         f.reference AS rfq_reference,
         r.id AS requisition_id, r.reference AS requisition_reference
        FROM purchase_orders p
        JOIN rfqs f ON f.id = p.rfq_id
        LEFT JOIN requisitions r ON r.id = f.requisition_id
       WHERE p.id = ? FOR UPDATE`,
      [purchaseOrderId]
    );
    if (!order) throw httpError(404, 'Purchase order not found.');
    if (order.status !== 'Pending approval') {
      throw httpError(409, 'Only a Purchase Order pending internal approval can request Supplier pricing.');
    }
    if (order.pricingStatus === 'Awarded') {
      throw httpError(409, 'Supplier pricing has already been awarded for this Purchase Order.');
    }
    const [[pendingApproval]] = await connection.execute(
      `SELECT id FROM purchase_order_approval_requests
        WHERE purchase_order_id = ? AND status = 'Pending' LIMIT 1`,
      [purchaseOrderId]
    );
    if (pendingApproval) {
      throw httpError(409, 'Revoke the pending internal approval request before asking Suppliers to quote.');
    }

    const suppliers = [];
    const invalid = [];
    for (const supplierId of supplierIds) {
      const [rows] = await connection.execute(
        'SELECT id, name, email, status, contact_name, address FROM suppliers WHERE id = ?', [supplierId]
      );
      const supplier = rows[0];
      const email = normalizeEmail(supplier?.email);
      if (!supplier) {
        invalid.push({ supplierId, name: `Supplier #${supplierId}`, email: '', reason: 'Supplier not found.' });
      } else if (supplier.status !== 'Active') {
        invalid.push({ supplierId, name: supplier.name, email: supplier.email || '', reason: 'Supplier is not active.' });
      } else if (!validEmail(email)) {
        invalid.push({ supplierId, name: supplier.name, email: supplier.email || '', reason: 'No valid registered email address.' });
      } else {
        suppliers.push({ ...supplier, email });
      }
    }
    if (invalid.length) {
      throw httpError(400, `Invalid suppliers: ${invalid.map((entry) => `${entry.name} (${entry.email || 'no registered email'})`).join(', ')}.`);
    }

    const placeholders = supplierIds.map(() => '?').join(',');
    const [duplicates] = await connection.execute(
      `SELECT s.name, s.email
         FROM purchase_order_pricing_responses res
         JOIN purchase_order_pricing_requests req ON req.id = res.request_id
         JOIN suppliers s ON s.id = res.supplier_id
        WHERE res.purchase_order_id = ? AND req.status = 'Open'
          AND res.status IN (${ACTIVE_RESPONSE_STATUSES.map(() => '?').join(',')})
          AND res.supplier_id IN (${placeholders})`,
      [purchaseOrderId, ...ACTIVE_RESPONSE_STATUSES, ...supplierIds]
    );
    if (duplicates.length) {
      throw httpError(409, `An active pricing link already exists for: ${duplicates.map((row) => `${row.name} (${row.email || 'no registered email'})`).join(', ')}.`);
    }

    const [poItems] = await connection.execute(
      `SELECT poi.id AS purchaseOrderItemId, poi.item_name AS itemName, poi.description,
         poi.quantity, poi.unit, poi.unit_price AS unitPrice
        FROM purchase_order_items poi WHERE poi.purchase_order_id = ? ORDER BY poi.id`,
      [purchaseOrderId]
    );
    if (!poItems.length) throw httpError(409, 'This purchase order has no items to price.');

    const reference = pricingReference();
    const expiresAt = expiryFor(submissionDeadline);
    const [requestResult] = await connection.execute(
      `INSERT INTO purchase_order_pricing_requests
         (reference, purchase_order_id, po_reference, rfq_id, rfq_reference,
          requisition_id, requisition_reference, currency, submission_deadline,
          message, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RWF', ?, ?, 'Open', ?)`,
      [reference, purchaseOrderId, order.reference, order.rfq_id, order.rfq_reference,
        order.requisition_id, order.requisition_reference, submissionDeadline,
        message || null, req.user.id]
    );
    const requestId = Number(requestResult.insertId);
    const pendingDeliveries = [];

    for (const supplier of suppliers) {
      const { token, tokenHash } = createSupplierPricingToken();
      const [responseResult] = await connection.execute(
        `INSERT INTO purchase_order_pricing_responses
           (request_id, purchase_order_id, supplier_id, supplier_name, supplier_email,
            supplier_contact, supplier_address, token_hash, status, email_status,
            expires_at, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Pending', ?, 'RWF')`,
        [requestId, purchaseOrderId, supplier.id, supplier.name, supplier.email,
          supplier.contact_name || null, supplier.address || null, tokenHash, expiresAt]
      );
      const responseId = Number(responseResult.insertId);
      for (const [index, item] of poItems.entries()) {
        // The price already recorded on the purchase order is shown to the
        // supplier as a starting point; they can change it before submitting.
        const initialUnitPrice = Number(item.unitPrice) || 0;
        const initialLineTotal = roundMoney(initialUnitPrice * Number(item.quantity));
        await connection.execute(
          `INSERT INTO purchase_order_pricing_response_items
             (response_id, purchase_order_item_id, item_no, item_name, description, quantity, unit, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [responseId, item.purchaseOrderItemId, index + 1, item.itemName,
            item.description || null, item.quantity, item.unit || 'unit',
            initialUnitPrice, initialLineTotal]
        );
      }
      await writeAudit(connection, req.user.id, 'pricing_request_sent', 'purchase_order', purchaseOrderId, {
        requestId, reference, supplierId: supplier.id, supplierName: supplier.name, recipientEmail: supplier.email
      });
      await writeAudit(connection, req.user.id, 'pricing_request_sent', 'supplier_pricing_response', responseId, {
        requestId, reference, supplierId: supplier.id, supplierName: supplier.name, recipientEmail: supplier.email
      });
      pendingDeliveries.push({ id: responseId, supplier, token });
    }

    await notifyProcurement(
      connection, order.requisition_id, 'Supplier pricing request sent',
      `${reference} was sent for ${order.reference}; ${suppliers.length} supplier response(s) are pending.`
    );
    await connection.execute(
      `UPDATE purchase_orders SET supplier_pricing_status = 'Collecting'
        WHERE id = ? AND supplier_pricing_status <> 'Awarded'`,
      [purchaseOrderId]
    );
    await connection.commit();
    connection.release();
    connection = null;

    const deliveries = [];
    const summary = { total: pendingDeliveries.length, accepted: 0, failed: 0, skipped: 0 };
    for (const delivery of pendingDeliveries) {
      liveTokens.set(String(delivery.id), delivery.token);
      const email = buildSupplierPricingEmail({
        supplierName: delivery.supplier.name,
        recipientEmail: delivery.supplier.email,
        reference,
        purchaseOrderReference: order.reference,
        items: poItems.map((item, index) => ({
          itemNo: index + 1,
          description: item.description || item.itemName,
          quantity: item.quantity,
          unit: item.unit || 'unit'
        })),
        deliveryDate: order.delivery_date ? String(order.delivery_date).slice(0, 10) : null,
        submissionDeadline,
        message,
        rawToken: delivery.token,
        currency: 'RWF'
      });
      const result = await sendEmail(email);
      if (result.reason === 'not_configured') summary.skipped += 1;
      else if (result.ok) summary.accepted += 1;
      else summary.failed += 1;

      await pool.execute(
        `UPDATE purchase_order_pricing_responses
            SET email_status = ?, email_attempts = email_attempts + 1,
              provider_message_id = ?, provider_response = ?, email_error = ?,
              sent_at = UTC_TIMESTAMP(), accepted_at = ?, status = ?
          WHERE id = ?`,
        [result.status, result.providerMessageId || null, result.providerResponse || null,
          emailErrorDetails(result), result.ok ? utcNow() : null,
          result.ok ? 'Invited' : 'Email failed', delivery.id]
      );
      await writeAudit(
        pool, req.user.id, result.ok ? 'pricing_request_email_accepted' : 'pricing_request_email_failed',
        'supplier_pricing_response', delivery.id,
        {
          requestId, reference, supplierId: delivery.supplier.id,
          supplierName: delivery.supplier.name, recipientEmail: delivery.supplier.email,
          emailStatus: result.status, reason: result.reason || null,
          providerMessageId: result.providerMessageId || null,
          error: result.error || null
        }
      );
      deliveries.push({
        id: delivery.id,
        supplierId: delivery.supplier.id,
        supplierName: delivery.supplier.name,
        recipientEmail: delivery.supplier.email,
        emailStatus: result.status,
        status: result.ok ? 'Invited' : 'Email failed',
        errorDetails: result.error || null
      });
    }

    const config = emailConfigStatus();
    if (summary.skipped) {
      summary.missing = config.missing;
    }
    const messageSuffix = summary.skipped
      ? ` The request was saved, but email was NOT delivered. Missing environment variable(s): ${config.missing.join(', ')}.`
      : ` ${summary.accepted} email(s) accepted by the provider; ${summary.failed} failed.`;
    return res.status(201).json({
      requestId,
      reference,
      message: `Supplier pricing request ${reference} saved.${messageSuffix}`,
      emailDelivery: summary,
      deliveries
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.status) {
      if (error.status === 400) {
        // Client-side diagnostics for a rejected supplier invitation. The
        // response body already carries this message, but keeping it in the
        // container logs makes a failed modal submission traceable.
        console.warn('[send-to-suppliers] rejected:', {
          purchaseOrderId: req.params.id,
          reason: error.message,
          supplierIds: req.body?.supplierIds,
          submissionDeadline: req.body?.submissionDeadline,
          messageLength: String(req.body?.message ?? '').length
        });
      }
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  } finally {
    connection?.release();
  }
});

protectedRouter.get('/purchase-orders/:id/supplier-responses', allowRoles(...readRoles), async (req, res, next) => {
  try {
    const purchaseOrderId = positiveId(req.params.id);
    if (!purchaseOrderId) throw httpError(400, 'Invalid purchase order identifier.');
    const [requests] = await pool.execute(
      `SELECT id, reference, purchase_order_id AS purchaseOrderId, po_reference AS poReference,
         rfq_id AS rfqId, rfq_reference AS rfqReference,
         requisition_id AS requisitionId, requisition_reference AS requisitionReference,
         currency, DATE_FORMAT(submission_deadline, '%Y-%m-%d') AS submissionDeadline, message, status,
         created_at AS createdAt, awarded_response_id AS awardedResponseId,
         awarded_at AS awardedAt, award_comment AS awardComment
        FROM purchase_order_pricing_requests
       WHERE purchase_order_id = ? ORDER BY created_at DESC, id DESC`,
      [purchaseOrderId]
    );
    let responses = [];
    if (requests.length) {
      const placeholders = requests.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT ${RESPONSE_COLUMNS}
           FROM purchase_order_pricing_responses r
          WHERE r.request_id IN (${placeholders})
          ORDER BY r.id`,
        requests.map((row) => row.id)
      );
      responses = await Promise.all(rows.map(async (row) => responseView(row, await responseItems(pool, row.id))));
    }
    return res.json({ requests: requests.map(requestView), responses });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

protectedRouter.get('/purchase-order-pricing/requests/:requestId/comparison', allowRoles(...readRoles), async (req, res, next) => {
  try {
    const requestId = positiveId(req.params.requestId);
    if (!requestId) throw httpError(400, 'Invalid pricing request identifier.');
    const [[request]] = await pool.execute(
      `SELECT id, reference, purchase_order_id AS purchaseOrderId, po_reference AS poReference,
         rfq_id AS rfqId, rfq_reference AS rfqReference,
         requisition_id AS requisitionId, requisition_reference AS requisitionReference,
         currency, DATE_FORMAT(submission_deadline, '%Y-%m-%d') AS submissionDeadline, message, status,
         created_at AS createdAt, awarded_response_id AS awardedResponseId,
         awarded_at AS awardedAt, award_comment AS awardComment
        FROM purchase_order_pricing_requests WHERE id = ?`,
      [requestId]
    );
    if (!request) throw httpError(404, 'Pricing request not found.');
    const [itemRows] = await pool.execute(
      `SELECT poi.id AS purchaseOrderItemId, pri.item_no AS itemNo, poi.item_name AS itemName,
         poi.description, poi.quantity, poi.unit
        FROM purchase_order_pricing_response_items pri
        JOIN purchase_order_items poi ON poi.id = pri.purchase_order_item_id
       WHERE pri.response_id = (SELECT id FROM purchase_order_pricing_responses WHERE request_id = ? ORDER BY id LIMIT 1)
       ORDER BY pri.item_no, pri.id`,
      [requestId]
    );
    const [submitted] = await pool.execute(
      `SELECT ${RESPONSE_COLUMNS}
         FROM purchase_order_pricing_responses r
        WHERE r.request_id = ? AND r.status = 'Submitted' ORDER BY r.id`,
      [requestId]
    );
    const responses = await Promise.all(submitted.map(async (row) => responseView(row, await responseItems(pool, row.id))));
    return res.json({
      request: requestView(request),
      columns: itemRows.map((row) => ({
        purchaseOrderItemId: row.purchaseOrderItemId,
        itemNo: row.itemNo,
        itemName: row.itemName,
        description: row.description,
        quantity: row.quantity,
        unit: row.unit
      })),
      responses
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

protectedRouter.patch('/purchase-order-pricing/responses/:id/revoke', allowRoles(...procurementRoles), async (req, res, next) => {
  let connection;
  try {
    const id = positiveId(req.params.id);
    if (!id) throw httpError(400, 'Invalid supplier response identifier.');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[row]] = await connection.execute(
      `SELECT r.id, r.status, r.request_id AS requestId, r.supplier_name AS supplierName,
         req.reference, req.purchase_order_id AS purchaseOrderId
        FROM purchase_order_pricing_responses r
        JOIN purchase_order_pricing_requests req ON req.id = r.request_id
       WHERE r.id = ? FOR UPDATE`,
      [id]
    );
    if (!row) throw httpError(404, 'Supplier pricing response not found.');
    if (row.status === 'Submitted') throw httpError(409, 'A submitted quotation cannot be revoked.');
    if (row.status === 'Revoked') throw httpError(409, 'This supplier pricing response is already revoked.');
    await connection.execute(
      "UPDATE purchase_order_pricing_responses SET status = 'Revoked', revoked_at = UTC_TIMESTAMP() WHERE id = ?",
      [id]
    );
    await writeAudit(connection, req.user.id, 'pricing_link_revoked', 'supplier_pricing_response', id, {
      requestId: row.requestId, reference: row.reference, supplierName: row.supplierName
    });
    await writeAudit(connection, req.user.id, 'pricing_link_revoked', 'purchase_order', row.purchaseOrderId, {
      responseId: id, requestId: row.requestId, reference: row.reference, supplierName: row.supplierName
    });
    await connection.commit();
    return res.json({ message: 'Supplier pricing link revoked.' });
  } catch (error) {
    connection?.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    connection?.release();
  }
});

async function retryFailedPricings(requestId, actor) {
  const [failed] = await pool.execute(
    `SELECT r.id, r.supplier_id AS supplierId, r.supplier_name AS supplierName,
       r.supplier_email AS supplierEmail, r.request_id AS requestId,
       req.reference, req.po_reference AS poReference,
       DATE_FORMAT(req.submission_deadline, '%Y-%m-%d') AS submissionDeadline, req.message,
       req.status AS requestStatus, r.expires_at AS expiresAt
      FROM purchase_order_pricing_responses r
      JOIN purchase_order_pricing_requests req ON req.id = r.request_id
     WHERE r.request_id = ?
       AND (r.email_status = 'Failed' OR r.status = 'Email failed'
         OR (r.email_status = 'Pending' AND r.sent_at IS NULL)
         OR (r.email_status = 'Sending' AND r.sent_at < UTC_TIMESTAMP() - INTERVAL 10 MINUTE))
     ORDER BY r.id`,
    [requestId]
  );
  const [[pricingRequest]] = await pool.execute(
    'SELECT id, reference FROM purchase_order_pricing_requests WHERE id = ?', [requestId]
  );
  if (!pricingRequest) throw httpError(404, 'Pricing request not found.');
  const summary = { total: failed.length, accepted: 0, failed: 0, skipped: 0 };
  const deliveries = [];
  for (const row of failed) {
    if (row.requestStatus !== 'Open') {
      summary.skipped += 1;
      deliveries.push({
        id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
        recipientEmail: row.supplierEmail, emailStatus: 'Skipped',
        status: 'Closed', errorDetails: { message: 'The pricing request is no longer open.' }
      });
      continue;
    }
    if (row.submissionDeadline &&
        new Date(`${row.submissionDeadline}T23:59:59Z`).getTime() <= Date.now()) {
      summary.skipped += 1;
      await pool.execute(
        `UPDATE purchase_order_pricing_responses
            SET status = 'Expired', updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND status <> 'Submitted'`,
        [row.id]
      );
      deliveries.push({
        id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
        recipientEmail: row.supplierEmail, emailStatus: 'Expired',
        status: 'Expired', errorDetails: { message: 'The configured submission deadline has passed.' }
      });
      continue;
    }

    const rawToken = liveTokens.get(String(row.id));
    if (!rawToken) {
      summary.skipped += 1;
      deliveries.push({
        id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
        recipientEmail: row.supplierEmail, emailStatus: 'LINK_TOKEN_UNAVAILABLE',
        status: row.status,
        errorDetails: {
          message: 'The original private link is no longer available in this server process. Create a new pricing request to invite this supplier again.'
        }
      });
      continue;
    }
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      summary.skipped += 1;
      await pool.execute(
        `UPDATE purchase_order_pricing_responses
            SET status = 'Expired', email_status = 'Expired', updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND status <> 'Submitted'`,
        [row.id]
      );
      deliveries.push({
        id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
        recipientEmail: row.supplierEmail, emailStatus: 'Expired',
        status: 'Expired', errorDetails: { message: 'The private link has expired.' }
      });
      continue;
    }
    const [claimed] = await pool.execute(
      `UPDATE purchase_order_pricing_responses r
       JOIN purchase_order_pricing_requests req ON req.id = r.request_id
          SET r.status = 'Pending', r.email_status = 'Sending',
            r.email_error = NULL, r.email_attempts = r.email_attempts + 1,
            r.sent_at = UTC_TIMESTAMP(), r.updated_at = UTC_TIMESTAMP()
        WHERE r.id = ? AND req.status = 'Open'
          AND (r.email_status = 'Failed' OR r.status = 'Email failed'
            OR (r.email_status = 'Pending' AND r.sent_at IS NULL)
            OR (r.email_status = 'Sending' AND r.sent_at < UTC_TIMESTAMP() - INTERVAL 10 MINUTE))`,
      [row.id]
    );
    if (!claimed.affectedRows) {
      summary.skipped += 1;
      deliveries.push({
        id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
        recipientEmail: row.supplierEmail, emailStatus: 'Skipped',
        status: 'Already processing', errorDetails: null
      });
      continue;
    }

    const [items] = await pool.execute(
      `SELECT item_no AS itemNo, item_name AS itemName, description, quantity, unit
         FROM purchase_order_pricing_response_items
        WHERE response_id = ? ORDER BY item_no, id`,
      [row.id]
    );
    const result = await sendEmail(buildSupplierPricingEmail({
      supplierName: row.supplierName,
      recipientEmail: row.supplierEmail,
      reference: row.reference,
      purchaseOrderReference: row.poReference,
      items: items.map((item) => ({
        itemNo: item.itemNo, description: item.description || item.itemName,
        quantity: item.quantity, unit: item.unit
      })),
      deliveryDate: null,
      submissionDeadline: row.submissionDeadline,
      message: row.message || '',
      rawToken,
      currency: 'RWF'
    }));
    if (result.reason === 'not_configured') summary.skipped += 1;
    else if (result.ok) summary.accepted += 1;
    else summary.failed += 1;
    await pool.execute(
      `UPDATE purchase_order_pricing_responses
          SET email_status = ?, provider_message_id = ?, provider_response = ?, email_error = ?,
            accepted_at = IF(?, UTC_TIMESTAMP(), accepted_at),
            status = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [result.status, result.providerMessageId || null, result.providerResponse || null,
        emailErrorDetails(result), result.ok ? 1 : 0,
        result.ok ? 'Invited' : 'Email failed', row.id]
    );
    await writeAudit(
      pool, actor?.id || null, result.ok ? 'pricing_request_email_accepted' : 'pricing_request_email_failed',
      'supplier_pricing_response', row.id,
      {
        requestId, reference: row.reference, supplierId: row.supplierId,
        supplierName: row.supplierName, recipientEmail: row.supplierEmail,
        emailStatus: result.status, reason: result.reason || null,
        providerMessageId: result.providerMessageId || null, error: result.error || null
      }
    );
    deliveries.push({
      id: row.id, supplierId: row.supplierId, supplierName: row.supplierName,
      recipientEmail: row.supplierEmail, emailStatus: result.status,
      status: result.ok ? 'Invited' : 'Email failed', errorDetails: result.error || null
    });
  }
  const config = emailConfigStatus();
  if (summary.skipped && config.missing.length) summary.missing = config.missing;
  return { requestId, reference: pricingRequest.reference, emailDelivery: summary, deliveries };
}

protectedRouter.post('/purchase-order-pricing/requests/:requestId/deliveries/retry-failed', allowRoles(...procurementRoles), async (req, res, next) => {
  try {
    const requestId = positiveId(req.params.requestId);
    if (!requestId) throw httpError(400, 'Invalid pricing request identifier.');
    return res.json(await retryFailedPricings(requestId, req.user));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

protectedRouter.post('/purchase-order-pricing/requests/:requestId/award', allowRoles('admin', 'committee'), async (req, res, next) => {
  let connection;
  try {
    const requestId = positiveId(req.params.requestId);
    if (!requestId) throw httpError(400, 'Invalid pricing request identifier.');
    const responseId = positiveId(req.body.responseId);
    if (!responseId) throw httpError(400, 'Choose a submitted supplier response to award.');
    const comment = boundedText(req.body.comment, 2000, 'Award comment');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[pricingRequest]] = await connection.execute(
      `SELECT id, reference, purchase_order_id AS purchaseOrderId, po_reference AS poReference,
         requisition_id AS requisitionId, status
        FROM purchase_order_pricing_requests WHERE id = ? FOR UPDATE`,
      [requestId]
    );
    if (!pricingRequest) throw httpError(404, 'Pricing request not found.');
    if (pricingRequest.status !== 'Open') throw httpError(409, 'This pricing request is not open for award.');
    const [[response]] = await connection.execute(
      `SELECT ${RESPONSE_COLUMNS}, req.requisition_id AS requisitionId
         FROM purchase_order_pricing_responses r
         JOIN purchase_order_pricing_requests req ON req.id = r.request_id
        WHERE r.id = ? AND r.request_id = ?`,
      [responseId, requestId]
    );
    if (!response) throw httpError(404, 'Supplier pricing response not found on this request.');
    if (response.status !== 'Submitted') throw httpError(409, 'Only a submitted supplier quotation can be awarded.');

    const awardedAt = utcNow();
    await connection.execute(
      `UPDATE purchase_order_pricing_requests
          SET status = 'Awarded', awarded_response_id = ?, awarded_at = ?,
            awarded_by = ?, award_comment = ?
        WHERE id = ?`,
      [responseId, awardedAt, req.user.id, comment || null, requestId]
    );
    await connection.execute('UPDATE purchase_order_pricing_responses SET awarded = 1 WHERE id = ?', [responseId]);
    await connection.execute(
      `UPDATE purchase_order_pricing_requests
          SET status = 'Closed'
        WHERE purchase_order_id = ? AND id <> ? AND status = 'Open'`,
      [pricingRequest.purchaseOrderId, requestId]
    );
    await connection.execute(
      `UPDATE purchase_order_pricing_responses
          SET status = 'Revoked', revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
        WHERE purchase_order_id = ? AND id <> ? AND status IN ('Pending','Invited','Opened','Draft','Email failed')`,
      [pricingRequest.purchaseOrderId, responseId]
    );
    await connection.execute(
      `UPDATE purchase_orders SET supplier_pricing_status = 'Awarded'
        WHERE id = ?`,
      [pricingRequest.purchaseOrderId]
    );
    await writeAudit(connection, req.user.id, 'supplier_pricing_awarded', 'purchase_order_pricing_request', requestId, {
      reference: pricingRequest.reference, responseId, supplierId: response.supplierId,
      supplierName: response.supplierName, comment: comment || null, total: response.total
    });
    await writeAudit(connection, req.user.id, 'supplier_pricing_awarded', 'supplier_pricing_response', responseId, {
      requestId, reference: pricingRequest.reference, supplierName: response.supplierName,
      comment: comment || null
    });
    await notifyProcurement(
      connection, pricingRequest.requisitionId, 'Supplier quotation awarded',
      `${pricingRequest.reference}: ${response.supplierName} was awarded. The original purchase order was not changed.`
    );
    await connection.commit();
    return res.json({
      message: 'Supplier quotation awarded. The original purchase order was not modified.',
      award: {
        requestId, reference: pricingRequest.reference, responseId,
        supplierId: response.supplierId, supplierName: response.supplierName,
        total: response.total, awardedAt, awardedBy: req.user.id, comment: comment || null
      }
    });
  } catch (error) {
    connection?.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    connection?.release();
  }
});

// ---------------------------------------------------------------------------
// Public, token-gated supplier APIs (mounted before authenticate())
// ---------------------------------------------------------------------------

publicRouter.get('/supplier-pricing/:token', async (req, res, next) => {
  try {
    const response = await findResponseByToken(req.params.token);
    if (!response) throw httpError(404, 'This supplier pricing link is invalid.');
    assertLinkUsable(response, { allowSubmittedRead: true });
    const settings = await getSettings();

    if (!response.openedAt && response.status !== 'Submitted') {
      const openedAt = utcNow();
      await pool.execute(
        "UPDATE purchase_order_pricing_responses SET opened_at = ?, status = CASE WHEN status IN ('Pending','Invited','Opened') THEN 'Opened' ELSE status END WHERE id = ? AND opened_at IS NULL",
        [openedAt, response.id]
      );
      await writeAudit(pool, null, 'pricing_link_viewed', 'purchase_order', response.purchaseOrderId, {
        responseId: response.id, requestReference: response.requestReference,
        supplierName: response.supplierName, supplierEmail: response.supplierEmail
      });
      await writeAudit(pool, null, 'pricing_link_viewed', 'supplier_pricing_response', response.id, {
        requestReference: response.requestReference, supplierName: response.supplierName
      });
    }

    const rows = await responseItems(pool, response.id);
    const isSubmitted = response.status === 'Submitted';
    return res.json({
      pricingRequest: {
        reference: response.requestReference,
        purchaseOrderReference: response.purchaseOrderReference,
        purchaseOrderType: response.purchaseOrderType,
        date: response.purchaseOrderDate,
        deliveryDate: response.deliveryDate,
        submissionDeadline: response.submissionDeadline,
        organization: {
          name: settings.organization_name,
          caption: settings.document_header,
          title: settings.system_name,
          address: settings.organization_address,
          email: settings.organization_email,
          phone: settings.organization_phone,
          city: settings.organization_city,
          country: settings.organization_country
        },
        currency: response.currency,
        vatRate: configuredVatRate(settings),
        message: response.requestMessage,
        supplier: {
          name: response.supplierName,
          contactName: response.supplierContact,
          email: response.supplierEmail,
          address: response.supplierAddress
        },
        status: response.status,
        isSubmitted,
        expiresAt: response.expiresAt
      },
      // Only the line snapshots and the supplier's own quoted figures are sent.
      items: rows.map((row) => ({
        id: row.id,
        purchaseOrderItemId: row.purchaseOrderItemId,
        itemNo: row.itemNo,
        quantity: row.quantity,
        unit: row.unit,
        description: row.description
      })),
      // The supplier's own line prices are available before submission so the
      // form opens with the price already recorded on the purchase order.
      // Another supplier's figures are never part of this token-gated view.
      response: {
        status: response.status,
        ...(isSubmitted ? {
          subtotal: response.subtotal,
          vatRate: response.vatRate,
          vatAmount: response.vatAmount,
          otherCharges: response.otherCharges,
          total: response.total,
          quotationValidity: response.quotationValidity,
          deliveryLeadTime: response.deliveryLeadTime,
          comments: response.comments,
          technicalRemarks: response.technicalRemarks,
          submittedAt: response.submittedAt
        } : {}),
        items: rows.map((row) => ({
          purchaseOrderItemId: row.purchaseOrderItemId,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal
        }))
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

async function saveSupplierQuotation(req, res, next, submitting) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const response = await findResponseByToken(req.params.token, connection, true);
    if (!response) throw httpError(404, 'This supplier pricing link is invalid.');
    if (response.status === 'Submitted') throw httpError(409, 'This quotation has already been submitted.');
    assertLinkUsable(response, { requireOpen: true });
    if (submitting && req.body.confirm !== true) {
      throw httpError(400, 'Confirm the submission before sending your prices.');
    }

    const [expected] = await connection.execute(
      `SELECT id, purchase_order_item_id AS purchaseOrderItemId, item_no AS itemNo,
         item_name AS itemName, description, quantity, unit
        FROM purchase_order_pricing_response_items
       WHERE response_id = ? ORDER BY item_no, id FOR UPDATE`,
      [response.id]
    );
    if (!expected.length) throw httpError(409, 'There are no items to price on this request.');
    const lines = quotedItems(req.body.items, expected, {
      requireAll: submitting,
      allowBlank: !submitting
    });
    const settings = await getSettings();
    const totals = quotedTotals(lines, settings.tax_rate, response, req.body);
    const status = submitting ? 'Submitted'
      : (['Opened', 'Invited', 'Draft'].includes(response.status) ? response.status : 'Draft');
    await persistQuotation(connection, response, lines, totals, req.body, status);
    if (submitting) {
      await connection.execute(
        'UPDATE purchase_order_pricing_responses SET submitted_at = UTC_TIMESTAMP() WHERE id = ?',
        [response.id]
      );
    }
    await writeAudit(
      connection, null, submitting ? 'pricing_response_submitted' : 'pricing_draft_saved',
      'supplier_pricing_response', response.id,
      {
        requestId: response.requestId, requestReference: response.requestReference,
        supplierName: response.supplierName, total: totals.total,
        submitted: submitting
      }
    );
    if (submitting) {
      await notifyProcurement(
        connection, response.requisitionId, 'Supplier quotation submitted',
        `${response.supplierName} submitted prices for ${response.requestReference}.`
      );
    }
    await connection.commit();

    const [freshRows] = await pool.execute(
      `SELECT ${RESPONSE_COLUMNS} FROM purchase_order_pricing_responses r WHERE r.id = ?`,
      [response.id]
    );
    const view = responseView(freshRows[0], await responseItems(pool, response.id));
    return res.json({
      message: submitting
        ? 'Your prices were submitted successfully.'
        : 'Your draft prices were saved.',
      reference: response.requestReference,
      response: view
    });
  } catch (error) {
    connection?.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    connection?.release();
  }
}

publicRouter.patch('/supplier-pricing/:token/draft', async (req, res, next) => (
  saveSupplierQuotation(req, res, next, false)
));

publicRouter.post('/supplier-pricing/:token/submit', async (req, res, next) => (
  saveSupplierQuotation(req, res, next, true)
));

export default protectedRouter;

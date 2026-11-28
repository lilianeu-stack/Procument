import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import {
  businessDate, businessDateTime, dateFilterClause, enforceDateOrder, parseDateFilter, toUtcDateTime
} from '../utils/dates.js';
import { PROCUREMENT_READY_STATUSES, REQUISITION_STATUS } from '../utils/requisition-status.js';
import { createRfqEmailDeliveries, listRfqDeliveries, sendRfqDeliveries } from '../services/rfq-email.js';
import {
  buildGoodReceivedNoteEmail, buildPurchaseOrderDecisionEmail,
  buildPurchaseOrderReviewEmail, sendEmail
} from '../services/email.js';
import { fetchRecord, renderRecordPdf } from '../services/exports.js';
import { getSettings } from '../services/settings.js';
import { emailConfigStatus } from '../utils/email-config.js';
import { amountInWords, calculatePurchaseTotals, roundMoney } from '../utils/money.js';
import { normalizeSignature } from '../utils/signature.js';
import {
  createPurchaseOrderApprovalToken, hashPurchaseOrderApprovalToken,
  isValidPurchaseOrderApprovalToken
} from '../utils/purchase-order-approval-token.js';

const router = Router();
const procurement = ['admin', 'procurement'];
const approvers = ['admin', 'approver'];
const committee = ['admin', 'committee'];
const finance = ['admin', 'finance'];
const stores = ['admin', 'storekeeper', 'procurement'];
const PO_APPROVAL_LINK_HOURS = 72;
const RFQ_STATUSES = ['Draft', 'Sent', 'Evaluating', 'Awarded', 'Closed'];
const RFQ_SORT_FIELDS = {
  reference: 'f.reference',
  requisition: 'r.reference',
  rfqDate: 'COALESCE(f.issued_at, f.created_at)',
  dueDate: 'f.due_date',
  invitedSuppliers: 'invitedSuppliers',
  quotations: 'quotations',
  status: 'f.status',
  createdAt: 'f.created_at'
};

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// The original requisition stays authoritative; sending an RFQ only advances
// its workflow stage once and records that transition in its own history.
async function markRequisitionInProcurement(connection, requisition, userId, rfqReference) {
  const nextStatus = [
    REQUISITION_STATUS.FORWARDED, REQUISITION_STATUS.APPROVED, REQUISITION_STATUS.UNDER_REVIEW
  ].includes(requisition.status) ? REQUISITION_STATUS.UNDER_REVIEW : 'In procurement';
  await connection.execute('UPDATE requisitions SET status = ? WHERE id = ?', [nextStatus, requisition.id]);
  await connection.execute(
    `INSERT INTO requisition_activity
       (requisition_id, user_id, action, details, previous_status, new_status)
     VALUES (?, ?, 'procurement_review_started', ?, ?, ?)`,
    [requisition.id, userId, JSON.stringify({ rfqReference }), requisition.status, nextStatus]
  );
  await createNotification(connection, requisition.requesterId, 'Request under Procurement review',
    `${requisition.reference} is now being processed by Procurement.`,
    `#/requester/My%20Procurement%20Requests?request=${requisition.id}`);
  return nextStatus;
}

function reference(prefix) {
  return `${prefix}-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function rwf(value) {
  return `RWF ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function configuredVatRate(settings) {
  const rate = Number(settings?.tax_rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

function approvalLinkHours() {
  const configured = Number(process.env.PO_APPROVAL_LINK_HOURS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 720 ? configured : PO_APPROVAL_LINK_HOURS;
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function recordEmailOutcome(userId, orderId, action, delivery, extra = {}) {
  await writeAudit(
    pool, userId, action, 'purchase_order', orderId,
    {
      ...extra,
      emailStatus: delivery?.status || 'Failed',
      emailReason: delivery?.reason || null,
      emailError: delivery?.error?.message || null,
      providerMessageId: delivery?.providerMessageId || null
    }
  );
}

export function emailFailureMessage(delivery, successMessage, subject = 'request') {
  if (delivery?.ok) return successMessage;
  const reason = delivery?.error?.message || delivery?.reason || 'unknown email error';
  return `${successMessage} The ${subject} was recorded, but the email was not delivered: ${reason}`;
}

function emailDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function parsePurchaseOrderItems(value) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); }
    catch { throw httpError(400, 'Purchase order items are not valid JSON.'); }
  }
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'Add at least one item to the purchase order.');
  if (items.length > 100) throw httpError(400, 'A purchase order can contain at most 100 items.');
  const seenIds = new Set();
  return items.map((item) => {
    const id = item.id === undefined || item.id === null || item.id === ''
      ? null : Number(item.id);
    if (id !== null && (!Number.isInteger(id) || id < 1)) throw httpError(400, 'An item has an invalid identifier.');
    if (id !== null && seenIds.has(id)) throw httpError(400, 'The same item cannot appear twice in a purchase order.');
    if (id !== null) seenIds.add(id);
    const itemName = text(item.itemName || item.name, 180);
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!itemName || !Number.isInteger(quantity) || quantity < 1 ||
        !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw httpError(400, 'Each item needs a name, a positive whole quantity, and a valid unit price.');
    }
    return {
      id,
      itemName,
      description: text(item.description, 2000),
      quantity,
      unit: text(item.unit, 30) || 'unit',
      unitPrice: Math.round(unitPrice * 10000) / 10000
    };
  });
}

async function loadLatestApproval(executor, purchaseOrderId) {
  const [rows] = await executor.execute(
    `SELECT a.id, a.status, a.sent_at AS sentAt, a.expires_at AS expiresAt,
       a.viewed_at AS viewedAt, a.decided_at AS decidedAt,
       a.decision_comment AS decisionComment, a.message,
       a.recipient_user_id AS recipientUserId, a.recipient_name AS recipientName,
       a.recipient_email AS recipientEmail, a.recipient_role AS recipientRole,
       a.sender_user_id AS senderUserId, a.sender_name AS senderName,
       a.sender_email AS senderEmail
      FROM purchase_order_approval_requests a
     WHERE a.purchase_order_id = ?
     ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
    [purchaseOrderId]
  );
  return rows[0] || null;
}

export async function loadPurchaseOrder(executor, id) {
  const [[order]] = await executor.execute(
    `SELECT p.id, p.reference, p.type, p.status,
      p.supplier_pricing_status AS supplierPricingStatus,
      p.delivery_date AS deliveryDate,
      p.supplier_id AS supplierId, p.supplier_contact AS supplierContact,
      p.supplier_address AS supplierAddress,
      p.prepared_signature AS preparedSignature, p.approved_signature AS approvedSignature,
      p.subtotal, p.vat_rate AS vatRate, p.vat_amount AS vatAmount,
      p.amount_in_words AS amountInWords, p.total,
      p.approved_at AS approvedAt, p.created_at AS createdAt, p.updated_at AS updatedAt,
      s.name AS supplier, r.reference AS requisition, r.id AS requisitionId,
      f.reference AS rfq, f.id AS rfqId,
      creator.name AS preparedBy, reviewer.name AS approvedBy
     FROM purchase_orders p
     JOIN suppliers s ON s.id = p.supplier_id
     JOIN rfqs f ON f.id = p.rfq_id
     JOIN requisitions r ON r.id = f.requisition_id
     JOIN users creator ON creator.id = p.created_by
     LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
     WHERE p.id = ?`,
    [id]
  );
  if (!order) throw httpError(404, 'Purchase order not found.');
  const [items] = await executor.execute(
    `SELECT id, item_name AS itemName, description, quantity, unit,
      unit_price AS unitPrice, line_total AS lineTotal
     FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id`,
    [id]
  );
  const approval = await loadLatestApproval(executor, id);
  const [[pricingAwardRow]] = await executor.execute(
    `SELECT req.id AS requestId, req.reference AS requestReference,
       req.awarded_at AS awardedAt, req.award_comment AS awardComment,
       res.id AS responseId, res.supplier_id AS supplierId,
       res.supplier_name AS supplierName, res.supplier_email AS supplierEmail,
       res.supplier_contact AS supplierContact, res.supplier_address AS supplierAddress,
       res.currency, res.subtotal, res.vat_rate AS vatRate,
       res.vat_amount AS vatAmount, res.other_charges AS otherCharges, res.total,
       res.quotation_validity AS quotationValidity,
       res.delivery_lead_time AS deliveryLeadTime,
       res.comments, res.technical_remarks AS technicalRemarks
      FROM purchase_order_pricing_requests req
      JOIN purchase_order_pricing_responses res ON res.id = req.awarded_response_id
     WHERE req.purchase_order_id = ? AND req.status = 'Awarded'
     ORDER BY req.awarded_at DESC, req.id DESC LIMIT 1`,
    [id]
  );
  let supplierPricingAward = null;
  if (pricingAwardRow) {
    const [awardItems] = await executor.execute(
      `SELECT purchase_order_item_id AS purchaseOrderItemId, item_no AS itemNo,
         item_name AS itemName, description, quantity, unit,
         unit_price AS unitPrice, line_total AS lineTotal
        FROM purchase_order_pricing_response_items
       WHERE response_id = ? ORDER BY item_no, id`,
      [pricingAwardRow.responseId]
    );
    supplierPricingAward = {
      ...pricingAwardRow,
      subtotal: roundMoney(pricingAwardRow.subtotal),
      vatRate: roundMoney(pricingAwardRow.vatRate),
      vatAmount: roundMoney(pricingAwardRow.vatAmount),
      otherCharges: roundMoney(pricingAwardRow.otherCharges),
      total: roundMoney(pricingAwardRow.total),
      amountInWords: amountInWords(pricingAwardRow.total),
      items: awardItems.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitPrice: roundMoney(item.unitPrice),
        lineTotal: roundMoney(item.lineTotal)
      }))
    };
  }
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    supplierPricingStatus: order.supplierPricingStatus || 'Not requested',
    supplierPricingAward,
    approval,
    decidedAt: approval?.decidedAt || order.approvedAt || null,
    type: order.type,
    deliveryDate: order.deliveryDate,
    supplier: order.supplier,
    supplierId: order.supplierId,
    supplierContact: order.supplierContact,
    supplierAddress: order.supplierAddress,
    preparedSignature: order.preparedSignature || null,
    approvedSignature: order.approvedSignature || null,
    preparedBy: order.preparedBy,
    approvedBy: order.approvedBy || null,
    approvedAt: order.approvedAt || null,
    requisition: order.requisition,
    requisitionId: order.requisitionId,
    rfq: order.rfq,
    rfqId: order.rfqId,
    subtotal: roundMoney(order.subtotal),
    vatRate: roundMoney(order.vatRate),
    vatAmount: roundMoney(order.vatAmount),
    total: roundMoney(order.total),
    amountInWords: order.amountInWords || amountInWords(order.total),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: roundMoney(item.unitPrice),
      lineTotal: roundMoney(item.lineTotal)
    }))
  };
}

async function configuredReference(settingKey, fallbackPrefix) {
  const settings = await getSettings();
  return reference(settings[settingKey] || fallbackPrefix);
}

async function duplicateRfqResponse(rfq) {
  const deliveries = await listRfqDeliveries(rfq.id);
  return {
    status: 200,
    body: {
      id: rfq.id,
      reference: rfq.reference,
      status: rfq.status || 'Sent',
      message: 'This RFQ was already submitted. Existing delivery statuses are shown; no duplicate was created.',
      emailDelivery: rfq.status === 'Draft' ? null : deliveries.summary,
      duplicate: true
    }
  };
}

export async function transaction(handler, res, next) {
  const connection = await pool.getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    committed = true;
    // Email sends run only after the RFQ is committed. Failure is recorded as a
    // delivery status, never as a rollback of the original procurement record.
    if (typeof result.afterCommit === 'function') await result.afterCommit();
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    if (!committed) await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

// Secure review links carry no database identifiers. The random token is
// hashed before lookup; only the matching approval record can reveal the PO.
export async function findApprovalByToken(executor, token) {
  if (!isValidPurchaseOrderApprovalToken(token)) return null;
  const [rows] = await executor.execute(
    `SELECT a.id, a.purchase_order_id AS purchaseOrderId, a.po_reference AS poReference,
       a.total, a.sender_user_id AS senderUserId, a.sender_name AS senderName,
       a.sender_email AS senderEmail, a.recipient_user_id AS recipientUserId,
       a.recipient_name AS recipientName, a.recipient_email AS recipientEmail,
       a.recipient_role AS recipientRole, a.token_hash AS tokenHash, a.status,
       a.message, a.sent_at AS sentAt, a.expires_at AS expiresAt,
       a.viewed_at AS viewedAt, a.decided_at AS decidedAt,
       a.decision_comment AS decisionComment, p.status AS purchaseOrderStatus
      FROM purchase_order_approval_requests a
      JOIN purchase_orders p ON p.id = a.purchase_order_id
     WHERE a.token_hash = ? LIMIT 1`,
    [hashPurchaseOrderApprovalToken(token)]
  );
  return rows[0] || null;
}

export function assertApprovalLinkUsable(approval) {
  if (!approval) throw httpError(404, 'This approval link is invalid.');
  if (approval.status === 'Revoked') throw httpError(410, 'This approval link has been revoked.');
  if (approval.status === 'Superseded') throw httpError(410, 'A newer approval link was sent for this purchase order.');
  if (approval.status === 'Expired' || (approval.status === 'Pending' && new Date(approval.expiresAt).getTime() <= Date.now())) {
    throw httpError(410, 'This approval link has expired. Ask the sender to issue a new one.');
  }
  if (approval.status === 'Pending' && approval.purchaseOrderStatus !== 'Pending approval') {
    throw httpError(409, 'This purchase order has already been decided.');
  }
  if (!['Pending', 'Approved', 'Rejected'].includes(approval.status)) {
    throw httpError(410, 'This approval link is no longer active.');
  }
}

export function assertApprovalRecipient(user, approval) {
  if (!user) {
    throw httpError(401, 'Sign in with the intended recipient account to open this approval link.');
  }
  if (!approvers.includes(user.role) || Number(user.id) !== Number(approval.recipientUserId)) {
    throw httpError(403, 'This approval link is reserved for another registered user.');
  }
}

export async function expireApprovalIfNeeded(executor, approval) {
  if (approval?.status === 'Pending' && new Date(approval.expiresAt).getTime() <= Date.now()) {
    await executor.execute(
      "UPDATE purchase_order_approval_requests SET status = 'Expired' WHERE id = ? AND status = 'Pending'",
      [approval.id]
    );
    approval.status = 'Expired';
  }
  return approval;
}

export async function approvalView(executor, approval) {
  const purchaseOrder = await loadPurchaseOrder(executor, approval.purchaseOrderId);
  const [users] = await executor.execute(
    'SELECT id, name, email, role, active FROM users WHERE id IN (?, ?)',
    [approval.senderUserId || 0, approval.recipientUserId || 0]
  );
  const senderUser = users.find((row) => Number(row.id) === Number(approval.senderUserId));
  const recipientUser = users.find((row) => Number(row.id) === Number(approval.recipientUserId));
  return {
    id: approval.id,
    status: approval.status,
    message: approval.message || '',
    sentAt: approval.sentAt,
    expiresAt: approval.expiresAt,
    viewedAt: approval.viewedAt || null,
    decidedAt: approval.decidedAt || null,
    decisionComment: approval.decisionComment || '',
    sender: {
      id: approval.senderUserId,
      name: approval.senderName,
      email: approval.senderEmail,
      role: senderUser?.role || 'admin'
    },
    recipient: {
      id: approval.recipientUserId,
      name: approval.recipientName,
      email: approval.recipientEmail,
      role: recipientUser?.role || approval.recipientRole
    },
    purchaseOrder: { ...purchaseOrder, decidedAt: approval.decidedAt || purchaseOrder.decidedAt || null }
  };
}

export async function recordPurchaseOrderDecision(connection, {
  id, approval = null, decision, comment = '', actorId
}) {
  const [[order]] = await connection.execute(
    `SELECT p.id, p.reference, p.status,
       p.supplier_pricing_status AS supplierPricingStatus,
       p.total, p.created_by AS createdBy,
       r.id AS requisitionId, f.reference AS rfq
      FROM purchase_orders p
      JOIN rfqs f ON f.id = p.rfq_id
      JOIN requisitions r ON r.id = f.requisition_id
     WHERE p.id = ? FOR UPDATE`,
    [id]
  );
  if (!order) throw httpError(404, 'Purchase order not found.');
  if (order.status !== 'Pending approval') throw httpError(409, 'This purchase order has already been decided.');
  if (['Required', 'Collecting'].includes(order.supplierPricingStatus)) {
    throw httpError(409, 'Award a submitted Supplier quotation before internal approval.');
  }

  if (approval) {
    if (approval.status !== 'Pending') throw httpError(409, 'This approval request is no longer pending.');
    if (Number(approval.recipientUserId) !== Number(actorId)) {
      throw httpError(403, 'Only the intended recipient can record this decision.');
    }
    if (new Date(approval.expiresAt).getTime() <= Date.now()) {
      throw httpError(410, 'This approval link has expired. Ask the sender to issue a new one.');
    }
  }

  const [result] = await connection.execute(
    `UPDATE purchase_orders
        SET status = ?, reviewed_by = ?, approved_at = IF(?, UTC_TIMESTAMP(), approved_at)
      WHERE id = ? AND status = 'Pending approval'`,
    [decision, actorId, decision === 'Approved' ? 1 : 0, id]
  );
  if (!result.affectedRows) throw httpError(409, 'This purchase order has already been decided.');

  const decisionComment = text(comment, 2000) || null;
  if (approval) {
    const [updated] = await connection.execute(
      `UPDATE purchase_order_approval_requests
          SET status = ?, decided_at = UTC_TIMESTAMP(), decision_comment = ?
        WHERE id = ? AND status = 'Pending'`,
      [decision, decisionComment, approval.id]
    );
    if (!updated.affectedRows) throw httpError(409, 'This approval request is no longer pending.');
  }

  await writeAudit(
    connection, actorId, decision.toLowerCase(), 'purchase_order', id,
    {
      reference: order.reference,
      comment: decisionComment,
      approvalRequestId: approval?.id || null,
      senderUserId: approval?.senderUserId || null,
      recipientUserId: approval?.recipientUserId || null
    },
    { previousStatus: 'Pending approval', newStatus: decision }
  );
  await createNotification(
    connection, null, `Purchase order ${decision.toLowerCase()}`,
    `${order.reference} was ${decision.toLowerCase()}.`, `/purchase-orders/${id}`
  );
  if (approval?.senderUserId) {
    await createNotification(
      connection, approval.senderUserId, `Purchase order ${decision.toLowerCase()}`,
      `${order.reference} was ${decision.toLowerCase()}${decisionComment ? `: ${decisionComment}` : ''}.`,
      `/purchase-orders/${id}`
    );
  }
  return { order, approval };
}

export async function notifySenderOfDecision(actorId, approval, decision, decisionComment) {
  if (!approval?.senderUserId || !approval.senderEmail) return null;
  const delivery = await sendEmail(buildPurchaseOrderDecisionEmail({
    recipientName: approval.senderName,
    recipientEmail: approval.senderEmail,
    reviewerName: approval.recipientName,
    reference: approval.poReference,
    poNumber: approval.poReference,
    decision,
    comment: decisionComment || ''
  }));
  await recordEmailOutcome(
    actorId, approval.purchaseOrderId, 'decision_email_sent', delivery,
    { approvalRequestId: approval.id, to: approval.senderEmail, decision }
  );
  return delivery;
}

function rfqBaseQuery() {
  return `SELECT f.id, f.reference, f.status, f.due_date AS dueDate,
    f.instructions, f.terms,
    f.issued_at AS issuedAt, f.closed_at AS closedAt,
    f.created_at AS createdAt, f.updated_at AS updatedAt,
    r.reference AS requisition, r.id AS requisitionId, r.title AS requisitionTitle,
    q.supplier_id AS selectedSupplierId, q.amount AS awardedAmount,
    s.name AS selectedSupplier,
    s.contact_name AS selectedSupplierContactName,
    s.phone AS selectedSupplierPhone, s.email AS selectedSupplierEmail,
    s.address AS selectedSupplierAddress,
    CONCAT_WS(' / ', NULLIF(s.contact_name, ''), NULLIF(s.phone, ''), NULLIF(s.email, '')) AS selectedSupplierContact,
    CONCAT_WS(' / ', NULLIF(s.contact_name, ''), NULLIF(s.phone, ''), NULLIF(s.email, '')) AS awardedSupplierContact,
    s.address AS awardedSupplierAddress,
    COUNT(DISTINCT fs.supplier_id) AS invitedSuppliers,
    COUNT(DISTINCT qt.id) AS quotations
   FROM rfqs f JOIN requisitions r ON r.id = f.requisition_id
   LEFT JOIN rfq_suppliers fs ON fs.rfq_id = f.id
   LEFT JOIN quotations qt ON qt.rfq_id = f.id
   LEFT JOIN quotations q ON q.id = f.selected_quotation_id
   LEFT JOIN suppliers s ON s.id = q.supplier_id`;
}

router.get('/rfqs', async (req, res, next) => {
  try {
    const columns = { issued: 'f.issued_at', due: 'f.due_date', closed: 'f.closed_at', created: 'f.created_at' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'issued' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const dateClause = dateFilterClause(filter, columns, params).replace(/^\s*AND\s*/i, '');
    const where = dateClause ? [dateClause] : [];

    const reference = String(req.query.reference || '').trim().slice(0, 120);
    if (reference) { where.push('f.reference LIKE ?'); params.push(`%${reference}%`); }
    const supplier = String(req.query.supplier || '').trim().slice(0, 120);
    if (supplier) {
      where.push(`EXISTS (
        SELECT 1 FROM rfq_suppliers fsi JOIN suppliers si ON si.id = fsi.supplier_id
        WHERE fsi.rfq_id = f.id AND (si.name LIKE ? OR si.email LIKE ?)
      )`);
      params.push(`%${supplier}%`, `%${supplier}%`);
    }
    const requisition = String(req.query.requisition || '').trim().slice(0, 120);
    if (requisition) {
      where.push('(r.reference LIKE ? OR r.title LIKE ?)');
      params.push(`%${requisition}%`, `%${requisition}%`);
    }
    const status = String(req.query.status || '').trim().slice(0, 40);
    if (status) {
      if (!RFQ_STATUSES.includes(status)) return res.status(400).json({ message: 'Unsupported RFQ status.' });
      where.push('f.status = ?');
      params.push(status);
    }
    const hasResponses = String(req.query.hasResponses || '').trim().toLowerCase();
    let having = '';
    if (hasResponses === 'yes') having = 'HAVING COUNT(DISTINCT qt.id) > 0';
    if (hasResponses === 'no') having = 'HAVING COUNT(DISTINCT qt.id) = 0';

    const base = `${rfqBaseQuery()} WHERE ${where.length ? where.join(' AND ') : '1 = 1'} GROUP BY f.id ${having}`;
    const sort = RFQ_SORT_FIELDS[String(req.query.sort || '')] || RFQ_SORT_FIELDS.rfqDate;
    const direction = String(req.query.direction || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    const page = positiveInt(req.query.page, 1);
    const limit = Math.min(positiveInt(req.query.limit, 10), 100);

    async function withResponses(rows) {
      if (!rows.length) return rows;
      const ids = rows.map((row) => Number(row.id));
      const [responseRows] = await pool.query(
        `SELECT q.id, q.rfq_id AS rfqId, q.amount, q.delivery_days AS deliveryDays,
           q.notes, q.submitted_at AS submittedAt, s.name AS supplier
         FROM quotations q JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.rfq_id IN (${ids.map(() => '?').join(',')})
        ORDER BY q.rfq_id, q.amount, q.delivery_days`,
        ids
      );
      const [responseItemRows] = await pool.query(
        `SELECT qi.quotation_id AS quotationId, qi.item_name AS itemName, qi.description,
           qi.quantity, qi.unit, qi.unit_price AS unitPrice, qi.line_total AS lineTotal, qi.comment
         FROM quotation_items qi
        WHERE qi.quotation_id IN (${responseRows.map((row) => row.id).join(',') || '0'})
        ORDER BY qi.quotation_id, qi.id`
      );
      const responsesByRfq = new Map();
      for (const row of responseRows) {
        const rfqId = Number(row.rfqId);
        if (!responsesByRfq.has(rfqId)) responsesByRfq.set(rfqId, []);
        responsesByRfq.get(rfqId).push({
          id: row.id,
          supplier: row.supplier,
          amount: Number(row.amount) || 0,
          deliveryDays: Number(row.deliveryDays) || 0,
          notes: row.notes || '',
          submittedAt: row.submittedAt,
          items: []
        });
      }
      for (const item of responseItemRows) {
        for (const response of responsesByRfq.values()) {
          const quote = response.find((entry) => Number(entry.id) === Number(item.quotationId));
          if (quote) {
            quote.items.push({
              itemName: item.itemName,
              description: item.description || '',
              quantity: Number(item.quantity) || 0,
              unit: item.unit || 'unit',
              unitPrice: Number(item.unitPrice) || 0,
              lineTotal: Number(item.lineTotal) || 0,
              comment: item.comment || ''
            });
            break;
          }
        }
      }
      return rows.map((rfq) => ({ ...rfq, responses: responsesByRfq.get(Number(rfq.id)) || [] }));
    }

    if (!paginated) {
      const [rfqs] = await pool.query(`${base} ORDER BY ${sort} ${direction}, f.id DESC`, params);
      return res.json({ rfqs: await withResponses(rfqs) });
    }

    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM (${base}) counted`, params);
    const [rfqs] = await pool.execute(
      `${base} ORDER BY ${sort} ${direction}, f.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const total = Number(countRow?.total) || 0;
    return res.json({
      rfqs: await withResponses(rfqs),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) { return next(error); }
});

router.get('/rfqs/stats', async (_req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(f.status = 'Draft'), 0) AS draft,
        COALESCE(SUM(f.status = 'Sent'), 0) AS sent,
        COALESCE(SUM(f.status = 'Evaluating'), 0) AS evaluating,
        COALESCE(SUM(f.status = 'Awarded'), 0) AS awarded,
        COALESCE(SUM(f.status = 'Sent' AND COALESCE(qc.responses, 0) = 0), 0) AS awaitingResponses,
        COALESCE(SUM(COALESCE(qc.responses, 0) > 0), 0) AS receivedQuotations,
        COALESCE(SUM(f.status = 'Closed'), 0) AS closed
       FROM rfqs f
       LEFT JOIN (
         SELECT rfq_id, COUNT(*) AS responses FROM quotations GROUP BY rfq_id
       ) qc ON qc.rfq_id = f.id`
    );
    return res.json({
      stats: {
        total: Number(row?.total) || 0,
        draft: Number(row?.draft) || 0,
        sent: Number(row?.sent) || 0,
        evaluating: Number(row?.evaluating) || 0,
        awarded: Number(row?.awarded) || 0,
        awaitingResponses: Number(row?.awaitingResponses) || 0,
        receivedQuotations: Number(row?.receivedQuotations) || 0,
        closed: Number(row?.closed) || 0
      }
    });
  } catch (error) { return next(error); }
});

router.post('/rfqs', allowRoles(...procurement), async (req, res, next) => {
  const requisitionId = Number(req.body.requisitionId);
  const supplierIds = [...new Set((Array.isArray(req.body.supplierIds) ? req.body.supplierIds : []).map(Number))];
  if (!Number.isInteger(requisitionId) || supplierIds.length < 1 ||
      supplierIds.some((id) => !Number.isInteger(id) || id < 1)) {
    return res.status(400).json({ message: 'Select an approved requisition and at least one valid supplier.' });
  }
  let startDate;
  let dueDate;
  try {
    startDate = businessDateTime(req.body.startDate, 'Send start date', { allowPast: false });
    dueDate = businessDateTime(req.body.dueDate, 'End date (deadline)', { allowPast: false });
    enforceDateOrder(
      { 'Send start date': startDate, 'End date (deadline)': dueDate },
      [['Send start date', 'End date (deadline)']]
    );
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const saveAsDraft = req.body.saveAsDraft === true;
  const instructions = text(req.body.instructions, 4000);
  const terms = text(req.body.terms, 4000);
  const idempotencyKey = String(req.body.idempotencyKey || '').trim().slice(0, 80);
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (idempotencyKey) {
    const [existingRows] = await pool.execute('SELECT id, reference FROM rfqs WHERE idempotency_key = ?', [idempotencyKey]);
    if (existingRows[0]) {
      const duplicate = await duplicateRfqResponse(existingRows[0]);
      return res.status(duplicate.status).json(duplicate.body);
    }
  }
  return transaction(async (connection) => {
    const readyPlaceholders = PROCUREMENT_READY_STATUSES.map(() => '?').join(',');
    const [requests] = await connection.execute(
      `SELECT id, reference, requester_id AS requesterId, status,
        supervisor_id AS supervisorId, forwarded_by_supervisor AS forwardedBySupervisor
       FROM requisitions WHERE id = ? AND status IN (${readyPlaceholders}) FOR UPDATE`,
      [requisitionId, ...PROCUREMENT_READY_STATUSES]
    );
    const requisition = requests[0];
    if (!requisition) {
      const error = new Error('A request explicitly forwarded by a Department Supervisor is required to create an RFQ.');
      error.status = 409;
      throw error;
    }
    // Defense in depth: a Department request can never enter Procurement
    // processing unless the Supervisor's forwarding action actually completed.
    if (requisition.supervisorId != null && requisition.forwardedBySupervisor == null) {
      const error = new Error('This request has not been forwarded to Procurement by its Department Supervisor.');
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
    if (idempotencyKey) {
      const [existingRows] = await connection.execute(
        'SELECT id, reference FROM rfqs WHERE idempotency_key = ?', [idempotencyKey]
      );
      if (existingRows[0]) return duplicateRfqResponse(existingRows[0]);
    }
    const rfqReference = reference('RFQ');
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO rfqs
           (reference, idempotency_key, requisition_id, due_date, instructions, terms, message, status, issued_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rfqReference, idempotencyKey || null, requisitionId, dueDate,
          instructions || null, terms || null, message || null,
          saveAsDraft ? 'Draft' : 'Sent', saveAsDraft ? null : startDate, req.user.id
        ]
      );
    } catch (error) {
      // A concurrent double-click can race the pre-check. The unique key makes
      // the second request return the original RFQ instead of creating another.
      if (error?.code === 'ER_DUP_ENTRY' && idempotencyKey) {
        const [existingRows] = await pool.execute(
          'SELECT id, reference FROM rfqs WHERE idempotency_key = ?', [idempotencyKey]
        );
        if (existingRows[0]) return duplicateRfqResponse(existingRows[0]);
      }
      throw error;
    }
    for (const supplierId of supplierIds) {
      await connection.execute('INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES (?, ?)', [result.insertId, supplierId]);
    }
    let nextStatus = requisition.status;
    let emailDeliveries = [];
    if (!saveAsDraft) {
      emailDeliveries = await createRfqEmailDeliveries(connection, {
        rfqId: result.insertId,
        reference: rfqReference,
        supplierIds
      });
      nextStatus = await markRequisitionInProcurement(connection, requisition, req.user.id, rfqReference);
      await createNotification(connection, null, 'New request for quotation',
        `${rfqReference} was issued to ${supplierIds.length} suppliers.`, `/rfqs/${result.insertId}`);
    }
    await writeAudit(
      connection, req.user.id, saveAsDraft ? 'draft_created' : 'created', 'rfq', result.insertId,
      { reference: rfqReference, requisitionReference: requisition.reference, supplierCount: supplierIds.length },
      { previousStatus: requisition.status, newStatus: saveAsDraft ? 'Draft' : nextStatus }
    );
    const responseBody = {
      id: result.insertId,
      reference: rfqReference,
      status: saveAsDraft ? 'Draft' : 'Sent',
      message: saveAsDraft
        ? 'RFQ saved as a draft. No supplier email has been sent yet.'
        : 'RFQ created. Supplier email delivery was attempted; see email delivery status for the result.',
      emailDelivery: saveAsDraft ? null : { total: emailDeliveries.length }
    };
    return {
      status: 201,
      body: responseBody,
      afterCommit: saveAsDraft ? undefined : async () => {
        responseBody.emailDelivery = await sendRfqDeliveries({ rfqId: result.insertId });
      }
    };
  }, res, next);
});

async function rfqDetail(rfqId) {
  const [[rfq]] = await pool.execute(
    `SELECT f.id, f.reference, f.status, f.due_date AS dueDate, f.instructions, f.terms,
      f.issued_at AS issuedAt, f.closed_at AS closedAt, f.created_at AS createdAt,
      f.requisition_id AS requisitionId, r.reference AS requisition, r.title AS requisitionTitle,
      r.justification, r.priority, r.required_by AS requiredBy,
      d.name AS department, u.name AS createdBy,
      q.id AS selectedQuotationId, q.amount AS awardedAmount, s.name AS selectedSupplier
     FROM rfqs f
     JOIN requisitions r ON r.id = f.requisition_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN users u ON u.id = f.created_by
     LEFT JOIN quotations q ON q.id = f.selected_quotation_id
     LEFT JOIN suppliers s ON s.id = q.supplier_id
    WHERE f.id = ?`,
    [rfqId]
  );
  if (!rfq) return null;
  const [items] = await pool.execute(
    `SELECT id, item_name AS itemName, description, quantity, unit,
      estimated_unit_cost AS estimatedUnitCost
     FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
    [rfq.requisitionId]
  );
  const [suppliers] = await pool.execute(
    `SELECT s.id, s.name, s.contact_name AS contactName, s.email, s.phone, s.status,
      (SELECT d.status FROM rfq_email_deliveries d
        WHERE d.rfq_id = ? AND d.supplier_id = s.id ORDER BY d.id DESC LIMIT 1) AS emailStatus,
      (SELECT COUNT(*) FROM rfq_email_deliveries d
        WHERE d.rfq_id = ? AND d.supplier_id = s.id) AS emailAttempts,
      (SELECT COUNT(*) FROM quotations q
        WHERE q.rfq_id = ? AND q.supplier_id = s.id) AS responses
     FROM rfq_suppliers fs JOIN suppliers s ON s.id = fs.supplier_id
    WHERE fs.rfq_id = ? ORDER BY s.name`,
    [rfqId, rfqId, rfqId, rfqId]
  );
  const [quotations] = await pool.execute(
    `SELECT q.id, q.supplier_id AS supplierId, s.name AS supplier, q.amount,
      q.delivery_days AS deliveryDays, q.quality_score AS qualityScore,
      q.rating_score AS ratingScore, q.notes, q.submitted_at AS submittedAt,
      (f.selected_quotation_id = q.id) AS selected
     FROM quotations q JOIN suppliers s ON s.id = q.supplier_id JOIN rfqs f ON f.id = q.rfq_id
    WHERE q.rfq_id = ? ORDER BY q.amount, q.delivery_days`,
    [rfqId]
  );
  const [activity] = await pool.execute(
    `SELECT a.id, a.action, a.details, a.created_at AS createdAt,
      a.previous_status AS previousStatus, a.new_status AS newStatus,
      COALESCE(u.name, 'System') AS actor
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity_type = 'rfq' AND a.entity_id = ? ORDER BY a.created_at, a.id`,
    [rfqId]
  );
  return {
    rfq: {
      ...rfq,
      invitedSuppliers: suppliers.length,
      quotations: quotations.length
    },
    items,
    suppliers,
    quotations,
    activity
  };
}

router.get('/rfqs/:id', allowRoles(...procurement, ...committee), async (req, res, next) => {
  try {
    const detail = await rfqDetail(req.params.id);
    if (!detail) return res.status(404).json({ message: 'RFQ not found.' });
    return res.json(detail);
  } catch (error) { return next(error); }
});

router.patch('/rfqs/:id', allowRoles(...procurement), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute("SELECT id, reference, requisition_id AS requisitionId FROM rfqs WHERE id = ? AND status = 'Draft'", [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'Only a draft RFQ can be edited.' });
    const requisitionId = req.body.requisitionId === undefined ? rfq.requisitionId : Number(req.body.requisitionId);
    if (!Number.isInteger(requisitionId) || requisitionId < 1) return res.status(400).json({ message: 'Choose a valid procurement request.' });
    const [[ready]] = await pool.execute(
      `SELECT id, reference, status FROM requisitions
       WHERE id = ? AND status IN (${PROCUREMENT_READY_STATUSES.map(() => '?').join(',')})`,
      [requisitionId, ...PROCUREMENT_READY_STATUSES]
    );
    if (!ready) return res.status(409).json({ message: 'Choose a request forwarded by a Department Supervisor.' });
    let dueDate = null;
    if (req.body.dueDate !== undefined) {
      try { dueDate = businessDate(req.body.dueDate, 'Quotation due date', { allowPast: false }); }
      catch (error) { return res.status(error.status || 400).json({ message: error.message }); }
    }
    let supplierIds = null;
    if (req.body.supplierIds !== undefined) {
      supplierIds = [...new Set((Array.isArray(req.body.supplierIds) ? req.body.supplierIds : []).map(Number))];
      if (!supplierIds.length || supplierIds.some((id) => !Number.isInteger(id) || id < 1)) {
        return res.status(400).json({ message: 'Select at least one valid supplier.' });
      }
    }
    await pool.execute(
      'UPDATE rfqs SET requisition_id = ?, due_date = ?, instructions = ?, terms = ? WHERE id = ?',
      [
        requisitionId, dueDate,
        req.body.instructions === undefined ? null : text(req.body.instructions, 4000) || null,
        req.body.terms === undefined ? null : text(req.body.terms, 4000) || null,
        rfq.id
      ]
    );
    if (supplierIds) {
      const placeholders = supplierIds.map(() => '?').join(',');
      const [active] = await pool.execute(`SELECT id FROM suppliers WHERE status = 'Active' AND id IN (${placeholders})`, supplierIds);
      if (active.length !== supplierIds.length) return res.status(400).json({ message: 'One or more selected suppliers are unavailable.' });
      await pool.execute('DELETE FROM rfq_suppliers WHERE rfq_id = ?', [rfq.id]);
      for (const supplierId of supplierIds) {
        await pool.execute('INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES (?, ?)', [rfq.id, supplierId]);
      }
    }
    await writeAudit(pool, req.user.id, 'draft_updated', 'rfq', rfq.id, { reference: rfq.reference });
    return res.json({ message: 'Draft RFQ updated.', id: Number(rfq.id) });
  } catch (error) { return next(error); }
});

router.delete('/rfqs/:id', allowRoles(...procurement), async (req, res, next) => {
  return transaction(async (connection) => {
    const [[rfq]] = await connection.execute("SELECT id, reference FROM rfqs WHERE id = ? AND status = 'Draft' FOR UPDATE", [req.params.id]);
    if (!rfq) throw httpError(404, 'Only a draft RFQ can be deleted.');
    await connection.execute('DELETE FROM rfq_suppliers WHERE rfq_id = ?', [rfq.id]);
    await connection.execute("DELETE FROM audit_logs WHERE entity_type = 'rfq' AND entity_id = ?", [String(rfq.id)]);
    await connection.execute('DELETE FROM rfqs WHERE id = ?', [rfq.id]);
    return { body: { message: `Draft ${rfq.reference} was deleted.` } };
  }, res, next);
});

router.post('/rfqs/:id/send', allowRoles(...procurement), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute("SELECT id, reference, requisition_id AS requisitionId FROM rfqs WHERE id = ? AND status = 'Draft'", [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'Only a draft RFQ can be sent.' });
    const [[requisition]] = await pool.execute(
      `SELECT id, reference, requester_id AS requesterId, status,
        supervisor_id AS supervisorId, forwarded_by_supervisor AS forwardedBySupervisor
       FROM requisitions WHERE id = ?`, [rfq.requisitionId]
    );
    if (!requisition) return res.status(409).json({ message: 'The related procurement request no longer exists.' });
    if (requisition.supervisorId != null && requisition.forwardedBySupervisor == null) {
      return res.status(409).json({ message: 'This request was not forwarded by its Department Supervisor.' });
    }
  } catch (error) { return next(error); }

  return transaction(async (connection) => {
    const [[rfq]] = await connection.execute(
      "SELECT id, reference, requisition_id AS requisitionId, idempotency_key AS idempotencyKey FROM rfqs WHERE id = ? AND status = 'Draft' FOR UPDATE",
      [req.params.id]
    );
    if (!rfq) throw httpError(404, 'Only a draft RFQ can be sent.');
    const [[requisition]] = await connection.execute('SELECT * FROM requisitions WHERE id = ? FOR UPDATE', [rfq.requisitionId]);
    const [suppliers] = await connection.execute(
      `SELECT s.id FROM rfq_suppliers fs JOIN suppliers s ON s.id = fs.supplier_id
       WHERE fs.rfq_id = ? AND s.status = 'Active' ORDER BY s.id`, [rfq.id]
    );
    if (!suppliers.length) throw httpError(400, 'Add at least one active supplier before sending the RFQ.');
    const [[existingDeliveries]] = await connection.execute(
      'SELECT COUNT(*) AS total FROM rfq_email_deliveries WHERE rfq_id = ?', [rfq.id]
    );
    if (!Number(existingDeliveries?.total)) {
      await createRfqEmailDeliveries(connection, {
        rfqId: rfq.id,
        reference: rfq.reference,
        supplierIds: suppliers.map((supplier) => supplier.id)
      });
    }
    await connection.execute("UPDATE rfqs SET status = 'Sent', issued_at = UTC_TIMESTAMP() WHERE id = ?", [rfq.id]);
    const nextStatus = await markRequisitionInProcurement(connection, requisition, req.user.id, rfq.reference);
    await createNotification(connection, null, 'New request for quotation',
      `${rfq.reference} was issued to ${suppliers.length} suppliers.`, `/rfqs/${rfq.id}`);
    await writeAudit(connection, req.user.id, 'sent', 'rfq', rfq.id,
      { reference: rfq.reference, supplierCount: suppliers.length },
      { previousStatus: 'Draft', newStatus: nextStatus }
    );
    const responseBody = { id: Number(rfq.id), reference: rfq.reference, status: 'Sent' };
    return {
      status: 200,
      body: responseBody,
      afterCommit: async () => {
        responseBody.emailDelivery = await sendRfqDeliveries({ rfqId: rfq.id });
      }
    };
  }, res, next);
});

router.post('/rfqs/:id/close', allowRoles(...procurement), async (req, res, next) => {
  return transaction(async (connection) => {
    const [[rfq]] = await connection.execute(
      "SELECT id, reference, status FROM rfqs WHERE id = ? AND status IN ('Sent','Evaluating') FOR UPDATE",
      [req.params.id]
    );
    if (!rfq) throw httpError(404, 'Only an open RFQ can be closed.');
    await connection.execute("UPDATE rfqs SET status = 'Closed', closed_at = UTC_TIMESTAMP() WHERE id = ?", [rfq.id]);
    await writeAudit(connection, req.user.id, 'closed', 'rfq', rfq.id, { reference: rfq.reference },
      { previousStatus: rfq.status, newStatus: 'Closed' });
    return { body: { message: `${rfq.reference} was closed.`, id: Number(rfq.id) } };
  }, res, next);
});

router.get('/rfqs/:id/quotations', async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute(
      `SELECT f.id, f.reference, f.status, f.message, f.issued_at AS issuedAt,
        f.due_date AS dueDate, r.id AS requisitionId,
        r.reference AS requisitionReference, r.title,
        d.name AS department
       FROM rfqs f
       JOIN requisitions r ON r.id = f.requisition_id
       LEFT JOIN departments d ON d.id = r.department_id
       WHERE f.id = ?`,
      [req.params.id]
    );
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });

    const [requestedItems] = await pool.execute(
      `SELECT item_name AS itemName, quantity, unit,
        estimated_unit_cost AS estimatedUnitCost,
        (quantity * estimated_unit_cost) AS lineTotal
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [rfq.requisitionId]
    );
    const [quotations] = await pool.execute(
      `SELECT q.id, q.rfq_id AS rfqId, q.supplier_id AS supplierId, s.name AS supplier,
        s.contact_name AS supplierContact, s.email AS supplierEmail, s.phone AS supplierPhone,
        q.amount, q.delivery_days AS deliveryDays, q.quality_score AS qualityScore,
        q.rating_score AS ratingScore, q.notes, q.submitted_at AS submittedAt,
        (rf.selected_quotation_id = q.id) AS selected
       FROM quotations q JOIN suppliers s ON s.id = q.supplier_id
       JOIN rfqs rf ON rf.id = q.rfq_id WHERE q.rfq_id = ? ORDER BY q.amount, q.delivery_days`,
      [req.params.id]
    );
    let items = [];
    if (quotations.length) {
      const [rows] = await pool.execute(
        `SELECT qi.quotation_id AS quotationId, qi.item_name AS itemName, qi.description,
           qi.quantity, qi.unit, qi.unit_price AS unitPrice, qi.line_total AS lineTotal, qi.comment
         FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
         WHERE q.rfq_id = ? ORDER BY qi.quotation_id, qi.id`,
        [req.params.id]
      );
      items = rows.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice) || 0,
        lineTotal: Number(item.lineTotal) || 0
      }));
    }
    return res.json({
      rfq: {
        ...rfq,
        requestedItems: requestedItems.map((item) => ({
          ...item,
          quantity: Number(item.quantity) || 0,
          estimatedUnitCost: Number(item.estimatedUnitCost) || 0,
          lineTotal: Number(item.lineTotal) || 0
        }))
      },
      quotations: quotations.map((quote) => ({
        ...quote,
        items: items.filter((item) => item.quotationId === quote.id)
      }))
    });
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
      `INSERT INTO quotations
         (rfq_id, supplier_id, amount, delivery_days, quality_score, rating_score, notes, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
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
    await connection.execute("UPDATE rfqs SET selected_quotation_id = ?, status = 'Awarded', closed_at = UTC_TIMESTAMP() WHERE id = ?", [quotationId, req.params.id]);
    await writeAudit(
      connection, req.user.id, 'awarded', 'rfq', req.params.id,
      { quotationId }, { previousStatus: 'Evaluating', newStatus: 'Awarded' }
    );
    await createNotification(connection, null, 'Quotation evaluation complete', `${quote.reference} has a recommended supplier and is ready for purchase order creation.`, `/rfqs/${req.params.id}`);
    return { body: { message: 'Supplier selected. Procurement can now prepare the purchase order.' } };
  }, res, next);
});

router.get('/purchase-orders', async (req, res, next) => {
  try {
    const columns = { created: 'p.created_at', approved: 'p.approved_at', delivery: 'p.delivery_date' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'created' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [orders] = await pool.query(
      `SELECT p.id, p.reference, p.type, p.status,
        p.supplier_pricing_status AS supplierPricingStatus,
        p.delivery_date AS deliveryDate,
        p.supplier_contact AS supplierContact, p.supplier_address AS supplierAddress,
        p.subtotal, p.vat_rate AS vatRate, p.vat_amount AS vatAmount,
        p.amount_in_words AS amountInWords, p.total,
        p.approved_at AS approvedAt, p.created_at AS createdAt, p.updated_at AS updatedAt,
        p.supplier_id AS supplierId,
        s.name AS supplier, r.reference AS requisition, r.id AS requisitionId,
        f.reference AS rfq, f.id AS rfqId,
        (SELECT cr.recommended_supplier_id FROM rfq_committee_reviews cr
          WHERE cr.rfq_id = f.id AND cr.recommended_supplier_id IS NOT NULL
          ORDER BY cr.id DESC LIMIT 1) AS recommendedSupplierId,
        (SELECT rs.name FROM rfq_committee_reviews cr
          JOIN suppliers rs ON rs.id = cr.recommended_supplier_id
          WHERE cr.rfq_id = f.id ORDER BY cr.id DESC LIMIT 1) AS recommendedSupplier,
        (SELECT GROUP_CONCAT(CONCAT(poi.item_name, ' × ', poi.quantity, ' @ ', FORMAT(poi.unit_price, 2)) SEPARATOR ', ')
         FROM purchase_order_items poi WHERE poi.purchase_order_id = p.id) AS items
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
       JOIN rfqs f ON f.id = p.rfq_id JOIN requisitions r ON r.id = f.requisition_id
       WHERE 1 = 1 ${clause}
       ORDER BY p.created_at DESC`,
      params
    );
    const approvals = new Map();
    if (orders.length) {
      const placeholders = orders.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT a.purchase_order_id AS purchaseOrderId, a.id, a.status,
           a.sent_at AS sentAt, a.decided_at AS decidedAt,
           a.decision_comment AS decisionComment, a.recipient_name AS recipientName,
           a.sender_name AS senderName
          FROM purchase_order_approval_requests a
          JOIN (SELECT purchase_order_id, MAX(id) AS id
                  FROM purchase_order_approval_requests GROUP BY purchase_order_id) latest
            ON latest.id = a.id
         WHERE a.purchase_order_id IN (${placeholders})`,
        orders.map((order) => order.id)
      );
      for (const row of rows) approvals.set(Number(row.purchaseOrderId), row);
    }
    return res.json({
      purchaseOrders: orders.map((order) => ({
        ...order,
        approval: approvals.get(Number(order.id)) || null
      }))
    });
  } catch (error) { return next(error); }
});

router.post('/purchase-orders', allowRoles(...procurement), async (req, res, next) => {
  const rfqId = Number(req.body.rfqId);
  if (!Number.isInteger(rfqId)) return res.status(400).json({ message: 'Choose an awarded RFQ.' });
  // Procurement may create the PO directly from its committee-recommended
  // supplier. Without an explicit supplier the awarded quotation stays authoritative.
  const supplierId = req.body.supplierId === undefined || req.body.supplierId === null || req.body.supplierId === ''
    ? null
    : Number(req.body.supplierId);
  if (supplierId !== null && !Number.isInteger(supplierId)) {
    return res.status(400).json({ message: 'Choose a valid recommended supplier.' });
  }
  const type = text(req.body.type, 50) || 'Standard';
  let deliveryDate;
  let preparedSignature = null;
  let approvedSignature = null;
  try {
    deliveryDate = businessDate(req.body.deliveryDate, 'Delivery date', { allowPast: false });
    preparedSignature = await normalizeSignature(req.body.preparedBySignature, 'Prepared by');
    approvedSignature = await normalizeSignature(req.body.approvedBySignature, 'Approved by');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  if (!preparedSignature) {
    return res.status(400).json({ message: 'Upload the Prepared by signature image.' });
  }
  if (!approvedSignature) {
    return res.status(400).json({ message: 'Upload the Approved by signature image.' });
  }
  return transaction(async (connection) => {
    if (supplierId !== null) {
      const [[recommendation]] = await connection.execute(
        'SELECT id FROM rfq_committee_reviews WHERE rfq_id = ? AND recommended_supplier_id = ? LIMIT 1',
        [rfqId, supplierId]
      );
      if (!recommendation) {
        throw httpError(409, 'That supplier is not Procurement’s recommendation for this RFQ.');
      }
    }
    const [[rfq]] = supplierId !== null
      ? await connection.execute(
        `SELECT f.id, f.reference, f.requisition_id, q.id AS selected_quotation_id,
          q.supplier_id, q.amount,
          s.name AS supplier_name, s.contact_name AS supplier_contact_name,
          s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address
         FROM rfqs f
         JOIN quotations q ON q.rfq_id = f.id AND q.supplier_id = ?
         JOIN suppliers s ON s.id = q.supplier_id
        WHERE f.id = ?
        ORDER BY q.id DESC LIMIT 1 FOR UPDATE`,
        [supplierId, rfqId]
      )
      : await connection.execute(
        `SELECT f.id, f.reference, f.requisition_id, f.selected_quotation_id,
          q.supplier_id, q.amount,
          s.name AS supplier_name, s.contact_name AS supplier_contact_name,
          s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address
         FROM rfqs f
         JOIN quotations q ON q.id = f.selected_quotation_id
         JOIN suppliers s ON s.id = q.supplier_id
        WHERE f.id = ? AND f.status = 'Awarded' FOR UPDATE`,
        [rfqId]
      );
    if (!rfq) {
      throw httpError(409, supplierId !== null
        ? 'The recommended supplier has no quotation for this RFQ.'
        : 'Only an awarded RFQ can be converted to a purchase order.');
    }
    const [[existing]] = await connection.execute('SELECT id FROM purchase_orders WHERE rfq_id = ?', [rfqId]);
    if (existing) throw httpError(409, 'A purchase order already exists for this RFQ.');
    if (supplierId !== null) {
      await connection.execute(
        "UPDATE rfqs SET selected_quotation_id = ?, status = 'Awarded' WHERE id = ?",
        [rfq.selected_quotation_id, rfqId]
      );
    }

    const [requestLines] = await connection.execute(
      `SELECT item_name AS itemName, description, quantity, unit,
        estimated_unit_cost AS estimatedUnitCost
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [rfq.requisition_id]
    );
    if (!requestLines.length) {
      throw httpError(409, 'The requisition has no items to put on the purchase order.');
    }

    // The awarded quotation is the authoritative subtotal. Its amount is
    // distributed across the original requisition lines for the official
    // document; VAT is read only from the configurable business settings.
    const subtotal = roundMoney(rfq.amount);
    const totalUnits = requestLines.reduce((sum, line) => sum + Number(line.quantity), 0);
    const estimateTotal = requestLines.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.estimatedUnitCost), 0
    );
    const totalCents = Math.round(subtotal * 100);
    let remainingCents = totalCents;
    const lines = requestLines.map((line, index) => {
      const weight = estimateTotal > 0
        ? Number(line.quantity) * Number(line.estimatedUnitCost) / estimateTotal
        : Number(line.quantity) / totalUnits;
      const lineCents = index === requestLines.length - 1
        ? remainingCents
        : Math.round(totalCents * weight);
      remainingCents -= lineCents;
      const lineTotal = lineCents / 100;
      return {
        itemName: line.itemName,
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit || 'unit',
        unitPrice: lineTotal / Number(line.quantity),
        lineTotal
      };
    });
    const settings = await getSettings();
    const totals = calculatePurchaseTotals(lines, configuredVatRate(settings));
    const supplierContact = text([
      rfq.supplier_contact_name, rfq.supplier_phone, rfq.supplier_email
    ].filter(Boolean).join(' / '), 150) || null;
    const supplierAddress = text(rfq.supplier_address, 255) || null;
    const poReference = reference(settings.purchase_order_prefix || 'PO');

    const [result] = await connection.execute(
      `INSERT INTO purchase_orders
       (reference, rfq_id, quotation_id, supplier_id, type, supplier_contact, supplier_address,
        prepared_signature, approved_signature, subtotal, vat_rate, vat_amount, amount_in_words,
        total, delivery_date, supplier_pricing_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Required', ?)`,
      [poReference, rfqId, rfq.selected_quotation_id, rfq.supplier_id, type,
        supplierContact, supplierAddress, preparedSignature, approvedSignature, totals.subtotal, totals.vatRate,
        totals.vatAmount, totals.amountInWords, totals.total, deliveryDate, req.user.id]
    );
    for (const line of lines) {
      await connection.execute(
        `INSERT INTO purchase_order_items
          (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, line.itemName, line.description || null, line.quantity,
          line.unit, line.unitPrice, line.lineTotal]
      );
    }
    await writeAudit(
      connection, req.user.id, 'created', 'purchase_order', result.insertId,
      { reference: poReference, type, supplier: rfq.supplier_name, subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total },
      { newStatus: 'Pending approval' }
    );
    await createNotification(
      connection, null, 'Purchase order prepared',
      `${poReference} is saved and ready for Supplier pricing requests.`,
      `/purchase-orders/${result.insertId}`
    );
    return {
      status: 201,
      body: {
        id: result.insertId,
        reference: poReference,
        type,
        subtotal: totals.subtotal,
        vatRate: totals.vatRate,
        vatAmount: totals.vatAmount,
        total: totals.total,
        amountInWords: totals.amountInWords,
        supplierPricingStatus: 'Required',
        message: 'Purchase order saved. Select Suppliers to request pricing before internal approval.'
      }
    };
  }, res, next);
});

// Registered users who may review or approve a purchase order. Procurement
// prepares documents but is intentionally not in this list.
router.get('/purchase-orders/approvers', allowRoles(...procurement), async (req, res, next) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, name, email, role, active
         FROM users
        WHERE active = TRUE AND role IN ('admin', 'approver')
        ORDER BY name, id`
    );
    return res.json({ users });
  } catch (error) { return next(error); }
});

router.post('/purchase-orders/:id/send-for-approval', allowRoles(...procurement), async (req, res, next) => {
  const id = Number(req.params.id);
  const recipientId = Number(req.body.recipientId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid purchase order identifier.' });
  if (!Number.isInteger(recipientId) || recipientId < 1) return res.status(400).json({ message: 'Choose a registered reviewer.' });
  const message = text(req.body.message, 1000);

  return transaction(async (connection) => {
    const [[order]] = await connection.execute(
      `SELECT p.id, p.reference, COALESCE(pricing.total, p.total) AS total, p.status,
         p.supplier_pricing_status AS supplierPricingStatus,
         p.delivery_date AS deliveryDate,
         COALESCE(pricing.supplier_name, s.name) AS supplier
        FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN purchase_order_pricing_requests req
          ON req.purchase_order_id = p.id AND req.status = 'Awarded'
        LEFT JOIN purchase_order_pricing_responses pricing
          ON pricing.id = req.awarded_response_id
       WHERE p.id = ? FOR UPDATE`,
      [id]
    );
    if (!order) throw httpError(404, 'Purchase order not found.');
    if (order.status !== 'Pending approval') {
      throw httpError(409, 'Only a pending purchase order can be sent for review.');
    }
    if (['Required', 'Collecting'].includes(order.supplierPricingStatus)) {
      throw httpError(409, 'Award a submitted Supplier quotation before sending the Purchase Order for internal approval.');
    }

    const [[recipient]] = await connection.execute(
      `SELECT id, name, email, role, active FROM users
        WHERE id = ? AND active = TRUE AND role IN ('admin', 'approver')`,
      [recipientId]
    );
    if (!recipient) throw httpError(400, 'Choose an active registered Administrator or Approver.');
    if (Number(recipient.id) === Number(req.user.id)) {
      throw httpError(400, 'Choose another authorized user; you cannot review a purchase order you prepared.');
    }

    const [previous] = await connection.execute(
      `SELECT id, recipient_email AS recipientEmail, status
         FROM purchase_order_approval_requests
        WHERE purchase_order_id = ? AND status = 'Pending'`,
      [id]
    );
    for (const row of previous) {
      await connection.execute(
        "UPDATE purchase_order_approval_requests SET status = 'Superseded' WHERE id = ? AND status = 'Pending'",
        [row.id]
      );
      await writeAudit(
        connection, req.user.id, 'approval_link_superseded', 'purchase_order', id,
        { approvalRequestId: row.id, previousRecipient: row.recipientEmail, reference: order.reference }
      );
    }

    const sender = {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email
    };
    const rawToken = createPurchaseOrderApprovalToken();
    const sentAt = new Date();
    const expiresAt = addHours(sentAt, approvalLinkHours());
    const [inserted] = await connection.execute(
      `INSERT INTO purchase_order_approval_requests
        (purchase_order_id, po_reference, total, sender_user_id, sender_name, sender_email,
         recipient_user_id, recipient_name, recipient_email, recipient_role,
         token_hash, status, message, sent_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`,
      [id, order.reference, order.total, sender.id, sender.name, sender.email,
        recipient.id, recipient.name, recipient.email, recipient.role,
        hashPurchaseOrderApprovalToken(rawToken), message || null,
        addHours(sentAt, 0), expiresAt]
    );

    await writeAudit(
      connection, sender.id, 'sent_for_approval', 'purchase_order', id,
      {
        reference: order.reference,
        approvalRequestId: Number(inserted.insertId),
        recipientUserId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        recipientRole: recipient.role,
        message: message || null,
        expiresAt,
        tokenHashPrefix: hashPurchaseOrderApprovalToken(rawToken).slice(0, 8)
      },
      { previousStatus: 'Pending approval', newStatus: 'Pending approval' }
    );
    await createNotification(
      connection, recipient.id, 'Purchase order awaiting your review',
      `${order.reference} was sent to you for review by ${sender.name}.`,
      `/purchase-orders/${id}`
    );

    const approvalRow = {
      id: Number(inserted.insertId),
      purchaseOrderId: id,
      status: 'Pending',
      message,
      sentAt: addHours(sentAt, 0),
      expiresAt,
      viewedAt: null,
      decidedAt: null,
      decisionComment: null,
      senderUserId: sender.id,
      senderName: sender.name,
      senderEmail: sender.email,
      recipientUserId: recipient.id,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      recipientRole: recipient.role
    };
    const body = {
      message: 'Sent for approval.',
      approval: await approvalView(connection, approvalRow),
      emailDelivery: null
    };
    return {
      body,
      afterCommit: async () => {
        const delivery = await sendEmail(buildPurchaseOrderReviewEmail({
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          reference: order.reference,
          supplier: order.supplier,
          totalAmount: rwf(order.total),
          deliveryDate: emailDate(order.deliveryDate),
          message,
          rawToken
        }));
        body.emailDelivery = delivery;
        body.message = emailFailureMessage(delivery, 'Sent for approval.');
        await recordEmailOutcome(sender.id, id, 'review_email_sent', delivery, {
          approvalRequestId: Number(inserted.insertId), to: recipient.email, reference: order.reference
        });
      }
    };
  }, res, next);
});

router.patch('/purchase-orders/:id/approvals/:approvalId/revoke', allowRoles(...procurement), async (req, res, next) => {
  const id = Number(req.params.id);
  const approvalId = Number(req.params.approvalId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(approvalId) || approvalId < 1) {
    return res.status(400).json({ message: 'Invalid approval request identifier.' });
  }
  return transaction(async (connection) => {
    const [[approval]] = await connection.execute(
      `SELECT a.*, p.reference AS poReference
         FROM purchase_order_approval_requests a
         JOIN purchase_orders p ON p.id = a.purchase_order_id
        WHERE a.id = ? AND a.purchase_order_id = ? FOR UPDATE`,
      [approvalId, id]
    );
    if (!approval) throw httpError(404, 'Approval request not found.');
    if (approval.status !== 'Pending') throw httpError(409, 'Only a pending approval link can be revoked.');
    if (req.user.role !== 'admin' && Number(approval.sender_user_id) !== Number(req.user.id)) {
      throw httpError(403, 'Only the sender or an Administrator can revoke this link.');
    }
    await connection.execute(
      "UPDATE purchase_order_approval_requests SET status = 'Revoked' WHERE id = ?",
      [approvalId]
    );
    await writeAudit(
      connection, req.user.id, 'approval_link_revoked', 'purchase_order', id,
      { approvalRequestId: approvalId, reference: approval.poReference, recipientEmail: approval.recipient_email },
      { previousStatus: 'Pending approval', newStatus: 'Pending approval' }
    );
    if (approval.recipient_user_id) {
      await createNotification(
        connection, approval.recipient_user_id, 'Purchase order review link revoked',
        `The review link for ${approval.poReference} was revoked by ${req.user.name}.`,
        `/purchase-orders/${id}`
      );
    }
    return { body: { message: 'Approval link revoked. The purchase order remains pending approval.' } };
  }, res, next);
});

router.get('/purchase-orders/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid purchase order identifier.' });
  try {
    const purchaseOrder = await loadPurchaseOrder(pool, id);
    return res.json({ purchaseOrder, ...purchaseOrder });
  } catch (error) { return next(error); }
});

// Procurement may correct a pending document, but approval locks it forever.
// All monetary fields are recalculated here; client-supplied totals are ignored.
router.patch('/purchase-orders/:id', allowRoles(...procurement), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid purchase order identifier.' });
  const itemsProvided = req.body.items !== undefined && req.body.items !== null;
  let items = null;
  let deliveryDate;
  try {
    if (itemsProvided) items = parsePurchaseOrderItems(req.body.items);
    if (req.body.deliveryDate !== undefined && req.body.deliveryDate !== null && req.body.deliveryDate !== '') {
      deliveryDate = businessDate(req.body.deliveryDate, 'Delivery date', { allowPast: false });
    }
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  return transaction(async (connection) => {
    const [[order]] = await connection.execute(
      `SELECT id, reference, type, status,
         supplier_pricing_status AS supplierPricingStatus,
         supplier_contact AS supplierContact, supplier_address AS supplierAddress
        FROM purchase_orders WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!order) throw httpError(404, 'Purchase order not found.');
    if (order.status !== 'Pending approval') {
      throw httpError(409, 'Only a purchase order pending approval can be edited.');
    }
    if (['Collecting', 'Awarded'].includes(order.supplierPricingStatus)) {
      throw httpError(409, 'A Purchase Order cannot be edited after Supplier pricing has started.');
    }

    const [currentRows] = await connection.execute(
      `SELECT id, item_name AS itemName, description, quantity, unit, unit_price AS unitPrice
       FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id`,
      [id]
    );
    const currentIds = new Set(currentRows.map((row) => Number(row.id)));
    if (items) {
      for (const item of items) {
        if (item.id !== null && !currentIds.has(item.id)) {
          throw httpError(400, 'An item does not belong to this purchase order.');
        }
      }
    }
    const finalLines = items || currentRows.map((row) => ({
      id: Number(row.id),
      itemName: row.itemName,
      description: row.description,
      quantity: Number(row.quantity),
      unit: row.unit || 'unit',
      unitPrice: Number(row.unitPrice)
    }));
    if (!finalLines.length) throw httpError(400, 'Add at least one item to the purchase order.');

    const settings = await getSettings();
    const totals = calculatePurchaseTotals(finalLines, configuredVatRate(settings));
    const type = req.body.type === undefined ? order.type : (text(req.body.type, 50) || 'Standard');
    const supplierContact = req.body.supplierContact === undefined
      ? order.supplierContact : (text(req.body.supplierContact, 150) || null);
    const supplierAddress = req.body.supplierAddress === undefined
      ? order.supplierAddress : (text(req.body.supplierAddress, 255) || null);

    await connection.execute(
      `UPDATE purchase_orders
          SET type = ?, supplier_contact = ?, supplier_address = ?,
            subtotal = ?, vat_rate = ?, vat_amount = ?, amount_in_words = ?, total = ?,
            delivery_date = COALESCE(?, delivery_date)
        WHERE id = ? AND status = 'Pending approval'`,
      [type, supplierContact, supplierAddress, totals.subtotal, totals.vatRate,
        totals.vatAmount, totals.amountInWords, totals.total, deliveryDate || null, id]
    );

    if (items) {
      const keptIds = [];
      for (const item of items) {
        const lineTotal = roundMoney(item.quantity * item.unitPrice);
        if (item.id !== null) {
          await connection.execute(
            `UPDATE purchase_order_items
                SET item_name = ?, description = ?, quantity = ?, unit = ?,
                  unit_price = ?, line_total = ?
              WHERE id = ? AND purchase_order_id = ?`,
            [item.itemName, item.description || null, item.quantity, item.unit,
              item.unitPrice, lineTotal, item.id, id]
          );
          keptIds.push(item.id);
        } else {
          const [inserted] = await connection.execute(
            `INSERT INTO purchase_order_items
              (purchase_order_id, item_name, description, quantity, unit, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, item.itemName, item.description || null, item.quantity, item.unit,
              item.unitPrice, lineTotal]
          );
          keptIds.push(Number(inserted.insertId));
        }
      }
      const placeholders = keptIds.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM purchase_order_items WHERE purchase_order_id = ? AND id NOT IN (${placeholders})`,
        [id, ...keptIds]
      );
    }

    await writeAudit(
      connection, req.user.id, 'updated', 'purchase_order', id,
      { reference: order.reference, subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total }
    );
    const purchaseOrder = await loadPurchaseOrder(connection, id);
    return { body: { message: 'Purchase order updated.', purchaseOrder, ...purchaseOrder } };
  }, res, next);
});

// Signature images belong to the official document, not to the financial
// editing flow. Procurement signs the prepared block; approvers sign the
// approved block; administrators may complete either one.
router.patch('/purchase-orders/:id/signatures', allowRoles('admin', 'procurement', 'approver'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid purchase order identifier.' });
  const updates = {};
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'preparedBySignature')) {
      if (!procurement.includes(req.user.role)) {
        return res.status(403).json({ message: 'Only Procurement may upload the prepared-by signature.' });
      }
      updates.prepared_signature = await normalizeSignature(req.body.preparedBySignature, 'Prepared by');
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'approvedBySignature')) {
      if (!approvers.includes(req.user.role)) {
        return res.status(403).json({ message: 'Only an approver may upload the approved-by signature.' });
      }
      updates.approved_signature = await normalizeSignature(req.body.approvedBySignature, 'Approved by');
    }
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const columns = Object.keys(updates);
  if (!columns.length) {
    return res.status(400).json({ message: 'Choose a signature image to upload.' });
  }
  try {
    const [[order]] = await pool.execute('SELECT reference FROM purchase_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ message: 'Purchase order not found.' });
    await pool.execute(
      `UPDATE purchase_orders SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
      [...columns.map((column) => updates[column]), id]
    );
    await writeAudit(pool, req.user.id, 'signature_uploaded', 'purchase_order', id, {
      reference: order.reference,
      signatures: columns.map((column) => (column === 'prepared_signature' ? 'preparedBy' : 'approvedBy'))
    });
    const purchaseOrder = await loadPurchaseOrder(pool, id);
    return res.json({ message: 'Signature saved.', purchaseOrder, ...purchaseOrder });
  } catch (error) { return next(error); }
});

router.patch('/purchase-orders/:id/decision', allowRoles(...approvers), async (req, res, next) => {
  const decision = req.body.decision;
  const id = Number(req.params.id);
  if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid purchase order identifier.' });
  return transaction(async (connection) => {
    const [[approval]] = await connection.execute(
      `SELECT * FROM purchase_order_approval_requests
        WHERE purchase_order_id = ?
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [id]
    );
    if (approval) {
      await expireApprovalIfNeeded(connection, approval);
      if (approval.status === 'Pending') {
        assertApprovalLinkUsable(approval);
        assertApprovalRecipient(req.user, approval);
      } else if (['Revoked', 'Expired', 'Superseded'].includes(approval.status)) {
        throw httpError(409, 'The last review link is no longer active. Send a new link before recording a decision.');
      }
    }
    const { order } = await recordPurchaseOrderDecision(connection, {
      id,
      approval: approval || null,
      decision,
      comment: req.body.comment,
      actorId: req.user.id
    });
    const body = {
      message: `Purchase order ${decision.toLowerCase()}.`,
      reference: order.reference,
      emailDelivery: null
    };
    return {
      body,
      afterCommit: approval ? async () => {
        body.emailDelivery = await notifySenderOfDecision(
          req.user.id, approval, decision, text(req.body.comment, 2000)
        );
        body.message = emailFailureMessage(body.emailDelivery, body.message, 'decision');
      } : undefined
    };
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
  const expectedAt = toUtcDateTime(req.body.expectedAt);
  if (req.body.expectedAt && !expectedAt) {
    return res.status(400).json({ message: 'Expected delivery time must be a valid ISO date or datetime.' });
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
    const [[item]] = await connection.execute('SELECT id, name, quantity FROM items WHERE id = ? FOR UPDATE', [itemId]);
    if (!item) {
      const error = new Error('Inventory item not found.');
      error.status = 404;
      throw error;
    }
    const grnReference = await configuredReference('goods_receipt_prefix', 'GRN');
    const [receipt] = await connection.execute(
      'INSERT INTO goods_receipts (reference, purchase_order_id, source, received_by, expected_at) VALUES (?, ?, ?, ?, ?)',
      [grnReference, purchaseOrderId, source, req.user.id, expectedAt]
    );
    const balance = item.quantity + quantity;
    await connection.execute('INSERT INTO goods_receipt_items (goods_receipt_id, item_id, quantity) VALUES (?, ?, ?)', [receipt.insertId, itemId, quantity]);
    await connection.execute('UPDATE items SET quantity = ? WHERE id = ?', [balance, itemId]);
    await connection.execute(
      "INSERT INTO inventory_movements (item_id, user_id, movement_type, direction, quantity, reference_no, source, balance_after, movement_at) VALUES (?, ?, 'Receipt', 'In', ?, ?, ?, ?, UTC_TIMESTAMP())",
      [itemId, req.user.id, quantity, grnReference, grnReference, balance]
    );
    if (purchaseOrderId) {
      await connection.execute(
        'UPDATE purchase_orders SET status = ? WHERE id = ?',
        [req.body.isFinal === true ? 'Received' : 'Partially received', purchaseOrderId]
      );
    }
    await writeAudit(
      connection, req.user.id, 'received', 'goods_receipt', receipt.insertId,
      { reference: grnReference, itemId, quantity }, { newStatus: 'Received' }
    );
    await createNotification(connection, null, 'Goods received', `${grnReference}: ${quantity} units were added to stock.`, `/inventory/movements`);
    const [stockkeepers] = await connection.execute(
      "SELECT id FROM users WHERE role = 'storekeeper' AND active = TRUE"
    );
    for (const stockkeeper of stockkeepers) {
      await createNotification(
        connection, stockkeeper.id, 'Stock received',
        `${quantity} ${item.name || 'units'} were added · ${grnReference}.`,
        `#/stockkeeper/Bin%20Card?item=${itemId}`, 'stock_in'
      );
    }
    return { status: 201, body: { id: receipt.insertId, reference: grnReference, balance, message: 'Goods receipt recorded and stock updated.' } };
  }, res, next);
});

function composedSupplierAddress(row) {
  if (row?.supplierAddress) return String(row.supplierAddress);
  if (row?.poSupplierAddress) return String(row.poSupplierAddress);
  return [row?.city, row?.district, row?.sector, row?.cell].filter(Boolean).join(', ');
}

// Procurement's Allow/Deny gate for the GRN workspace. A denied order is hidden
// from sent suppliers; only an allowed order can produce a Good Received Note.
router.post('/goods-receipts/supplier-decision', allowRoles(...stores), async (req, res, next) => {
  const purchaseOrderId = Number(req.body.purchaseOrderId);
  const decision = String(req.body.decision || '').trim();
  if (!Number.isInteger(purchaseOrderId) || purchaseOrderId < 1 ||
      !['Allowed', 'Denied'].includes(decision)) {
    return res.status(400).json({ message: 'Choose a sent purchase order and an Allow or Deny decision.' });
  }
  const reason = text(req.body.reason, 2000);

  return transaction(async (connection) => {
    const [[order]] = await connection.execute(
      `SELECT p.id, p.reference, s.name AS supplierName
         FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = ?`,
      [purchaseOrderId]
    );
    if (!order) throw httpError(404, 'Purchase order not found.');
    const [[queued]] = await connection.execute(
      'SELECT COUNT(*) AS total FROM purchase_order_delivery_items WHERE purchase_order_id = ?',
      [purchaseOrderId]
    );
    if (!Number(queued.total)) {
      throw httpError(409, 'This purchase order has not been sent to a supplier yet.');
    }

    await connection.execute(
      `INSERT INTO grn_supplier_decisions
         (purchase_order_id, status, reason, decided_by, decided_by_name)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status), reason = VALUES(reason),
         decided_by = VALUES(decided_by), decided_by_name = VALUES(decided_by_name)`,
      [purchaseOrderId, decision, decision === 'Denied' ? reason || null : null,
        req.user.id, req.user.name || null]
    );
    await writeAudit(
      connection, req.user.id,
      decision === 'Allowed' ? 'grn_supplier_allowed' : 'grn_supplier_denied',
      'purchase_order', purchaseOrderId,
      {
        reference: order.reference, supplier: order.supplierName || null,
        decision, reason: decision === 'Denied' ? reason || null : null
      },
      { newStatus: decision }
    );
    await createNotification(
      connection, null, `Supplier ${decision.toLowerCase()} for a Good Received Note`,
      `${order.reference} (${order.supplierName || 'supplier'}) was ${decision.toLowerCase()} for GRN creation.`,
      '/goods-receipts', 'grn_supplier_decision'
    );

    return {
      status: 200,
      body: {
        purchaseOrderId,
        decision,
        message: decision === 'Allowed'
          ? 'Supplier allowed. You can now create a Good Received Note.'
          : 'Supplier denied. This purchase order was removed from the GRN workspace.'
      }
    };
  }, res, next);
});

// Purchase orders become visible to the GRN workspace at the moment they are
// sent to the supplier. The delivery queue is therefore the source of truth for
// "sent" and for the Storekeeper decision that is allowed into stock.
router.get('/goods-receipts/sent-suppliers', allowRoles(...stores), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT d.purchase_order_id AS purchaseOrderId, d.purchase_order_item_id AS purchaseOrderItemId,
         d.po_reference AS poReference, d.item_name AS itemName, d.description, d.quantity,
         d.unit, d.unit_price AS unitPrice, d.line_total AS lineTotal, d.delivery_date AS deliveryDate,
         d.status AS deliveryStatus, d.inventory_item_id AS itemId,
         d.department_id AS departmentId, d.department_name AS departmentName,
         d.supplier_name AS queueSupplierName, d.supplier_email AS queueSupplierEmail,
         p.reference AS orderReference, p.status AS purchaseOrderStatus,
         p.supplier_id AS supplierId, p.supplier_contact AS poSupplierContact,
         p.supplier_address AS poSupplierAddress,
         s.name AS supplierName, s.contact_name AS supplierContact,
         s.email AS supplierEmail, s.phone AS supplierPhone,
         s.address AS supplierAddress, s.city, s.district, s.sector, s.cell,
         gd.status AS grnDecision, gd.reason AS decisionReason,
         COALESCE(gr.receivedQuantity, 0) AS receivedQuantity
        FROM purchase_order_delivery_items d
        JOIN purchase_orders p ON p.id = d.purchase_order_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN grn_supplier_decisions gd ON gd.purchase_order_id = d.purchase_order_id
        LEFT JOIN (
          SELECT gr.purchase_order_id, gri.item_id, SUM(gri.quantity) AS receivedQuantity
          FROM goods_receipts gr
          JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
          WHERE gr.purchase_order_id IS NOT NULL
          GROUP BY gr.purchase_order_id, gri.item_id
        ) gr ON gr.purchase_order_id = d.purchase_order_id AND gr.item_id = d.inventory_item_id
        WHERE gd.status IS NULL OR gd.status <> 'Denied'
        ORDER BY d.supplier_name, p.reference, d.purchase_order_item_id`
    );

    const suppliers = new Map();
    for (const row of rows) {
      const supplierKey = row.supplierId ? `id-${row.supplierId}` : `name-${row.queueSupplierName}`;
      if (!suppliers.has(supplierKey)) {
        suppliers.set(supplierKey, {
          supplierId: row.supplierId || null,
          supplierName: row.supplierName || row.queueSupplierName,
          supplierContact: row.supplierContact || row.poSupplierContact || '',
          supplierEmail: row.supplierEmail || row.queueSupplierEmail || '',
          supplierPhone: row.supplierPhone || '',
          supplierAddress: composedSupplierAddress(row),
          purchaseOrders: []
        });
      }
      const supplier = suppliers.get(supplierKey);
      let order = supplier.purchaseOrders.find((entry) => entry.id === Number(row.purchaseOrderId));
      if (!order) {
        order = {
          id: Number(row.purchaseOrderId),
          reference: row.orderReference || row.poReference,
          status: row.purchaseOrderStatus,
          deliveryDate: row.deliveryDate ? String(row.deliveryDate).slice(0, 10) : '',
          departmentName: row.departmentName || '',
          grnDecision: row.grnDecision || '',
          decisionReason: row.decisionReason || '',
          lines: []
        };
        supplier.purchaseOrders.push(order);
      }
      const quantity = Number(row.quantity) || 0;
      const receivedQuantity = Number(row.receivedQuantity) || 0;
      order.lines.push({
        purchaseOrderItemId: Number(row.purchaseOrderItemId),
        itemId: row.itemId ? Number(row.itemId) : null,
        itemName: row.itemName,
        description: row.description || '',
        quantity,
        unit: row.unit,
        unitPrice: Number(row.unitPrice) || 0,
        lineTotal: Number(row.lineTotal) || 0,
        deliveryStatus: row.deliveryStatus,
        receivedQuantity,
        outstandingQuantity: Math.max(0, quantity - receivedQuantity)
      });
    }
    return res.json({ sentSuppliers: [...suppliers.values()] });
  } catch (error) { return next(error); }
});

// The official Good Received Note is a document produced from lines the
// Storekeeper already accepted into stock. It must not add stock a second time.
router.post('/goods-receipts/from-supplier', allowRoles(...stores), async (req, res, next) => {
  const purchaseOrderId = Number(req.body.purchaseOrderId);
  if (!Number.isInteger(purchaseOrderId) || purchaseOrderId < 1) {
    return res.status(400).json({ message: 'Choose the sent purchase order for this Good Received Note.' });
  }
  const requestedLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!requestedLines.length) {
    return res.status(400).json({ message: 'Choose at least one accepted item for the Good Received Note.' });
  }
  const aggregated = new Map();
  for (const raw of requestedLines) {
    const purchaseOrderItemId = Number(raw?.purchaseOrderItemId);
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(purchaseOrderItemId) || purchaseOrderItemId < 1 ||
        !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ message: 'Every Good Received Note line needs a valid item and quantity.' });
    }
    const current = aggregated.get(purchaseOrderItemId) || { quantity: 0, comments: [] };
    current.quantity += quantity;
    const comment = text(raw?.comment, 500);
    if (comment) current.comments.push(comment);
    aggregated.set(purchaseOrderItemId, current);
  }

  let grnDate;
  try {
    grnDate = businessDate(req.body.grnDate || new Date().toISOString().slice(0, 10), 'Received date');
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const receivedByName = text(req.body.receivedByName, 150);
  const verifiedByName = text(req.body.verifiedByName, 150);

  return transaction(async (connection) => {
    const [orders] = await connection.execute(
      `SELECT p.id, p.reference, p.supplier_id,
         p.supplier_address AS poSupplierAddress,
         s.name AS supplierName, s.contact_name AS supplierContact,
         s.phone AS supplierPhone, s.email AS supplierEmail,
         s.address AS supplierAddress, s.city, s.district, s.sector, s.cell,
         d.department_name AS departmentName
        FROM purchase_orders p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN purchase_order_delivery_items d ON d.purchase_order_id = p.id
        WHERE p.id = ?
        ORDER BY d.id
        LIMIT 1`,
      [purchaseOrderId]
    );
    const order = orders[0];
    if (!order) throw httpError(404, 'Purchase order not found.');
    const [[decision]] = await connection.execute(
      'SELECT status FROM grn_supplier_decisions WHERE purchase_order_id = ?',
      [purchaseOrderId]
    );
    if (decision?.status !== 'Allowed') {
      throw httpError(409, 'Allow this supplier before creating a Good Received Note.');
    }

    // Normalising inside the transaction keeps the Allow/Deny gate ahead of
    // upload validation and never stores untrusted browser bytes verbatim.
    const receivedBySignature = await normalizeSignature(req.body.receivedBySignature, 'Received by');
    const verifiedBySignature = await normalizeSignature(req.body.verifiedBySignature, 'Verified by');
    if (!receivedBySignature) throw httpError(400, 'Upload the Received by signature image.');
    if (!verifiedBySignature) throw httpError(400, 'Upload the Verified by signature image.');

    const preparedLines = [];
    for (const [purchaseOrderItemId, requested] of aggregated) {
      const [deliveries] = await connection.execute(
        `SELECT d.* FROM purchase_order_delivery_items d
         WHERE d.purchase_order_id = ? AND d.purchase_order_item_id = ? FOR UPDATE`,
        [purchaseOrderId, purchaseOrderItemId]
      );
      const delivery = deliveries[0];
      if (!delivery) throw httpError(404, 'That purchase order item was not sent to the supplier.');
      if (delivery.status === 'Rejected') {
        throw httpError(409, `Rejected items cannot appear on a Good Received Note. ${delivery.itemName} was rejected.`);
      }

      let itemId = delivery.inventory_item_id ? Number(delivery.inventory_item_id) : null;
      if (!itemId) {
        // A pending delivery has no catalogue item yet. Resolve or create one
        // with zero balance so the GRN can document the line without adding
        // stock; Storekeeper acceptance remains the only stock movement.
        const [matches] = await connection.execute(
          'SELECT id FROM items WHERE name = ? AND unit = ? ORDER BY id LIMIT 1 FOR UPDATE',
          [delivery.item_name, delivery.unit]
        );
        if (matches[0]) {
          itemId = Number(matches[0].id);
        } else {
          const sku = `PO-${Number(delivery.purchase_order_item_id)}-${randomBytes(3).toString('hex').toUpperCase()}`;
          const [created] = await connection.execute(
            `INSERT INTO items (department_id, sku, name, category, unit, quantity, reorder_level, unit_cost)
             VALUES (?, ?, ?, 'Purchased', ?, 0, 10, ?)`,
            [delivery.department_id || null, sku, delivery.item_name,
              delivery.unit, Number(delivery.unit_price) || 0]
          );
          itemId = Number(created.insertId);
        }
        await connection.execute(
          'UPDATE purchase_order_delivery_items SET inventory_item_id = ? WHERE id = ?',
          [itemId, delivery.id]
        );
      }
      const [[documented]] = await connection.execute(
        `SELECT COALESCE(SUM(gri.quantity), 0) AS quantity
         FROM goods_receipt_items gri
         JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
         WHERE gr.purchase_order_id = ? AND gri.item_id = ?`,
        [purchaseOrderId, itemId]
      );
      if (Number(documented.quantity) + requested.quantity > Number(delivery.quantity)) {
        throw httpError(409, `The Good Received Note quantity for ${delivery.itemName} exceeds the ordered quantity.`);
      }
      preparedLines.push({
        delivery,
        itemId,
        quantity: requested.quantity,
        comment: requested.comments.join(' · ')
      });
    }

    const supplierAddress = composedSupplierAddress(order);
    const suppliedBy = text([
      order.supplierName, order.supplierContact, order.supplierPhone,
      order.supplierEmail, supplierAddress, req.body.suppliedBy
    ].filter(Boolean).join(' · '), 190);
    const source = text(req.body.source, 180) || `${order.reference || `PO-${purchaseOrderId}`} · ${order.supplierName || 'supplier'}`;
    const grnReference = await configuredReference('goods_receipt_prefix', 'GRN');
    const [receipt] = await connection.execute(
      `INSERT INTO goods_receipts
         (reference, purchase_order_id, source, received_by, expected_at,
          supplier_id, supplied_by, receiving_department, received_by_name,
          verified_by_name, received_signature, verified_signature, grn_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grnReference, purchaseOrderId, source, req.user.id, toUtcDateTime(grnDate),
        order.supplier_id || null, suppliedBy || null, order.departmentName || null,
        receivedByName || null, verifiedByName || null,
        receivedBySignature, verifiedBySignature, grnDate
      ]
    );
    for (const line of preparedLines) {
      await connection.execute(
        'INSERT INTO goods_receipt_items (goods_receipt_id, item_id, quantity, comment) VALUES (?, ?, ?, ?)',
        [receipt.insertId, line.itemId, line.quantity, line.comment || null]
      );
    }

    const [queue] = await connection.execute(
      'SELECT status, quantity, inventory_item_id FROM purchase_order_delivery_items WHERE purchase_order_id = ?',
      [purchaseOrderId]
    );
    const [documentedRows] = await connection.execute(
      `SELECT gri.item_id, SUM(gri.quantity) AS quantity
       FROM goods_receipt_items gri
       JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
       WHERE gr.purchase_order_id = ?
       GROUP BY gri.item_id`,
      [purchaseOrderId]
    );
    const documentedByItem = new Map(documentedRows.map((row) => [Number(row.item_id), Number(row.quantity)]));
    const fullyReceived = queue.length > 0 && queue.every((row) =>
      row.status === 'Accepted' && row.inventory_item_id &&
      (documentedByItem.get(Number(row.inventory_item_id)) || 0) >= Number(row.quantity)
    );
    await connection.execute(
      'UPDATE purchase_orders SET status = ? WHERE id = ?',
      [fullyReceived ? 'Received' : 'Partially received', purchaseOrderId]
    );

    await writeAudit(
      connection, req.user.id, 'created', 'goods_receipt', receipt.insertId,
      {
        reference: grnReference, purchaseOrderId, supplier: order.supplierName || null,
        lines: preparedLines.map((line) => ({
          purchaseOrderItemId: Number(line.delivery.purchase_order_item_id),
          itemId: line.itemId, quantity: line.quantity
        }))
      },
      { newStatus: fullyReceived ? 'Received' : 'Partially received' }
    );
    await createNotification(
      connection, null, 'Good Received Note recorded',
      `${grnReference}: ${preparedLines.length} line${preparedLines.length === 1 ? '' : 's'} recorded for ${order.supplierName || 'the supplier'}.`,
      '/goods-receipts'
    );

    const body = {
      id: Number(receipt.insertId),
      reference: grnReference,
      purchaseOrderId,
      supplier: order.supplierName || null,
      emailRecipient: order.supplierEmail || '',
      lines: preparedLines.map((line) => ({
        purchaseOrderItemId: Number(line.delivery.purchase_order_item_id),
        itemId: line.itemId,
        itemName: line.delivery.item_name,
        quantity: line.quantity,
        unit: line.delivery.unit,
        comment: line.comment
      })),
      message: 'Good Received Note recorded from the sent purchase order.'
    };

    return {
      status: 201,
      body,
      // The GRN is committed first. Email is best-effort: a failed or
      // unconfigured provider is reported but never rolls back the document.
      afterCommit: async () => {
        let delivery;
        try {
          const record = await fetchRecord('goodsReceipt', Number(receipt.insertId), req.user);
          const pdf = await renderRecordPdf(record);
          const filename = `${grnReference.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
          const email = buildGoodReceivedNoteEmail({
            supplierName: order.supplierName,
            recipientEmail: order.supplierEmail,
            reference: grnReference,
            purchaseOrderReference: order.reference,
            lines: body.lines
          });
          delivery = await sendEmail({
            ...email,
            attachments: [{ filename, contentType: 'application/pdf', content: pdf }]
          });
        } catch (error) {
          delivery = {
            ok: false, status: 'Failed', reason: 'grn_email_error',
            error: { code: 'GRN_EMAIL_ERROR', message: error.message || 'Could not prepare the Good Received Note email.' }
          };
        }
        try {
          await writeAudit(
            pool, req.user.id, 'grn_email_sent', 'goods_receipt', receipt.insertId,
            {
              reference: grnReference, recipientEmail: order.supplierEmail || null,
              emailStatus: delivery.status, reason: delivery.reason || null
            }
          );
        } catch {
          // The email outcome is still returned even if audit logging fails.
        }
        body.emailDelivery = delivery;
        body.message = emailFailureMessage(delivery, body.message, 'GRN email');
      }
    };
  }, res, next);
});

router.get('/goods-receipts', async (req, res, next) => {
  try {
    const columns = { received: 'g.received_at', expected: 'g.expected_at' };
    const filter = parseDateFilter(req.query, columns, { defaultField: 'received' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, columns, params);
    const [receipts] = await pool.query(
      `SELECT g.id, g.reference, g.source, g.expected_at AS expectedAt,
        g.received_at AS receivedAt, g.updated_at AS updatedAt,
        g.supplied_by AS suppliedBy, g.receiving_department AS receivingDepartment,
        g.received_by_name AS receivedByName, g.verified_by_name AS verifiedByName,
        g.grn_date AS grnDate,
        p.reference AS purchaseOrder, s.name AS supplier, u.name AS receivedBy,
        GROUP_CONCAT(CONCAT(i.name, ' × ', gi.quantity) SEPARATOR ', ') AS items
       FROM goods_receipts g
       LEFT JOIN purchase_orders p ON p.id = g.purchase_order_id
       LEFT JOIN suppliers s ON s.id = g.supplier_id
       JOIN users u ON u.id = g.received_by
       JOIN goods_receipt_items gi ON gi.goods_receipt_id = g.id
       JOIN items i ON i.id = gi.item_id
       WHERE 1 = 1 ${clause}
       GROUP BY g.id ORDER BY g.received_at DESC`,
      params
    );
    return res.json({ goodsReceipts: receipts });
  } catch (error) { return next(error); }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const filter = parseDateFilter(req.query, {
      created: 'i.created_at', submitted: 'i.submitted_at',
      approved: 'i.approved_at', paid: 'i.paid_at', due: 'i.due_date'
    }, { defaultField: 'created' });
    if (filter.error) return res.status(400).json({ message: filter.error });
    const params = [];
    const clause = dateFilterClause(filter, {
      created: 'i.created_at', submitted: 'i.submitted_at',
      approved: 'i.approved_at', paid: 'i.paid_at', due: 'i.due_date'
    }, params);
    const [invoices] = await pool.query(
      `SELECT i.id, i.reference, i.amount, i.status, i.invoice_date AS invoiceDate,
        i.due_date AS dueDate, i.submitted_at AS submittedAt,
        i.approved_at AS approvedAt, i.paid_at AS paidAt,
        i.created_at AS createdAt, i.updated_at AS updatedAt,
        p.reference AS purchaseOrder, s.name AS supplier, u.name AS submittedBy
       FROM invoices i JOIN purchase_orders p ON p.id = i.purchase_order_id
       JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = i.submitted_by
       WHERE 1 = 1 ${clause}
       ORDER BY COALESCE(i.submitted_at, i.created_at) DESC`,
      params
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
  let invoiceDate;
  let dueDate;
  try {
    invoiceDate = businessDate(req.body.invoiceDate, 'Invoice date', { required: true });
    dueDate = businessDate(req.body.dueDate, 'Payment due date');
    enforceDateOrder({ 'Invoice date': invoiceDate, 'Payment due date': dueDate }, [['Invoice date', 'Payment due date']]);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
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
      `INSERT INTO invoices
         (reference, purchase_order_id, amount, submitted_by, invoice_date, due_date, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [invoiceReference, purchaseOrderId, amount, req.user.id, invoiceDate, dueDate]
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
  const allowedPrevious = decision === 'Paid' ? 'Approved' : 'Pending';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE invoices
         SET status = ?, reviewed_by = ?,
             approved_at = IF(?, UTC_TIMESTAMP(), approved_at),
             paid_at = IF(?, UTC_TIMESTAMP(), paid_at)
       WHERE id = ? AND status = ?`,
      [
        decision, req.user.id,
        decision === 'Approved' || decision === 'Paid' ? 1 : 0,
        decision === 'Paid' ? 1 : 0,
        req.params.id, allowedPrevious
      ]
    );
    if (!result.affectedRows) {
      const error = new Error(`Invoice cannot be marked ${decision.toLowerCase()} from its current status.`);
      error.status = 409;
      throw error;
    }
    await writeAudit(
      connection, req.user.id, decision.toLowerCase(), 'invoice', req.params.id,
      {}, { previousStatus: allowedPrevious, newStatus: decision }
    );
    await createNotification(
      connection, null, `Invoice ${decision.toLowerCase()}`,
      `Invoice ${req.params.id} was marked ${decision.toLowerCase()}.`, '/invoices'
    );
    await connection.commit();
    return res.json({ message: `Invoice ${decision.toLowerCase()}.` });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const [notifications] = await pool.execute(
      'SELECT id, title, body, link, category, is_read AS isRead, created_at AS createdAt FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 50',
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

import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';

const router = Router();
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_REASON_LENGTH = 5000;
const DECISION_ALIASES = {
  Accept: 'Accepted',
  Accepted: 'Accepted',
  Deny: 'Rejected',
  Denied: 'Rejected',
  Reject: 'Rejected',
  Rejected: 'Rejected'
};

function storedDecision(value) {
  return DECISION_ALIASES[String(value || '').trim()] || '';
}

function decodeSnapshot(value) {
  if (!value) return { suppliers: [], requestedItems: [] };
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch { return { suppliers: [], requestedItems: [] }; }
}

function publicDecision(decision) {
  return {
    id: Number(decision.id),
    supplierId: Number(decision.supplierId),
    quotationId: decision.quotationId ? Number(decision.quotationId) : null,
    supplier: decision.supplier || 'Supplier',
    decision: decision.decision,
    reason: decision.reason || '',
    responderName: decision.responderName || '',
    decidedAt: decision.decidedAt || null
  };
}

async function loadReview(token, connection = pool) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return null;
  const [[review]] = await connection.execute(
    `SELECT r.id, r.rfq_id AS rfqId, r.token, r.recipient_name AS recipientName,
        r.recipient_email AS recipientEmail, r.report_snapshot AS snapshot,
        r.status, r.sent_at AS sentAt, r.opened_at AS openedAt,
        r.submitted_at AS submittedAt,
        f.reference, f.issued_at AS issuedAt, f.due_date AS dueDate, f.message,
        q.id AS requisitionId, q.reference AS requisitionReference, q.title,
        d.name AS department
       FROM rfq_committee_reviews r
       JOIN rfqs f ON f.id = r.rfq_id
       JOIN requisitions q ON q.id = f.requisition_id
       LEFT JOIN departments d ON d.id = q.department_id
      WHERE r.token = ? LIMIT 1`,
    [String(token).toLowerCase()]
  );
  if (!review) return null;

  const snapshot = decodeSnapshot(review.snapshot);
  const [decisions] = await connection.execute(
    `SELECT d.id, d.supplier_id AS supplierId, s.name AS supplier, d.decision, d.reason,
        d.responder_name AS responderName, d.decided_at AS decidedAt
       FROM rfq_committee_decisions d
       JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.review_id = ? ORDER BY d.id`,
    [review.id]
  );
  const quotationBySupplier = new Map((snapshot.suppliers || [])
    .map((supplier) => [Number(supplier.supplierId), supplier.quotationId || null]));
  return {
    ...review,
    snapshot,
    decisions: decisions.map((decision) => publicDecision({
      ...decision,
      quotationId: quotationBySupplier.get(Number(decision.supplierId))
    }))
  };
}

function reviewPayload(review) {
  const responses = (review.snapshot.suppliers || []).filter((supplier) =>
    supplier.responseAt || supplier.amount !== null || (supplier.items || []).length
  ).map((supplier) => ({
    supplierId: Number(supplier.supplierId),
    quotationId: supplier.quotationId || null,
    supplier: supplier.name || 'Supplier',
    recipientEmail: supplier.recipientEmail || supplier.email || null,
    submittedAt: supplier.responseAt || null,
    emailSentAt: supplier.emailSentAt || null,
    amount: supplier.amount === null || supplier.amount === undefined ? null : Number(supplier.amount),
    deliveryDays: supplier.deliveryDays === null || supplier.deliveryDays === undefined ? null : Number(supplier.deliveryDays),
    notes: supplier.notes || '',
    items: supplier.items || []
  }));
  const decisionsBySupplier = new Map(review.decisions.map((decision) => [decision.supplierId, decision]));

  return {
    id: review.id,
    rfqId: review.rfqId,
    reference: review.reference,
    requisitionReference: review.requisitionReference,
    title: review.title,
    department: review.department || null,
    message: review.message || '',
    issuedAt: review.issuedAt || null,
    dueDate: review.dueDate || null,
    sentAt: review.sentAt || null,
    submittedAt: review.submittedAt || null,
    recipientName: review.recipientName,
    recipientEmail: review.recipientEmail,
    responded: Boolean(review.submittedAt),
    recommendation: review.snapshot.recommendation
      || (review.snapshot.recommendations || {})[String(review.rfqId)]
      || null,
    requestedItems: review.snapshot.requestedItems || [],
    responses: responses.map((response) => ({
      ...response,
      decision: decisionsBySupplier.get(response.supplierId) || null
    })),
    overallDecision: review.decisions[0] || null,
    decisions: review.decisions
  };
}

async function persistDecisions(connection, res, review, decisions, responderName) {
  await connection.beginTransaction();
  try {
    const [[locked]] = await connection.execute(
      'SELECT id FROM rfq_committee_reviews WHERE id = ? FOR UPDATE',
      [review.id]
    );
    if (!locked) {
      await connection.rollback();
      return res.status(404).json({ message: 'This committee decision link is invalid or has expired.' });
    }

    // Claiming the review before inserting decisions guarantees exactly one
    // submission set per emailed token, even under concurrent requests.
    const [claim] = await connection.execute(
      `UPDATE rfq_committee_reviews
          SET status = 'Submitted', submitted_at = UTC_TIMESTAMP(),
              opened_at = COALESCE(opened_at, UTC_TIMESTAMP())
        WHERE id = ? AND submitted_at IS NULL`,
      [review.id]
    );
    if (!claim.affectedRows) {
      await connection.rollback();
      return res.status(409).json({ message: 'A decision has already been submitted from this link.' });
    }

    for (const decision of decisions) {
      await connection.execute(
        `INSERT INTO rfq_committee_decisions
           (review_id, supplier_id, decision, reason, responder_name, decided_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [review.id, decision.supplierId, decision.decision, decision.reason,
          responderName || review.recipientName]
      );
    }

    await writeAudit(connection, null, 'committee_decision_submitted', 'rfq_committee_review', review.id, {
      reference: review.reference,
      recipientEmail: review.recipientEmail,
      responderName: responderName || review.recipientName,
      decisions: decisions.map((decision) => ({
        supplier: decision.supplier,
        decision: decision.decision === 'Rejected' ? 'Deny' : 'Accept',
        reason: decision.reason
      }))
    });
    const [managers] = await connection.execute(
      "SELECT id FROM users WHERE active = TRUE AND role IN ('admin', 'procurement')"
    );
    const outcome = decisions[0]?.decision === 'Rejected' ? 'denied' : 'accepted';
    for (const manager of managers) {
      await createNotification(
        connection,
        manager.id,
        'Committee decision received',
        `${review.recipientName} ${outcome} the recommendation for ${review.reference}.`,
        `#/admin/RFQs?rfq=${review.rfqId}`,
        'email'
      );
    }

    await connection.commit();
    return res.status(201).json({
      message: 'Your decisions were submitted to Procurement.',
      decisionCount: decisions.length
    });
  } catch (error) {
    try { await connection.rollback(); } catch { /* ignore rollback errors */ }
    throw error;
  }
}

router.get('/committee-review/:token', async (req, res, next) => {
  try {
    const review = await loadReview(req.params.token);
    if (!review) return res.status(404).json({ message: 'This committee decision link is invalid or has expired.' });
    await pool.execute(
      'UPDATE rfq_committee_reviews SET opened_at = COALESCE(opened_at, UTC_TIMESTAMP()) WHERE id = ?',
      [review.id]
    );
    return res.json({ review: reviewPayload(review) });
  } catch (error) { return next(error); }
});

router.post('/committee-review/:token/decisions', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const review = await loadReview(req.params.token, connection);
    if (!review) return res.status(404).json({ message: 'This committee decision link is invalid or has expired.' });

    const expected = (review.snapshot.suppliers || []).filter((supplier) =>
      supplier.responseAt || supplier.amount !== null || (supplier.items || []).length
    ).map((supplier) => ({
      supplierId: Number(supplier.supplierId),
      supplier: supplier.name || 'Supplier'
    }));
    if (!expected.length) {
      return res.status(409).json({ message: 'This RFQ has no supplier responses to decide.' });
    }

    // One committee member makes one decision on Procurement's recommendation,
    // not a separate decision for every supplier response. Older cached pages
    // may still post a decisions array, so its first entry is accepted too.
    const legacy = Array.isArray(req.body?.decisions) ? req.body.decisions[0] : null;
    const decision = storedDecision(req.body?.decision ?? legacy?.decision);
    const reason = String(req.body?.reason ?? legacy?.reason ?? '').trim().slice(0, MAX_REASON_LENGTH);
    const responderName = String(req.body?.responderName || '').trim().slice(0, 150);
    const errors = [];

    if (!decision) errors.push('Choose Accept or Deny for Procurement’s recommendation.');
    if (!reason) {
      errors.push(decision === 'Rejected'
        ? 'Give a reason for denying this recommendation.'
        : 'Give a reason for accepting this recommendation.');
    }
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const recommendation = review.snapshot.recommendation
      || (review.snapshot.recommendations || {})[String(review.rfqId)]
      || null;
    const recommendedSupplierId = Number(recommendation?.supplierId);
    const target = expected.find((item) => item.supplierId === recommendedSupplierId)
      || expected[0];

    return await persistDecisions(connection, res, review, [{ ...target, decision, reason }], responderName);
  } catch (error) {
    try { await connection.rollback(); } catch { /* ignore rollback errors */ }
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;

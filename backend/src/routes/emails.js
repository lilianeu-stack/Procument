import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { allowRoles } from '../middleware/auth.js';
import { writeAudit } from '../lib/events.js';
import { committeeReviewLink, sendEmail } from '../services/email.js';
import {
  buildCommitteeReport, committeeReportText, committeeReviewEmailHtml, parseRfqIds
} from '../services/committee-review.js';
import { getSettings } from '../services/settings.js';
import {
  createResendDelivery, listRfqDeliveries, retryFailedDeliveries, sendRfqDeliveries
} from '../services/rfq-email.js';
import { requisitionDisplayReference } from '../utils/requisition-display.js';

const router = Router();
const managers = ['admin', 'procurement'];

router.get('/rfqs/:id/email-deliveries', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const result = await listRfqDeliveries(req.params.id);
    return res.json({ rfq, ...result });
  } catch (error) { return next(error); }
});

// What Procurement sees in the preview is built by the same service used for
// the email, so invitation times and response times cannot drift apart.
router.get('/rfqs/committee-preview', allowRoles(...managers), async (req, res, next) => {
  try {
    const report = await buildCommitteeReport(req.query.rfqIds);
    const [members] = await pool.execute(
      `SELECT id, first_name AS firstName, last_name AS lastName, email
       FROM procurement_committee_members
       ORDER BY last_name, first_name, id`
    );
    return res.json({ report, members });
  } catch (error) { return next(error); }
});

function readableGeneratedAt(value, settings) {
  const raw = String(value || '');
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return raw || 'Not recorded';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'
    }).format(instant);
  } catch {
    return `${raw.slice(0, 16).replace('T', ' ')} UTC`;
  }
}

router.post('/rfqs/send-to-committee', allowRoles(...managers), async (req, res, next) => {
  const rfqIds = parseRfqIds(req.body?.rfqIds);
  const selectedMemberIds = req.body?.memberIds;
  const recommendationsInput = req.body?.recommendations;

  try {
    let members;
    if (selectedMemberIds !== undefined && selectedMemberIds !== null) {
      if (!Array.isArray(selectedMemberIds) || !selectedMemberIds.length) {
        return res.status(400).json({ message: 'Select at least one committee member to receive this review.' });
      }
      const memberIds = [...new Set(selectedMemberIds.map(Number))];
      if (memberIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
        return res.status(400).json({ message: 'One or more selected committee members are invalid.' });
      }
      [members] = await pool.execute(
        `SELECT id, first_name AS firstName, last_name AS lastName, email
         FROM procurement_committee_members
         WHERE id IN (${memberIds.map(() => '?').join(',')})
         ORDER BY last_name, first_name, id`,
        memberIds
      );
      if (members.length !== memberIds.length) {
        return res.status(404).json({ message: 'One or more selected committee members could not be found.' });
      }
    } else {
      [members] = await pool.query(
        `SELECT id, first_name AS firstName, last_name AS lastName, email
         FROM procurement_committee_members
         ORDER BY last_name, first_name, id`
      );
    }
    if (!members.length) {
      return res.status(409).json({ message: 'Add Procurement Committee members before sending an RFQ.' });
    }

    const report = await buildCommitteeReport(rfqIds);

    // Procurement enters one recommendation per RFQ before sending. Legacy
    // callers that omit recommendations keep the previous behaviour.
    const recommendations = {};
    if (recommendationsInput !== undefined && recommendationsInput !== null) {
      for (const section of report) {
        const entry = recommendationsInput[section.id] || recommendationsInput[String(section.id)];
        const supplier = (section.suppliers || []).find((item) =>
          Number(item.supplierId) === Number(entry?.supplierId) && (item.responseAt || item.amount !== null));
        const reason = String(entry?.reason || '').trim().slice(0, 5000);
        if (!supplier || !reason) {
          return res.status(400).json({
            message: `Choose a recommended supplier and give a reason for ${section.reference}.`
          });
        }
        recommendations[String(section.id)] = {
          supplierId: Number(supplier.supplierId),
          supplierName: supplier.name,
          reason
        };
      }
    }

    const settings = await getSettings();
    const generatedAt = new Date().toISOString();
    const responseCount = report.reduce(
      (total, section) => total + section.suppliers.filter((supplier) =>
        supplier.responseAt || supplier.amount !== null || (supplier.items || []).length).length,
      0
    );
    const subject = report.length === 1
      ? `Supplier responses and decision form for ${report[0].reference} - Procurement Committee`
      : `Supplier responses and decision forms for ${report.length} RFQs - Procurement Committee`;

    const deliveries = [];
    let reviewsCreated = 0;
    for (const member of members) {
      const recipientName = `${member.firstName} ${member.lastName}`.trim();
      const links = [];
      const reviewIds = [];

      for (const section of report) {
        // One token per RFQ and recipient is stored before the email is sent,
        // so the link remains valid even if the provider is slow. The snapshot
        // is what was actually emailed and cannot change if a quote is edited.
        const token = randomBytes(32).toString('hex');
        const recommendation = recommendations[String(section.id)] || null;
        const snapshot = {
          ...section,
          recommendations,
          recommendation,
          generatedAt,
          recipient: { name: recipientName, email: member.email }
        };
        const [result] = await pool.execute(
          `INSERT INTO rfq_committee_reviews
             (rfq_id, token, committee_member_id, created_by, recipient_name, recipient_email,
              recommended_supplier_id, reason, report_snapshot, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
          [section.id, token, member.id || null, req.user.id, recipientName, member.email,
            recommendation?.supplierId || null, recommendation?.reason || null,
            JSON.stringify(snapshot)]
        );
        reviewIds.push(Number(result.insertId));
        links.push({ id: section.id, reference: section.reference, url: committeeReviewLink(token) });
      }

      const text = [
        `Hello ${recipientName},`,
        '',
        `Procurement has sent ${responseCount} supplier response(s) for your decision. Prepared ${readableGeneratedAt(generatedAt, settings)}.`,
        '',
        'OPEN YOUR DECISION FORM(S) BELOW. Open the OPEN DECISION FORM link, choose one Accept or Deny for Procurement’s recommendation, and give a reason for that decision. Only one decision is accepted per link.',
        '',
        ...links.map((link) => `- ${link.reference}: ${link.url}`),
        '',
        ...report.map((section) => {
          const base = committeeReportText(section, settings);
          const recommendation = recommendations[String(section.id)];
          return recommendation
            ? `${base}\n\nProcurement recommendation: ${recommendation.supplierName}\nReason: ${recommendation.reason}`
            : base;
        }),
        '',
        'All amounts are in RWF.'
      ].join('\n');

      const emailResult = await sendEmail({
        to: member.email,
        subject,
        text,
        html: committeeReviewEmailHtml({
          recipientName, sections: report, links, recommendations, generatedAt, settings
        })
      });
      if (reviewIds.length) {
        await pool.execute(
          `UPDATE rfq_committee_reviews
              SET sent_at = UTC_TIMESTAMP(), status = ?
            WHERE id IN (${reviewIds.map(() => '?').join(',')})`,
          [emailResult.ok ? 'Sent' : 'Failed', ...reviewIds]
        );
        reviewsCreated += reviewIds.length;
      }
      deliveries.push({
        name: recipientName,
        email: member.email,
        status: emailResult.status,
        error: emailResult.ok ? null : emailResult.error?.message || 'Email could not be accepted by the provider.',
        reviewCount: reviewIds.length
      });
    }

    await Promise.all(report.map((section) => writeAudit(pool, req.user.id, 'rfq_committee_email_requested', 'rfq', section.id, {
      batchReferences: report.map((entry) => entry.reference),
      recipientCount: members.length,
      selectedRecipients: members.map((member) => member.email),
      recommendations,
      responseCount: section.suppliers.filter((supplier) =>
        supplier.responseAt || supplier.amount !== null || (supplier.items || []).length).length
    })));

    const accepted = deliveries.filter((delivery) => delivery.status === 'Accepted by Email Provider').length;
    return res.json({
      message: 'RFQ and supplier responses sent to Procurement Committee.',
      total: deliveries.length,
      accepted,
      failed: deliveries.length - accepted,
      rfqCount: report.length,
      responseCount,
      reviewsCreated,
      deliveries
    });
  } catch (error) { return next(error); }
});

// Procurement reads the outcome of every review it sent, including the
// Accept/Deny decision and reason recorded by each Committee member.
router.get('/rfqs/:id/committee-reviews', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const [reviews] = await pool.execute(
      `SELECT r.id, r.recipient_name AS recipientName, r.recipient_email AS recipientEmail,
          r.recommended_supplier_id AS recommendedSupplierId, r.reason AS recommendationReason,
          s.name AS recommendedSupplier,
          r.status, r.sent_at AS sentAt, r.opened_at AS openedAt, r.submitted_at AS submittedAt
         FROM rfq_committee_reviews r
         LEFT JOIN suppliers s ON s.id = r.recommended_supplier_id
        WHERE r.rfq_id = ?
        ORDER BY r.id DESC`,
      [req.params.id]
    );
    const [decisions] = await pool.execute(
      `SELECT d.review_id AS reviewId, d.supplier_id AS supplierId, s.name AS supplier,
          d.decision, d.reason, d.responder_name AS responderName, d.decided_at AS decidedAt
         FROM rfq_committee_decisions d
         JOIN rfq_committee_reviews r ON r.id = d.review_id
         JOIN suppliers s ON s.id = d.supplier_id
        WHERE r.rfq_id = ?
        ORDER BY d.review_id, s.name`,
      [req.params.id]
    );
    const decisionsByReview = new Map();
    for (const decision of decisions) {
      if (!decisionsByReview.has(decision.reviewId)) decisionsByReview.set(decision.reviewId, []);
      decisionsByReview.get(decision.reviewId).push(decision);
    }
    return res.json({
      rfq,
      reviews: reviews.map((review) => ({
        ...review,
        decisions: decisionsByReview.get(review.id) || []
      }))
    });
  } catch (error) { return next(error); }
});

// Procurement's recommended suppliers are surfaced in the Purchase orders
// workspace so a recommendation can be opened and turned into a PO directly.
router.get('/committee-recommendations', allowRoles(...managers), async (req, res, next) => {
  try {
    const [recommendations] = await pool.query(
      `SELECT r.id AS reviewId, r.rfq_id AS rfqId, r.report_snapshot AS snapshot,
          r.recommended_supplier_id AS supplierId, r.reason AS recommendationReason,
          r.recipient_name AS recipientName, r.recipient_email AS recipientEmail,
          r.status, r.sent_at AS sentAt, r.submitted_at AS submittedAt,
          f.reference, q.title, f.requisition_id AS requisitionId,
          q.reference AS requisitionReference, d.name AS department,
          q.submitted_at AS requisitionSubmittedAt, q.created_at AS requisitionCreatedAt,
          (SELECT COUNT(*) FROM requisitions rr
            WHERE rr.requester_id = q.requester_id
              AND rr.department_id <=> q.department_id
              AND rr.id <= q.id) AS departmentSequence,
          s.name AS supplier, s.contact_name AS supplierContact,
          s.phone AS supplierPhone, s.email AS supplierEmail, s.address AS supplierAddress,
          qt.id AS quotationId, qt.amount AS quotationAmount,
          qt.delivery_days AS deliveryDays, qt.notes AS quotationNotes,
          (SELECT dc.decision FROM rfq_committee_decisions dc
            WHERE dc.review_id = r.id ORDER BY dc.id DESC LIMIT 1) AS decision,
          (SELECT dc.reason FROM rfq_committee_decisions dc
            WHERE dc.review_id = r.id ORDER BY dc.id DESC LIMIT 1) AS decisionReason,
          (SELECT dc.responder_name FROM rfq_committee_decisions dc
            WHERE dc.review_id = r.id ORDER BY dc.id DESC LIMIT 1) AS responderName,
          (SELECT po.id FROM purchase_orders po
            WHERE po.rfq_id = f.id ORDER BY po.id DESC LIMIT 1) AS purchaseOrderId,
          (SELECT po.reference FROM purchase_orders po
            WHERE po.rfq_id = f.id ORDER BY po.id DESC LIMIT 1) AS purchaseOrderReference
         FROM rfq_committee_reviews r
         JOIN rfqs f ON f.id = r.rfq_id
         JOIN requisitions q ON q.id = f.requisition_id
         LEFT JOIN departments d ON d.id = q.department_id
         LEFT JOIN suppliers s ON s.id = r.recommended_supplier_id
         LEFT JOIN quotations qt ON qt.id = (
           SELECT qt2.id FROM quotations qt2
            WHERE qt2.rfq_id = f.id AND qt2.supplier_id = r.recommended_supplier_id
            ORDER BY qt2.id DESC LIMIT 1
         )
        WHERE r.recommended_supplier_id IS NOT NULL
        ORDER BY r.id DESC`
    );
    return res.json({
      recommendations: recommendations.map((row) => {
        let snapshot = {};
        if (typeof row.snapshot === 'object' && row.snapshot !== null) snapshot = row.snapshot;
        else {
          try { snapshot = row.snapshot ? JSON.parse(row.snapshot) : {}; }
          catch { snapshot = {}; }
        }
        const quotedItems = (snapshot.suppliers || [])
          .find((entry) => Number(entry.supplierId) === Number(row.supplierId))?.items || [];
        return {
          ...row,
          requisitionDisplayReference: requisitionDisplayReference({
            submittedAt: row.requisitionSubmittedAt,
            createdAt: row.requisitionCreatedAt,
            departmentSequence: row.departmentSequence
          }),
          supplierId: Number(row.supplierId),
          quotationId: row.quotationId ? Number(row.quotationId) : null,
          quotationAmount: row.quotationAmount === null ? null : Number(row.quotationAmount),
          deliveryDays: row.deliveryDays === null ? null : Number(row.deliveryDays),
          purchaseOrderId: row.purchaseOrderId ? Number(row.purchaseOrderId) : null,
          recommendedSupplier: row.supplier || 'Supplier',
          reason: row.recommendationReason || '',
          items: quotedItems
        };
      })
    });
  } catch (error) { return next(error); }
});

// A recipient who cannot open the original email can be sent the same private
// token again. Reusing the token preserves the one-decision-set-per-link rule.
router.post('/rfqs/:id/committee-reviews/:reviewId/resend', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT r.id, r.token, r.recipient_name AS recipientName, r.recipient_email AS recipientEmail,
              r.report_snapshot AS snapshot, r.submitted_at AS submittedAt, f.reference
         FROM rfq_committee_reviews r
         JOIN rfqs f ON f.id = r.rfq_id
        WHERE r.id = ? AND r.rfq_id = ?`,
      [req.params.reviewId, req.params.id]
    );
    if (!row) return res.status(404).json({ message: 'Committee review link not found.' });
    if (row.submittedAt) {
      return res.status(409).json({ message: 'This recipient has already submitted decisions from the link.' });
    }

    const snapshot = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : (row.snapshot || {});
    const settings = await getSettings();
    const generatedAt = readableGeneratedAt(new Date(), settings);
    const link = committeeReviewLink(row.token);
    const responseCount = (snapshot.suppliers || []).filter((supplier) =>
      supplier.responseAt || supplier.amount !== null || (supplier.items || []).length).length;
    const recommendation = snapshot.recommendation || null;
    const base = committeeReportText(snapshot, settings);

    const text = [
      `Hello ${row.recipientName || 'Committee member'},`,
      '',
      'The decision link for this RFQ has been resent. Use the link below to open your form; no staff login is needed.',
      '',
      `- ${snapshot.reference || row.reference}: ${link}`,
      '',
      `Procurement has sent ${responseCount} supplier response(s) for your decision. Prepared ${generatedAt}.`,
      '',
      'Choose one Accept or Deny for Procurement’s recommendation. Give a reason for that decision. Only one decision is accepted per link.',
      '',
      recommendation ? `${base}\n\nProcurement recommendation: ${recommendation.supplierName}\nReason: ${recommendation.reason}` : base,
      '',
      'All amounts are in RWF.'
    ].join('\n');

    const emailResult = await sendEmail({
      to: row.recipientEmail,
      subject: `Decision link resent for ${snapshot.reference || row.reference} - Procurement Committee`,
      text,
      html: committeeReviewEmailHtml({
        recipientName: row.recipientName || 'Committee member',
        sections: [snapshot],
        links: [{ id: snapshot.id || row.id, reference: snapshot.reference || row.reference, url: link }],
        recommendations: recommendation ? { [String(snapshot.id || row.id)]: recommendation } : {},
        generatedAt,
        settings
      })
    });

    await pool.execute(
      `UPDATE rfq_committee_reviews
          SET sent_at = UTC_TIMESTAMP(), status = ?
        WHERE id = ?`,
      [emailResult.ok ? 'Sent' : 'Failed', row.id]
    );
    await writeAudit(pool, req.user.id, 'rfq_committee_link_resent', 'rfq', req.params.id, {
      reviewId: row.id,
      recipientEmail: row.recipientEmail,
      status: emailResult.status
    });

    return res.json({
      message: emailResult.ok
        ? `Decision link resent to ${row.recipientEmail}.`
        : 'The email provider did not accept the resent decision link.',
      result: emailResult
    });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/emails/retry-failed', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const result = await retryFailedDeliveries({ rfqId: req.params.id, userId: req.user.id });
    const deliveries = await listRfqDeliveries(req.params.id);
    return res.json({ message: 'Failed recipient retry completed.', result, ...deliveries });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/email-deliveries/:deliveryId/resend', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const deliveryId = await createResendDelivery({
      rfqId: req.params.id,
      deliveryId: req.params.deliveryId,
      userId: req.user.id
    });
    if (!deliveryId) return res.status(404).json({ message: 'Delivery record not found for this RFQ.' });
    const result = await sendRfqDeliveries({ rfqId: req.params.id, deliveryIds: [deliveryId] });
    const deliveries = await listRfqDeliveries(req.params.id);
    return res.json({ message: 'RFQ link resent to the selected Supplier.', result, ...deliveries });
  } catch (error) { return next(error); }
});

export default router;

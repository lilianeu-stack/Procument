import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';

const router = Router();
const TOKEN_PATTERN = /^[a-f0-9]{32}$/i;

async function loadThread(token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return null;
  const [[thread]] = await pool.execute(
    `SELECT t.id, t.requisition_id AS requisitionId, t.recipient_email AS recipientEmail,
       t.response_submitted_at AS responseSubmittedAt, t.message,
       r.reference, r.title, d.name AS department, u.name AS requester
     FROM requisition_email_threads t
     JOIN requisitions r ON r.id = t.requisition_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN users u ON u.id = r.requester_id
    WHERE t.token = ? LIMIT 1`,
    [token]
  );
  return thread || null;
}

router.get('/request-response/:token', async (req, res, next) => {
  try {
    const thread = await loadThread(req.params.token);
    if (!thread) return res.status(404).json({ message: 'This response link is invalid or has expired.' });

    const [items] = await pool.execute(
      `SELECT item_name AS itemName, description, quantity, unit,
         estimated_unit_cost AS estimatedUnitCost,
         (quantity * estimated_unit_cost) AS lineTotal
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [thread.requisitionId]
    );
    const [comments] = await pool.execute(
      `SELECT id, sender, comment, received_at AS receivedAt
       FROM requisition_email_comments
       WHERE thread_id = ? ORDER BY received_at DESC, id DESC LIMIT 20`,
      [thread.id]
    );
    const response = comments.find((entry) => entry.sender && entry.comment) || null;

    return res.json({
      request: {
        reference: thread.reference,
        title: thread.title,
        department: thread.department,
        requester: thread.requester,
        recipientEmail: thread.recipientEmail,
        message: thread.message || '',
        responded: Boolean(thread.responseSubmittedAt || response),
        response: response ? {
          sender: response.sender,
          comment: response.comment,
          receivedAt: response.receivedAt
        } : null,
        items: items.map((item) => ({
          ...item,
          estimatedUnitCost: Number(item.estimatedUnitCost),
          lineTotal: Number(item.lineTotal)
        }))
      },
      comments
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-response/:token/comment', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const thread = await loadThread(req.params.token);
    if (!thread) {
      return res.status(404).json({ message: 'This response link is invalid or has expired.' });
    }

    const comment = String(req.body.comment || '').trim();
    const responderName = String(req.body.responderName || '').trim().slice(0, 150);
    if (!comment || comment.length > 5000) {
      return res.status(400).json({ message: 'Enter a comment of 5,000 characters or fewer.' });
    }

    await connection.beginTransaction();
    const [claim] = await connection.execute(
      `UPDATE requisition_email_threads
          SET response_submitted_at = UTC_TIMESTAMP()
        WHERE id = ? AND response_submitted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM requisition_email_comments WHERE thread_id = ?
          )`,
      [thread.id, thread.id]
    );
    if (!claim.affectedRows) {
      await connection.rollback();
      return res.status(409).json({ message: 'A response has already been submitted for this form.' });
    }

    const sender = responderName
      ? `${responderName} <${thread.recipientEmail}>`
      : thread.recipientEmail;
    const gmailMessageId = `form:${randomBytes(12).toString('hex')}`;
    const subject = `Response form - ${thread.reference}`;

    await connection.execute(
      `INSERT INTO requisition_email_comments
         (requisition_id, thread_id, gmail_message_id, sender, recipient,
          subject, comment, body_text, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        thread.requisitionId, thread.id, gmailMessageId, sender,
        thread.recipientEmail, subject, comment, comment
      ]
    );
    await connection.execute(
      `INSERT INTO requisition_activity (requisition_id, user_id, action, details)
       VALUES (?, NULL, 'email_comment_received', ?)`,
      [thread.requisitionId, JSON.stringify({
        source: 'response_form',
        sender,
        subject,
        comment,
        responseMessageId: gmailMessageId
      })]
    );
    await writeAudit(connection, null, 'requisition_response_comment_received', 'requisition', thread.requisitionId, {
      reference: thread.reference, responderName, sender
    });

    const [managers] = await connection.execute(
      "SELECT id FROM users WHERE active = TRUE AND role IN ('admin', 'procurement')"
    );
    const link = `#/admin/${encodeURIComponent('Requests Received from Departments')}?view=${thread.requisitionId}&request=${thread.requisitionId}`;
    for (const manager of managers) {
      await createNotification(
        connection,
        manager.id,
        'Response comment received',
        `${thread.reference}: ${comment.slice(0, 120)}`,
        link,
        'email'
      );
    }

    await connection.commit();
    return res.status(201).json({
      message: 'Your comment was sent directly to Procurement.',
      reference: thread.reference
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;

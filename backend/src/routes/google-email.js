import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { allowRoles } from '../middleware/auth.js';
import { writeAudit } from '../lib/events.js';
import { emailConfigStatus, normalizeEmail, validEmail } from '../utils/email-config.js';
import { buildRequestedItemsEmail } from '../utils/email-reply.js';
import { sendEmail } from '../services/email.js';
import {
  buildGoogleAuthorizationUrl, createOAuthState, disconnectGoogleMailbox,
  exchangeAuthorizationCode, fetchGoogleAccount, googleConnectionStatus,
  hashOAuthState, listInboxMessages, getInboxMessage, saveGoogleConnection,
  syncGoogleInbox
} from '../services/google-email.js';

const publicRouter = Router();
const router = Router();
const managers = ['admin', 'procurement'];

function clientInboxUrl(result) {
  let origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  try {
    origin = new URL(origin).origin;
  } catch {
    origin = 'http://localhost:5173';
  }
  return `${origin}/#/admin/Email%20Inbox?google=${encodeURIComponent(result)}`;
}

async function consumeOAuthState(rawState) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT created_by AS createdBy FROM google_email_oauth_states
       WHERE state_hash = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
      [hashOAuthState(rawState)]
    );
    if (!rows.length) {
      await connection.rollback();
      return null;
    }
    await connection.execute('DELETE FROM google_email_oauth_states WHERE state_hash = ?', [hashOAuthState(rawState)]);
    await connection.commit();
    return rows[0].createdBy;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

publicRouter.get('/email/google/callback', async (req, res, next) => {
  try {
    const state = String(req.query.state || '');
    if (!state) return res.status(400).send('Google authorization state is missing. Return to the app and try connecting again.');
    const userId = await consumeOAuthState(state);
    if (!userId) return res.status(400).send('Google authorization has expired or was already used. Return to the app and try again.');
    if (req.query.error) return res.redirect(303, clientInboxUrl('error'));

    const code = String(req.query.code || '');
    if (!code) return res.status(400).send('Google did not return an authorization code. Return to the app and try again.');
    const tokens = await exchangeAuthorizationCode(code);
    if (!tokens.refresh_token) {
      return res.status(400).send('Google did not issue a refresh token. Return to the app and reconnect, approving access when prompted.');
    }
    const grantedScopes = String(tokens.scope || '').split(/\s+/);
    if (!grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly') ||
        !grantedScopes.includes('https://www.googleapis.com/auth/gmail.send')) {
      return res.status(403).send('Google did not grant the requested Gmail read and send access. Return to the app and reconnect with the requested permissions.');
    }

    const account = await fetchGoogleAccount(tokens.access_token);
    const expectedMailbox = normalizeEmail(process.env.GOOGLE_MAILBOX);
    const connectedMailbox = normalizeEmail(account.email);
    if (!account.email_verified || !validEmail(connectedMailbox) || connectedMailbox !== expectedMailbox) {
      return res.status(403).send('The Google account does not match the configured procurement mailbox. No token was stored.');
    }

    await saveGoogleConnection({
      mailbox: connectedMailbox,
      refreshToken: tokens.refresh_token,
      scopes: String(tokens.scope || ''),
      userId
    });
    return res.redirect(303, clientInboxUrl('connected'));
  } catch (error) {
    return next(error);
  }
});

router.get('/email/google/status', allowRoles(...managers), async (_req, res, next) => {
  try {
    return res.json(await googleConnectionStatus());
  } catch (error) {
    return next(error);
  }
});

router.get('/email/google/connect', allowRoles(...managers), async (req, res, next) => {
  try {
    const state = createOAuthState();
    await pool.execute('DELETE FROM google_email_oauth_states WHERE expires_at <= UTC_TIMESTAMP()');
    await pool.execute(
      `INSERT INTO google_email_oauth_states (state_hash, created_by, expires_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))`,
      [hashOAuthState(state), req.user.id]
    );
    return res.json({ authorizationUrl: buildGoogleAuthorizationUrl(state) });
  } catch (error) {
    return next(error);
  }
});

router.post('/email/google/disconnect', allowRoles(...managers), async (_req, res, next) => {
  try {
    const disconnected = await disconnectGoogleMailbox();
    return res.json({
      message: disconnected ? 'Google mailbox disconnected and its stored messages removed.' : 'Google mailbox was not connected.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/email/inbox/messages', allowRoles(...managers), async (_req, res, next) => {
  try {
    const messages = await listInboxMessages();
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

router.get('/email/inbox/messages/:id', allowRoles(...managers), async (req, res, next) => {
  try {
    const message = await getInboxMessage(req.params.id);
    if (!message) return res.status(404).json({ message: 'Email not found. Sync the inbox and try again.' });
    return res.json({ message });
  } catch (error) {
    return next(error);
  }
});

router.post('/email/inbox/sync', allowRoles(...managers), async (_req, res, next) => {
  try {
    const result = await syncGoogleInbox();
    return res.json({ message: 'Inbox sync completed.', ...result });
  } catch (error) {
    return next(error);
  }
});

function publicFormUrl(token) {
  const base = String(emailConfigStatus().appBaseUrl || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/#/response?token=${encodeURIComponent(token)}`;
}

async function requisitionFormEmail(connection, requisitionId, { token, recipientPhone, message }) {
  const [[requisition]] = await connection.execute(
    `SELECT r.id, r.reference, r.title, d.name AS department, u.name AS requester
       FROM requisitions r
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users u ON u.id = r.requester_id
      WHERE r.id = ? AND r.forwarded_by_supervisor IS NOT NULL LIMIT 1`,
    [requisitionId]
  );
  if (!requisition) return null;
  const [items] = await connection.execute(
    `SELECT item_name AS itemName, description, quantity, unit,
        estimated_unit_cost AS estimatedUnitCost,
        (quantity * estimated_unit_cost) AS lineTotal
       FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
    [requisitionId]
  );
  return {
    requisition,
    email: buildRequestedItemsEmail({
      requisitionId,
      reference: requisition.reference,
      title: requisition.title,
      department: requisition.department,
      requester: requisition.requester,
      recipientPhone,
      items,
      token,
      message,
      responseUrl: publicFormUrl(token)
    })
  };
}

router.get('/email/requisitions/:id/forms', allowRoles(...managers), async (req, res, next) => {
  try {
    const requisitionId = Number(req.params.id);
    if (!Number.isInteger(requisitionId) || requisitionId < 1) {
      return res.status(400).json({ message: 'Invalid requisition identifier.' });
    }
    const [[requisition]] = await pool.execute(
      'SELECT id, reference FROM requisitions WHERE id = ? AND forwarded_by_supervisor IS NOT NULL LIMIT 1',
      [requisitionId]
    );
    if (!requisition) return res.status(404).json({ message: 'Forwarded request not found.' });
    const [rows] = await pool.execute(
      `SELECT t.id, t.recipient_email AS recipientEmail, t.recipient_phone AS recipientPhone,
          t.message, t.created_at AS createdAt, t.response_submitted_at AS responseSubmittedAt,
          (SELECT COUNT(*) FROM requisition_email_comments c WHERE c.thread_id = t.id) AS responseCount
         FROM requisition_email_threads t WHERE t.requisition_id = ?
        ORDER BY t.created_at DESC, t.id DESC`,
      [requisitionId]
    );
    return res.json({
      requisition,
      forms: rows.map((form) => ({
        ...form,
        responseCount: Number(form.responseCount) || 0,
        responded: Boolean(form.responseSubmittedAt || Number(form.responseCount) > 0)
      }))
    });
  } catch (error) { return next(error); }
});

router.post('/email/requisitions/:id/forms/:threadId/resend', allowRoles(...managers), async (req, res, next) => {
  const requisitionId = Number(req.params.id);
  const threadId = Number(req.params.threadId);
  if (!Number.isInteger(requisitionId) || requisitionId < 1 || !Number.isInteger(threadId) || threadId < 1) {
    return res.status(400).json({ message: 'Invalid request or form identifier.' });
  }
  const connection = await pool.getConnection();
  try {
    const [[thread]] = await connection.execute(
      `SELECT id, token, recipient_email AS recipientEmail, recipient_phone AS recipientPhone, message
         FROM requisition_email_threads WHERE id = ? AND requisition_id = ? LIMIT 1`,
      [threadId, requisitionId]
    );
    if (!thread) return res.status(404).json({ message: 'Sent response form not found.' });
    const form = await requisitionFormEmail(connection, requisitionId, thread);
    if (!form) return res.status(404).json({ message: 'Forwarded request not found.' });

    await writeAudit(connection, req.user.id, 'requisition_email_form_resent', 'requisition', requisitionId, {
      to: thread.recipientEmail,
      threadId,
      subject: form.email.subject,
      link: publicFormUrl(thread.token)
    });
    const result = await sendEmail({
      to: thread.recipientEmail,
      subject: form.email.subject,
      text: form.email.text,
      html: form.email.html
    });
    if (!result.ok) {
      return res.status(result.reason === 'not_configured' ? 503 : 502).json({
        message: result.error?.message || 'Email provider could not accept this message.'
      });
    }
    return res.json({
      message: 'Response form resent with the current public link.',
      status: result.status,
      threadId
    });
  } catch (error) { return next(error); }
  finally { connection.release(); }
});

router.post('/email/requisitions/:id/send', allowRoles(...managers), async (req, res, next) => {
  const requisitionId = Number(req.params.id);
  const to = normalizeEmail(req.body.to);
  const recipientPhone = String(req.body.recipientPhone || '').trim().slice(0, 50);
  const message = String(req.body.message || '').trim().slice(0, 2000);

  if (!Number.isInteger(requisitionId) || requisitionId < 1) {
    return res.status(400).json({ message: 'Invalid requisition identifier.' });
  }
  if (!validEmail(to)) return res.status(400).json({ message: 'Enter a valid recipient email address.' });

  const connection = await pool.getConnection();
  let threadId = null;
  try {
    await connection.beginTransaction();
    const [[requisition]] = await connection.execute(
      `SELECT r.id, r.reference, r.title, d.name AS department, u.name AS requester
         FROM requisitions r
         LEFT JOIN departments d ON d.id = r.department_id
         LEFT JOIN users u ON u.id = r.requester_id
        WHERE r.id = ? AND r.forwarded_by_supervisor IS NOT NULL LIMIT 1`,
      [requisitionId]
    );
    if (!requisition) {
      await connection.rollback();
      return res.status(404).json({ message: 'Forwarded request not found.' });
    }

    const [items] = await connection.execute(
      `SELECT item_name AS itemName, description, quantity, unit,
         estimated_unit_cost AS estimatedUnitCost,
         (quantity * estimated_unit_cost) AS lineTotal
        FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
      [requisitionId]
    );

    const token = randomBytes(16).toString('hex');
    const [thread] = await connection.execute(
      `INSERT INTO requisition_email_threads
         (requisition_id, token, recipient_email, recipient_phone, message, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [requisitionId, token, to, recipientPhone || null, message || null, req.user.id]
    );
    threadId = thread.insertId;

    const appBaseUrl = String(emailConfigStatus().appBaseUrl || 'http://localhost:5173').replace(/\/+$/, '');
    const responseUrl = `${appBaseUrl}/#/response?token=${encodeURIComponent(token)}`;
    const email = buildRequestedItemsEmail({
      requisitionId,
      reference: requisition.reference,
      title: requisition.title,
      department: requisition.department,
      requester: requisition.requester,
      recipientPhone,
      items,
      token,
      message,
      responseUrl
    });

    await writeAudit(connection, req.user.id, 'requisition_email_form_sent', 'requisition', requisitionId, {
      to, subject: email.subject, recipientPhone
    });
    await connection.commit();

    const result = await sendEmail({
      to, subject: email.subject, text: email.text, html: email.html
    });
    if (!result.ok) {
      await pool.execute('DELETE FROM requisition_email_threads WHERE id = ?', [threadId]);
      return res.status(result.reason === 'not_configured' ? 503 : 502).json({
        message: result.error?.message || 'Email provider could not accept this message.'
      });
    }

    return res.json({
      message: 'Requested items form sent. A recipient reply will appear here as a comment after inbox sync.',
      status: result.status,
      requisitionId,
      threadId
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/email/send', allowRoles(...managers), async (req, res, next) => {
  try {
    const to = normalizeEmail(req.body.to);
    const subject = String(req.body.subject || '').trim();
    const text = String(req.body.text || '').trim();
    if (!validEmail(to)) return res.status(400).json({ message: 'Enter a valid recipient email address.' });
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
      return res.status(400).json({ message: 'Subject is required, must be 200 characters or fewer, and cannot contain line breaks.' });
    }
    if (!text || text.length > 50000) return res.status(400).json({ message: 'Message is required and must be 50,000 characters or fewer.' });

    await writeAudit(pool, req.user.id, 'email_send_requested', 'email', to, { subject });
    const result = await sendEmail({ to, subject, text });
    if (!result.ok) {
      return res.status(result.reason === 'not_configured' ? 503 : 502).json({
        message: result.error?.message || 'Email provider could not accept this message.'
      });
    }
    return res.json({ message: 'Email accepted by the configured provider.', status: result.status });
  } catch (error) {
    return next(error);
  }
});

export { publicRouter as googleEmailPublicRouter };
export default router;

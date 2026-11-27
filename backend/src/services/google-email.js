import { createDecipheriv, createCipheriv, createHash, randomBytes } from 'node:crypto';
import pool from '../config/db.js';
import { emailConfigStatus, normalizeEmail, validEmail } from '../utils/email-config.js';
import { createNotification } from '../lib/events.js';
import { log } from '../lib/logger.js';
import { extractReplyComment, findRequisitionReplyTag } from '../utils/email-reply.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
const MESSAGE_LIMIT = 25;
const BODY_LIMIT = 60000;

function env(name) {
  return String(process.env[name] || '').trim();
}

function encryptionKey() {
  const value = env('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!/^[\da-f]{64}$/i.test(value)) return null;
  return Buffer.from(value, 'hex');
}

function googleConfig() {
  const missing = [];
  const clientId = env('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET');
  const mailbox = normalizeEmail(env('GOOGLE_MAILBOX'));
  const redirectUri = env('GOOGLE_OAUTH_REDIRECT_URI') || 'http://localhost:4000/api/email/google/callback';
  let validRedirect = false;
  try {
    const url = new URL(redirectUri);
    validRedirect = ['http:', 'https:'].includes(url.protocol) &&
      url.pathname === '/api/email/google/callback' && !url.search && !url.hash &&
      (process.env.NODE_ENV !== 'production' || url.protocol === 'https:');
  } catch {
    validRedirect = false;
  }

  if (!clientId) missing.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!validEmail(mailbox)) missing.push('GOOGLE_MAILBOX');
  if (!validRedirect) missing.push('GOOGLE_OAUTH_REDIRECT_URI');
  if (!encryptionKey()) missing.push('GOOGLE_TOKEN_ENCRYPTION_KEY');

  return { clientId, clientSecret, mailbox, redirectUri, missing, configured: missing.length === 0 };
}

function requireGoogleConfig() {
  const config = googleConfig();
  if (!config.configured) {
    const error = new Error(`Google email is not configured. Missing or invalid setting(s): ${config.missing.join(', ')}.`);
    error.status = 503;
    throw error;
  }
  return config;
}

export function googleEmailConfigStatus() {
  const config = googleConfig();
  return {
    configured: config.configured,
    missing: config.missing,
    mailbox: config.mailbox || null,
    redirectUri: config.redirectUri
  };
}

export function createOAuthState() {
  return randomBytes(32).toString('base64url');
}

export function hashOAuthState(state) {
  return createHash('sha256').update(String(state)).digest('hex');
}

export function buildGoogleAuthorizationUrl(state) {
  const config = requireGoogleConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export function encryptRefreshToken(token) {
  const key = encryptionKey();
  if (!key) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex')
  };
}

export function decryptRefreshToken(ciphertext, iv, tag) {
  const key = encryptionKey();
  if (!key) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Google rejected the email authorization request.');
    error.status = response.status === 400 ? 400 : 502;
    error.code = data.error || 'GOOGLE_AUTH_ERROR';
    throw error;
  }
  return data;
}

export async function exchangeAuthorizationCode(code) {
  const config = requireGoogleConfig();
  return postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code'
  });
}

export async function fetchGoogleAccount(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const error = new Error('Google could not verify the connected mailbox.');
    error.status = 502;
    throw error;
  }
  return response.json();
}

export async function saveGoogleConnection({ mailbox, refreshToken, scopes, userId }) {
  const encrypted = encryptRefreshToken(refreshToken);
  await pool.execute(
    `INSERT INTO google_email_connection
       (id, mailbox, refresh_token, token_iv, token_tag, granted_scopes, connected_by)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mailbox = VALUES(mailbox), refresh_token = VALUES(refresh_token),
       token_iv = VALUES(token_iv), token_tag = VALUES(token_tag),
       granted_scopes = VALUES(granted_scopes), connected_by = VALUES(connected_by),
       connected_at = CURRENT_TIMESTAMP`,
    [mailbox, encrypted.ciphertext, encrypted.iv, encrypted.tag, scopes, userId]
  );
}

export async function googleConnectionStatus() {
  const config = googleConfig();
  const [[connection]] = await pool.execute(
    `SELECT mailbox, granted_scopes AS grantedScopes, connected_at AS connectedAt
     FROM google_email_connection WHERE id = 1`
  );
  const connected = Boolean(connection && connection.mailbox === config.mailbox);
  const googleSendEnabled = Boolean(
    connected && connection.grantedScopes.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send')
  );
  return {
    ...googleEmailConfigStatus(),
    connected,
    googleSendEnabled,
    connectedMailbox: connection?.mailbox || null,
    connectedAt: connected ? connection.connectedAt : null,
    connectionMismatch: Boolean(connection && !connected),
    smtpConfigured: emailConfigStatus().configured
  };
}

async function accessToken(requiredScope = 'gmail.readonly') {
  const config = requireGoogleConfig();
  const [[connection]] = await pool.execute(
    `SELECT mailbox, granted_scopes AS grantedScopes, refresh_token AS refreshToken,
       token_iv AS tokenIv, token_tag AS tokenTag
     FROM google_email_connection WHERE id = 1`
  );
  if (!connection) {
    const error = new Error('Connect the Google mailbox before syncing the inbox.');
    error.status = 409;
    throw error;
  }
  if (connection.mailbox !== config.mailbox) {
    const error = new Error('The saved Google connection belongs to a different mailbox. Reconnect the configured mailbox.');
    error.status = 409;
    throw error;
  }
  if (!connection.grantedScopes.split(/\s+/).includes(`https://www.googleapis.com/auth/${requiredScope}`)) {
    const error = new Error(`The saved Google connection does not include ${requiredScope} permission. Reconnect and approve the requested Gmail access.`);
    error.status = 409;
    throw error;
  }

  const refreshToken = decryptRefreshToken(connection.refreshToken, connection.tokenIv, connection.tokenTag);
  const tokens = await postForm(GOOGLE_TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  if (!tokens.access_token) {
    const error = new Error('Google did not return an access token. Reconnect the mailbox and try again.');
    error.status = 502;
    throw error;
  }
  return tokens.access_token;
}

async function gmailRequest(path, token, options = {}) {
  const response = await fetch(`${GOOGLE_API_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? 'Google authorization expired or was revoked. Reconnect the mailbox.'
      : 'Google could not complete the inbox request.');
    error.status = response.status === 401 ? 409 : 502;
    error.code = 'GOOGLE_GMAIL_API_ERROR';
    throw error;
  }
  return data;
}

function base64Lines(buffer) {
  return buffer.toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function attachmentFilename(value) {
  return String(value || 'document').replace(/[\r\n"\\]/g, '_').slice(0, 120);
}

function normalizedAttachments(value) {
  if (!Array.isArray(value)) return [];
  const attachments = value.map((attachment) => {
    const content = Buffer.isBuffer(attachment?.content) ? attachment.content : null;
    if (!content?.length) {
      const error = new Error('An email attachment is empty.');
      error.code = 'INVALID_EMAIL_MESSAGE';
      throw error;
    }
    return {
      filename: attachmentFilename(attachment.filename),
      contentType: String(attachment.contentType || 'application/octet-stream').replace(/[\r\n]/g, ''),
      content
    };
  });
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.content.length, 0);
  if (totalBytes > 20 * 1024 * 1024) {
    const error = new Error('Email attachments must be 20 MB or smaller.');
    error.code = 'INVALID_EMAIL_MESSAGE';
    throw error;
  }
  return attachments;
}

export async function sendGoogleEmail(message) {
  const config = requireGoogleConfig();
  const to = normalizeEmail(message.to);
  const subject = String(message.subject || '').trim();
  const text = String(message.text || '');
  if (!validEmail(to)) {
    const error = new Error('Enter a valid recipient email address.');
    error.status = 400;
    error.code = 'INVALID_EMAIL_MESSAGE';
    throw error;
  }
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
    const error = new Error('Subject is required, must be 200 characters or fewer, and cannot contain line breaks.');
    error.status = 400;
    error.code = 'INVALID_EMAIL_MESSAGE';
    throw error;
  }
  if (!text.trim() || text.length > 50000) {
    const error = new Error('Message is required and must be 50,000 characters or fewer.');
    error.status = 400;
    error.code = 'INVALID_EMAIL_MESSAGE';
    throw error;
  }

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const headers = [
    `From: ${config.mailbox}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0'
  ];
  const html = String(message.html || '').trim();
  const attachments = normalizedAttachments(message.attachments);
  let rawMessage;

  if (!attachments.length) {
    if (html) {
      const boundary = `----HopeHavenBoundary${randomBytes(12).toString('hex')}`;
      rawMessage = [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8')),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(html.replace(/\r?\n/g, '\r\n'), 'utf8')),
        `--${boundary}--`,
        ''
      ].join('\r\n');
    } else {
      rawMessage = [
        ...headers,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8')),
        ''
      ].join('\r\n');
    }
  } else {
    const mixedBoundary = `----HopeHavenMixed${randomBytes(12).toString('hex')}`;
    const alternativeBoundary = `----HopeHavenAlternative${randomBytes(12).toString('hex')}`;
    const parts = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`
    ];
    if (html) {
      parts.push(
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        '',
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8')),
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(html.replace(/\r?\n/g, '\r\n'), 'utf8')),
        `--${alternativeBoundary}--`
      );
    } else {
      parts.push(
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8'))
      );
    }
    for (const attachment of attachments) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(attachment.content)
      );
    }
    parts.push(`--${mixedBoundary}--`, '');
    rawMessage = parts.join('\r\n');
  }
  const result = await gmailRequest('/messages/send', await accessToken('gmail.send'), {
    method: 'POST',
    body: { raw: Buffer.from(rawMessage, 'utf8').toString('base64url') }
  });
  return {
    ok: true,
    status: 'Accepted by Email Provider',
    providerMessageId: result.id || null
  };
}

function headerValue(headers, name) {
  return headers?.find((header) => header.name?.toLowerCase() === name)?.value || '';
}

function decodePart(part) {
  if (part?.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const child of part?.parts || []) {
    const content = decodePart(child);
    if (content) return content;
  }
  return '';
}

export function parseGoogleMessage(message) {
  const payload = message.payload || {};
  const labels = Array.isArray(message.labelIds) ? message.labelIds : [];
  const date = Number(message.internalDate);
  const receivedAt = Number.isFinite(date) && date > 0
    ? new Date(date).toISOString().slice(0, 19).replace('T', ' ')
    : null;
  const body = decodePart(payload).slice(0, BODY_LIMIT);
  return {
    id: message.id,
    threadId: message.threadId || message.id,
    from: headerValue(payload.headers, 'from').slice(0, 500),
    to: headerValue(payload.headers, 'to').slice(0, 500),
    subject: headerValue(payload.headers, 'subject').slice(0, 998) || '(no subject)',
    snippet: String(message.snippet || '').slice(0, 1000),
    body,
    labels,
    unread: labels.includes('UNREAD'),
    receivedAt
  };
}

function senderAddress(value) {
  const match = /<([^>]+)>/.exec(String(value || ''));
  return normalizeEmail(match ? match[1] : value);
}

async function ingestRequisitionComments(messages) {
  let received = 0;
  const connection = await pool.getConnection();
  try {
    for (const message of messages) {
      const tag = findRequisitionReplyTag(message.subject, message.body);
      if (!tag) continue;

      const mailbox = normalizeEmail(env('GOOGLE_MAILBOX'));
      const isOwnMailbox = senderAddress(message.from) === mailbox;
      // Our original outgoing message can also land in the inbox during tests.
      // Only a Re: reply is treated as a recipient comment.
      if (isOwnMailbox && !/^re:/i.test(String(message.subject || '').trim())) continue;

      const comment = extractReplyComment(message.body);
      if (!comment) continue;

      await connection.beginTransaction();
      try {
        const [[thread]] = await connection.execute(
          `SELECT id, requisition_id AS requisitionId
             FROM requisition_email_threads
            WHERE token = ? AND requisition_id = ? LIMIT 1`,
          [tag.token, tag.requisitionId]
        );
        if (!thread) {
          await connection.rollback();
          continue;
        }
        const [[requisition]] = await connection.execute(
          'SELECT reference FROM requisitions WHERE id = ? LIMIT 1',
          [thread.requisitionId]
        );
        if (!requisition) {
          await connection.rollback();
          continue;
        }

        const [claim] = await connection.execute(
          `UPDATE requisition_email_threads
              SET response_submitted_at = UTC_TIMESTAMP()
            WHERE id = ? AND response_submitted_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM requisition_email_comments WHERE thread_id = ?
            )`,
          [thread.id, thread.id]
        );
        if (!claim.affectedRows) {
          await connection.rollback();
          continue;
        }

        await connection.execute(
          `INSERT INTO requisition_email_comments
             (requisition_id, thread_id, gmail_message_id, sender, recipient,
              subject, comment, body_text, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            thread.requisitionId, thread.id, message.id, message.from, message.to,
            message.subject, comment, message.body, message.receivedAt
          ]
        );
        await connection.execute(
          `INSERT INTO requisition_activity (requisition_id, user_id, action, details)
           VALUES (?, NULL, 'email_comment_received', ?)`,
          [thread.requisitionId, JSON.stringify({
            sender: message.from,
            subject: message.subject,
            comment,
            gmailMessageId: message.id
          })]
        );

        const [managers] = await connection.execute(
          "SELECT id FROM users WHERE active = TRUE AND role IN ('admin', 'procurement')"
        );
        const link = `#/admin/${encodeURIComponent('Requests Received from Departments')}?view=${thread.requisitionId}&request=${thread.requisitionId}`;
        for (const manager of managers) {
          await createNotification(
            connection,
            manager.id,
            'Email comment received',
            `${requisition.reference}: ${comment.slice(0, 120)}`,
            link,
            'email'
          );
        }

        await connection.commit();
        received += 1;
      } catch (error) {
        await connection.rollback();
        if (error.code !== 'ER_DUP_ENTRY') {
          log('ERROR', `Could not link email reply ${message.id} to a requisition: ${error.message}`);
        }
      }
    }
  } finally {
    connection.release();
  }
  return received;
}

export async function syncGoogleInbox() {
  const token = await accessToken();
  const listed = await gmailRequest(`/messages?q=in%3Ainbox&maxResults=${MESSAGE_LIMIT}`, token);
  const messages = listed.messages || [];
  const parsed = [];

  for (let index = 0; index < messages.length; index += 5) {
    const batch = await Promise.all(messages.slice(index, index + 5).map(async ({ id }) => {
      const message = await gmailRequest(`/messages/${encodeURIComponent(id)}?format=full`, token);
      return parseGoogleMessage(message);
    }));
    parsed.push(...batch);
  }

  for (const message of parsed) {
    await pool.execute(
      `INSERT INTO google_email_messages
         (gmail_message_id, thread_id, sender, recipient, subject, snippet, body_text, labels, unread, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         thread_id = VALUES(thread_id), sender = VALUES(sender), recipient = VALUES(recipient),
         subject = VALUES(subject), snippet = VALUES(snippet), body_text = VALUES(body_text),
         labels = VALUES(labels), unread = VALUES(unread), received_at = VALUES(received_at),
         synced_at = CURRENT_TIMESTAMP`,
      [
        message.id, message.threadId, message.from, message.to, message.subject,
        message.snippet, message.body, JSON.stringify(message.labels), message.unread,
        message.receivedAt
      ]
    );
  }

  const commentsReceived = await ingestRequisitionComments(parsed);

  await pool.execute(
    `DELETE FROM google_email_messages
     WHERE gmail_message_id NOT IN (
       SELECT gmail_message_id FROM (
         SELECT gmail_message_id FROM google_email_messages
         ORDER BY received_at DESC, gmail_message_id DESC LIMIT 100
       ) AS recent_messages
     )`
  );

  return { synced: parsed.length, commentsReceived };
}

export async function listInboxMessages() {
  const [rows] = await pool.execute(
    `SELECT g.gmail_message_id AS id, g.sender, g.recipient, g.subject, g.snippet,
       g.unread, g.received_at AS receivedAt,
       c.id AS commentId, c.requisition_id AS requisitionId,
       r.reference AS requisitionReference
     FROM google_email_messages g
     LEFT JOIN requisition_email_comments c ON c.gmail_message_id = g.gmail_message_id
     LEFT JOIN requisitions r ON r.id = c.requisition_id
     ORDER BY g.received_at DESC, g.gmail_message_id DESC
     LIMIT 100`
  );
  return rows;
}

export async function getInboxMessage(id) {
  const [[message]] = await pool.execute(
    `SELECT g.gmail_message_id AS id, g.thread_id AS threadId, g.sender, g.recipient,
       g.subject, g.snippet, g.body_text AS body, g.unread, g.received_at AS receivedAt,
       c.id AS commentId, c.requisition_id AS requisitionId,
       r.reference AS requisitionReference, c.comment
     FROM google_email_messages g
     LEFT JOIN requisition_email_comments c ON c.gmail_message_id = g.gmail_message_id
     LEFT JOIN requisitions r ON r.id = c.requisition_id
     WHERE g.gmail_message_id = ? LIMIT 1`,
    [id]
  );
  return message || null;
}

export async function disconnectGoogleMailbox() {
  const [[connection]] = await pool.execute(
    'SELECT refresh_token AS refreshToken, token_iv AS tokenIv, token_tag AS tokenTag FROM google_email_connection WHERE id = 1'
  );
  if (!connection) return false;
  const refreshToken = decryptRefreshToken(connection.refreshToken, connection.tokenIv, connection.tokenTag);
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken })
  });
  if (!response.ok) {
    const error = new Error('Google did not revoke the mailbox authorization. The connection was kept.');
    error.status = 502;
    throw error;
  }
  await pool.execute('DELETE FROM google_email_connection WHERE id = 1');
  await pool.execute('DELETE FROM google_email_messages');
  return true;
}

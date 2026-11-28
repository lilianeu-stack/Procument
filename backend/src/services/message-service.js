// Shared in-app messaging service.
//
// The reading rules are deliberately explicit: listing conversations and
// opening a thread never change read state. Only markMessageRead(), called
// after the reader actually opens a message, writes message_recipients.
// Every conversation is filtered through a role-aware participant policy, and
// all reads/sends are restricted to rows the caller is a party to.

import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { markNotificationsRead, messageNotificationCondition } from '../lib/notification-reads.js';
import { PORTALS, portalForRole } from '../utils/roles.js';
import { loadStockkeeperScope, scopeMatches } from './stockkeeper-scope.js';

const MESSAGE_ROLES = new Set(['admin', 'procurement', 'supervisor', 'requestor', 'storekeeper']);
const ADMIN_PORTAL_ROLES = new Set(['admin', 'procurement', 'approver', 'finance', 'committee']);
const CONTACT_ROLES = {
  admin: ['admin', 'procurement', 'supervisor', 'requestor', 'storekeeper'],
  procurement: ['admin', 'procurement', 'supervisor', 'requestor', 'storekeeper'],
  supervisor: ['requestor'],
  requestor: ['supervisor'],
  storekeeper: ['supervisor', 'requestor']
};
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function text(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function like(value) {
  return `%${String(value).replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function normalizeFilter(value) {
  const filter = String(value || 'all').toLowerCase();
  return ['all', 'unread', 'read', 'sent'].includes(filter) ? filter : 'all';
}

function bool(value) {
  return Boolean(value);
}

function conversationKey(kind, id) {
  return `${kind === 'announcement' ? 'a' : 'p'}-${id}`;
}

const MANAGER_ROLES = new Set(['admin', 'procurement']);

// A pair is legal if either side is allowed to initiate it and the data scope
// of both roles agrees. This is symmetric: once a privileged user has started
// a conversation, the other party must be able to reply to it.
function pairAllowed(user, row, scope) {
  const viewerRole = user.role;
  const otherRole = row.role;
  const departmentId = parseId(row.departmentId);
  const parentId = parseId(row.parentId);
  if (MANAGER_ROLES.has(viewerRole) && MANAGER_ROLES.has(otherRole)) return true;
  if (MANAGER_ROLES.has(viewerRole)) {
    return ['supervisor', 'requestor', 'storekeeper'].includes(otherRole);
  }
  if (MANAGER_ROLES.has(otherRole)) {
    return ['supervisor', 'requestor', 'storekeeper'].includes(viewerRole);
  }
  if (['supervisor', 'requestor'].includes(viewerRole)
      && ['supervisor', 'requestor'].includes(otherRole)) {
    const viewerDepartmentId = parseId(user.departmentId);
    return viewerDepartmentId !== null && departmentId === viewerDepartmentId;
  }
  if (viewerRole === 'storekeeper' && ['supervisor', 'requestor'].includes(otherRole)) {
    return Boolean(scope) && scopeMatches(scope, departmentId, parentId);
  }
  if (otherRole === 'storekeeper' && ['supervisor', 'requestor'].includes(viewerRole)) {
    const viewerDepartmentId = parseId(user.departmentId);
    return Boolean(scope) && scopeMatches({
      userId: Number(row.id), departmentId: parseId(row.departmentId), parentId
    }, viewerDepartmentId, parseId(user.parentId));
  }
  return false;
}

const USER_COLUMNS = `u.id, u.name, u.email, u.profile_photo AS photo, u.role,
  u.department_id AS departmentId, d.name AS departmentName, d.parent_id AS parentId`;

async function participantRows(connection, user) {
  if (!MESSAGE_ROLES.has(user.role)) return [];
  const scope = user.role === 'storekeeper' ? await loadStockkeeperScope(connection, user.id) : null;
  const byId = new Map();

  // Contacts the current role is allowed to start a conversation with.
  const roles = CONTACT_ROLES[user.role] || [];
  if (roles.length) {
    const placeholders = roles.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT ${USER_COLUMNS}
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.active = TRUE AND u.id <> ? AND u.role IN (${placeholders})`,
      [user.id, ...roles]
    );
    for (const row of rows) {
      if (pairAllowed(user, row, scope)) byId.set(Number(row.id), row);
    }
  }

  // Also keep counterparties of existing private conversations. They may no
  // longer be starting contacts (for example after a role change), but both
  // parties must still be able to read their own history.
  const [existing] = await connection.execute(
    `SELECT other.id, other.name, other.email, other.profile_photo AS photo, other.role,
       other.department_id AS departmentId, d.name AS departmentName, d.parent_id AS parentId
       FROM messages m
       JOIN users other ON other.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END
       LEFT JOIN departments d ON d.id = other.department_id
      WHERE m.is_announcement = FALSE AND (m.sender_id = ? OR m.recipient_id = ?)
        AND other.active = TRUE AND other.id <> ?
      GROUP BY other.id`,
    [user.id, user.id, user.id, user.id]
  );
  for (const row of existing) {
    if (pairAllowed(user, row, scope)) byId.set(Number(row.id), row);
  }
  return [...byId.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export async function findParticipant(user, otherId, connection = pool) {
  const id = parseId(otherId);
  if (!id) throw httpError(400, 'Invalid conversation participant.');
  const participants = await participantRows(connection, user);
  const participant = participants.find((row) => Number(row.id) === id);
  if (!participant) throw httpError(403, 'You cannot access this conversation.');
  return participant;
}

function departmentFor(user, participant) {
  return parseId(user.departmentId) || parseId(participant?.departmentId) || null;
}

async function privateSummaries(connection, user, search) {
  // Placeholder order follows the SQL text: SELECT subqueries first, then
  // JOIN/ON and WHERE. Search is a computed flag, not a WHERE filter, so a
  // matching older message keeps its full conversation counts and preview.
  const params = [
    user.id, user.id, user.id,
    user.id, user.id,
    user.id, user.id,
    user.id, user.id,
    user.id, user.id,
    user.id, user.id, user.id, search ? like(search) : '',
    user.id, user.id,
    user.id, user.id
  ];
  const [rows] = await connection.execute(
    `SELECT
       MAX(CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END) AS participantId,
       COUNT(*) AS messageCount,
       COALESCE(SUM(CASE WHEN m.sender_id = ? THEN 1 ELSE 0 END), 0) AS sentCount,
       COALESCE(SUM(CASE WHEN m.sender_id <> ? AND COALESCE(viewerReceipt.is_read, FALSE) = FALSE THEN 1 ELSE 0 END), 0) AS unreadCount,
       MAX(m.created_at) AS lastAt,
       (SELECT m2.body FROM messages m2
         WHERE m2.is_announcement = FALSE
           AND ((m2.sender_id = ? AND m2.recipient_id = other.id)
             OR (m2.sender_id = other.id AND m2.recipient_id = ?))
         ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS lastBody,
       (SELECT m2.requisition_id FROM messages m2
         WHERE m2.is_announcement = FALSE
           AND ((m2.sender_id = ? AND m2.recipient_id = other.id)
             OR (m2.sender_id = other.id AND m2.recipient_id = ?))
         ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS lastRequisitionId,
       (SELECT rr.reference FROM messages m2
         LEFT JOIN requisitions rr ON rr.id = m2.requisition_id
         WHERE m2.is_announcement = FALSE
           AND ((m2.sender_id = ? AND m2.recipient_id = other.id)
             OR (m2.sender_id = other.id AND m2.recipient_id = ?))
         ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS lastRequisitionReference,
       (SELECT COUNT(*) FROM message_attachments ma
         JOIN messages m3 ON m3.id = ma.message_id
         WHERE m3.is_announcement = FALSE
           AND ((m3.sender_id = ? AND m3.recipient_id = other.id)
             OR (m3.sender_id = other.id AND m3.recipient_id = ?))) AS attachmentCount,
       EXISTS (
         SELECT 1 FROM messages ms
          WHERE ms.is_announcement = FALSE
            AND ((ms.sender_id = ? AND ms.recipient_id = other.id)
              OR (ms.sender_id = other.id AND ms.recipient_id = ?))
            AND (? = '' OR ms.body LIKE ? ESCAPE '\\\\')
       ) AS hasSearchMatch
       FROM messages m
       JOIN users other ON other.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END
       LEFT JOIN message_recipients viewerReceipt
         ON viewerReceipt.message_id = m.id AND viewerReceipt.user_id = ?
       WHERE m.is_announcement = FALSE AND (m.sender_id = ? OR m.recipient_id = ?)
         
       GROUP BY other.id, other.name`,
    params
  );
  return new Map(rows.map((row) => [Number(row.participantId), row]));
}

async function announcementRows(connection, user, search) {
  const [rows] = await connection.execute(
    `SELECT m.id, m.body, m.created_at AS createdAt, m.sender_id AS senderId,
       sender.name AS senderName, sender.profile_photo AS senderPhoto,
       sender.role AS senderRole, d.name AS departmentName,
       CASE WHEN m.sender_id = ? THEN TRUE ELSE COALESCE(viewerReceipt.is_read, FALSE) END AS isRead,
       (SELECT COUNT(*) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachmentCount
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN message_recipients viewerReceipt
         ON viewerReceipt.message_id = m.id AND viewerReceipt.user_id = ?
       WHERE m.is_announcement = TRUE
         AND (m.sender_id = ? OR viewerReceipt.user_id IS NOT NULL)
         AND (? = '' OR m.body LIKE ? ESCAPE '\\\\' OR sender.name LIKE ? ESCAPE '\\\\')
       ORDER BY m.created_at DESC, m.id DESC`,
    [user.id, user.id, user.id, search || '', search ? like(search) : '', search ? like(search) : '']
  );
  return rows;
}

function privateConversation(row, participant) {
  const messageCount = Number(row.messageCount) || 0;
  const sentCount = Number(row.sentCount) || 0;
  const receivedCount = messageCount - sentCount;
  const unreadCount = Number(row.unreadCount) || 0;
  return {
    key: conversationKey('private', participant.id),
    kind: 'private',
    id: Number(participant.id),
    participantId: Number(participant.id),
    name: participant.name,
    email: participant.email,
    photo: participant.photo,
    role: participant.role,
    department: participant.departmentName || '',
    unreadCount,
    messageCount,
    receivedCount,
    sentCount,
    lastBody: row.lastBody || '',
    lastAt: row.lastAt || null,
    lastRequisitionId: row.lastRequisitionId ? Number(row.lastRequisitionId) : null,
    lastRequisitionReference: row.lastRequisitionReference || '',
    attachmentCount: Number(row.attachmentCount) || 0,
    isRead: unreadCount === 0
  };
}

function announcementConversation(row, user) {
  const mine = Number(row.senderId) === Number(user.id);
  const isRead = bool(row.isRead);
  const received = mine ? 0 : 1;
  return {
    key: conversationKey('announcement', row.id),
    kind: 'announcement',
    id: Number(row.id),
    announcementId: Number(row.id),
    participantId: Number(row.senderId),
    name: row.senderName || 'Department announcement',
    email: '',
    photo: row.senderPhoto,
    role: row.senderRole,
    department: row.departmentName || '',
    unreadCount: received && !isRead ? 1 : 0,
    messageCount: 1,
    receivedCount: received,
    sentCount: mine ? 1 : 0,
    lastBody: row.body || '',
    lastAt: row.createdAt || null,
    lastRequisitionId: null,
    lastRequisitionReference: '',
    attachmentCount: Number(row.attachmentCount) || 0,
    isRead
  };
}

export async function listConversations(user, options = {}) {
  const filter = normalizeFilter(options.filter);
  const search = text(options.search, 120);
  const page = positiveInt(options.page, 1);
  const pageSize = Math.min(positiveInt(options.pageSize, 20), 50);
  const participants = await participantRows(pool, user);
  const summaries = await privateSummaries(pool, user, search);
  const privateConversations = [];
  for (const participant of participants) {
    const summary = summaries.get(Number(participant.id));
    const conversation = privateConversation(summary || {
      messageCount: 0, sentCount: 0, unreadCount: 0, attachmentCount: 0
    }, participant);
    // The SQL flag checks every message body in the thread, not only the
    // latest preview. Names and emails are matched here so searching also
    // finds conversations before the first message is sent.
    const matchesSearch = !search
      || Boolean(summary?.hasSearchMatch)
      || [conversation.name, conversation.email]
        .some((value) => String(value || '').toLowerCase().includes(search.toLowerCase()));
    if (matchesSearch) privateConversations.push(conversation);
  }
  const announcements = (await announcementRows(pool, user, search))
    .map((row) => announcementConversation(row, user));
  const all = [...privateConversations, ...announcements];
  const counts = {
    all: all.length,
    unread: all.filter((row) => row.unreadCount > 0).length,
    read: all.filter((row) => row.receivedCount > 0 && row.unreadCount === 0).length,
    sent: all.filter((row) => row.sentCount > 0).length
  };
  const filtered = all.filter((row) => {
    if (filter === 'unread') return row.unreadCount > 0;
    if (filter === 'read') return row.receivedCount > 0 && row.unreadCount === 0;
    if (filter === 'sent') return row.sentCount > 0;
    return true;
  });
  filtered.sort((left, right) => {
    const leftAt = left.lastAt ? new Date(left.lastAt).getTime() : 0;
    const rightAt = right.lastAt ? new Date(right.lastAt).getTime() : 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return String(left.name).localeCompare(String(right.name));
  });
  const start = (page - 1) * pageSize;
  return {
    conversations: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    counts,
    filter,
    search,
    canSendAnnouncement: user.role === 'supervisor'
  };
}

async function attachmentsForMessages(connection, messageIds) {
  if (!messageIds.length) return new Map();
  const placeholders = messageIds.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT id, message_id AS messageId, file_name AS fileName,
       mime_type AS mimeType, file_size AS fileSize
       FROM message_attachments WHERE message_id IN (${placeholders})
      ORDER BY message_id, id`,
    messageIds
  );
  const map = new Map();
  for (const row of rows) {
    const key = Number(row.messageId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      id: Number(row.id),
      name: row.fileName,
      mimeType: row.mimeType,
      size: Number(row.fileSize) || 0
    });
  }
  return map;
}

async function selectMessages(connection, where, params, viewerId, page, pageSize) {
  const limit = Math.min(positiveInt(pageSize, 50), 100);
  const offset = (positiveInt(page, 1) - 1) * limit;
  const [rows] = await connection.execute(
    `SELECT m.id, m.body, m.created_at AS createdAt, m.sender_id AS senderId,
       sender.name AS senderName, sender.profile_photo AS senderPhoto, sender.role AS senderRole,
       m.recipient_id AS recipientId, recipient.name AS recipientName,
       recipient.profile_photo AS recipientPhoto,
       m.requisition_id AS requisitionId, rr.reference AS requisitionReference,
       m.is_announcement AS isAnnouncement,
       CASE WHEN m.sender_id = ? THEN TRUE ELSE COALESCE(viewerReceipt.is_read, FALSE) END AS isRead,
       COALESCE(recipientReceipt.is_read, FALSE) AS recipientIsRead,
       (SELECT COUNT(*) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachmentCount
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       LEFT JOIN users recipient ON recipient.id = m.recipient_id
       LEFT JOIN requisitions rr ON rr.id = m.requisition_id
       LEFT JOIN message_recipients viewerReceipt
         ON viewerReceipt.message_id = m.id AND viewerReceipt.user_id = ?
       LEFT JOIN message_recipients recipientReceipt
         ON recipientReceipt.message_id = m.id AND recipientReceipt.user_id = m.recipient_id
       WHERE ${where}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
    [viewerId, viewerId, ...params, limit, offset]
  );
  const [countRows] = await connection.execute(
    `SELECT COUNT(*) AS total FROM messages m WHERE ${where}`,
    params
  );
  const attachmentMap = await attachmentsForMessages(connection, rows.map((row) => Number(row.id)));
  return {
    total: Number(countRows[0]?.total) || 0,
    page: positiveInt(page, 1),
    pageSize: limit,
    messages: rows.map((row) => {
      const mine = Number(row.senderId) === Number(viewerId);
      return {
        id: Number(row.id),
        body: row.body,
        createdAt: row.createdAt,
        senderId: Number(row.senderId),
        senderName: row.senderName,
        senderPhoto: row.senderPhoto,
        senderRole: row.senderRole,
        recipientId: row.recipientId ? Number(row.recipientId) : null,
        recipientName: row.recipientName,
        recipientPhoto: row.recipientPhoto,
        requisitionId: row.requisitionId ? Number(row.requisitionId) : null,
        requisitionReference: row.requisitionReference || '',
        isAnnouncement: bool(row.isAnnouncement),
        isRead: mine || bool(row.isRead),
        deliveryStatus: mine && !row.isAnnouncement
          ? (bool(row.recipientIsRead) ? 'Read' : 'Delivered') : null,
        attachmentCount: Number(row.attachmentCount) || 0,
        attachments: attachmentMap.get(Number(row.id)) || []
      };
    })
  };
}

async function findAnnouncement(connection, user, announcementId) {
  const id = parseId(announcementId);
  if (!id) throw httpError(400, 'Invalid announcement identifier.');
  const [rows] = await connection.execute(
    `SELECT m.id, m.department_id AS departmentId, m.sender_id AS senderId,
       sender.name AS senderName, sender.profile_photo AS senderPhoto,
       d.name AS departmentName
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN message_recipients mr ON mr.message_id = m.id AND mr.user_id = ?
       WHERE m.id = ? AND m.is_announcement = TRUE
         AND (m.sender_id = ? OR mr.user_id IS NOT NULL)
       LIMIT 1`,
    [user.id, id, user.id]
  );
  if (!rows[0]) throw httpError(403, 'You cannot access this announcement.');
  return rows[0];
}

export async function getThread(user, options = {}) {
  const page = positiveInt(options.page, 1);
  const pageSize = positiveInt(options.pageSize, 50);
  const announcementId = parseId(options.announcementId);
  if (announcementId) {
    const announcement = await findAnnouncement(pool, user, announcementId);
    const result = await selectMessages(pool, 'm.id = ? AND m.is_announcement = TRUE', [announcementId], user.id, page, pageSize);
    return {
      kind: 'announcement',
      participant: null,
      announcement: {
        id: Number(announcement.id),
        senderId: Number(announcement.senderId),
        name: announcement.senderName,
        photo: announcement.senderPhoto,
        department: announcement.departmentName || ''
      },
      canReply: false,
      ...result
    };
  }
  const participant = await findParticipant(user, options.participantId);
  const where = `m.is_announcement = FALSE
    AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`;
  const result = await selectMessages(pool, where,
    [user.id, participant.id, participant.id, user.id], user.id, page, pageSize);
  return { kind: 'private', participant, announcement: null, canReply: true, ...result };
}

function parseAttachments(value) {
  if (!value) return [];
  let attachments = value;
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); }
    catch { throw httpError(400, 'Attachments are not valid JSON.'); }
  }
  if (!Array.isArray(attachments)) throw httpError(400, 'Attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) {
    throw httpError(400, `A maximum of ${MAX_ATTACHMENTS} attachments is supported.`);
  }
  return attachments.map((attachment) => {
    const fileName = text(attachment.fileName || attachment.name, 255);
    const mimeType = text(attachment.mimeType || attachment.type, 150) || 'application/octet-stream';
    const data = String(attachment.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!fileName || !data) throw httpError(400, 'An attachment is missing its file name or contents.');
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw httpError(400, `Unsupported attachment type: ${mimeType}. Upload PDF, document, spreadsheet, CSV, text, or image files.`);
    }
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
      throw httpError(400, 'Each attachment must be smaller than 5 MB.');
    }
    return { fileName, mimeType, buffer };
  });
}

async function saveAttachments(connection, messageId, attachments) {
  for (const attachment of attachments) {
    await connection.execute(
      `INSERT INTO message_attachments (message_id, file_name, mime_type, file_size, file_data)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, attachment.fileName, attachment.mimeType, attachment.buffer.length, attachment.buffer]
    );
  }
}

function messageLink(user, messageId, requisitionId) {
  if (user.role === 'supervisor') {
    return `#/requester/Messages?userId=${user.id}&request=${requisitionId || ''}&message=${messageId}`;
  }
  if (user.role === 'requestor') {
    return `#/supervisor/Department%20Messages?userId=${user.id}&request=${requisitionId || ''}&message=${messageId}`;
  }
  if (user.role === 'storekeeper') {
    return `#/stockkeeper/Messages?userId=${user.id}&message=${messageId}`;
  }
  return `#/admin/Messages?userId=${user.id}&message=${messageId}`;
}

export async function createMessage(user, payload, connection = pool) {
  if (!MESSAGE_ROLES.has(user.role)) throw httpError(403, 'Messaging is not available to your role.');
  const body = text(payload.body, 5000);
  const attachments = parseAttachments(payload.attachments);
  if (!body && !attachments.length) throw httpError(400, 'Write a message or attach a document.');
  const announcement = payload.announcement === true || payload.announcement === 'true';
  if (announcement && user.role !== 'supervisor') {
    throw httpError(403, 'Only Supervisors can send Department announcements.');
  }

  const participant = announcement ? null : await findParticipant(user, payload.recipientId, connection);
  const departmentId = departmentFor(user, participant);
  if (announcement && !departmentId) {
    throw httpError(403, 'Your account is not assigned to a Department.');
  }

  let requisitionId = null;
  if (payload.requisitionId) {
    requisitionId = parseId(payload.requisitionId);
    if (!requisitionId) throw httpError(400, 'Invalid request reference.');
    if (!['supervisor', 'requestor'].includes(user.role)) {
      throw httpError(403, 'You cannot link a message to this procurement request.');
    }
    const where = user.role === 'requestor' ? 'id = ? AND requester_id = ?' : 'id = ? AND department_id = ?';
    const [requests] = await connection.execute(
      `SELECT id FROM requisitions WHERE ${where} LIMIT 1`,
      [requisitionId, user.role === 'requestor' ? user.id : departmentId]
    );
    if (!requests.length) throw httpError(403, 'The message must relate to one of your authorized requests.');
  }

  const [result] = await connection.execute(
    `INSERT INTO messages (department_id, requisition_id, sender_id, recipient_id, body, is_announcement)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [departmentId, requisitionId, user.id, participant?.id || null, body, announcement ? 1 : 0]
  );
  const messageId = Number(result.insertId);
  let recipients = [];
  if (announcement) {
    const [rows] = await connection.execute(
      `SELECT id FROM users WHERE department_id = ? AND role = 'requestor' AND active = TRUE`,
      [departmentId]
    );
    recipients = rows.map((row) => Number(row.id)).filter((id) => id !== Number(user.id));
  } else {
    recipients = [Number(participant.id)];
  }
  for (const recipientId of recipients) {
    await connection.execute('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [messageId, recipientId]);
  }
  await saveAttachments(connection, messageId, attachments);
  await writeAudit(connection, user.id, announcement ? 'department_announcement' : 'message_sent',
    'message', messageId, { departmentId, recipientCount: recipients.length, requisitionId });
  const link = announcement
    ? `#/requester/Messages?message=${messageId}`
    : messageLink(user, messageId, requisitionId);
  for (const recipientId of recipients) {
    await createNotification(connection, recipientId, announcement ? 'Department announcement' : 'New message',
      `${user.name}: ${body || 'A document was attached.'}`, link, 'message');
  }
  return {
    id: messageId,
    message: announcement ? 'Announcement sent to your Department.' : 'Message sent.'
  };
}

export async function markMessageRead(connection, user, messageId) {
  const id = parseId(messageId);
  if (!id) throw httpError(400, 'Invalid message identifier.');
  const [rows] = await connection.execute(
    'SELECT user_id FROM message_recipients WHERE message_id = ? AND user_id = ?',
    [id, user.id]
  );
  if (!rows.length) throw httpError(404, 'Message not found.');
  await connection.execute(
    `UPDATE message_recipients SET is_read = TRUE, read_at = NOW()
      WHERE message_id = ? AND user_id = ?`,
    [id, user.id]
  );
  const notice = messageNotificationCondition(id);
  await markNotificationsRead(connection, user.id, notice.condition, notice.params);
  return { message: 'Message marked as read.' };
}

export async function countUnreadMessages(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS total
       FROM message_recipients mr
       JOIN messages m ON m.id = mr.message_id
      WHERE mr.user_id = ? AND mr.is_read = FALSE AND m.sender_id <> ?`,
    [userId, userId]
  );
  return Number(rows[0]?.total) || 0;
}

export async function findAttachment(user, attachmentId) {
  const id = parseId(attachmentId);
  if (!id) throw httpError(400, 'Invalid attachment identifier.');
  const [rows] = await pool.execute(
    `SELECT ma.file_name AS fileName, ma.mime_type AS mimeType, ma.file_size AS fileSize,
       ma.file_data AS fileData, m.sender_id AS senderId, m.id AS messageId
       FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
      WHERE ma.id = ? LIMIT 1`,
    [id]
  );
  const attachment = rows[0];
  if (!attachment) return null;
  const [readers] = await pool.execute(
    'SELECT user_id FROM message_recipients WHERE message_id = ?',
    [attachment.messageId]
  );
  const allowed = Number(attachment.senderId) === Number(user.id)
    || readers.some((reader) => Number(reader.user_id) === Number(user.id));
  if (!allowed) throw httpError(403, 'You do not have access to this attachment.');
  return attachment;
}

export function pageNameForRole(role) {
  if (role === 'supervisor') return 'Department Messages';
  if (role === 'requestor') return 'Messages';
  return portalForRole(role) === PORTALS.STOCKKEEPER ? 'Messages' : 'Messages';
}

export { ADMIN_PORTAL_ROLES };

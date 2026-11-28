// Shared notification persistence and read-state helpers. The notifications
// table already backs every in-app notice; these helpers add the structured
// fields needed by the system-wide notification center without changing the
// established category/link conventions used by existing workflows.

import {
  READ_NOTIFICATION_SQL,
  UNREAD_NOTIFICATION_SQL,
  VALID_NOTIFICATION_SQL
} from '../lib/notification-reads.js';

export const NOTIFICATION_TYPES = ['error', 'warning', 'success', 'information'];

const WARNING_CATEGORIES = new Set([
  'warning', 'low_stock', 'zero_stock', 'stock_shortage', 'overdue', 'deadline'
]);
const ERROR_CATEGORIES = new Set(['error', 'failure', 'failed']);
const SUCCESS_CATEGORIES = new Set(['success', 'saved', 'completed']);

const LIMITS = {
  title: 180,
  body: 500,
  category: 40,
  module: 120,
  relatedRecordId: 80,
  actionUrl: 500,
  recommendedAction: 200,
  dedupeKey: 191,
  requestId: 64
};

function text(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

export function normalizeNotificationType(value, fallback = 'information') {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'info') return 'information';
  return NOTIFICATION_TYPES.includes(type) ? type : fallback;
}

// Existing rows predate the `notification_type` column. Legacy category values
// still need to render with a sensible severity in the centralized UI.
export function typeForCategory(category) {
  const value = String(category || '').toLowerCase();
  if (ERROR_CATEGORIES.has(value)) return 'error';
  if (WARNING_CATEGORIES.has(value)) return 'warning';
  if (SUCCESS_CATEGORIES.has(value)) return 'success';
  return 'information';
}

export function notificationType(row) {
  return normalizeNotificationType(
    row?.type || row?.notificationType || row?.notification_type,
    normalizeNotificationType(row?.category, typeForCategory(row?.category))
  );
}

// Only internal application routes can become notification actions. A stored
// URL is never used for a redirect, but rejecting external schemes prevents a
// copied value from becoming an unsafe link in a future client.
export function safeActionUrl(value) {
  const url = text(value, LIMITS.actionUrl);
  if (!url || /[\\\r\n\t]/.test(url)) return null;
  if (/^(javascript:|data:|vbscript:|https?:)/i.test(url)) return null;
  if (url.startsWith('//')) return null;
  if (url.startsWith('#/')) return url;
  if (url.startsWith('/')) return url;
  return null;
}

export function prepareNotification(input = {}) {
  const title = text(input.title, LIMITS.title);
  const body = text(input.body ?? input.message, LIMITS.body);
  if (!title || !body) {
    const error = new Error('A notification title and message are required.');
    error.status = 400;
    throw error;
  }
  const category = text(input.category, LIMITS.category) || 'general';
  return {
    userId: Number.isInteger(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null,
    title,
    body,
    link: safeActionUrl(input.link),
    category,
    type: normalizeNotificationType(input.type, typeForCategory(category)),
    module: text(input.module, LIMITS.module) || null,
    relatedRecordId: text(input.relatedRecordId, LIMITS.relatedRecordId) || null,
    actionUrl: safeActionUrl(input.actionUrl || input.link),
    recommendedAction: text(input.recommendedAction, LIMITS.recommendedAction) || null,
    dedupeKey: text(input.dedupeKey, LIMITS.dedupeKey) || null,
    requestId: text(input.requestId, LIMITS.requestId) || null
  };
}

const NOTIFICATION_COLUMNS = `
  n.id, n.title, n.body, n.link, n.category,
  n.notification_type AS type, n.module, n.related_record_id AS relatedRecordId,
  n.action_url AS actionUrl, n.recommended_action AS recommendedAction,
  n.request_id AS requestId, n.created_at AS createdAt,
  CASE WHEN n.is_read = TRUE OR nr.notification_id IS NOT NULL THEN TRUE ELSE FALSE END AS isRead,
  CASE WHEN n.is_read = TRUE OR nr.notification_id IS NOT NULL
    THEN COALESCE(nr.read_at, n.read_at, n.updated_at) ELSE NULL END AS readAt
`;

const NOTIFICATION_JOIN = `
  FROM notifications n
  LEFT JOIN notification_read_receipts nr
    ON nr.notification_id = n.id AND nr.user_id = ?
`;

export function normalizeNotificationRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body),
    link: row.link || null,
    category: String(row.category || 'general'),
    type: notificationType(row),
    module: row.module || null,
    relatedRecordId: row.relatedRecordId || null,
    actionUrl: row.actionUrl || row.link || null,
    recommendedAction: row.recommendedAction || null,
    requestId: row.requestId || null,
    isRead: Boolean(row.isRead),
    readAt: row.isRead ? row.readAt || null : null,
    createdAt: row.createdAt
  };
}

export async function getNotification(connection, id, userId) {
  const [rows] = await connection.execute(
    `SELECT ${NOTIFICATION_COLUMNS}
      ${NOTIFICATION_JOIN}
      WHERE n.id = ? AND (n.user_id = ? OR n.user_id IS NULL)`,
    [userId, id, userId]
  );
  return normalizeNotificationRow(rows[0]);
}

export async function createNotificationRecord(connection, input) {
  const notice = prepareNotification({ ...input, userId: input.userId ?? input.user_id });
  const columns = `
    user_id, title, body, link, category, notification_type, module,
    related_record_id, action_url, recommended_action, dedupe_key, request_id
  `;
  const values = [
    notice.userId, notice.title, notice.body, notice.link, notice.category,
    notice.type, notice.module, notice.relatedRecordId, notice.actionUrl,
    notice.recommendedAction, notice.dedupeKey, notice.requestId
  ];
  const [result] = await connection.execute(
    `INSERT ${notice.dedupeKey ? 'IGNORE ' : ''}INTO notifications (${columns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  );
  const id = Number(result.insertId);
  if (id) return getNotification(connection, id, notice.userId);
  if (!notice.dedupeKey) return null;
  const [existing] = await connection.execute(
    `SELECT n.id FROM notifications n
      WHERE n.user_id = ? AND n.dedupe_key = ? ORDER BY n.id DESC LIMIT 1`,
    [notice.userId, notice.dedupeKey]
  );
  // Return the original row so callers that only need a notification still
  // work, but flag the collision so API routes can report a deduplicated
  // write instead of claiming another record was created.
  if (!existing.length) return null;
  const duplicate = await getNotification(connection, existing[0].id, notice.userId);
  return duplicate ? { ...duplicate, duplicate: true } : null;
}

const FILTERS = new Set(['all', 'unread', 'read', ...NOTIFICATION_TYPES]);

export function normalizeNotificationFilter(value) {
  const filter = String(value || 'all').trim().toLowerCase();
  if (filter === 'info') return 'information';
  if (filter === 'errors') return 'error';
  if (filter === 'warnings') return 'warning';
  if (filter === 'successes') return 'success';
  return FILTERS.has(filter) ? filter : 'all';
}

function filterCondition(filter, params) {
  if (filter === 'unread') {
    params.push(params[0]);
    return UNREAD_NOTIFICATION_SQL;
  }
  if (filter === 'read') {
    params.push(params[0]);
    return READ_NOTIFICATION_SQL;
  }
  if (filter !== 'all') {
    params.push(filter);
    return 'n.notification_type = ?';
  }
  return '1 = 1';
}

export async function listNotifications(connection, userId, options = {}) {
  const filter = normalizeNotificationFilter(options.filter);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const params = [userId]; // read-state receipt lookup in the SELECT list
  params.push(userId); // recipient scope in the WHERE clause
  const condition = filterCondition(filter, params);
  params.push(limit, offset);
  const [rows] = await connection.execute(
    `SELECT ${NOTIFICATION_COLUMNS}
      ${NOTIFICATION_JOIN}
      WHERE (n.user_id = ? OR n.user_id IS NULL)
        AND ${VALID_NOTIFICATION_SQL}
        AND (${condition})
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows.map(normalizeNotificationRow);
}

export async function countNotifications(connection, userId) {
  const [[row]] = await connection.execute(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN ${UNREAD_NOTIFICATION_SQL} THEN 1 ELSE 0 END), 0) AS unread,
       COALESCE(SUM(CASE WHEN n.notification_type = 'error' THEN 1 ELSE 0 END), 0) AS error,
       COALESCE(SUM(CASE WHEN n.notification_type = 'warning' THEN 1 ELSE 0 END), 0) AS warning,
       COALESCE(SUM(CASE WHEN n.notification_type = 'success' THEN 1 ELSE 0 END), 0) AS success,
       COALESCE(SUM(CASE WHEN n.notification_type = 'information' THEN 1 ELSE 0 END), 0) AS information
      ${NOTIFICATION_JOIN}
      WHERE (n.user_id = ? OR n.user_id IS NULL) AND ${VALID_NOTIFICATION_SQL}`,
    [userId, userId, userId]
  );
  return {
    total: Number(row?.total) || 0,
    unread: Number(row?.unread) || 0,
    error: Number(row?.error) || 0,
    warning: Number(row?.warning) || 0,
    success: Number(row?.success) || 0,
    information: Number(row?.information) || 0
  };
}

export async function dismissNotification(connection, userId, id) {
  const [rows] = await connection.execute(
    'SELECT user_id AS userId FROM notifications WHERE id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1',
    [id, userId]
  );
  const notification = rows[0];
  if (!notification) return null;
  if (notification.userId === userId) {
    await connection.execute('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
    return { id, dismissed: true };
  }
  // A shared row cannot be deleted for everyone. Dismissing it records this
  // reader's receipt so the notice stays available to other recipients.
  await connection.execute(
    'INSERT IGNORE INTO notification_read_receipts (notification_id, user_id) VALUES (?, ?)',
    [id, userId]
  );
  return { id, dismissed: false, read: true };
}

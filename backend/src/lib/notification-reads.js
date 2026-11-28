// Notification read state has two layers:
//   1. notifications.is_read for rows addressed to a single user (legacy compatible)
//   2. notification_read_receipts for every recipient, including broadcast rows
// A broadcast row must never be cleared globally when one user opens a module.

export const UNREAD_NOTIFICATION_SQL = `n.is_read = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM notification_read_receipts nr
     WHERE nr.notification_id = n.id AND nr.user_id = ?
  )`;

export const READ_NOTIFICATION_SQL = `(
  n.is_read = TRUE
  OR EXISTS (
    SELECT 1 FROM notification_read_receipts nr
     WHERE nr.notification_id = n.id AND nr.user_id = ?
  )
)`;

// A routed notification must still have a backing store request. Historical
// QA cleanup could otherwise leave a Stock Keeper badge pointing at a deleted
// record, which is indistinguishable from a real unread route in the UI.
export const VALID_NOTIFICATION_SQL = `(
  n.category <> 'stock_routing'
  OR n.link IS NULL
  OR n.link NOT LIKE '%request=%'
  OR EXISTS (
    SELECT 1 FROM store_requests sr
     WHERE CAST(sr.id AS CHAR) = SUBSTRING_INDEX(SUBSTRING_INDEX(n.link, 'request=', -1), '&', 1)
  )
)`;

function placeholders(values) {
  return values.map(() => '?').join(',');
}

export async function markNotificationsRead(connection, userId, condition = '1 = 1', params = []) {
  const [rows] = await connection.execute(
    `SELECT n.id FROM notifications n
      WHERE ${UNREAD_NOTIFICATION_SQL}
        AND ${VALID_NOTIFICATION_SQL}
        AND (n.user_id = ? OR n.user_id IS NULL)
        AND (${condition})`,
    [userId, userId, ...params]
  );
  const ids = rows.map((row) => Number(row.id));
  if (!ids.length) return [];
  const marks = placeholders(ids);
  await connection.execute(
    `INSERT IGNORE INTO notification_read_receipts (notification_id, user_id)
      SELECT id, ? FROM notifications WHERE id IN (${marks})`,
    [userId, ...ids]
  );
  // User-addressed rows keep the long-standing boolean contract for lists and
  // older clients. Broadcast rows deliberately keep is_read = FALSE.
  await connection.execute(
    `UPDATE notifications SET is_read = TRUE
      WHERE user_id = ? AND is_read = FALSE AND id IN (${marks})`,
    [userId, ...ids]
  );
  return ids;
}

export async function markNotificationRead(connection, userId, notificationId) {
  return markNotificationsRead(connection, userId, 'n.id = ?', [notificationId]);
}

// Shared Google mailbox messages have no owner column, so read state is also
// stored per authorized user.
export const UNREAD_EMAIL_SQL = `e.unread = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM email_message_read_receipts er
     WHERE er.gmail_message_id = e.gmail_message_id AND er.user_id = ?
  )`;

export async function countUnreadEmails(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS total FROM google_email_messages e WHERE ${UNREAD_EMAIL_SQL}`,
    [userId]
  );
  return Number(rows[0]?.total) || 0;
}

export async function markEmailsRead(connection, userId, condition = '1 = 1', params = []) {
  const [rows] = await connection.execute(
    `SELECT e.gmail_message_id FROM google_email_messages e
      WHERE ${UNREAD_EMAIL_SQL} AND (${condition})`,
    [userId, ...params]
  );
  const ids = rows.map((row) => row.gmail_message_id);
  if (!ids.length) return [];
  const marks = placeholders(ids);
  await connection.execute(
    `INSERT IGNORE INTO email_message_read_receipts (gmail_message_id, user_id)
      SELECT gmail_message_id, ? FROM google_email_messages WHERE gmail_message_id IN (${marks})`,
    [userId, ...ids]
  );
  return ids;
}

export async function markEmailRead(connection, userId, gmailMessageId) {
  return markEmailsRead(connection, userId, 'e.gmail_message_id = ?', [gmailMessageId]);
}

import { createNotificationRecord } from '../services/notification-service.js';

export async function writeAudit(connection, userId, action, entityType, entityId, details = {}, status = {}) {
  await connection.execute(
    `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, details, previous_status, new_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId || null,
      action,
      entityType,
      String(entityId),
      JSON.stringify(details),
      status.previousStatus || null,
      status.newStatus || null
    ]
  );
}

// Existing call sites use the original five positional arguments. The optional
// metadata argument carries the structured fields used by the notification
// center; category remains the module sub-type for backward compatibility.
export async function createNotification(
  connection, userId, title, body, link = null, category = 'general', metadata = {}
) {
  return createNotificationRecord(connection, {
    ...metadata,
    userId,
    title,
    body,
    link,
    category
  });
}

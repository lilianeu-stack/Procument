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

export async function createNotification(connection, userId, title, body, link = null, category = 'general') {
  await connection.execute(
    'INSERT INTO notifications (user_id, title, body, link, category) VALUES (?, ?, ?, ?, ?)',
    [userId || null, title, body, link, category]
  );
}

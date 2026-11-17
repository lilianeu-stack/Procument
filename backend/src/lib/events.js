export async function writeAudit(connection, userId, action, entityType, entityId, details = {}) {
  await connection.execute(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId || null, action, entityType, String(entityId), JSON.stringify(details)]
  );
}

export async function createNotification(connection, userId, title, body, link = null) {
  await connection.execute(
    'INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)',
    [userId || null, title, body, link]
  );
}

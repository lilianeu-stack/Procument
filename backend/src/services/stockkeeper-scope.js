// Stock Keeper authorization is department/inventory based. A user ID is never
// treated as a department ID: the Stock Keeper's own department (and its parent
// in the two-level department hierarchy) determines the default inventory
// scope. Explicit routing assignments can widen that scope for one request.

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function loadStockkeeperScope(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT u.id, u.department_id AS departmentId, d.parent_id AS parentId
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ? AND u.role = 'storekeeper' AND u.active = TRUE LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    userId: Number(rows[0].id),
    departmentId: positiveId(rows[0].departmentId),
    parentId: positiveId(rows[0].parentId)
  };
}

function scopeMatches(scope, departmentId, parentId) {
  if (!scope) return false;
  const requestDepartment = positiveId(departmentId);
  const requestParent = positiveId(parentId);
  if (scope.departmentId === null) return true;
  if (requestDepartment === scope.departmentId) return true;
  // The request belongs to a subdepartment of the Stock Keeper's department.
  if (scope.departmentId !== null && requestParent === scope.departmentId) return true;
  if (scope.parentId === null) return false;
  // The Stock Keeper is assigned below the requesting department.
  if (requestDepartment === scope.parentId) return true;
  // Both departments are subdepartments of the same parent (for example IT and
  // Stores under Facilities).
  return requestParent === scope.parentId;
}

export async function eligibleStockkeepers(connection, departmentId) {
  const requestDepartment = positiveId(departmentId);
  const [[department]] = requestDepartment
    ? await connection.execute('SELECT parent_id AS parentId FROM departments WHERE id = ?', [requestDepartment])
    : [{}];
  const [users] = await connection.execute(
    `SELECT u.id, u.name, u.department_id AS departmentId, d.parent_id AS parentId
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = 'storekeeper' AND u.active = TRUE
      ORDER BY u.id`
  );
  return users
    .filter((user) => scopeMatches({
      departmentId: positiveId(user.departmentId),
      parentId: positiveId(user.parentId)
    }, requestDepartment, department?.parentId))
    .map((user) => ({
      id: Number(user.id),
      name: user.name,
      departmentId: positiveId(user.departmentId),
      parentId: positiveId(user.parentId)
    }));
}

// Applies to queries with `store_requests sr` and `LEFT JOIN departments d`.
// The first parameter is the current Stock Keeper's user ID, followed by the
// department scope values. Assignments are checked per request so a route can
// never be read by an unrelated account through a guessed ID.
export function stockkeeperScopeClause(scope, userId) {
  const departmentId = scope?.departmentId ?? null;
  const parentId = scope?.parentId ?? null;
  return {
    clause: `(
      EXISTS (
        SELECT 1 FROM store_request_assignments sra
         WHERE sra.store_request_id = sr.id AND sra.user_id = ?
      )
      OR ? IS NULL
      OR sr.department_id = ?
      OR (? IS NOT NULL AND d.parent_id = ?)
      OR (? IS NOT NULL AND sr.department_id = ?)
      OR (? IS NOT NULL AND d.parent_id = ?)
    )`,
    params: [
      userId,
      departmentId, departmentId,
      departmentId, departmentId,
      parentId, parentId,
      parentId, parentId
    ]
  };
}

function noRows() {
  return { clause: '1 = 0', params: [] };
}

export function requisitionScope(user, alias = 'r') {
  if (user.role === 'procurement_admin') return { clause: '1 = 1', params: [] };
  if (user.role === 'requestor') return { clause: `${alias}.requester_id = ?`, params: [user.id] };
  if (user.role === 'supervisor') {
    return user.departmentId
      ? { clause: `${alias}.department_id = ?`, params: [user.departmentId] }
      : noRows();
  }
  return noRows();
}

export function storeRequestScope(user, alias = 'sr') {
  if (user.role === 'procurement_admin' || user.role === 'storekeeper') return { clause: '1 = 1', params: [] };
  if (user.role === 'requestor') return { clause: `${alias}.requester_id = ?`, params: [user.id] };
  if (user.role === 'supervisor') {
    return user.departmentId
      ? { clause: `${alias}.department_id = ?`, params: [user.departmentId] }
      : noRows();
  }
  return noRows();
}

export function purchaseOrderScope(user, alias = 'p') {
  if (user.role === 'procurement_admin') return { clause: '1 = 1', params: [] };
  if (user.role === 'supervisor') {
    return user.departmentId
      ? {
          clause: `EXISTS (
            SELECT 1 FROM rfqs f JOIN requisitions r ON r.id = f.requisition_id
            WHERE f.id = ${alias}.rfq_id AND r.department_id = ?
          )`,
          params: [user.departmentId]
        }
      : noRows();
  }
  return noRows();
}

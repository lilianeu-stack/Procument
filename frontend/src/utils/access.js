const restrictedPages = {
  Approvals: ['admin', 'approver'],
  'Stock movements': ['admin', 'procurement', 'storekeeper'],
  Users: ['admin'],
  'Audit logs': ['admin']
};

export function canAccessPage(role, page) {
  const allowedRoles = restrictedPages[page];
  return !allowedRoles || allowedRoles.includes(role);
}

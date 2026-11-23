export const PORTALS = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  REQUESTER: 'requester',
  STOCKKEEPER: 'stockkeeper'
};

// `requestor` is the existing database value; the UI calls this role Requester.
export const USER_ROLES = [
  'admin',
  'supervisor',
  'requestor',
  'approver',
  'procurement',
  'storekeeper',
  'finance',
  'committee'
];

export const PORTAL_ROLES = new Set([PORTALS.ADMIN, PORTALS.SUPERVISOR, PORTALS.REQUESTER, PORTALS.STOCKKEEPER]);
export const DEPARTMENT_ROLES = new Set(['supervisor', 'requestor', 'storekeeper']);

const PORTAL_BY_ROLE = {
  admin: PORTALS.ADMIN,
  approver: PORTALS.ADMIN,
  procurement: PORTALS.ADMIN,
  finance: PORTALS.ADMIN,
  committee: PORTALS.ADMIN,
  supervisor: PORTALS.SUPERVISOR,
  requestor: PORTALS.REQUESTER,
  storekeeper: PORTALS.STOCKKEEPER
};

const ROLE_LABELS = {
  admin: 'Administrator',
  procurement: 'Procurement Officer',
  supervisor: 'Department Supervisor',
  requestor: 'Requester',
  storekeeper: 'Stock Keeper'
};

export function portalForRole(role) {
  return PORTAL_BY_ROLE[role] || null;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || '').replace(/^\w/, (letter) => letter.toUpperCase());
}

export function withPortalIdentity(user) {
  if (!user) return user;
  const role = user.role;
  return {
    ...user,
    role,
    roleLabel: roleLabel(role),
    portal: portalForRole(role),
    departmentId: user.departmentId ?? user.department_id ?? null
  };
}

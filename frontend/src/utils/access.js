export const PORTALS = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  REQUESTER: 'requester',
  STOCKKEEPER: 'stockkeeper',
  // Public, signed-link portal used by Suppliers. It has no staff login.
  SUPPLIER: 'supplier',
  // Public, token-gated portal where a Supplier supplies prices for a purchase
  // order. The token itself authorizes exactly one pricing response.
  SUPPLIER_PRICING: 'supplier-pricing',
  // Token-gated Purchase Order review page. The link is public, but a decision
  // requires the intended registered account to sign in.
  PURCHASE_ORDER_APPROVAL: 'po-approval'
};

export const SUPPLIER_PAGES = ['RFQ'];
export const SUPPLIER_PRICING_PAGES = ['Quote'];
export const STOCKKEEPER_PAGES = [
  'Dashboard',
  'List of Requesters',
  'Notification',
  'Bin Card',
  'Profile'
];

export const SUPERVISOR_PAGES = [
  'Supervisor Dashboard',
  'Department Overview',
  'My Department',
  'Requesters',
  'Procurement Requests',
  'Approvals',
  'Stock Overview',
  'Department Messages',
  'Notifications',
  'My Profile'
];

export const REQUESTER_PAGES = [
  'Requester Dashboard',
  'My Procurement Requests',
  'Create Purchase Request',
  'My Request History',
  'Messages',
  'Notifications',
  'My Profile'
];

// Procurement uses the Administrator-side shell but only the pages below.
export const RECEIVED_REQUESTS_PAGE = 'Requests Received from Departments';

// Internal continuation of a forwarded department request. It is opened from
// the document page, not from the Administrator sidebar.
export const PROCUREMENT_PROCESSING_PAGE = 'Procurement Processing';
export const SETTINGS_PAGE = 'Settings';

// These pages remain in the code for their own portals/history, but are no
// longer active Administrator-side pages. Direct admin routes are denied.
const ADMIN_HIDDEN_PAGES = new Set([
  'Requisitions',
  'Approvals',
  'Purchase orders',
  'Audit logs'
]);

// Supervisor-facing label for the request queue; the established route name is
// kept as the canonical page so existing links and notifications keep working.
export const SUPERVISOR_INCOMING_PAGE = 'Incoming Requests';

export const PROCUREMENT_PAGES = [
  'Overview',
  RECEIVED_REQUESTS_PAGE,
  PROCUREMENT_PROCESSING_PAGE,
  'RFQs',
  'Goods receipts',
  'Invoices',
  'Suppliers',
  'Stock overview',
  'Stock movements',
  'Store requests'
];

// Older notification links may use the longer stock page name.
const PAGE_ALIASES = {
  'Department Stock Overview': 'Stock Overview',
  'Department Procurement Requests': 'Procurement Requests',
  [SUPERVISOR_INCOMING_PAGE]: 'Approvals',
  'Supervisor Incoming Requests': 'Approvals'
};

export function canonicalPage(page) {
  return PAGE_ALIASES[page] || page;
}

const restrictedPages = {
  Approvals: ['admin', 'approver'],
  'Stock movements': ['admin', 'procurement', 'storekeeper'],
  [RECEIVED_REQUESTS_PAGE]: ['admin', 'procurement'],
  [PROCUREMENT_PROCESSING_PAGE]: ['admin', 'procurement'],
  Users: ['admin'],
  'Audit logs': ['admin'],
  [SETTINGS_PAGE]: ['admin']
};

const ROLE_LABELS = {
  admin: 'Administrator',
  supervisor: 'Department Supervisor',
  requestor: 'Requester',
  storekeeper: 'Stock Keeper',
  approver: 'Approver',
  procurement: 'Procurement Officer',
  finance: 'Finance Officer',
  committee: 'Committee Member'
};

export function portalForRole(role) {
  if (['admin', 'approver', 'procurement', 'finance', 'committee'].includes(role)) {
    return PORTALS.ADMIN;
  }
  if (role === 'supervisor') return PORTALS.SUPERVISOR;
  // The database still stores the established `requestor` value.
  if (role === 'requestor') return PORTALS.REQUESTER;
  if (role === 'storekeeper') return PORTALS.STOCKKEEPER;
  return null;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || 'Unknown').replace(/^\w/, (letter) => letter.toUpperCase());
}

export function defaultPageForPortal(portal) {
  if (portal === PORTALS.ADMIN) return 'Overview';
  if (portal === PORTALS.SUPERVISOR) return 'Supervisor Dashboard';
  if (portal === PORTALS.REQUESTER) return 'Requester Dashboard';
  if (portal === PORTALS.STOCKKEEPER) return 'Dashboard';
  if (portal === PORTALS.SUPPLIER) return 'RFQ';
  if (portal === PORTALS.SUPPLIER_PRICING) return 'Quote';
  return null;
}

export function defaultPageForRole(role) {
  return defaultPageForPortal(portalForRole(role));
}

// The public pricing link is authorized by its token, never by a staff role.
const SUPPLIER_PRICING_PAGE_NAMES = new Set(SUPPLIER_PRICING_PAGES.flatMap((page) => [page, page.toLowerCase()]));

export function canAccessPage(role, page) {
  const target = canonicalPage(page);
  if (role === PORTALS.SUPPLIER_PRICING) return SUPPLIER_PRICING_PAGE_NAMES.has(target);
  // No back-office role may open the public supplier pricing page through the
  // staff shell; the signed token is the only credential for that portal.
  if (SUPPLIER_PRICING_PAGE_NAMES.has(target)) return false;
  const portal = portalForRole(role);
  // Department portals use their own page lists; the admin-side restricted
  // pages only apply to Administrator-side roles.
  if (portal === PORTALS.SUPERVISOR) return SUPERVISOR_PAGES.includes(target);
  if (portal === PORTALS.REQUESTER) return REQUESTER_PAGES.includes(target);
  if (portal === PORTALS.STOCKKEEPER) return STOCKKEEPER_PAGES.includes(target);
  if (portal === PORTALS.SUPPLIER) return SUPPLIER_PAGES.includes(target);

  const allowedRoles = restrictedPages[target];
  if (allowedRoles && !allowedRoles.includes(role)) return false;
  if (portal === PORTALS.ADMIN) {
    if (ADMIN_HIDDEN_PAGES.has(target) && !(role === 'approver' && target === 'Approvals')) return false;
    // Administrator keeps full access to all remaining pages; Procurement only
    // gets its own pages. Other back-office roles share this shell but remain
    // subject to the role-specific backend authorization on each action.
    if (role === 'procurement') return PROCUREMENT_PAGES.includes(target);
    return true;
  }
  return !allowedRoles || allowedRoles.includes(role);
}

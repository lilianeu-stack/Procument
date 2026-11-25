export const PORTALS = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  REQUESTER: 'requester',
  STOCKKEEPER: 'stockkeeper',
  // Public, signed-link portal used by Suppliers. It has no staff login.
  SUPPLIER: 'supplier',
  // Public token-link page used by recipients of a requisition form email.
  RESPONSE: 'response',
  // Public token-link page where a Committee member accepts/denies quotations.
  COMMITTEE_REVIEW: 'committee-review',
  // Public, token-gated portal where a Supplier supplies prices for a purchase
  // order. The token itself authorizes exactly one pricing response.
  SUPPLIER_PRICING: 'supplier-pricing',
  // Token-gated Purchase Order review page. A decision requires the intended
  // registered account to sign in.
  PURCHASE_ORDER_APPROVAL: 'po-approval'
};

export const SUPPLIER_PAGES = ['RFQ'];
export const RESPONSE_PAGES = ['Response'];
export const COMMITTEE_REVIEW_PAGES = ['Review'];
export const SUPPLIER_PRICING_PAGES = ['Quote'];
// One canonical personal Profile route is shared by every authenticated portal.
export const PROFILE_PAGE = 'Profile';
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
  PROFILE_PAGE
];

export const REQUESTER_PAGES = [
  'Requester Dashboard',
  'My Procurement Requests',
  'Create Purchase Request',
  'My Request History',
  'Messages',
  'Notifications',
  PROFILE_PAGE
];

// Procurement uses the Administrator-side shell but only the pages below.
export const RECEIVED_REQUESTS_PAGE = 'Requests Received from Departments';

// Internal continuation of a forwarded department request. It is opened from
// the document page, not from the Administrator sidebar.
export const PROCUREMENT_PROCESSING_PAGE = 'Procurement Processing';
export const PROCUREMENT_COMMITTEE_PAGE = 'Procurement Committee';
// Existing global purchase-order workspace. It is reachable from Overview so the
// dashboard's View All action has a real destination without inventing a route.
export const PURCHASE_ORDERS_PAGE = 'Purchase orders';
export const SETTINGS_PAGE = 'Settings';

// These pages remain in the code for their own portals/history, but are no
// longer active Administrator-side pages. Direct admin routes are denied.
const ADMIN_HIDDEN_PAGES = new Set([
  'Requisitions',
  'Approvals',
  'Audit logs',
  // System settings remain available to backend services, but the user-facing
  // Administrator Settings page has been replaced by the personal Profile page.
  SETTINGS_PAGE
]);

// Supervisor-facing label for the request queue; the established route name is
// kept as the canonical page so existing links and notifications keep working.
export const SUPERVISOR_INCOMING_PAGE = 'Incoming Requests';

export const PROCUREMENT_PAGES = [
  'Overview',
  RECEIVED_REQUESTS_PAGE,
  PROCUREMENT_PROCESSING_PAGE,
  PROCUREMENT_COMMITTEE_PAGE,
  'RFQs',
  'Email Inbox',
  PURCHASE_ORDERS_PAGE,
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
  'Supervisor Incoming Requests': 'Approvals',
  // Existing bookmarks/links continue to open the unified Profile page.
  'My Profile': PROFILE_PAGE
};

export function canonicalPage(page) {
  return PAGE_ALIASES[page] || page;
}

const restrictedPages = {
  Approvals: ['admin', 'approver'],
  'Stock movements': ['admin', 'procurement', 'storekeeper'],
  [RECEIVED_REQUESTS_PAGE]: ['admin', 'procurement'],
  [PROCUREMENT_PROCESSING_PAGE]: ['admin', 'procurement'],
  'Email Inbox': ['admin', 'procurement'],
  [PROCUREMENT_COMMITTEE_PAGE]: ['admin', 'procurement'],
  [PURCHASE_ORDERS_PAGE]: ['admin', 'procurement'],
  Users: ['admin'],
  'Audit logs': ['admin']
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
  if (portal === PORTALS.RESPONSE) return 'Response';
  if (portal === PORTALS.COMMITTEE_REVIEW) return 'Review';
  if (portal === PORTALS.SUPPLIER_PRICING) return 'Quote';
  if (portal === PORTALS.PURCHASE_ORDER_APPROVAL) return 'Approval';
  return null;
}

export function defaultPageForRole(role) {
  return defaultPageForPortal(portalForRole(role));
}

// The public pricing link is authorized by its token, never by a staff role.
const SUPPLIER_PRICING_PAGE_NAMES = new Set(SUPPLIER_PRICING_PAGES.flatMap((page) => [page, page.toLowerCase()]));

export function canAccessPage(role, page) {
  const target = canonicalPage(page);
  // The response form is public and token-gated; it has no staff role.
  if (role === PORTALS.RESPONSE) return RESPONSE_PAGES.includes(target);
  if (role === PORTALS.COMMITTEE_REVIEW) return COMMITTEE_REVIEW_PAGES.includes(target);
  if (role === PORTALS.SUPPLIER_PRICING) return SUPPLIER_PRICING_PAGE_NAMES.has(target);
  // No back-office role may open the public supplier pricing page through the
  // staff shell; the signed token is the only credential for that portal.
  if (SUPPLIER_PRICING_PAGE_NAMES.has(target)) return false;
  if (role === PORTALS.PURCHASE_ORDER_APPROVAL) return ['Approval'].includes(target);
  const portal = portalForRole(role);
  // Every authenticated staff account owns the same personal Profile page,
  // including roles that otherwise share the restricted Administrator shell.
  if (target === PROFILE_PAGE) return Boolean(portal);
  // Department portals use their own page lists; the admin-side restricted
  // pages only apply to Administrator-side roles.
  if (portal === PORTALS.SUPERVISOR) return SUPERVISOR_PAGES.includes(target);
  if (portal === PORTALS.REQUESTER) return REQUESTER_PAGES.includes(target);
  if (portal === PORTALS.STOCKKEEPER) return STOCKKEEPER_PAGES.includes(target);
  if (portal === PORTALS.SUPPLIER) return SUPPLIER_PAGES.includes(target);
  if (portal === PORTALS.RESPONSE) return RESPONSE_PAGES.includes(target);

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

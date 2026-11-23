import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import BrandLogo from './components/ui/BrandLogo.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PageContent from './pages/PageContent.jsx';
import AdminLayout from './components/portals/AdminLayout.jsx';
import SupervisorLayout from './components/portals/SupervisorLayout.jsx';
import RequesterLayout from './components/portals/RequesterLayout.jsx';
import StockKeeperLayout from './components/portals/StockKeeperLayout.jsx';
import AccessDenied from './components/portals/AccessDenied.jsx';
import RoleBasedDashboard from './components/portals/RoleBasedDashboard.jsx';
import PortalPlaceholder from './components/portals/PortalPlaceholder.jsx';
import RequesterRequests from './components/portals/RequesterRequests.jsx';
import CreatePurchaseRequest from './components/portals/CreatePurchaseRequest.jsx';
import PortalMessages from './components/portals/PortalMessages.jsx';
import PortalNotifications from './components/portals/PortalNotifications.jsx';
import PortalProfile from './components/portals/PortalProfile.jsx';
import SupervisorOverview from './components/portals/SupervisorOverview.jsx';
import SupervisorRequesters from './components/portals/SupervisorRequesters.jsx';
import SupervisorRequests from './components/portals/SupervisorRequests.jsx';
import SupervisorApprovals from './components/portals/SupervisorApprovals.jsx';
import SupervisorStock from './components/portals/SupervisorStock.jsx';
import StockKeeperDashboard from './components/portals/StockKeeperDashboard.jsx';
import StockKeeperNotifications from './components/portals/StockKeeperNotifications.jsx';
import StockKeeperBinCards from './components/portals/StockKeeperBinCards.jsx';
import ReceivedRequests from './components/portals/ReceivedRequests.jsx';
import ProcurementDocumentView from './components/portals/ProcurementDocumentView.jsx';
import SupplierRfqPage from './components/portals/SupplierRfqPage.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { api } from './services/api.js';
import {
  canAccessPage, canonicalPage, defaultPageForPortal, portalForRole, roleLabel,
  PORTALS, PROCUREMENT_PROCESSING_PAGE, RECEIVED_REQUESTS_PAGE
} from './utils/access.js';
import { buildRoute, parseRoute } from './utils/routes.js';
import { dateQueryForFilter } from './utils/reportFields.js';

const StockKeeperRequesters = lazy(() => import('./components/portals/StockKeeperRequesters.jsx'));

const initialData = {
  dashboard: null,
  requisitions: [],
  receivedRequests: [],
  items: [],
  suppliers: [],
  movements: [],
  rfqs: [],
  quotations: [],
  purchaseOrders: [],
  goodsReceipts: [],
  invoices: [],
  storeRequests: [],
  users: [],
  departments: [],
  notifications: [],
  portalSummary: null,
  portalExtras: null
};

function request(path, body, method = 'POST') {
  return api(path, { method, body: JSON.stringify(body) });
}

function readRoute() {
  return parseRoute(window.location.hash);
}

function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

// Portal pages need more than the summary; load the data each page starts with.
async function loadPortalExtras(portal, page) {
  if (portal === 'stockkeeper') {
    if (page === 'List of Requesters') return null;
    if (page === 'Bin Card') {
      const [items, issueRequests] = await Promise.all([
        api('/portal/stockkeeper/items'),
        api('/portal/stockkeeper/issue-requests')
      ]);
      return { stockItems: items.items || [], issueRequests: issueRequests.requests || [] };
    }
    return null;
  }
  if (portal === 'requester') {
    if (page === 'Requester Dashboard' || page === 'My Procurement Requests' || page === 'My Request History') {
      return { requesterRequests: await api(`/portal/requester/requisitions${toQuery({ page: 1, limit: 10 })}`) };
    }
    if (page === 'Messages') {
      return { conversations: await api('/portal/messages/conversations') };
    }
    return null;
  }
  if (portal === 'supervisor') {
    if (page === 'Supervisor Dashboard' || page === 'Department Overview') {
      const [supervisorRequests, stock, requesters] = await Promise.all([
        api(`/portal/supervisor/requisitions${toQuery({ page: 1, limit: 10 })}`),
        api('/portal/supervisor/stock'),
        api('/portal/supervisor/requesters')
      ]);
      return { supervisorRequests, stock, requesters };
    }
    if (page === 'My Department' || page === 'Requesters') {
      return { requesters: await api('/portal/supervisor/requesters') };
    }
    if (page === 'Procurement Requests') {
      const [supervisorRequests, requesters] = await Promise.all([
        api(`/portal/supervisor/requisitions${toQuery({ page: 1, limit: 10 })}`),
        api('/portal/supervisor/requesters')
      ]);
      return { supervisorRequests, requesters };
    }
    if (page === 'Approvals') {
      const [approvalRequests, requesters] = await Promise.all([
        api(`/portal/supervisor/requisitions${toQuery({ page: 1, limit: 10, status: 'Pending Supervisor Approval' })}`),
        api('/portal/supervisor/requesters')
      ]);
      return { approvalRequests, requesters };
    }
    if (page === 'Stock Overview') {
      return { stock: await api('/portal/supervisor/stock') };
    }
    if (page === 'Department Messages') {
      return { conversations: await api('/portal/messages/conversations') };
    }
  }
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState(readRoute);
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dateFilters, setDateFilters] = useState({});

  const portal = user ? portalForRole(user.role) : null;
  const activePortal = route.portal || portal;
  const activePage = canonicalPage(route.page) || (activePortal ? defaultPageForPortal(activePortal) : null);
  const routeUnauthorized = Boolean(user && route.portal) && (
    route.portal !== portal || Boolean(route.page && !canAccessPage(user.role, route.page))
  );

  function go(nextPortal, nextPage, nextQuery = null) {
    const targetPage = canonicalPage(nextPage);
    const nextHash = buildRoute(nextPortal, targetPage, nextQuery);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    setRoute({ portal: nextPortal, page: targetPage, query: nextQuery || {} });
    setSearch('');
    setMobileNav(false);
  }

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('pims-token');
    if (!token) {
      setAuthLoading(false);
      return () => { active = false; };
    }

    api('/auth/me')
      .then((result) => {
        if (!active) return;
        const nextUser = result.user;
        const nextPortal = portalForRole(nextUser.role);
        setUser(nextUser);
        const current = readRoute();
        if (!nextPortal) return;
        if (!current.portal) go(nextPortal, defaultPageForPortal(nextPortal));
      })
      .catch(() => localStorage.removeItem('pims-token'))
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  const activeFilter = activePortal === 'admin' ? dateFilters[activePage] : null;
  const setDateFilter = useCallback((next) => {
    setDateFilters((current) => ({ ...current, [activePage]: next }));
  }, [activePage]);

  const loadData = useCallback(async () => {
    if (!user || !portal) return;
    setLoading(true);
    setError('');
    const filterQuery = toQuery(dateQueryForFilter(activeFilter));
    const filtered = (path) => {
      if (!filterQuery) return path;
      return path.includes('?') ? `${path}&${filterQuery.slice(1)}` : `${path}${filterQuery}`;
    };
    try {
      if (portal === 'admin') {
        const [
          dashboard, requisitions, receivedRequests, inventory, suppliers, rfqs, purchaseOrders,
          goodsReceipts, invoices, storeRequests, notifications
        ] = await Promise.all([
          api('/dashboard'), api(filtered('/requisitions')),
          canAccessPage(user.role, RECEIVED_REQUESTS_PAGE)
            ? api(filtered('/procurement/received-requests?page=1&limit=10'))
            : Promise.resolve({ requisitions: [] }),
          api('/inventory'), api(filtered('/suppliers')),
          api(filtered('/rfqs')), api(filtered('/purchase-orders')), api(filtered('/goods-receipts')),
          api(filtered('/invoices')), api(filtered('/store-requests')), api('/notifications')
        ]);
        // Account and Department administration is Administrator-only.
        // Audit history remains in the backend; the Administrator UI no longer
        // loads or displays it.
        const adminOnly = user.role === 'admin';
        const [users, departments] = adminOnly
          ? await Promise.all([api(filtered('/admin/users')), api('/admin/departments')])
          : [{ users: [] }, { departments: [] }];
        let movements = [];
        if (activePage === 'Stock movements' && ['admin', 'procurement', 'storekeeper'].includes(user.role)) {
          movements = (await api(filtered('/inventory/movements'))).movements;
        }
        // Preserve locally loaded quotations across data refreshes. The admin
        // bootstrap does not include them; replacing the whole object used to
        // leave RfqsPage with quotations === undefined after creating an RFQ.
        setData((current) => ({
          ...current,
          dashboard, requisitions: requisitions.requisitions || [],
          receivedRequests: receivedRequests.requisitions || [],
          items: inventory.items || [],
          suppliers: suppliers.suppliers || [], rfqs: rfqs.rfqs || [],
          purchaseOrders: purchaseOrders.purchaseOrders || [],
          goodsReceipts: goodsReceipts.goodsReceipts || [], invoices: invoices.invoices || [],
          storeRequests: storeRequests.storeRequests || [], notifications: notifications.notifications || [],
          users: users.users || [], departments: departments.departments || [],
          quotations: current.quotations || [],
          movements, portalSummary: null, portalExtras: null
        }));
      } else {
        const [summary, notifications, portalExtras] = await Promise.all([
          api(`/portal/${portal}/summary`),
          api('/notifications'),
          loadPortalExtras(portal, activePage).catch(() => null)
        ]);
        setData({ ...initialData, portalSummary: summary, notifications: notifications.notifications, portalExtras });
      }
    } catch (exception) {
      setError(exception.message);
      if (!localStorage.getItem('pims-token')) setUser(null);
    } finally {
      setLoading(false);
    }
  }, [activePage, activeFilter, portal, user]);

  useEffect(() => {
    if (user && portal) loadData();
  }, [user, portal, loadData]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api('/admin/settings')
      .then((result) => {
        const settings = result.settings || {};
        localStorage.setItem('pims-currency', settings.default_currency || 'USD');
        localStorage.setItem('pims-currency-precision', String(settings.decimal_precision ?? 2));
        localStorage.setItem('pims-date-format', settings.date_format || 'DD/MM/YYYY');
        localStorage.setItem('pims-time-format', settings.time_format || '24');
        localStorage.setItem('pims-timezone', settings.timezone || 'Africa/Kigali');
        localStorage.setItem('pims-theme', settings.theme || 'light');
        if (settings.theme === 'dark') document.documentElement.dataset.theme = 'dark';
        else if (settings.theme === 'system') {
          document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } else document.documentElement.dataset.theme = 'light';
        document.title = `${settings.system_name || 'Procurement Management System'} | ${settings.organization_name || 'Hope Haven'}`;
      })
      .catch(() => {});
  }, [user]);

  async function login(email, password) {
    const result = await request('/auth/login', { email, password });
    const nextPortal = portalForRole(result.user.role);
    if (!nextPortal) {
      throw new Error('Your role does not have an assigned portal. Contact an administrator.');
    }
    localStorage.setItem('pims-token', result.token);
    setData(initialData);
    setUser(result.user);
    go(nextPortal, defaultPageForPortal(nextPortal));
  }

  function logout() {
    localStorage.removeItem('pims-token');
    setUser(null);
    setData(initialData);
    setRoute({ portal: null, page: null, query: {} });
    setNotificationsOpen(false);
    setMobileNav(false);
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }

  const mutate = useCallback(async (path, body, method = 'POST') => {
    const result = await request(path, body, method);
    await loadData();
    return result;
  }, [loadData]);

  // Callbacks used by Requester / Supervisor pages. Every mutation reloads the
  // portal data so summaries, lists and unread counts stay in sync.
  const portalApi = useMemo(() => {
    const post = async (path, body) => {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      await loadData();
      return result;
    };
    return {
      reload: () => loadData(),
      navigate: (page, query) => go(portal, page, query),
      getRequesterRequests: (params = {}) => api(`/portal/requester/requisitions${toQuery(params)}`),
      getRequesterRequest: (id) => api(`/portal/requester/requisitions/${id}`),
      createRequesterRequest: (payload) => post('/portal/requester/requisitions', payload),
      submitRequesterRequest: (id, payload = {}) => post(`/portal/requester/requisitions/${id}/submit`, payload),
      resubmitRequesterRequest: (id, payload = {}) => post(`/portal/requester/requisitions/${id}/resubmit`, payload),
      getSupervisorRequests: (params = {}) => api(`/portal/supervisor/requisitions${toQuery(params)}`),
      getSupervisorRequest: (id) => api(`/portal/supervisor/requisitions/${id}`),
      decideRequest: (id, payload) => post(`/portal/supervisor/requisitions/${id}/decision`, payload),
      forwardRequest: (id) => post(`/portal/supervisor/requisitions/${id}/forward`),
      getRequesters: async () => api('/portal/supervisor/requesters'),
      getDepartments: async () => api('/procurement/departments'),
      getReceivedRequests: (params = {}) => api(`/procurement/received-requests${toQuery(params)}`),
      getReceivedRequest: (id) => api(`/procurement/received-requests/${id}`),
      reviewReceivedRequest: (id) => post(`/procurement/received-requests/${id}/review`),
      getStock: (params = {}) => api(`/portal/supervisor/stock${toQuery(params)}`),
      getStockItem: (id) => api(`/portal/supervisor/stock/${id}`),
      getConversations: () => api('/portal/messages/conversations'),
      getThread: (userId) => api(`/portal/messages/thread?userId=${encodeURIComponent(userId)}`),
      sendMessage: (payload) => post('/portal/messages', payload),
      markMessageRead: (id) => api(`/portal/messages/${id}/read`, { method: 'PATCH' }),
      getNotifications: async () => (await api('/notifications')).notifications,
      markNotificationRead: (id) => api(`/notifications/${id}/read`, { method: 'PATCH' }),
      markAllNotificationsRead: () => api('/portal/stockkeeper/notifications/read-all', { method: 'PATCH' }),
      getStockItems: (params = {}) => api(`/portal/stockkeeper/items${toQuery(params)}`),
      getBinCard: (id) => api(`/portal/stockkeeper/items/${id}`),
      getIssueRequests: () => api('/portal/stockkeeper/issue-requests'),
      getStockKeeperRequesters: (params = {}) => api(`/portal/stockkeeper/requesters${toQuery(params)}`),
      getRequesterDetails: (id) => api(`/portal/stockkeeper/requesters/${id}`),
      getRequesterHistory: (id, params = {}) => api(`/portal/stockkeeper/requesters/${id}/history${toQuery(params)}`),
      stockIn: (payload) => post('/portal/stockkeeper/transactions/stock-in', payload),
      stockOut: (payload) => post('/portal/stockkeeper/transactions/stock-out', payload),
      stockAdjustment: (payload) => post('/portal/stockkeeper/transactions/adjustment', payload)
    };
  }, [loadData, portal]);

  async function loadQuotations(rfqId) {
    const result = await api(`/rfqs/${rfqId}/quotations`);
    setData((current) => ({ ...current, quotations: result.quotations }));
  }

  async function openNotification(notification) {
    try {
      await api(`/notifications/${notification.id}/read`, { method: 'PATCH' });
      setNotificationsOpen(false);
      setData((current) => ({
        ...current,
        notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, isRead: true } : item)
      }));

      const parsed = parseRoute(notification.link || '');
      if (canonicalPage(parsed.page) === RECEIVED_REQUESTS_PAGE && canAccessPage(user.role, RECEIVED_REQUESTS_PAGE)) {
        go('admin', RECEIVED_REQUESTS_PAGE, { view: parsed.query.request });
        void loadData();
        return;
      }
      if (parsed.portal && parsed.portal !== 'admin' && canAccessPage(user.role, parsed.page || defaultPageForPortal(parsed.portal))) {
        const destination = canonicalPage(parsed.page) || defaultPageForPortal(parsed.portal);
        go(parsed.portal, destination, parsed.query);
        void loadData();
        return;
      }
      if (portal !== 'admin') {
        go(portal, 'Notifications');
        void loadData();
        return;
      }
      const link = notification.link || '';
      // Purchase-order notifications open the original request's workflow,
      // because POs are no longer a standalone Administrator page.
      const purchaseOrderId = Number(link.match(/\/purchase-orders\/(\d+)/)?.[1]);
      if (Number.isInteger(purchaseOrderId) && purchaseOrderId > 0) {
        const order = (data.purchaseOrders || []).find((row) => Number(row.id) === purchaseOrderId);
        if (order?.requisitionId && canAccessPage(user.role, PROCUREMENT_PROCESSING_PAGE)) {
          go('admin', PROCUREMENT_PROCESSING_PAGE, { request: order.requisitionId, tab: 'purchase-orders' });
          void loadData();
          return;
        }
      }
      const destination = link.includes('rfq') ? 'RFQs'
        : link.includes('purchase') ? RECEIVED_REQUESTS_PAGE
          : link.includes('invoice') ? 'Invoices'
            : link.includes('store') ? 'Store requests'
              : link.includes('inventory') ? 'Stock movements' : RECEIVED_REQUESTS_PAGE;
      const safeDestination = canAccessPage(user.role, destination) ? destination
        : canAccessPage(user.role, RECEIVED_REQUESTS_PAGE) ? RECEIVED_REQUESTS_PAGE : 'Overview';
      go('admin', safeDestination);
    } catch (exception) {
      setError(exception.message);
    }
  }

  const initials = useMemo(() => user?.name?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'HH', [user]);
  const displayUser = user ? {
    ...user,
    initials,
    roleLabel: user.roleLabel || roleLabel(user.role)
  } : null;

  // Signed Supplier links are public and must not be blocked by the staff
  // session checks below. The token itself authorizes exactly one Supplier RFQ.
  if (activePortal === PORTALS.SUPPLIER) {
    return <ErrorBoundary key="supplier-rfq"><SupplierRfqPage token={route.query?.token || ''} /></ErrorBoundary>;
  }

  if (authLoading) return <main className="grid min-h-screen place-items-center bg-canvas">
    <div role="status" className="flex flex-col items-center gap-4">
      <BrandLogo variant="loading" />
      <span className="text-sm text-muted">Loading your workspace…</span>
    </div>
  </main>;
  if (!user) return <LoginPage onLogin={login} />;

  if (!portal || routeUnauthorized) {
    return <AccessDenied
      invalidRole={!portal}
      attemptedPortal={route.portal}
      attemptedPage={route.page}
      correctPortal={portal}
      correctPage={portal ? defaultPageForPortal(portal) : null}
      onContinue={() => go(portal, defaultPageForPortal(portal))}
      onLogout={logout}
    />;
  }

  const actions = {
    onNavigate: (nextPage) => go('admin', nextPage),
    onCreateRequisition: (form) => mutate('/requisitions', form),
    onRequisitionDecision: (id, decision) => mutate(`/requisitions/${id}/decision`, { decision }, 'PATCH'),
    onAddItem: (form) => mutate('/inventory/items', form),
    onReceive: (form) => mutate('/goods-receipts', form),
    onCreateSupplier: (form) => mutate('/suppliers', form),
    onCreateRFQ: (form) => mutate('/rfqs', form),
    onLoadEmailDeliveries: (rfqId) => api(`/rfqs/${rfqId}/email-deliveries`),
    onRetryFailedEmails: (rfqId) => mutate(`/rfqs/${rfqId}/emails/retry-failed`, {}),
    onResendRfqEmail: (rfqId, deliveryId) => mutate(`/rfqs/${rfqId}/email-deliveries/${deliveryId}/resend`, {}),
    onLoadQuotes: loadQuotations,
    onQuote: (id, form) => mutate(`/rfqs/${id}/quotations`, form),
    onAward: (id, quotationId) => mutate(`/rfqs/${id}/award`, { quotationId }),
    onCreatePO: (form) => mutate('/purchase-orders', form),
    onPODecision: (id, decision) => mutate(`/purchase-orders/${id}/decision`, { decision }, 'PATCH'),
    onReceivePO: (form) => mutate('/goods-receipts', form),
    onCreateInvoice: (form) => mutate('/invoices', form),
    onInvoiceDecision: (id, decision) => mutate(`/invoices/${id}/decision`, { decision }, 'PATCH'),
    onCreateStoreRequest: (form) => mutate('/store-requests', form),
    onStoreDecision: (id, decision) => mutate(`/store-requests/${id}/decision`, { decision }, 'PATCH'),
    onIssueStoreRequest: (id) => mutate(`/store-requests/${id}/issue`, {}, 'PATCH'),
    onCreateUser: (form) => mutate('/admin/users', form),
    onToggleUser: (id, active) => mutate(`/admin/users/${id}/status`, { active }, 'PATCH'),
    onCreateDepartment: (form) => mutate('/admin/departments', form),
    onDepartmentUsers: (id) => api(`/admin/departments/${id}/users`),
    onUpdateDepartment: (id, form) => mutate(`/admin/departments/${id}`, form, 'PATCH'),
    onDeleteDepartment: (id, reassignTo) => request(`/admin/departments/${id}`, { reassignTo }, 'DELETE').then((result) => loadData().then(() => result)),
    onUpdateUser: (id, form) => mutate(`/admin/users/${id}`, form, 'PATCH'),
    onDeleteUser: (id) => mutate(`/admin/users/${id}`, {}, 'DELETE'),
    onResetPassword: (id, password) => request(`/admin/users/${id}/reset-password`, password ? { password } : {}),
    onBulkValidate: (users) => request('/admin/users/bulk/validate', { users }),
    onBulkImport: (users) => mutate('/admin/users/bulk', { users }),
    onUserActivity: (id) => api(`/admin/users/${id}/activity`),
    getSettings: () => api('/admin/settings'),
    saveSettings: (settings) => request('/admin/settings', { settings }, 'PUT'),
    resetSettings: (keys) => request('/admin/settings/reset', { keys }, 'POST'),
    getAuditLogs: () => api('/admin/audit-logs')
  };

  const shellProps = {
    user: displayUser,
    page: activePage,
    notifications: data.notifications,
    refreshing: loading,
    mobileNav,
    notificationsOpen,
    onNavigate: (nextPage, nextQuery) => go(activePortal, nextPage, nextQuery),
    onNotification: openNotification,
    onToggleNotifications: () => setNotificationsOpen((open) => !open),
    onOpenMenu: () => setMobileNav(true),
    onCloseMenu: () => setMobileNav(false),
    onLogout: logout
  };

  const alert = error && <div role="alert" className="mb-5 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
    <span>{error}</span><button onClick={loadData} className="font-bold underline">Retry</button>
  </div>;

  if (portal === 'admin') {
    return <AdminLayout {...shellProps}>
      <div className="mb-4 flex items-center justify-between gap-3">
        {activePage !== 'Overview' && <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this page…" className="field max-w-xs bg-white" />}
        {loading && <span className="text-xs text-muted">Refreshing…</span>}
      </div>
      {alert}
      <ErrorBoundary key={`${activePortal}-${activePage}`} onRetry={loadData} onLogout={logout}>
        <PageContent
          page={activePage}
          data={{ ...data, user, search }}
          query={route.query || {}}
          actions={actions}
          portalApi={portalApi}
          navigate={(nextPage, nextQuery) => go('admin', nextPage, nextQuery)}
          dateFilter={activeFilter}
          onDateFilterChange={setDateFilter}
        />
      </ErrorBoundary>
    </AdminLayout>;
  }

  const PortalShell = portal === 'supervisor' ? SupervisorLayout
    : portal === 'requester' ? RequesterLayout : StockKeeperLayout;
  const dashboardPage = portal === 'supervisor' ? 'Supervisor Dashboard'
    : portal === 'requester' ? 'Requester Dashboard' : 'Dashboard';
  const extras = data.portalExtras || {};
  const navigatePage = (page, query) => go(portal, page, query);
  let portalContent;

  if (activePage === dashboardPage) {
    portalContent = portal === 'stockkeeper'
      ? <StockKeeperDashboard summary={data.portalSummary} notifications={data.notifications} onNavigate={navigatePage} />
      : <RoleBasedDashboard
        portal={portal}
        user={displayUser}
        summary={data.portalSummary}
        notifications={data.notifications}
        onNavigate={navigatePage}
        onOpenNotification={openNotification}
        portalApi={portalApi}
      />;
  } else if (portal === 'stockkeeper') {
    if (activePage === 'List of Requesters') {
      portalContent = <Suspense fallback={<div role="status" className="p-8 text-sm text-muted">Loading requester directory…</div>}>
        <StockKeeperRequesters portalApi={portalApi} initial={extras} />
      </Suspense>;
    } else if (activePage === 'Notification') {
      portalContent = <StockKeeperNotifications
        notifications={data.notifications}
        portalApi={portalApi}
        onOpenNotification={openNotification}
      />;
    } else if (activePage === 'Bin Card') {
      portalContent = <StockKeeperBinCards
        portalApi={portalApi}
        initialItems={extras.stockItems}
        initialIssueRequests={extras.issueRequests}
        query={route.query || {}}
        navigate={navigatePage}
      />;
    } else if (activePage === 'Profile') {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} />;
    } else {
      portalContent = <PortalPlaceholder portal={portal} page={activePage} user={displayUser}
        summary={data.portalSummary} notifications={data.notifications} onNavigate={navigatePage} />;
    }
  } else if (portal === 'requester') {
    if (activePage === 'My Procurement Requests' || activePage === 'My Request History') {
      portalContent = <RequesterRequests
        key={activePage}
        portalApi={portalApi}
        query={route.query || {}}
        navigate={navigatePage}
        history={activePage === 'My Request History'}
        initial={activePage === 'My Request History' ? null : extras.requesterRequests}
      />;
    } else if (activePage === 'Create Purchase Request') {
      portalContent = <CreatePurchaseRequest portalApi={portalApi} query={route.query || {}} navigate={navigatePage} />;
    } else if (activePage === 'Messages') {
      portalContent = <PortalMessages
        portal="requester"
        portalApi={portalApi}
        query={route.query || {}}
        userId={user?.id}
        navigate={navigatePage}
        initial={extras.conversations}
      />;
    } else if (activePage === 'Notifications') {
      portalContent = <PortalNotifications
        portal="requester"
        notifications={data.notifications}
        portalApi={portalApi}
        onOpenNotification={openNotification}
        navigate={navigatePage}
      />;
    } else if (activePage === 'My Profile') {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} />;
    } else {
      portalContent = <PortalPlaceholder portal={portal} page={activePage} user={displayUser}
        summary={data.portalSummary} notifications={data.notifications} onNavigate={navigatePage} />;
    }
  } else {
    if (activePage === 'Department Overview' || activePage === 'My Department') {
      portalContent = <SupervisorOverview
        key={activePage}
        mode={activePage === 'My Department' ? 'department' : 'overview'}
        summary={data.portalSummary}
        portalApi={portalApi}
        navigate={navigatePage}
      />;
    } else if (activePage === 'Requesters') {
      portalContent = <SupervisorRequesters portalApi={portalApi} navigate={navigatePage} />;
    } else if (activePage === 'Procurement Requests') {
      portalContent = <SupervisorRequests portalApi={portalApi} query={route.query || {}} navigate={navigatePage} initial={extras.supervisorRequests} />;
    } else if (activePage === 'Approvals') {
      portalContent = <SupervisorApprovals portalApi={portalApi} query={route.query || {}} navigate={navigatePage} initial={extras.approvalRequests} />;
    } else if (activePage === 'Stock Overview') {
      portalContent = <SupervisorStock portalApi={portalApi} initial={extras.stock} />;
    } else if (activePage === 'Department Messages') {
      portalContent = <PortalMessages
        portal="supervisor"
        portalApi={portalApi}
        query={route.query || {}}
        userId={user?.id}
        navigate={navigatePage}
        initial={extras.conversations}
      />;
    } else if (activePage === 'Notifications') {
      portalContent = <PortalNotifications
        portal="supervisor"
        notifications={data.notifications}
        portalApi={portalApi}
        onOpenNotification={openNotification}
        navigate={navigatePage}
      />;
    } else if (activePage === 'My Profile') {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} />;
    } else {
      portalContent = <PortalPlaceholder portal={portal} page={activePage} user={displayUser}
        summary={data.portalSummary} notifications={data.notifications} onNavigate={navigatePage} />;
    }
  }

  return <PortalShell {...shellProps} summary={data.portalSummary}>
    {alert}
    <ErrorBoundary key={`${activePortal}-${activePage}`} onRetry={loadData} onLogout={logout}>{portalContent}</ErrorBoundary>
  </PortalShell>;
}

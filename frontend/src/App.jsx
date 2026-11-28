import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoginPage from './pages/LoginPage.jsx';
import PageContent from './pages/PageContent.jsx';
import AdminLayout from './components/portals/AdminLayout.jsx';
import SupervisorLayout from './components/portals/SupervisorLayout.jsx';
import RequesterLayout from './components/portals/RequesterLayout.jsx';
import StockKeeperLayout from './components/portals/StockKeeperLayout.jsx';
import AccessDenied from './components/portals/AccessDenied.jsx';
import RoleBasedDashboard from './components/portals/RoleBasedDashboard.jsx';
import RequesterDashboard from './components/portals/RequesterDashboard.jsx';
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
import StockKeeperDisplayBeforeDelivery from './components/portals/StockKeeperDisplayBeforeDelivery.jsx';
import ReceivedRequests from './components/portals/ReceivedRequests.jsx';
import ProcurementDocumentView from './components/portals/ProcurementDocumentView.jsx';
import SupplierRfqPage from './components/portals/SupplierRfqPage.jsx';
import RequestResponsePage from './components/portals/RequestResponsePage.jsx';
import CommitteeReviewPage from './components/portals/CommitteeReviewPage.jsx';
import SupplierPricingPage from './components/portals/SupplierPricingPage.jsx';
import PurchaseOrderApprovalPage from './components/portals/PurchaseOrderApprovalPage.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { initialsFor } from './components/ui/UserAvatar.jsx';
import { useNotifications } from './notifications/NotificationProvider.jsx';
import { api, apiBlob } from './services/api.js';
import {
  fetchSidebarCounts, markAllNotificationsRead as requestMarkAllNotificationsRead,
  markModuleNotificationsRead, shouldMarkModuleOnOpen
} from './services/sidebarCounts.js';
import {
  canAccessPage, canonicalPage, defaultPageForPortal, portalForRole, roleLabel,
  PORTALS, PROCUREMENT_COMMITTEE_PAGE, PROCUREMENT_PROCESSING_PAGE, PROFILE_PAGE, RECEIVED_REQUESTS_PAGE
} from './utils/access.js';
import { buildRoute, parseRoute, readRouteFromLocation } from './utils/routes.js';
import { dateQueryForFilter } from './utils/reportFields.js';

const StockKeeperRequesters = lazy(() => import('./components/portals/StockKeeperRequesters.jsx'));
const StockKeeperSupervisorRequests = lazy(() => import('./components/portals/StockKeeperSupervisorRequests.jsx'));
const StockKeeperStockOverview = lazy(() => import('./components/portals/StockKeeperStockOverview.jsx'));
const StockKeeperStockIn = lazy(() => import('./components/portals/StockKeeperStockIn.jsx'));
const StockKeeperStockOut = lazy(() => import('./components/portals/StockKeeperStockOut.jsx'));
const StockKeeperInventoryReports = lazy(() => import('./components/portals/StockKeeperInventoryReports.jsx'));

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
  goodsReceipts: [], grnSuppliers: [],
  invoices: [],
  storeRequests: [],
  users: [],
  departments: [],
  committeeMembers: [],
  notifications: [],
  portalSummary: null,
  portalExtras: null
};

function request(path, body, method = 'POST') {
  return api(path, { method, body: JSON.stringify(body) });
}

function readRoute() {
  return readRouteFromLocation(window.location);
}

function pageLabelForPath(path) {
  const value = String(path || '');
  if (value.startsWith('/messages')) return 'Messages';
  if (value.startsWith('/rfqs')) return 'RFQs';
  if (value.startsWith('/purchase-order')) return 'Purchase orders';
  if (value.startsWith('/portal/requester')) return 'My Procurement Requests';
  if (value.startsWith('/portal/supervisor')) return 'Department Supervisor Portal';
  if (value.startsWith('/portal/stockkeeper')) return 'Stock Keeper Portal';
  if (value.startsWith('/inventory')) return 'Inventory';
  if (value.startsWith('/goods-receipts')) return 'Goods receipts';
  if (value.startsWith('/invoices')) return 'Invoices';
  if (value.startsWith('/suppliers')) return 'Suppliers';
  if (value.startsWith('/admin')) return 'Administration';
  return 'Workspace';
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
  // Every authenticated portal uses the same role-scoped messaging endpoint.
  if (page === 'Messages' || page === 'Department Messages') {
    return { conversations: await api('/messages/conversations') };
  }
  if (portal === 'stockkeeper') {
    if (page === 'Requests from Supervisors') {
      return { routedRequests: (await api('/portal/stockkeeper/routed-requests')).requests || [] };
    }
    if (page === 'Stock Out') {
      return { issueRequests: (await api('/portal/stockkeeper/issue-requests')).requests || [] };
    }
    if (page === 'Stock In') {
      return { expectedDeliveries: (await api('/portal/stockkeeper/expected-deliveries')).deliveries || [] };
    }
    if (page === 'Bin Card') {
      const items = await api('/portal/stockkeeper/items');
      return { stockItems: items.items || [] };
    }
    return null;
  }
  if (portal === 'requester') {
    if (page === 'Requester Dashboard' || page === 'My Procurement Requests' || page === 'My Request History') {
      return { requesterRequests: await api(`/portal/requester/requisitions${toQuery({ page: 1, limit: 10 })}`) };
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
  const [sidebarCounts, setSidebarCounts] = useState({});
  const [notificationBusy, setNotificationBusy] = useState(false);
  const { notify } = useNotifications();
  // Count requests are sequenced so a slow response from an older page cannot
  // overwrite a newer count after a module has been marked read.
  const countSequenceRef = useRef(0);
  const countUserRef = useRef(null);
  const notificationSequenceRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const markedPageRef = useRef(null);

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

  const refreshSidebarCounts = useCallback(async () => {
    if (!user) return {};
    const scope = String(user.id);
    const sequence = ++countSequenceRef.current;
    countUserRef.current = scope;
    try {
      const counts = await fetchSidebarCounts();
      if (sequence !== countSequenceRef.current || countUserRef.current !== scope) return {};
      setSidebarCounts(counts);
      return counts;
    } catch {
      // Keep the last known counts when a transient refresh fails.
      return {};
    }
  }, [user]);

  // The notification dropdown is refreshed independently of page data so a new
  // notice appears without a page reload. The sequence prevents an older
  // response from replacing a newer read/dismiss state.
  const refreshNotifications = useCallback(async () => {
    if (!user) return [];
    const sequence = ++notificationSequenceRef.current;
    try {
      const result = await api('/notifications?limit=50');
      const notifications = result.notifications || [];
      if (sequence !== notificationSequenceRef.current) return [];
      setData((current) => ({ ...current, notifications }));
      return notifications;
    } catch {
      return [];
    }
  }, [user]);

  const downloadMessageAttachment = useCallback(async (id, fileName) => {
    const blob = await apiBlob(`/messages/attachments/${id}`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `attachment-${id}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  // No WebSocket/SSE transport exists in this project, so badges and the
  // notification dropdown use grouped requests on mount, after mutations, on
  // focus, and every 20 seconds. This avoids stale counts or dropdown content.
  useEffect(() => {
    if (!user) {
      setSidebarCounts({});
      return undefined;
    }
    void refreshSidebarCounts();
    void refreshNotifications();
    const interval = window.setInterval(() => {
      void refreshSidebarCounts();
      void refreshNotifications();
    }, 20000);
    const onFocus = () => {
      void refreshSidebarCounts();
      void refreshNotifications();
    };
    const onVisibility = () => {
      if (!document.hidden) {
        void refreshSidebarCounts();
        void refreshNotifications();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refreshSidebarCounts, refreshNotifications]);

  const loadData = useCallback(async () => {
    if (!user || !portal) return;
    const loadToken = ++loadSequenceRef.current;
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
          goodsReceipts, grnSuppliers, invoices, storeRequests, notifications, committee,
          receivedRequestStats, rfqStats
        ] = await Promise.all([
          activePage === 'Overview' ? api('/dashboard') : Promise.resolve(null),
          api(filtered('/requisitions')),
          canAccessPage(user.role, RECEIVED_REQUESTS_PAGE)
            ? api(filtered('/procurement/received-requests?page=1&limit=10'))
            : Promise.resolve({ requisitions: [] }),
          api('/inventory'), api(filtered('/suppliers')),
          api(filtered('/rfqs')), api(filtered('/purchase-orders')), api(filtered('/goods-receipts')),
          canAccessPage(user.role, 'Goods receipts')
            ? api('/goods-receipts/sent-suppliers')
            : Promise.resolve({ sentSuppliers: [] }),
          api(filtered('/invoices')), api(filtered('/store-requests')), api('/notifications'),
          canAccessPage(user.role, PROCUREMENT_COMMITTEE_PAGE)
            ? api('/procurement-committee')
            : Promise.resolve({ members: [] }),
          activePage === 'Overview' && canAccessPage(user.role, RECEIVED_REQUESTS_PAGE)
            ? api('/procurement/received-requests/stats')
            : Promise.resolve(null),
          activePage === 'Overview' && canAccessPage(user.role, 'RFQs')
            ? api('/rfqs/stats')
            : Promise.resolve(null)
        ]);
        // Account and Department administration is Administrator-only.
        // Audit history remains in the backend; the Administrator UI no longer
        // loads or displays it.
        const adminOnly = user.role === 'admin';
        const [users, departments] = adminOnly
          ? await Promise.all([api(filtered('/admin/users')), api('/admin/departments')])
          : [{ users: [] }, { departments: [] }];
        const conversations = activePage === 'Messages' && canAccessPage(user.role, 'Messages')
          ? await api('/messages/conversations')
          : null;
        let movements = [];
        if (activePage === 'Stock movements' && ['admin', 'procurement', 'storekeeper'].includes(user.role)) {
          movements = (await api(filtered('/inventory/movements'))).movements;
        }
        // Preserve locally loaded quotations across data refreshes. The admin
        // bootstrap does not include them; replacing the whole object used to
        // leave RfqsPage with quotations === undefined after creating an RFQ.
        setData((current) => ({
          ...current,
          dashboard: dashboard
            ? {
                ...dashboard,
                receivedRequests: receivedRequestStats?.stats || null,
                rfqs: rfqStats?.stats || null
              }
            : current.dashboard,
          requisitions: requisitions.requisitions || [],
          receivedRequests: receivedRequests.requisitions || [],
          items: inventory.items || [],
          suppliers: suppliers.suppliers || [], rfqs: rfqs.rfqs || [],
          purchaseOrders: purchaseOrders.purchaseOrders || [],
          goodsReceipts: goodsReceipts.goodsReceipts || [],
          grnSuppliers: grnSuppliers.sentSuppliers || [],
          invoices: invoices.invoices || [],
          storeRequests: storeRequests.storeRequests || [], notifications: notifications.notifications || [],
          committeeMembers: committee.members || [],
          users: users.users || [], departments: departments.departments || [],
          quotations: current.quotations || [],
          movements, portalSummary: null,
          portalExtras: conversations ? { conversations } : null
        }));
      } else {
        const [summary, notifications, portalExtras] = await Promise.all([
          api(`/portal/${portal}/summary`),
          api('/notifications'),
          loadPortalExtras(portal, activePage).catch(() => null)
        ]);
        setData({ ...initialData, portalSummary: summary, notifications: notifications.notifications, portalExtras });
      }

      // Only a successful page/data load can clear a module's unread badge.
      // A reload caused by an unrelated mutation does not clear a badge that
      // arrived while the user was already on this page.
      const markedPage = `${user.id}:${activePage}`;
      if (loadToken === loadSequenceRef.current
        && markedPageRef.current !== markedPage
        && shouldMarkModuleOnOpen(activePage)
        && canAccessPage(user.role, activePage)) {
        markedPageRef.current = markedPage;
        try {
          await markModuleNotificationsRead(activePage);
        } catch {
          if (markedPageRef.current === markedPage) markedPageRef.current = null;
        }
      }
      if (loadToken === loadSequenceRef.current) await refreshSidebarCounts();
    } catch (exception) {
      setError(exception.message);
      if (!localStorage.getItem('pims-token')) setUser(null);
    } finally {
      setLoading(false);
    }
  }, [activePage, activeFilter, portal, user, refreshSidebarCounts]);

  useEffect(() => {
    if (user && portal) loadData();
  }, [user, portal, loadData]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api('/admin/settings')
      .then((result) => {
        const settings = result.settings || {};
        localStorage.setItem('pims-currency', 'RWF');
        localStorage.setItem('pims-currency-precision', String(settings.decimal_precision ?? 2));
        localStorage.setItem('pims-tax-rate', String(settings.tax_rate ?? 0));
        localStorage.setItem('pims-date-format', settings.date_format || 'DD/MM/YYYY');
        localStorage.setItem('pims-time-format', settings.time_format || '24');
        localStorage.setItem('pims-timezone', settings.timezone || 'Africa/Kigali');
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
    countSequenceRef.current += 1;
    countUserRef.current = null;
    loadSequenceRef.current += 1;
    markedPageRef.current = null;
    setUser(null);
    setData(initialData);
    setSidebarCounts({});
    setRoute({ portal: null, page: null, query: {} });
    setNotificationsOpen(false);
    setMobileNav(false);
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }

  // Profile changes are applied to the authenticated user in memory so every
  // sidebar/header avatar and account menu updates without a new login.
  const applyProfileUpdate = useCallback((updated) => {
    setUser((current) => {
      const merged = { ...(current || {}), ...updated };
      return {
        ...merged,
        initials: initialsFor(merged.name) || 'HH',
        roleLabel: merged.roleLabel || roleLabel(merged.role)
      };
    });
  }, []);

  const mutate = useCallback(async (path, body, method = 'POST') => {
    const result = await request(path, body, method);
    if (result?.message) {
      notify({ type: 'success', title: 'Operation completed', message: result.message, module: pageLabelForPath(path) });
    }
    await loadData();
    return result;
  }, [loadData, notify]);

  // Callbacks used by Requester / Supervisor pages. Every mutation reloads the
  // portal data so summaries, lists and unread counts stay in sync.
  const portalApi = useMemo(() => {
    const post = async (path, body) => {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      if (result?.message) {
        notify({ type: 'success', title: 'Operation completed', message: result.message, module: pageLabelForPath(path) });
      }
      await loadData();
      return result;
    };
    const patch = async (path, body) => {
      const result = await api(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
      if (result?.message) {
        notify({ type: 'success', title: 'Operation completed', message: result.message, module: pageLabelForPath(path) });
      }
      await loadData();
      return result;
    };
    return {
      reload: async () => {
        await loadData();
        await refreshSidebarCounts();
        await refreshNotifications();
      },
      navigate: (page, query) => go(portal, page, query),
      getRequesterRequests: (params = {}) => api(`/portal/requester/requisitions${toQuery(params)}`),
      getRequesterRequest: (id) => api(`/portal/requester/requisitions/${id}`),
      createRequesterRequest: (payload) => post('/portal/requester/requisitions', payload),
      updateRequesterRequest: (id, payload) => patch(`/portal/requester/requisitions/${id}`, payload),
      submitRequesterRequest: (id, payload = {}) => post(`/portal/requester/requisitions/${id}/submit`, payload),
      resubmitRequesterRequest: (id, payload = {}) => post(`/portal/requester/requisitions/${id}/resubmit`, payload),
      getSupervisorRequests: (params = {}) => api(`/portal/supervisor/requisitions${toQuery(params)}`),
      getSupervisorRequest: (id) => api(`/portal/supervisor/requisitions/${id}`),
      decideRequest: (id, payload) => post(`/portal/supervisor/requisitions/${id}/decision`, payload),
      forwardRequest: (id) => post(`/portal/supervisor/requisitions/${id}/forward`),
      routeRequest: (id, payload) => post(`/portal/supervisor/requisitions/${id}/route`, payload),
      routeShortage: (id, payload) => post(`/portal/supervisor/requisitions/${id}/route-return`, payload),
      getRequesters: async () => api('/portal/supervisor/requesters'),
      getDepartmentUsers: async () => api('/portal/supervisor/department-users'),
      getDepartments: async () => api('/procurement/departments'),
      getReceivedRequests: (params = {}) => api(`/procurement/received-requests${toQuery(params)}`),
      getReceivedRequestStats: () => api('/procurement/received-requests/stats'),
      getReceivedRequest: (id) => api(`/procurement/received-requests/${id}`),
      reviewReceivedRequest: (id) => post(`/procurement/received-requests/${id}/review`),
      sendEmail: (payload) => api('/email/send', { method: 'POST', body: JSON.stringify(payload) }),
      sendRequisitionEmail: (id, payload) => api(`/email/requisitions/${id}/send`, { method: 'POST', body: JSON.stringify(payload) }),
      getRequisitionForms: (id) => api(`/email/requisitions/${id}/forms`),
      resendRequisitionForm: (id, threadId) => mutate(`/email/requisitions/${id}/forms/${threadId}/resend`, {}),
      syncEmailInbox: () => api('/email/inbox/sync', { method: 'POST', body: '{}' }),
      getStock: (params = {}) => api(`/portal/supervisor/stock${toQuery(params)}`),
      getStockItem: (id) => api(`/portal/supervisor/stock/${id}`),
      getConversations: (params = {}) => api(`/messages/conversations${toQuery(params)}`),
      getThread: async ({ userId, announcementId, ...params } = {}) => {
        const result = await api(`/messages/thread${toQuery({
          ...(userId ? { userId } : {}),
          ...(announcementId ? { announcementId } : {}),
          ...params
        })}`);
        await refreshSidebarCounts();
        return result;
      },
      sendMessage: (payload) => post('/messages', payload),
      markMessageRead: async (id) => {
        const result = await api(`/messages/${id}/read`, { method: 'PATCH' });
        await refreshSidebarCounts();
        return result;
      },
      refreshMessageCounts: refreshSidebarCounts,
      downloadMessageAttachment,
      getNotifications: async (params = {}) => (await api(`/notifications${toQuery(params)}`)).notifications,
      markNotificationRead: async (id) => {
        const result = await api(`/notifications/${id}/read`, { method: 'PATCH' });
        await refreshSidebarCounts();
        return result;
      },
      markAllNotificationsRead: async () => {
        const updated = await requestMarkAllNotificationsRead();
        await refreshSidebarCounts();
        return { updated };
      },
      deleteNotification: async (id) => {
        const result = await api(`/notifications/${id}`, { method: 'DELETE' });
        await refreshSidebarCounts();
        return result;
      },
      getStockItems: (params = {}) => api(`/portal/stockkeeper/items${toQuery(params)}`),
      getBinCard: (id) => api(`/portal/stockkeeper/items/${id}`),
      getStockOverview: (params = {}) => api(`/portal/stockkeeper/stock-overview${toQuery(params)}`),
      updateStockLocation: (id, payload) => patch(`/portal/stockkeeper/items/${id}/location`, payload),
      getIssueRequests: () => api('/portal/stockkeeper/issue-requests'),
      getPurchaseOrderDeliveries: (params = {}) => api(`/portal/stockkeeper/deliveries${toQuery(params)}`),
      acceptPurchaseOrderDelivery: async (id, payload) => {
        const result = await post(`/portal/stockkeeper/deliveries/${id}/accept`, payload);
        await refreshSidebarCounts();
        return result;
      },
      rejectPurchaseOrderDelivery: async (id, payload) => {
        const result = await post(`/portal/stockkeeper/deliveries/${id}/reject`, payload);
        await refreshSidebarCounts();
        return result;
      },
      getRoutedRequests: () => api('/portal/stockkeeper/routed-requests'),
      getRoutedRequest: (id) => api(`/portal/stockkeeper/routed-requests/${id}`),
      reportStockShortage: (id, payload) => post(`/portal/stockkeeper/routed-requests/${id}/return-shortage`, payload),
      decideStockRequest: (id, payload) => post(`/portal/stockkeeper/requests/${id}/decision`, payload),
      issueStock: (payload) => post('/portal/stockkeeper/transactions/stock-out', payload),
      issueRequest: (id, payload) => post(`/portal/stockkeeper/requests/${id}/issue`, payload),
      getStockKeeperRequesters: (params = {}) => api(`/portal/stockkeeper/requesters${toQuery(params)}`),
      getRequesterDetails: (id) => api(`/portal/stockkeeper/requesters/${id}`),
      getRequesterHistory: (id, params = {}) => api(`/portal/stockkeeper/requesters/${id}/history${toQuery(params)}`),
      getExpectedDeliveries: () => api('/portal/stockkeeper/expected-deliveries'),
      getExpectedDelivery: (id) => api(`/portal/stockkeeper/expected-deliveries/${id}`),
      receiveAll: (id, payload) => post(`/portal/stockkeeper/expected-deliveries/${id}/receive-all`, payload),
      receiveItems: (id, payload) => post(`/portal/stockkeeper/expected-deliveries/${id}/receive-items`, payload),
      getInventoryReport: (params = {}) => api(`/portal/stockkeeper/inventory-report${toQuery(params)}`),
      stockIn: (payload) => post('/portal/stockkeeper/transactions/stock-in', payload),
      stockOut: (payload) => post('/portal/stockkeeper/transactions/stock-out', payload),
      stockAdjustment: (payload) => post('/portal/stockkeeper/transactions/adjustment', payload)
    };
  }, [downloadMessageAttachment, loadData, notify, portal, refreshNotifications, refreshSidebarCounts]);

  const patchNotificationState = useCallback((updater) => {
    setData((current) => ({
      ...current,
      notifications: updater(Array.isArray(current.notifications) ? current.notifications : [])
    }));
  }, []);

  const markNotificationRead = useCallback(async (id) => {
    setNotificationBusy(true);
    try {
      await portalApi.markNotificationRead(id);
      patchNotificationState((items) => items.map((item) => item.id === id ? { ...item, isRead: true } : item));
    } finally {
      setNotificationBusy(false);
    }
  }, [patchNotificationState, portalApi]);

  const markAllNotificationsRead = useCallback(async () => {
    setNotificationBusy(true);
    try {
      await portalApi.markAllNotificationsRead();
      patchNotificationState((items) => items.map((item) => ({ ...item, isRead: true })));
    } finally {
      setNotificationBusy(false);
    }
  }, [patchNotificationState, portalApi]);

  const deleteNotification = useCallback(async (id) => {
    setNotificationBusy(true);
    try {
      await portalApi.deleteNotification(id);
      patchNotificationState((items) => items.filter((item) => item.id !== id));
    } finally {
      setNotificationBusy(false);
    }
  }, [patchNotificationState, portalApi]);

  const viewAllNotifications = useCallback(() => {
    go(activePortal, 'Notifications');
    setNotificationsOpen(false);
  }, [activePortal]);

  async function loadQuotations(rfqId) {
    const result = await api(`/rfqs/${rfqId}/quotations`);
    setData((current) => ({ ...current, quotations: result.quotations }));
    return result;
  }

  async function openNotification(notification) {
    try {
      const link = notification.link || '';
      // A message notification is not the message itself. Navigation to the
      // conversation must leave it unread until that message is actually opened.
      const isMessageNotice = notification.category === 'message' || link.includes('message=');
      if (!isMessageNotice) {
        await api(`/notifications/${notification.id}/read`, { method: 'PATCH' });
        setData((current) => ({
          ...current,
          notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, isRead: true } : item)
        }));
      }
      await refreshSidebarCounts();
      setNotificationsOpen(false);

      const parsed = parseRoute(link);
      if (canonicalPage(parsed.page) === RECEIVED_REQUESTS_PAGE && canAccessPage(user.role, RECEIVED_REQUESTS_PAGE)) {
        go('admin', RECEIVED_REQUESTS_PAGE, { view: parsed.query.request });
        void loadData();
        return;
      }
      const routedDestination = canonicalPage(parsed.page) || defaultPageForPortal(parsed.portal);
      if (parsed.portal && parsed.portal !== 'admin' && canAccessPage(user.role, routedDestination)) {
        go(parsed.portal, routedDestination, parsed.query);
        void loadData();
        return;
      }
      if (portal !== 'admin') {
        go(portal, 'Notifications');
        void loadData();
        return;
      }
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
      const parsedDestination = parsed.page ? canonicalPage(parsed.page) : null;
      const destination = parsedDestination && canAccessPage(user.role, parsedDestination) ? parsedDestination
        : link.includes('rfq') ? 'RFQs'
          : link.includes('purchase') ? RECEIVED_REQUESTS_PAGE
            : link.includes('invoice') ? 'Invoices'
              : link.includes('store') ? 'Store requests'
                : link.includes('inventory') ? 'Stock movements' : RECEIVED_REQUESTS_PAGE;
      const safeDestination = canAccessPage(user.role, destination) ? destination
        : canAccessPage(user.role, RECEIVED_REQUESTS_PAGE) ? RECEIVED_REQUESTS_PAGE : 'Overview';
      go('admin', safeDestination, parsed.query);
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

  // Signed Supplier links and requisition response links are public and must
  // not be blocked by the staff session checks below. Each token authorizes
  // exactly one Supplier RFQ or one requisition response form.
  if (activePortal === PORTALS.SUPPLIER) {
    return <ErrorBoundary key="supplier-rfq"><SupplierRfqPage token={route.query?.token || ''} /></ErrorBoundary>;
  }
  if (activePortal === PORTALS.RESPONSE) {
    return <ErrorBoundary key="request-response"><RequestResponsePage token={route.query?.token || ''} /></ErrorBoundary>;
  }
  if (activePortal === PORTALS.COMMITTEE_REVIEW) {
    return <ErrorBoundary key="committee-review"><CommitteeReviewPage token={route.query?.token || ''} /></ErrorBoundary>;
  }

  // Supplier pricing links are public. The signed token authorizes exactly one
  // purchase order pricing response, so no staff session or portal page check
  // may stand in front of this page.
  if (activePortal === PORTALS.SUPPLIER_PRICING) {
    return <ErrorBoundary key="supplier-pricing"><SupplierPricingPage token={route.query?.token || ''} /></ErrorBoundary>;
  }

  // The Purchase Order approval link is also reachable without dashboard
  // navigation. The backend still requires the intended signed-in recipient
  // before the document is revealed or a decision is accepted.
  if (activePortal === PORTALS.PURCHASE_ORDER_APPROVAL) {
    return <ErrorBoundary key="purchase-order-approval"><PurchaseOrderApprovalPage token={route.query?.token || ''} /></ErrorBoundary>;
  }

  if (authLoading) return <main className="grid min-h-screen place-items-center bg-canvas">
    <div role="status" className="flex flex-col items-center gap-4">
      <span className="text-sm text-black">Loading your workspace…</span>
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
    onNavigate: (nextPage, nextQuery) => go('admin', nextPage, nextQuery),
    onProfileUpdated: applyProfileUpdate,
    onRefresh: loadData,
    onCreateRequisition: (form) => mutate('/requisitions', form),
    onRequisitionDecision: (id, decision) => mutate(`/requisitions/${id}/decision`, { decision }, 'PATCH'),
    onAddItem: (form) => mutate('/inventory/items', form),
    onCreateSupplierGRN: (form) => mutate('/goods-receipts/from-supplier', form),
    onSupplierDecision: (purchaseOrderId, decision, reason) =>
      mutate('/goods-receipts/supplier-decision', { purchaseOrderId, decision, reason }),
    onCreateSupplier: (form) => mutate('/suppliers', form),
    onUpdateSupplier: (id, form) => mutate(`/suppliers/${id}`, form, 'PATCH'),
    onDeleteSupplier: (id) => mutate(`/suppliers/${id}`, {}, 'DELETE'),
    onCreateCommitteeMember: (form) => mutate('/procurement-committee', form),
    onUpdateCommitteeMember: (id, form) => mutate(`/procurement-committee/${id}`, form, 'PATCH'),
    onDeleteCommitteeMember: (id) => mutate(`/procurement-committee/${id}`, {}, 'DELETE'),
    onCreateRFQ: (form) => mutate('/rfqs', form),
    onSendRfqToCommittee: (payload) => mutate('/rfqs/send-to-committee', payload),
    onPreviewCommittee: (rfqIds) => api(`/rfqs/committee-preview?rfqIds=${rfqIds.map(encodeURIComponent).join(',')}`),
    onLoadCommitteeReviews: (rfqId) => api(`/rfqs/${rfqId}/committee-reviews`),
    onLoadCommitteeRecommendations: () => api('/committee-recommendations'),
    onResendCommitteeReview: (rfqId, reviewId) => mutate(`/rfqs/${rfqId}/committee-reviews/${reviewId}/resend`, {}),
    onLoadEmailDeliveries: (rfqId) => api(`/rfqs/${rfqId}/email-deliveries`),
    onRetryFailedEmails: (rfqId) => mutate(`/rfqs/${rfqId}/emails/retry-failed`, {}),
    onResendRfqEmail: (rfqId, deliveryId) => mutate(`/rfqs/${rfqId}/email-deliveries/${deliveryId}/resend`, {}),
    getEmailStatus: () => api('/email/google/status'),
    getEmailConnectUrl: () => api('/email/google/connect'),
    disconnectGoogleEmail: () => mutate('/email/google/disconnect', {}),
    getInboxMessages: () => api('/email/inbox/messages'),
    getInboxMessage: (id) => api(`/email/inbox/messages/${encodeURIComponent(id)}`),
    markEmailRead: async (id) => {
      const result = await api(`/email/inbox/messages/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
      await refreshSidebarCounts();
      return result;
    },
    syncInbox: () => mutate('/email/inbox/sync', {}),
    sendEmail: (message) => mutate('/email/send', message),
    listRfqs: (params = {}) => api(`/rfqs${toQuery(params)}`),
    getRfqStats: () => api('/rfqs/stats'),
    getRfqDetail: (rfqId) => api(`/rfqs/${rfqId}`),
    onUpdateRFQ: (rfqId, form) => mutate(`/rfqs/${rfqId}`, form, 'PATCH'),
    onDeleteRFQ: (rfqId) => mutate(`/rfqs/${rfqId}`, {}, 'DELETE'),
    onSendRFQ: (rfqId) => mutate(`/rfqs/${rfqId}/send`, {}),
    onCloseRFQ: (rfqId) => mutate(`/rfqs/${rfqId}/close`, {}),
    onLoadQuotes: loadQuotations,
    onQuote: (id, form) => mutate(`/rfqs/${id}/quotations`, form),
    onAward: (id, quotationId) => mutate(`/rfqs/${id}/award`, { quotationId }),
    onCreatePO: (form) => mutate('/purchase-orders', form),
    getPurchaseOrder: (id) => api(`/purchase-orders/${id}`),
    updatePurchaseOrder: (id, form) => mutate(`/purchase-orders/${id}`, form, 'PATCH'),
    savePurchaseOrderSignatures: (id, form) => mutate(`/purchase-orders/${id}/signatures`, form, 'PATCH'),
    getPurchaseOrderApprovers: () => api('/purchase-orders/approvers'),
    sendPurchaseOrderForApproval: (id, form) => mutate(`/purchase-orders/${id}/send-for-approval`, form),
    revokePurchaseOrderApproval: (id, approvalId) => mutate(`/purchase-orders/${id}/approvals/${approvalId}/revoke`, {}, 'PATCH'),
    sendPurchaseOrderToSuppliers: (id, form) => mutate(`/purchase-orders/${id}/send-to-suppliers`, form),
    sendPurchaseOrderToSupplier: (id, form = {}) => mutate(`/purchase-orders/${id}/send-to-supplier`, form),
    getPurchaseOrderSupplierResponses: (id) => api(`/purchase-orders/${id}/supplier-responses`),
    getSupplierQuoteComparison: (requestId) => api(`/purchase-order-pricing/requests/${requestId}/comparison`),
    revokeSupplierPricingResponse: (id) => mutate(`/purchase-order-pricing/responses/${id}/revoke`, {}, 'PATCH'),
    retrySupplierPricingEmails: (requestId) => mutate(`/purchase-order-pricing/requests/${requestId}/deliveries/retry-failed`, {}),
    awardSupplierPricingResponse: (requestId, form) => mutate(`/purchase-order-pricing/requests/${requestId}/award`, form),
    updateRequesterRequest: (id, form) => mutate(`/portal/requester/requisitions/${id}`, form, 'PATCH'),
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

  const dashboardPage = portal === 'supervisor' ? 'Supervisor Dashboard'
    : portal === 'requester' ? 'Requester Dashboard' : 'Dashboard';
  const shellProps = {
    user: displayUser,
    page: activePage,
    hidePageHeading: portal === 'requester' && (activePage === dashboardPage
      || activePage === 'My Procurement Requests' || activePage === 'My Request History'),
    counts: sidebarCounts,
    notifications: data.notifications,
    refreshing: loading,
    mobileNav,
    notificationsOpen,
    onNavigate: (nextPage, nextQuery) => go(activePortal, nextPage, nextQuery),
    onNotification: openNotification,
    onToggleNotifications: (next) => setNotificationsOpen(typeof next === 'boolean' ? next : !notificationsOpen),
    onMarkNotificationRead: markNotificationRead,
    onMarkAllNotificationsRead: markAllNotificationsRead,
    onDeleteNotification: deleteNotification,
    onViewAllNotifications: viewAllNotifications,
    notificationBusy,
    onOpenMenu: () => setMobileNav(true),
    onCloseMenu: () => setMobileNav(false),
    onLogout: logout,
    onRefresh: loadData
  };

  const alert = error && activePage !== 'Overview' && <div role="alert" className="mb-5 flex items-center justify-between rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">
    <span>{error}</span><button onClick={loadData} className="font-bold underline">Retry</button>
  </div>;
  const showGenericPageSearch = activePage !== 'Overview'
    && activePage !== RECEIVED_REQUESTS_PAGE
    && activePage !== 'RFQs'
    && activePage !== 'Purchase orders'
    && activePage !== 'Goods receipts'
    && activePage !== 'Invoices'
    && activePage !== 'Messages'
    && activePage !== 'Stock movements'
    && activePage !== 'Store requests'
    && activePage !== 'Users'
    && activePage !== PROFILE_PAGE;

  if (portal === 'admin') {
    return <AdminLayout {...shellProps}>
      {showGenericPageSearch && <div className="mb-4 flex items-center justify-between gap-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activePage === 'Suppliers' ? 'Search suppliers…' : activePage === 'Stock overview' ? 'Search inventory…' : 'Search this page…'} className="field max-w-xs bg-white" />
        {loading && <span className="text-xs text-black">Refreshing…</span>}
      </div>}
      {activePage === 'RFQs' && loading && <div className="mb-4 text-xs text-black">Refreshing…</div>}
      {alert}
      <ErrorBoundary key={`${activePortal}-${activePage}`} onRetry={loadData} onLogout={logout}>
        <PageContent
          page={activePage}
          data={{ ...data, user, search, error }}
          query={route.query || {}}
          actions={actions}
          portalApi={portalApi}
          getPurchaseOrder={actions.getPurchaseOrder}
          updatePurchaseOrder={actions.updatePurchaseOrder}
          loading={loading}
          counts={sidebarCounts}
          onOpenNotification={openNotification}
          navigate={(nextPage, nextQuery) => go('admin', nextPage, nextQuery)}
          dateFilter={activeFilter}
          onDateFilterChange={setDateFilter}
        />
      </ErrorBoundary>
    </AdminLayout>;
  }

  const PortalShell = portal === 'supervisor' ? SupervisorLayout
    : portal === 'requester' ? RequesterLayout : StockKeeperLayout;
  const extras = data.portalExtras || {};
  const navigatePage = (page, query) => go(portal, page, query);
  let portalContent;

  if (activePage === dashboardPage) {
    if (portal === 'requester') {
      portalContent = <RequesterDashboard
        user={displayUser}
        summary={data.portalSummary}
        notifications={data.notifications}
        onNavigate={navigatePage}
        onOpenNotification={openNotification}
        portalApi={portalApi}
        initialRequests={extras.requesterRequests}
      />;
    } else if (portal === 'stockkeeper') {
      portalContent = <StockKeeperDashboard summary={data.portalSummary} notifications={data.notifications} onNavigate={navigatePage} />;
    } else {
      portalContent = <RoleBasedDashboard
        portal={portal}
        user={displayUser}
        summary={data.portalSummary}
        notifications={data.notifications}
        onNavigate={navigatePage}
        onOpenNotification={openNotification}
        portalApi={portalApi}
      />;
    }
  } else if (portal === 'stockkeeper') {
    const stockLoader = (label) => <div role="status" className="p-8 text-sm text-black">Loading {label}…</div>;
    if (activePage === 'Requests from Supervisors') {
      portalContent = <Suspense fallback={stockLoader('Supervisor requests')}>
        <StockKeeperSupervisorRequests
          portalApi={portalApi}
          query={route.query || {}}
          initial={extras.routedRequests}
          user={displayUser}
        />
      </Suspense>;
    } else if (activePage === 'Stock Overview') {
      portalContent = <Suspense fallback={stockLoader('stock overview')}>
        <StockKeeperStockOverview portalApi={portalApi} />
      </Suspense>;
    } else if (activePage === 'Stock In') {
      portalContent = <Suspense fallback={stockLoader('expected deliveries')}>
        <StockKeeperStockIn portalApi={portalApi} query={route.query || {}} initial={extras.expectedDeliveries} />
      </Suspense>;
    } else if (activePage === 'Stock Out') {
      portalContent = <Suspense fallback={stockLoader('accepted requests')}>
        <StockKeeperStockOut portalApi={portalApi} initial={extras.issueRequests} />
      </Suspense>;
    } else if (activePage === 'Inventory Reports') {
      portalContent = <Suspense fallback={stockLoader('inventory reports')}>
        <StockKeeperInventoryReports portalApi={portalApi} user={displayUser} department={displayUser?.departmentName || displayUser?.department || ''} />
      </Suspense>;
    } else if (activePage === 'Messages') {
      portalContent = <PortalMessages
        portal="stockkeeper"
        portalApi={portalApi}
        query={route.query || {}}
        userId={user?.id}
        navigate={navigatePage}
        initial={extras.conversations}
      />;
    } else if (activePage === 'Notifications') {
      portalContent = <StockKeeperNotifications
        notifications={data.notifications}
        counts={sidebarCounts}
        portalApi={portalApi}
        onOpenNotification={openNotification}
        navigate={navigatePage}
      />;
    } else if (activePage === 'Display before delivery') {
      portalContent = <StockKeeperDisplayBeforeDelivery portalApi={portalApi} />;
    } else if (activePage === 'Bin Card') {
      portalContent = <StockKeeperBinCards
        portalApi={portalApi}
        initialItems={extras.stockItems}
        query={route.query || {}}
        navigate={navigatePage}
        user={displayUser}
      />;
    } else if (activePage === 'Profile') {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} onUpdated={applyProfileUpdate} />;
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
        user={displayUser}
        summary={data.portalSummary}
      />;
    } else if (activePage === 'Create Purchase Request') {
      portalContent = <CreatePurchaseRequest portalApi={portalApi} query={route.query || {}} navigate={navigatePage} user={displayUser} />;
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
        counts={sidebarCounts}
        portalApi={portalApi}
        onOpenNotification={openNotification}
        navigate={navigatePage}
      />;
    } else if (activePage === PROFILE_PAGE) {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} onUpdated={applyProfileUpdate} />;
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
      portalContent = <SupervisorRequesters portalApi={portalApi} navigate={navigatePage} user={displayUser} />;
    } else if (activePage === 'Procurement Requests') {
      portalContent = <SupervisorRequests portalApi={portalApi} query={route.query || {}} navigate={navigatePage} initial={extras.supervisorRequests} user={displayUser} />;
    } else if (activePage === 'Approvals') {
      portalContent = <SupervisorApprovals portalApi={portalApi} query={route.query || {}} navigate={navigatePage} initial={extras.approvalRequests} user={displayUser} />;
    } else if (activePage === 'Stock Overview') {
      portalContent = <SupervisorStock portalApi={portalApi} initial={extras.stock} user={displayUser} />;
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
        counts={sidebarCounts}
        portalApi={portalApi}
        onOpenNotification={openNotification}
        navigate={navigatePage}
      />;
    } else if (activePage === PROFILE_PAGE) {
      portalContent = <PortalProfile user={displayUser} summary={data.portalSummary} portal={portal} onUpdated={applyProfileUpdate} />;
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

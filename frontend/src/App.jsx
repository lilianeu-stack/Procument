import { useCallback, useEffect, useMemo, useState } from 'react';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PageContent from './pages/PageContent.jsx';
import { api } from './services/api.js';
import { canAccessPage } from './utils/access.js';

const initialData = {
  dashboard: null,
  requisitions: [],
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
  auditLogs: [],
  notifications: []
};

function request(path, body, method = 'POST') {
  return api(path, { method, body: JSON.stringify(body) });
}

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('Overview');
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [
        dashboard, requisitions, inventory, suppliers, rfqs, purchaseOrders,
        goodsReceipts, invoices, storeRequests, notifications
      ] = await Promise.all([
        api('/dashboard'), api('/requisitions'), api('/inventory'), api('/suppliers'),
        api('/rfqs'), api('/purchase-orders'), api('/goods-receipts'), api('/invoices'),
        api('/store-requests'), api('/notifications')
      ]);
      let administration = { users: [], departments: [], auditLogs: [] };
      if (user.role === 'admin') {
        const [users, departments, auditLogs] = await Promise.all([
          api('/admin/users'), api('/admin/departments'), api('/admin/audit-logs')
        ]);
        administration = { users: users.users, departments: departments.departments, auditLogs: auditLogs.logs };
      }
      let movements = [];
      if (page === 'Stock movements' && ['admin', 'procurement', 'storekeeper'].includes(user.role)) {
        movements = (await api('/inventory/movements')).movements;
      }
      setData({
        dashboard, requisitions: requisitions.requisitions, items: inventory.items,
        suppliers: suppliers.suppliers, rfqs: rfqs.rfqs, purchaseOrders: purchaseOrders.purchaseOrders,
        goodsReceipts: goodsReceipts.goodsReceipts, invoices: invoices.invoices,
        storeRequests: storeRequests.storeRequests, notifications: notifications.notifications,
        movements, ...administration
      });
    } catch (exception) {
      setError(exception.message);
      if (!localStorage.getItem('pims-token')) setUser(null);
    } finally {
      setLoading(false);
    }
  }, [page, user]);

  useEffect(() => {
    const token = localStorage.getItem('pims-token');
    if (!token) return;
    api('/auth/me').then((result) => setUser(result.user)).catch(() => localStorage.removeItem('pims-token'));
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  useEffect(() => {
    if (user && !canAccessPage(user.role, page)) setPage('Overview');
  }, [user, page]);

  async function login(email, password) {
    const result = await request('/auth/login', { email, password });
    localStorage.setItem('pims-token', result.token);
    setData(initialData);
    setUser(result.user);
  }

  function logout() {
    localStorage.removeItem('pims-token');
    setUser(null);
    setPage('Overview');
    setData(initialData);
  }

  const mutate = useCallback(async (path, body, method = 'POST') => {
    const result = await request(path, body, method);
    await loadData();
    return result;
  }, [loadData]);

  async function loadQuotations(rfqId) {
    const result = await api(`/rfqs/${rfqId}/quotations`);
    setData((current) => ({ ...current, quotations: result.quotations }));
  }

  async function openNotification(notification) {
    try {
      await mutate(`/notifications/${notification.id}/read`, {}, 'PATCH');
      setNotificationsOpen(false);
      const link = notification.link || '';
      const destination = link.includes('rfq') ? 'RFQs'
        : link.includes('purchase') ? 'Purchase orders'
          : link.includes('invoice') ? 'Invoices'
            : link.includes('store') ? 'Store requests'
              : link.includes('inventory') ? 'Stock movements'
                : link.includes('approval') ? 'Approvals' : 'Requisitions';
      if (canAccessPage(user.role, destination)) setPage(destination);
    } catch (exception) {
      setError(exception.message);
    }
  }

  const initials = useMemo(() => user?.name?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'HH', [user]);
  const displayUser = user ? { ...user, initials } : null;

  if (!user) return <LoginPage onLogin={login} />;

  const actions = {
    onNavigate: setPage,
    onCreateRequisition: (form) => mutate('/requisitions', form),
    onRequisitionDecision: (id, decision) => mutate(`/requisitions/${id}/decision`, { decision }, 'PATCH'),
    onAddItem: (form) => mutate('/inventory/items', form),
    onReceive: (form) => mutate('/goods-receipts', form),
    onCreateSupplier: (form) => mutate('/suppliers', form),
    onCreateRFQ: (form) => mutate('/rfqs', form),
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
    onIssueStoreRequest: (id) => mutate(`/store-requests/${id}/issue`, {}),
    onCreateUser: (form) => mutate('/admin/users', form),
    onToggleUser: (id, active) => mutate(`/admin/users/${id}/status`, { active }, 'PATCH'),
    onCreateDepartment: (form) => mutate('/admin/departments', form)
  };

  return <AppLayout
    user={displayUser}
    page={page}
    pendingCount={Number(data.dashboard?.requisitions?.pending) || 0}
    notifications={data.notifications}
    mobileNav={mobileNav}
    notificationsOpen={notificationsOpen}
    onNavigate={(nextPage) => { setPage(nextPage); setSearch(''); }}
    onNotification={openNotification}
    onToggleNotifications={() => setNotificationsOpen((open) => !open)}
    onOpenMenu={() => setMobileNav(true)}
    onCloseMenu={() => setMobileNav(false)}
    onLogout={logout}
  >
    <div className="mb-4 flex items-center justify-between gap-3">
      {page !== 'Overview' && <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this page…" className="field max-w-xs bg-white" />}
      {loading && <span className="text-xs text-muted">Refreshing…</span>}
    </div>
    {error && <div role="alert" className="mb-5 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700"><span>{error}</span><button onClick={loadData} className="font-bold underline">Retry</button></div>}
    <PageContent
      page={page}
      data={{ ...data, user, search }}
      actions={actions}
    />
  </AppLayout>;
}

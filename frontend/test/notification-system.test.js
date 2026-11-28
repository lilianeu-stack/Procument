import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const main = read('../src/main.jsx');
const app = read('../src/App.jsx');
const provider = read('../src/notifications/NotificationProvider.jsx');
const center = read('../src/notifications/NotificationCenter.jsx');
const page = read('../src/notifications/NotificationsPage.jsx');
const apiClient = read('../src/services/api.js');
const topbar = read('../src/components/layout/Topbar.jsx');
const sharedHeader = read('../src/components/portals/SharedHeader.jsx');
const pageContent = read('../src/pages/PageContent.jsx');
const access = read('../src/utils/access.js');
const adminSidebar = read('../src/components/layout/Sidebar.jsx');
const packageJson = read('../package.json');

test('one root provider supplies notifications to every portal and public page', () => {
  assert.match(main, /<NotificationProvider>[\s\S]*<App \/>[\s\S]*<\/NotificationProvider>/);
  assert.ok(main.includes("from './notifications/NotificationProvider.jsx'"));
  assert.ok(provider.includes('<ToastViewport toasts={toasts} onDismiss={dismiss} />'));
  assert.ok(provider.includes('aria-label="System notifications"'));
  assert.ok(provider.includes('aria-live="polite"'));
  assert.ok(app.includes("import { useNotifications } from './notifications/NotificationProvider.jsx'"));
  assert.ok(app.includes('if (activePortal === PORTALS.SUPPLIER)'));
  for (const file of [
    '../src/components/portals/SupplierRfqPage.jsx',
    '../src/components/portals/SupplierPricingPage.jsx',
    '../src/components/portals/PurchaseOrderApprovalPage.jsx'
  ]) {
    assert.doesNotMatch(read(file), /NotificationCenter|useNotifications/);
  }
});

test('toast surface carries severity, icon, title, message, timestamp, module and guidance', () => {
  for (const [type, label, background] of [
    ['error', 'Error', '#FEF2F2'],
    ['warning', 'Warning', '#FFFBEB'],
    ['success', 'Success', '#F0FDF4'],
    ['information', 'Information', '#EFF6FF']
  ]) {
    assert.ok(provider.includes(`${type}: { label: '${label}'`), `missing ${type} toast metadata`);
    assert.ok(provider.includes(background), `missing ${type} surface tint`);
  }
  assert.ok(provider.includes('data-notification-type={toast.type}'));
  assert.ok(provider.includes("role={toast.type === 'error' ? 'alert' : 'status'}"));
  assert.ok(provider.includes('className="mt-px shrink-0 text-black"'));
  assert.ok(provider.includes('{toast.title}'));
  assert.ok(provider.includes('{toast.message}'));
  assert.ok(provider.includes('{toast.module ? `${toast.module} · ` : \'\'}{toast.timeLabel}'));
  assert.ok(provider.includes('{toast.recommendedAction && !toast.action'));
  assert.ok(provider.includes('{toast.action.label}'));
  assert.ok(provider.includes("month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'"));
});

test('toasts deduplicate and offline failures are queued without claiming success', () => {
  assert.ok(provider.includes("const QUEUE_KEY = 'pims-pending-notifications'"));
  assert.ok(provider.includes('const DEDUPE_WINDOW_MS = 90000'));
  assert.ok(provider.includes('if (recent && now - recent < DEDUPE_WINDOW_MS) return null;'));
  assert.ok(provider.includes('persist: offline'));
  assert.ok(provider.includes('suppressGlobalError: true'));
  assert.ok(provider.includes('void flushQueue();'));
  assert.ok(provider.includes("window.addEventListener('online', onOnline)"));
  assert.ok(provider.includes("path === '/notifications'"));
  assert.ok(provider.includes("path === '/sidebar-counts'"));
  assert.ok(provider.includes('writeQueue(queue.slice(-25));'));
});

test('API client reports network and timeout failures once with request metadata', () => {
  assert.ok(apiClient.includes('const REQUEST_TIMEOUT_MS = 20000'));
  assert.ok(apiClient.includes('const controller = new AbortController()'));
  assert.ok(apiClient.includes('function apiError(message, status, data, path, method, code)'));
  assert.ok(apiClient.includes('error.code = code'));
  assert.ok(apiClient.includes("'TIMEOUT'"));
  assert.ok(apiClient.includes("'NETWORK_ERROR'"));
  assert.ok(apiClient.includes('error.path = path'));
  assert.ok(apiClient.includes('error.method = method'));
  assert.ok(apiClient.includes('error.requestId = data?.requestId'));
  assert.ok(apiClient.includes('setApiErrorHandler'));
  assert.ok(apiClient.includes('setApiSuccessHandler'));
  assert.ok(apiClient.includes('if (options.suppressGlobalError) return;'));
  assert.ok(apiClient.includes('error.reported = true'));
});

test('both authenticated shells expose the shared notification bell and actions', () => {
  assert.ok(topbar.includes('NotificationCenter'));
  assert.ok(sharedHeader.includes('NotificationCenter'));
  assert.ok(center.includes('aria-label={`Notifications'));
  assert.ok(center.includes('aria-expanded={Boolean(open)}'));
  assert.ok(center.includes("event.key === 'Escape'"));
  assert.ok(center.includes("document.addEventListener('pointerdown', onPointerDown)"));
  assert.ok(center.includes('onMarkAllRead?.()'));
  assert.ok(center.includes('onMarkRead?.(notice.id)'));
  assert.ok(center.includes('onDelete?.(notice.id)'));
  assert.ok(center.includes('View all notifications'));
  assert.ok(center.includes('disabled={busy || !unread}'));
  for (const label of [
    "['all', 'All']", "['unread', 'Unread']", "['error', 'Errors']",
    "['warning', 'Warnings']", "['success', 'Success']", "['information', 'Information']"
  ]) {
    assert.ok(center.includes(label), `missing dropdown filter ${label}`);
  }
});

test('dropdown and full page filters render authoritative backend counts', () => {
  for (const [name, source] of [['dropdown', center], ['page', page]]) {
    assert.ok(source.includes('counts?.notificationCounts'), `${name} ignores backend counts`);
    assert.ok(source.includes("value === 'all' ? backendCounts.total"), `${name} has no total count`);
    assert.ok(source.includes("value === 'unread' ? unread : backendCounts[value]"), `${name} has no typed counts`);
    assert.ok(source.includes('filterCount(value) ?'), `${name} does not display counts`);
  }
});

test('one notification page is reachable and actionable in every authenticated portal', () => {
  assert.ok(page.includes('title="All notifications"'));
  assert.ok(page.includes('>Mark all as read'));
  assert.ok(page.includes('portalApi.markNotificationRead(notification.id)'));
  assert.ok(page.includes('portalApi.markAllNotificationsRead()'));
  assert.ok(page.includes('portalApi.deleteNotification(notification.id)'));
  assert.ok(page.includes('ErrorState'));
  assert.ok(page.includes('EmptyState'));
  assert.ok(page.includes('busyId === notification.id'));
  assert.ok(page.includes('busyAll'));
  assert.ok(page.includes('setError(exception.message'));
  assert.ok(pageContent.includes("page === 'Notifications'"));
  assert.ok(pageContent.includes('<NotificationsPage'));
  assert.ok(access.includes("'Notifications'"));
  assert.ok(adminSidebar.includes("{ name: 'Notifications', icon: Bell }"));
  for (const wrapper of [
    '../src/components/portals/PortalNotifications.jsx',
    '../src/components/portals/StockKeeperNotifications.jsx'
  ]) {
    assert.match(read(wrapper), /NotificationsPage/);
  }
  const countProps = app.match(/counts=\{sidebarCounts\}/g) || [];
  assert.ok(countProps.length >= 3, 'admin, supervisor, requester and stock keeper must pass counts');
  assert.ok(app.includes('portal="stockkeeper"'));
  assert.ok(app.includes('portal="requester"'));
  assert.ok(app.includes('portal="supervisor"'));
});

test('notification polling uses grouped requests with focus refresh and no WebSocket dependency', () => {
  assert.ok(app.includes("api('/notifications?limit=50')"));
  assert.ok(app.includes('notificationSequenceRef.current'));
  assert.match(app, /setInterval\(\(\) => \{[\s\S]*?void refreshSidebarCounts\(\);[\s\S]*?void refreshNotifications\(\);[\s\S]*?\}, 20000\)/);
  assert.ok(app.includes("window.addEventListener('focus', onFocus)"));
  assert.ok(app.includes("document.addEventListener('visibilitychange', onVisibility)"));
  assert.doesNotMatch(app, /new WebSocket|socket\.io/);
  assert.doesNotMatch(packageJson.toLowerCase(), /websocket|socket\.io/);
});

test('success toasts follow a confirmed response and failures never report success', () => {
  assert.ok(app.includes('const result = await request(path, body, method);'));
  assert.ok(app.includes("notify({ type: 'success', title: 'Operation completed'"));
  assert.ok(app.includes('await loadData();'));
  assert.ok(provider.includes('if (!error?.reported)'));
  assert.ok(provider.includes("title: options.errorTitle || 'Operation failed'"));
  assert.ok(provider.includes('throw error;'));
  assert.ok(page.includes('catch (exception)'));
  assert.ok(page.includes('setError(exception.message'));
});

test('notification actions render busy state and refresh authoritative counts', () => {
  assert.ok(app.includes('const [notificationBusy, setNotificationBusy] = useState(false)'));
  assert.ok(app.includes('setNotificationBusy(true)'));
  assert.ok(app.includes('setNotificationBusy(false)'));
  assert.ok(center.includes('disabled={busy}'));
  assert.ok(page.includes('Saving…'));
  for (const action of [
    'markNotificationRead: async',
    'markAllNotificationsRead: async',
    'deleteNotification: async'
  ]) {
    assert.ok(app.includes(action), `missing ${action}`);
  }
  assert.ok(app.includes('await refreshSidebarCounts();'));
  assert.ok(page.includes('await portalApi.reload?.()'));
});

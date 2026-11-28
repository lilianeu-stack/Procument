import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { badgeLabel } from '../src/services/sidebarCounts.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const adminSidebar = read('../src/components/layout/Sidebar.jsx');
const appLayout = read('../src/components/layout/AppLayout.jsx');
const portalFrame = read('../src/components/portals/PortalSidebarFrame.jsx');
const portalLayout = read('../src/components/portals/PortalLayout.jsx');
const badge = read('../src/components/ui/SidebarBadge.jsx');
const client = read('../src/services/sidebarCounts.js');
const emailInbox = read('../src/pages/EmailInboxPage.jsx');

test('badge labels hide zero, show real counts, and cap at 99+', () => {
  assert.equal(badgeLabel(0), '');
  assert.equal(badgeLabel(-2), '');
  assert.equal(badgeLabel(undefined), '');
  assert.equal(badgeLabel('not-a-number'), '');
  assert.equal(badgeLabel(1), '1');
  assert.equal(badgeLabel(9), '9');
  assert.equal(badgeLabel(99), '99');
  assert.equal(badgeLabel(100), '99+');
  assert.equal(badgeLabel(254), '99+');
});

test('all four authenticated sidebars render the same badge from one count map', () => {
  for (const [name, source] of [
    ['Administrator', adminSidebar],
    ['department portals', portalFrame]
  ]) {
    assert.match(source, /import SidebarBadge from '\.\.\/ui\/SidebarBadge\.jsx'/, `${name} should use the shared badge`);
    assert.match(source, /counts = \{\}/, `${name} should default the count map`);
    assert.match(source, /<SidebarBadge count=\{counts\[name\]\}/, `${name} should badge its own links`);
    assert.match(source, /relative flex min-h-10/, `${name} must not widen for a badge`);
  }
  assert.match(appLayout, /counts=\{counts\}/);
  assert.match(portalLayout, /counts=\{counts\}/);
  assert.match(appLayout, /<Sidebar user=\{user\} page=\{page\} counts=\{counts\}/);
  assert.match(portalLayout, /counts=\{counts\}/);
});

test('badge keeps existing colours and uses the scoped white count exception', () => {
  for (const token of ['bg-success', 'border border-brand', 'pims-sidebar-badge', 'shrink-0', 'rounded-full', 'ml-auto', 'floating ?']) {
    assert.ok(badge.includes(token), `badge is missing ${token}`);
  }
  assert.doesNotMatch(badge, /text-white|style=\{\{[^}]*\bcolor\s*:/);
  assert.match(read('../src/index.css'), /\.pims-sidebar-badge \{\s*color: #FFFFFF !important;\s*\}/);
  assert.match(badge, /if \(!label\) return null;/);
  assert.match(badge, /aria-label=\{`\$\{Number\(count\)\} unread`\}/);
});

test('Email Inbox nav shows its unread email count as green text from the shared count map', () => {
  assert.match(adminSidebar, /\{\s*name:\s*'Email Inbox',\s*icon:\s*Mail\s*\}/);
  assert.match(
    adminSidebar,
    /<SidebarBadge count=\{counts\[name\]\} showText=\{name === 'Email Inbox'\} floating=\{collapsed\} \/>/
  );
  assert.match(badge, /showText = false/);
  assert.match(badge, /data-testid="email-inbox-unread-text"/);
  assert.match(badge, /pims-sidebar-unread-text/);
  assert.match(badge, /\{label\} unread/);
  assert.match(
    read('../src/index.css'),
    /\.pims-sidebar-unread-text \{\s*color: var\(--pims-reference\) !important;\s*\}/
  );
});

test('loading a conversation never marks messages read; each message opens explicitly', () => {
  const messages = read('../src/components/portals/PortalMessages.jsx');
  assert.match(messages, /const unread = !mine && !message\.isRead/);
  assert.match(messages, /data-message-id=\{message\.id\}/);
  assert.match(messages, /onClick=\{\(\) => onOpen\(message\)\}/);
  assert.match(messages, /openMessage[\s\S]*portalApi\.markMessageRead\(message\.id\)/);
  assert.match(messages, /setThread\(\(current\)[\s\S]*isRead: true/);
  assert.match(messages, /const loadThread = useCallback[\s\S]*portalApi\.getThread\(\{[\s\S]*setThread\(response\);/);
  assert.match(app, /markMessageRead: async[\s\S]*await refreshSidebarCounts\(\)/);
});

test('one grouped count request feeds all badges and refreshes without a page reload', () => {
  assert.match(client, /api\('\/sidebar-counts'\)/);
  assert.match(app, /fetchSidebarCounts/);
  assert.match(app, /setSidebarCounts\(counts\)/);
  assert.match(app, /countSequenceRef\.current/);
  assert.match(app, /setInterval\(\(\) => \{[\s\S]*?void refreshSidebarCounts\(\);[\s\S]*?void refreshNotifications\(\);[\s\S]*?\}, 20000\)/);
  assert.match(app, /window\.addEventListener\('focus'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /counts: sidebarCounts/);
  assert.match(app, /await refreshSidebarCounts\(\);[\s\S]*setNotificationsOpen\(false\)/);
  assert.match(app, /getThread: async[\s\S]*await refreshSidebarCounts\(\)/);
  assert.match(app, /markMessageRead: async[\s\S]*await refreshSidebarCounts\(\)/);
  assert.match(app, /markAllNotificationsRead: async[\s\S]*await refreshSidebarCounts\(\)/);
  assert.match(app, /requestMarkAllNotificationsRead/);
});

test('opening a loaded module clears only that module\'s notifications and refreshes badges', () => {
  assert.match(client, /api\('\/notifications\/read-module'/);
  assert.match(client, /shouldMarkModuleOnOpen/);
  assert.match(client, /RECEIVED_REQUESTS_PAGE, 'RFQs', 'Email Inbox', PURCHASE_ORDERS_PAGE/);
  const moduleReadPages = client.match(/const MODULE_READ_PAGES = new Set\(\[([\s\S]*?)\]\);/)[1];
  assert.doesNotMatch(moduleReadPages, /'Messages'|'Department Messages'/);
  assert.match(app, /loadToken === loadSequenceRef\.current/);
  assert.match(app, /markedPageRef\.current/);
  assert.match(app, /shouldMarkModuleOnOpen\(activePage\)/);
  assert.match(app, /await markModuleNotificationsRead\(activePage\)/);
  assert.match(app, /canAccessPage\(user\.role, activePage\)/);
});

test('private-message notifications wait for the actual message; emails use per-reader receipts', () => {
  assert.match(app, /isMessageNotice = notification\.category === 'message' \|\| link\.includes\('message='\)/);
  assert.match(app, /if \(!isMessageNotice\) \{/);
  assert.match(app, /markEmailRead: async[\s\S]*\/email\/inbox\/messages\/.*\/read[\s\S]*await refreshSidebarCounts\(\)/);
  assert.match(emailInbox, /await actions\.markEmailRead\(message\.id\)/);
  assert.match(emailInbox, /message\.isRead \? <MailOpen/);
});

test('public supplier surfaces have no authenticated sidebar badge state', () => {
  const supplierRfq = read('../src/components/portals/SupplierRfqPage.jsx');
  const supplierPricing = read('../src/components/portals/SupplierPricingPage.jsx');
  for (const [name, source] of [['supplier RFQ', supplierRfq], ['supplier pricing', supplierPricing]]) {
    assert.doesNotMatch(source, /SidebarBadge|sidebar-counts|pims-token/, `${name} must stay token-gated and shell-free`);
  }
});

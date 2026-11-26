import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const accountMenu = read('../src/components/ui/AccountMenu.jsx');
const topbar = read('../src/components/layout/Topbar.jsx');
const sharedHeader = read('../src/components/portals/SharedHeader.jsx');
const sidebar = read('../src/components/layout/Sidebar.jsx');
const appLayout = read('../src/components/layout/AppLayout.jsx');
const portalSidebarFrame = read('../src/components/portals/PortalSidebarFrame.jsx');
const portalLayout = read('../src/components/portals/PortalLayout.jsx');
const portalSidebars = {
  supervisor: read('../src/components/portals/SupervisorSidebar.jsx'),
  requester: read('../src/components/portals/RequesterSidebar.jsx'),
  stockkeeper: read('../src/components/portals/StockKeeperSidebar.jsx')
};
const supplierRfq = read('../src/components/portals/SupplierRfqPage.jsx');
const supplierPricing = read('../src/components/portals/SupplierPricingPage.jsx');
const purchaseOrderApproval = read('../src/components/portals/PurchaseOrderApprovalPage.jsx');
const userAvatar = read('../src/components/ui/UserAvatar.jsx');
const portalMessages = read('../src/components/portals/PortalMessages.jsx');
const app = read('../src/App.jsx');

test('both authenticated shells reuse one account menu component', () => {
  for (const [name, source] of [['Topbar', topbar], ['SharedHeader', sharedHeader]]) {
    assert.match(source, /import AccountMenu from /, `${name} should import the shared menu`);
    assert.match(source, /<AccountMenu user=\{user\} onProfile=\{onProfile\} onLogout=\{onLogout\} \/>/, `${name} should render the shared menu`);
    assert.doesNotMatch(source, /useState|setAccountOpen|aria-label="Account menu"/, `${name} must not duplicate menu state`);
  }
  assert.match(accountMenu, /aria-label="Account menu"/);
});

test('the account control only toggles the menu and never logs out on open', () => {
  assert.match(accountMenu, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.match(accountMenu, /aria-expanded=\{open\}/);
  assert.match(accountMenu, /aria-haspopup="menu"/);
  assert.doesNotMatch(accountMenu, /window\.location|location\.href/);
});

test('the dropdown closes on a second click, outside click and Escape', () => {
  for (const token of ['pointerdown', 'click', 'keydown', 'Escape', 'rootRef.current?.contains']) {
    assert.match(accountMenu, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${token}`);
  }
  assert.match(accountMenu, /document\.removeEventListener/);
});

test('the dropdown header uses the authenticated user identity and photo', () => {
  for (const token of ['UserAvatar', 'user?.name', 'user?.email', 'roleLabel(user?.role)', 'user?.department']) {
    assert.ok(accountMenu.includes(token), `missing ${token}`);
  }
  assert.doesNotMatch(accountMenu, /password|passwordHash|pims-token/i);
});

test('the dropdown has explicit My Profile and Logout actions', () => {
  assert.match(accountMenu, /My Profile/);
  assert.match(accountMenu, /onProfile\(\)/);
  assert.match(accountMenu, /role="menuitem"/);
  assert.match(accountMenu, /Logout/);
  assert.match(accountMenu, /onLogout\(\)/);
  assert.match(accountMenu, /UserRound/);
  assert.match(accountMenu, /LogOut/);
});

test('the Administrator sidebar no longer duplicates status or identity', () => {
  for (const text of ['SYSTEM STATUS', 'All systems operational', 'Hope Haven Administrator', 'Administrator · Administration']) {
    assert.ok(!sidebar.includes(text), `sidebar still renders ${text}`);
  }
  for (const token of ['UserAvatar', 'LogOut', 'aria-label="Open profile"', 'aria-label="Sign out"']) {
    assert.ok(!sidebar.includes(token), `sidebar still renders ${token}`);
  }
  assert.match(sidebar, /BrandLogo/);
  assert.match(sidebar, /PROFILE_PAGE/);

  const sidebarTag = appLayout.match(/<Sidebar[\s\S]*?\/>/)?.[0] || '';
  assert.doesNotMatch(sidebarTag, /onLogout/);
});

test('department sidebars keep navigation chrome but drop duplicated account/status blocks', () => {
  for (const text of [
    'DEPARTMENT VIEW', 'Scoped to your assigned Department.', 'portalLabel',
    'UserAvatar', 'LogOut', 'roleLabel', 'PROFILE_PAGE',
    'aria-label="Open profile"', 'aria-label="Sign out"'
  ]) {
    assert.ok(!portalSidebarFrame.includes(text), `sidebar frame still renders ${text}`);
  }
  for (const token of ['BrandLogo', 'aria-label="Main navigation"', 'groups.map', 'onNavigate(name)', 'onToggleCollapse']) {
    assert.match(portalSidebarFrame, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${token}`);
  }

  for (const [name, source] of Object.entries(portalSidebars)) {
    assert.match(source, /<PortalSidebarFrame \{\.\.\.props\} accent=\{accent\} groups=\{groups\} \/>/, `${name} should use the cleaned shared frame`);
    for (const token of ['statusText', 'profile:', 'badge:', 'dot:', 'portalLabel']) {
      assert.ok(!source.includes(token), `${name} still configures ${token}`);
    }
  }
});

test('department layout passes identity only to the navbar, not the sidebar', () => {
  const sidebarTag = portalLayout.match(/<Sidebar[\s\S]*?\/>/)?.[0] || '';
  const headerTag = portalLayout.match(/<SharedHeader[\s\S]*?\/>/)?.[0] || '';
  assert.doesNotMatch(sidebarTag, /user=|onLogout/);
  assert.match(headerTag, /user=\{user\}/);
  assert.match(headerTag, /onLogout=\{onLogout\}/);
  assert.match(headerTag, /onProfile=/);
  assert.doesNotMatch(portalLayout, /roleLabel|departmentName|No Department assigned/);
});

test('supplier-facing surfaces are token-gated public pages without a staff account shell', () => {
  for (const [name, source] of [
    ['supplier RFQ', supplierRfq],
    ['supplier pricing', supplierPricing],
    ['purchase order approval', purchaseOrderApproval]
  ]) {
    assert.doesNotMatch(source, /AccountMenu|SharedHeader|PortalSidebarFrame|<Sidebar|onProfile|onLogout/, `${name} must not render a staff shell`);
    assert.match(source, /token/, `${name} should use its signed link token`);
  }
  assert.match(supplierRfq, /\/supplier\/rfq\//);
  assert.match(supplierPricing, /\/supplier-pricing\//);
  assert.doesNotMatch(supplierRfq, /pims-token/);
  assert.doesNotMatch(supplierPricing, /pims-token/);
});

test('the shared dropdown uses professional neutral styling with green hover', () => {
  for (const token of ['bg-white', 'border border-strong', 'shadow-dashboard', 'rounded-xl', 'hover:bg-accent-tint', 'focus-visible:ring', 'z-50']) {
    assert.ok(accountMenu.includes(token), `missing ${token}`);
  }
});

test('avatars only request a photo when the record actually has one', () => {
  assert.match(userAvatar, /const photoMarker = photo === undefined \? user\?\.profilePhoto : photo/);
  assert.match(userAvatar, /if \(!id \|\| !hasPhoto\)/);
  assert.match(userAvatar, /apiBlob\(`\/profile\/photo\/\$\{id\}\?v=\$\{version\}`/);
  assert.match(portalMessages, /photo=\{conversation\.photo\}/);
  assert.match(portalMessages, /photo=\{message\.senderPhoto\}/);
  assert.match(portalMessages, /photo=\{announcement\.senderPhoto\}/);
});

test('logout clears the token before restoring the unauthenticated view', () => {
  const logout = app.match(/function logout\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(logout, /localStorage\.removeItem\('pims-token'\)/);
  assert.match(logout, /setUser\(null\)/);
  assert.match(logout, /setRoute\(\{ portal: null/);
  assert.match(logout, /history\.replaceState/);
  assert.ok(logout.indexOf("removeItem('pims-token')") < logout.indexOf('setUser(null)'));
});

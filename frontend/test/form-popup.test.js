import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('requester form opens as a popup instead of a full page', () => {
  const app = read('../src/App.jsx');
  const modal = read('../src/components/portals/CreatePurchaseRequestModal.jsx');
  const form = read('../src/components/portals/CreatePurchaseRequest.jsx');

  assert.match(app, /import CreatePurchaseRequestModal from/);
  assert.match(app, /portalContent = <CreatePurchaseRequestModal/);
  assert.doesNotMatch(app, /portalContent = <CreatePurchaseRequest /);

  assert.match(modal, /<Modal title=\{title\} size="xl" onClose=\{close\}>/);
  assert.match(modal, /const close = \(\) => navigate\('My Procurement Requests'\)/);
  assert.match(modal, /<CreatePurchaseRequest[\s\S]*inModal/);

  assert.match(form, /inModal = false/);
  assert.match(form, /\{!inModal && <button/);
});

test('profile forms open as popups in every portal', () => {
  const app = read('../src/App.jsx');
  const pageContent = read('../src/pages/PageContent.jsx');
  const modal = read('../src/components/portals/PortalProfileModal.jsx');
  const form = read('../src/components/portals/PortalProfile.jsx');

  assert.match(modal, /<Modal title="My profile" size="xl" onClose=\{onClose\}>/);
  assert.match(modal, /<PortalProfile[\s\S]*inModal/);
  assert.match(form, /inModal = false/);
  assert.match(form, /\{!inModal && <PageHeader/);

  assert.equal((app.match(/<PortalProfileModal/g) || []).length, 3);
  assert.doesNotMatch(app, /<PortalProfile /);
  assert.match(pageContent, /import PortalProfileModal from/);
  assert.match(pageContent, /<PortalProfileModal[\s\S]*onClose=\{\(\) => navigate\('Overview'\)\}/);
  assert.doesNotMatch(pageContent, /<PortalProfile\s/);
});

test('message composers open as popups instead of inline forms', () => {
  const messages = read('../src/components/portals/PortalMessages.jsx');

  assert.match(messages, /import Modal from '\.\.\/ui\/Modal\.jsx'/);
  assert.match(messages, /setShowAnnouncementComposer\(true\)/);
  assert.match(messages, /<Modal title="New department announcement"/);
  assert.match(messages, /<Modal\s+title=\{`Reply to \$\{activeConversation\.name \|\| 'contact'\}`\}/);
  assert.doesNotMatch(messages, /<PageCard title="Department announcement"/);
  assert.doesNotMatch(messages, /className="space-y-3 border-t border-subtle p-4"/);
});

test('supervisor decisions open in a popup instead of inline row forms', () => {
  const approvals = read('../src/components/portals/SupervisorApprovals.jsx');

  assert.match(approvals, /import Modal from '\.\.\/ui\/Modal\.jsx'/);
  assert.match(approvals, /const activeRequest = pending\.find/);
  assert.match(approvals, /<Modal\s+title=\{`Decision · \$\{requisitionDisplayReference\(activeRequest\)\}`\}/);
  assert.match(approvals, /confirm\(activeRequest\)/);
  assert.doesNotMatch(approvals, /Confirm \{decision\}/);
});

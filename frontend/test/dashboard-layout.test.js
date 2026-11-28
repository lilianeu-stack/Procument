import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const dashboard = read('../src/components/portals/RoleBasedDashboard.jsx');
const requesterDashboard = read('../src/components/portals/RequesterDashboard.jsx');

test('supervisor overview renders cards only', () => {
  const supervisorStart = dashboard.indexOf('if (isSupervisor) return');
  const requesterStart = dashboard.indexOf('return <div className="space-y-6">');
  assert.ok(supervisorStart > -1);
  assert.ok(requesterStart > supervisorStart);

  const supervisorBranch = dashboard.slice(supervisorStart, requesterStart);
  assert.match(supervisorBranch, /<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">/);
  assert.match(supervisorBranch, /cards\.map\(\(card\) => <WorkspaceStatCard/);
  for (const removed of ['<Hero', 'Recent Department requests', 'Unread notifications', 'Need help?']) {
    assert.doesNotMatch(supervisorBranch, new RegExp(removed.replace(/[?*+()]/g, '\\$&')), `${removed} must not appear in the supervisor branch`);
  }
});

test('supervisor overview does not load the recent-requests list it no longer renders', () => {
  assert.match(dashboard, /useRecentRequests\(portalApi, portal, !isSupervisor\)/);
  assert.match(dashboard, /function useRecentRequests\(portalApi, portal, enabled = true\)/);
  assert.match(dashboard, /if \(!enabled\)/);
});

test('requester overview renders cards only', () => {
  const returnStart = requesterDashboard.indexOf('return <div data-testid="requester-dashboard"');
  assert.ok(returnStart > -1);
  const rendered = requesterDashboard.slice(returnStart);
  assert.match(rendered, /data-testid="workspace-grid"/);
  assert.match(rendered, /cards\.map\(\(card\) => <WorkspaceCard/);
  for (const removed of ['dashboard-title', 'welcome-title', 'Quick actions', 'My recent requests', 'Unread notifications', 'useRecentRequests']) {
    assert.doesNotMatch(rendered, new RegExp(removed.replace(/[?*+()]/g, '\\$&')), `${removed} must not appear in the requester overview`);
  }
  for (const removedCard of ['Information required', 'Unread messages', 'Unread notices']) {
    assert.doesNotMatch(requesterDashboard, new RegExp(`label: '${removedCard}'`), `${removedCard} card must be removed`);
  }
});

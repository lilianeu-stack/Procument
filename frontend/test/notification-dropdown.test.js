import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const topbar = read('../src/components/layout/Topbar.jsx');
const sharedHeader = read('../src/components/portals/SharedHeader.jsx');
const css = read('../src/index.css');

for (const [name, source] of [['Topbar', topbar], ['SharedHeader', sharedHeader]]) {
  test(`${name} bell card shows the unread count and marks each unread notice`, () => {
    assert.match(source, /filter\(\(notice\) => !notice\.isRead\)\.length/, `${name} must derive the unread count`);
    assert.match(source, /data-testid="notification-unread-count"/, `${name} must expose the count`);
    assert.match(source, /pims-notification-unread-text[^>]*\{unread\} unread|className="pims-notification-unread-text[^"]*"[^>]*>\{unread\} unread/, `${name} must render the green count text`);
    assert.match(source, /!notice\.isRead && <span data-testid="notification-unread-marker"/, `${name} must mark unread notices`);
    assert.match(source, /pims-notification-unread-label/, `${name} must use the scoped green marker class`);
    assert.match(source, /border-reference bg-accent-tint/, `${name} must tint unread items`);
    assert.match(source, /border-transparent bg-white/, `${name} must keep read items neutral`);
  });
}

test('notification unread colors are scoped exceptions after the global button rule', () => {
  const buttonRule = css.indexOf('#root button,');
  const exception = css.indexOf('.pims-notification-unread-text');
  assert.ok(buttonRule > -1);
  assert.ok(exception > buttonRule, 'the green exception must follow the black button rule');
  assert.match(css, /#root button \.pims-notification-unread-title[\s\S]*color: var\(--pims-reference\) !important/);
  assert.match(css, /#root button \.pims-notification-unread-label[\s\S]*color: var\(--pims-reference\) !important/);
});

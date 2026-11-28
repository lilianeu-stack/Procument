import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const topbar = read('../src/components/layout/Topbar.jsx');
const sharedHeader = read('../src/components/portals/SharedHeader.jsx');
const notificationCenter = read('../src/notifications/NotificationCenter.jsx');
const css = read('../src/index.css');

for (const [name, source] of [['Topbar', topbar], ['SharedHeader', sharedHeader]]) {
  test(`${name} bell card shows the unread count and marks each unread notice`, () => {
    assert.match(source, /<NotificationCenter/, `${name} must use the shared notification center`);
    assert.match(notificationCenter, /notifications\.filter\(\(item\) => !item\.isRead\)\.length/,
      'the shared center must derive unread counts when backend counts are absent');
    assert.match(notificationCenter, /\{unread\} unread/, 'the shared center must show the unread count');
    assert.match(notificationCenter, /!notice\.isRead && <span[^>]*>New<\/span>/,
      'the shared center must mark unread notices');
    assert.match(notificationCenter, /notice\.isRead \? 'bg-white' : 'bg-accent-row'/,
      'the shared center must distinguish read and unread notices');
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

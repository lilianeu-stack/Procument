import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const messages = read('../src/components/portals/PortalMessages.jsx');
const app = read('../src/App.jsx');
const pageContent = read('../src/pages/PageContent.jsx');
const access = read('../src/utils/access.js');
const adminSidebar = read('../src/components/layout/Sidebar.jsx');
const stockSidebar = read('../src/components/portals/StockKeeperSidebar.jsx');
const css = read('../src/index.css');

test('Messages uses real filters, search and pagination from the shared API', () => {
  for (const filter of ["key: 'all'", "key: 'unread'", "key: 'read'", "key: 'sent'"]) {
    assert.ok(messages.includes(filter), `missing ${filter} filter`);
  }
  assert.ok(!messages.includes("key: 'archived'"), 'there is no safe archived state');
  assert.ok(messages.includes('Search sender or message…'));
  assert.ok(messages.includes('portalApi.getConversations({'));
  assert.ok(messages.includes('pageSize: PAGE_SIZE'));
  assert.ok(messages.includes('Load more conversations'));
  assert.ok(app.includes("api(`/messages/conversations${toQuery(params)}`)"));
});

test('Messages has a responsive three-panel shell with separate mobile views', () => {
  assert.ok(messages.includes("xl:grid-cols-[320px_minmax(0,1fr)"));
  assert.ok(messages.includes('_250px'));
  assert.ok(messages.includes("aria-label=\"Conversations\""));
  assert.ok(messages.includes("aria-label=\"Conversation\""));
  assert.ok(messages.includes("aria-label=\"Conversation details\""));
  assert.ok(messages.includes("setMobileView('thread')"));
  assert.ok(messages.includes("view === 'details' ? 'thread' : 'details'"));
});

test('unread styling is subtle, labelled, and independent from selection', () => {
  assert.ok(css.includes('.message-unread { background-color: var(--pims-interaction-row-tint); }'));
  assert.ok(messages.includes("unread ? 'message-unread' : 'bg-white'"));
  assert.ok(messages.includes("unread ? 'font-extrabold' : 'font-normal'"));
  assert.ok(messages.includes('>NEW<'));
  assert.ok(messages.includes('aria-hidden="true"'));
  assert.ok(messages.includes("active ? 'ring-1 ring-inset ring-brand' : 'hover:bg-hover'"));
  assert.ok(messages.includes('dateTimeLabel(conversation.lastAt)'));
});

test('message bodies stay hidden until explicitly opened', () => {
  assert.ok(messages.includes('const unread = !mine && !message.isRead'));
  assert.ok(messages.includes('data-message-id={message.id}'));
  assert.ok(messages.includes('{unread ? <button type="button"'));
  assert.ok(messages.includes('onClick={() => onOpen(message)}'));
  assert.ok(messages.includes('portalApi.markMessageRead(message.id)'));
  assert.ok(messages.includes('isRead: true'));
  assert.ok(messages.includes('{groups.length ? groups.map((group)'));
});

test('attachments are downloaded through the authenticated shared API', () => {
  assert.ok(messages.includes('onDownload={downloadAttachment} onError={downloadError}'));
  assert.ok(messages.includes('portalApi.downloadMessageAttachment(id, fileName)'));
  assert.ok(app.includes("apiBlob(`/messages/attachments/${id}`)"));
  assert.ok(app.includes('downloadMessageAttachment,'));
});

test('every applicable portal routes to the shared Messages page', () => {
  assert.ok(pageContent.includes('page === \'Messages\''));
  assert.ok(pageContent.includes('portal="admin"'));
  assert.ok(app.includes('portal="stockkeeper"'));
  assert.ok(app.includes('portal="requester"'));
  assert.ok(app.includes('portal="supervisor"'));
  assert.ok(access.includes("'Messages'"));
  assert.ok(adminSidebar.includes("{ name: 'Messages', icon: MessageSquare }"));
  assert.ok(stockSidebar.includes('Messages: MessageSquare'));
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, Eye, Info, Megaphone, Paperclip, Search, Send, X
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import UserAvatar from '../ui/UserAvatar.jsx';
import {
  AttachmentList, AttachmentPicker, EmptyState, ErrorState, LoadingState, PageHeader,
  PortalBadge, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import { filesToAttachments } from '../../utils/attachments.js';
import { badgeLabel } from '../../services/sidebarCounts.js';

const PAGE_SIZE = 20;
const POLL_MS = 20000;
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
  { key: 'sent', label: 'Sent' }
];

function normalizeFilter(value) {
  const filter = String(value || 'all').toLowerCase();
  return FILTERS.some((item) => item.key === filter) ? filter : 'all';
}

function dashboardPage(portal) {
  if (portal === 'supervisor') return 'Supervisor Dashboard';
  if (portal === 'requester') return 'Requester Dashboard';
  if (portal === 'stockkeeper') return 'Dashboard';
  return 'Overview';
}

function conversationFromQuery(conversations = [], query = {}) {
  const messageId = Number(query.message);
  if (messageId) {
    const announcement = conversations.find((row) => row.kind === 'announcement'
      && Number(row.announcementId) === messageId);
    if (announcement) return announcement;
  }
  const userId = Number(query.userId);
  if (userId) {
    const privateConversation = conversations.find((row) => row.kind === 'private'
      && Number(row.participantId) === userId);
    if (privateConversation) return privateConversation;
  }
  return null;
}

function initialResult(initial) {
  if (initial?.conversations && initial?.counts) return initial;
  return { conversations: [], total: 0, counts: {}, filter: 'all', search: '' };
}

function groupByDate(messages = []) {
  const groups = [];
  const chronological = [...messages].sort((left, right) => (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  ));
  for (const message of chronological) {
    const label = dateLabel(message.createdAt);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, messages: [] });
    groups[groups.length - 1].messages.push(message);
  }
  return groups;
}

function ConversationRow({ conversation, active, onSelect }) {
  const unread = Number(conversation.unreadCount) > 0;
  return <button type="button" role="option" aria-selected={active} onClick={onSelect}
    data-conversation-key={conversation.key}
    className={`flex w-full items-center gap-3 border-b border-subtle px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus ${unread ? 'message-unread' : 'bg-white'} ${active ? 'ring-1 ring-inset ring-brand' : 'hover:bg-hover'}`}>
    <span className="relative shrink-0">
      <UserAvatar userId={conversation.participantId} name={conversation.name} photo={conversation.photo}
        size="h-9 w-9" textSize="text-xs" className="border border-brand" />
      {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-reference" aria-hidden="true" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className={`truncate ${unread ? 'font-extrabold' : 'font-normal'} text-black`}>{conversation.name}</span>
        <span className="shrink-0 text-[10px] text-black" title={conversation.lastAt ? dateTimeLabel(conversation.lastAt) : undefined}>
          {conversation.lastAt ? dateTimeLabel(conversation.lastAt) : '—'}
        </span>
      </span>
      <span className={`mt-1 block truncate text-[11px] ${unread ? 'font-bold text-black' : 'text-black'}`}>
        {conversation.lastBody || 'No messages yet'}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-black">
        {conversation.kind === 'announcement' && <PortalBadge tone="indigo"><Megaphone size={10} />Announcement</PortalBadge>}
        {conversation.lastRequisitionReference && <span className="font-semibold">Re: {conversation.lastRequisitionReference}</span>}
        {Number(conversation.attachmentCount) > 0 && <span className="inline-flex items-center gap-1 font-semibold"><Paperclip size={10} />{conversation.attachmentCount}</span>}
      </span>
    </span>
    {unread && <span className="flex shrink-0 flex-col items-end gap-1" aria-label={`${unread} unread`}>
      <span className="rounded-full border border-brand bg-white px-2 py-0.5 text-[9px] font-extrabold text-black">NEW</span>
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-reference px-1 text-[10px] font-extrabold text-black">{badgeLabel(unread)}</span>
    </span>}
  </button>;
}

function MessageBubble({ message, userId, onOpen, opening, onDownload, onError }) {
  const mine = Number(message.senderId) === Number(userId);
  const unread = !mine && !message.isRead;
  const attachments = message.attachments || [];
  return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[85%] rounded-2xl border px-4 py-3 sm:max-w-[70%] ${mine ? 'rounded-br-sm bg-white' : 'rounded-bl-sm bg-white'} ${unread ? 'message-unread border-accent-border' : 'border-brand'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold">
        <UserAvatar userId={message.senderId} name={message.senderName} photo={message.senderPhoto}
          size="h-5 w-5" textSize="text-[8px]" className="border border-brand" />
        <span>{mine ? 'You' : message.senderName || 'Other party'}</span>
        <span>{dateTimeLabel(message.createdAt)}</span>
        {unread && <PortalBadge tone="emerald">NEW</PortalBadge>}
        {mine && message.deliveryStatus && <span className="inline-flex items-center gap-1 font-semibold" title={message.deliveryStatus}>
          <Check size={11} />{message.deliveryStatus}
        </span>}
      </div>
      {unread ? <button type="button" data-message-id={message.id} aria-label={`Open message ${message.id}`}
        onClick={() => onOpen(message)} disabled={opening}
        className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-black underline disabled:cursor-wait">
        <Eye size={13} />{opening ? 'Opening…' : 'Open message'}
        {Number(message.attachmentCount) > 0 && <span className="ml-1 inline-flex items-center gap-1 font-semibold no-underline"><Paperclip size={11} />{message.attachmentCount}</span>}
      </button> : <>
        <p className="whitespace-pre-wrap break-words text-xs leading-5">{message.body || 'Document attached'}</p>
        {message.requisitionReference && <div className="mt-2 rounded border border-brand bg-white px-2 py-1 text-[10px] font-bold">
          Related request: {message.requisitionReference}
        </div>}
        {attachments.length > 0 && <div className="mt-2">
          <AttachmentList attachments={attachments} downloadPath={onDownload} onError={onError} />
        </div>}
      </>}
    </div>
  </div>;
}

function ConversationDetails({ conversation, thread, onClose, onDownload, onError }) {
  const attachments = (thread?.messages || []).flatMap((message) => message.attachments || []);
  return <PageCard title="Conversation details"
    action={<button type="button" onClick={onClose} aria-label="Close details" className="rounded p-1 text-black hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"><X size={15} /></button>}>
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <UserAvatar userId={conversation.participantId} name={conversation.name} photo={conversation.photo}
          size="h-10 w-10" textSize="text-xs" className="border border-brand" />
        <div className="min-w-0">
          <div className="truncate text-xs font-extrabold">{conversation.name}</div>
          <div className="truncate text-[10px] text-black">{conversation.email || conversation.department || conversation.role || 'Department contact'}</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-subtle pt-3 text-[11px]">
        <div className="flex justify-between gap-2"><span className="text-black">Status</span><span className="font-bold">{Number(conversation.unreadCount) > 0 ? `${badgeLabel(conversation.unreadCount)} unread` : 'All caught up'}</span></div>
        <div className="flex justify-between gap-2"><span className="text-black">Messages</span><span className="font-bold">{conversation.messageCount || 0}</span></div>
        <div className="flex justify-between gap-2"><span className="text-black">Received</span><span className="font-bold">{conversation.receivedCount || 0}</span></div>
        <div className="flex justify-between gap-2"><span className="text-black">Sent</span><span className="font-bold">{conversation.sentCount || 0}</span></div>
        {conversation.lastAt && <div className="flex justify-between gap-2"><span className="text-black">Last activity</span><span className="font-bold">{dateTimeLabel(conversation.lastAt)}</span></div>}
        {conversation.lastRequisitionReference && <div className="flex justify-between gap-2"><span className="text-black">Request</span><span className="font-bold">{conversation.lastRequisitionReference}</span></div>}
      </div>
      <div className="border-t border-subtle pt-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide"><Paperclip size={11} />Attachments</div>
        <AttachmentList attachments={attachments} downloadPath={onDownload} onError={onError} />
      </div>
    </div>
  </PageCard>;
}

export default function PortalMessages({ portal, portalApi, query = {}, userId = null, navigate, initial = null }) {
  const isSupervisor = portal === 'supervisor';
  const inboxPage = isSupervisor ? 'Department Messages' : 'Messages';
  const canLinkRequest = portal === 'supervisor' || portal === 'requester';
  const [result, setResult] = useState(() => initialResult(initial));
  const [filter, setFilter] = useState(() => normalizeFilter(query.filter));
  const [searchDraft, setSearchDraft] = useState(String(query.search || ''));
  const [search, setSearch] = useState(String(query.search || ''));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initial?.conversations);
  const [error, setError] = useState('');
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [openingMessageId, setOpeningMessageId] = useState(null);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [relatedRequest, setRelatedRequest] = useState(query.request || '');
  const [requestOptions, setRequestOptions] = useState([]);
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementFiles, setAnnouncementFiles] = useState([]);
  const [announcementBusy, setAnnouncementBusy] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileView, setMobileView] = useState('list');
  const [selectedKey, setSelectedKey] = useState(() => conversationFromQuery(initial?.conversations || [], query)?.key || null);
  const openedFromQueryRef = useRef(null);
  const initialLoadedRef = useRef(Boolean(initial?.conversations));

  const loadConversations = useCallback(async (options = {}) => {
    const activeFilter = normalizeFilter(options.filter ?? filter);
    const activeSearch = String(options.search ?? search);
    const activePage = Number(options.page ?? page) || 1;
    if (!options.silent) setLoading(true);
    setError('');
    try {
      const response = await portalApi.getConversations({
        filter: activeFilter, search: activeSearch, page: activePage, pageSize: PAGE_SIZE
      });
      setResult((current) => {
        if (activePage <= 1) return response;
        const merged = [...(current.conversations || []), ...(response.conversations || [])];
        return { ...response, conversations: [...new Map(merged.map((row) => [row.key, row])).values()] };
      });
    } catch (exception) {
      setError(exception.message || 'Conversations could not be loaded.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [filter, page, portalApi, search]);

  useEffect(() => {
    if (initialLoadedRef.current) {
      initialLoadedRef.current = false;
      return;
    }
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadConversations({ silent: true });
      void portalApi.refreshMessageCounts?.();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadConversations, portalApi]);

  useEffect(() => {
    const linked = conversationFromQuery(result.conversations, query);
    if (linked && linked.key !== selectedKey) setSelectedKey(linked.key);
  }, [query.message, query.userId, result.conversations, selectedKey]);

  useEffect(() => {
    if (!selectedKey && result.conversations.length) setSelectedKey(result.conversations[0].key);
  }, [result.conversations, selectedKey]);

  useEffect(() => {
    setSearchDraft(String(query.search || ''));
    setSearch(String(query.search || ''));
  }, [query.search]);

  const selectedConversation = useMemo(
    () => result.conversations.find((row) => row.key === selectedKey) || null,
    [result.conversations, selectedKey]
  );
  const participantId = selectedConversation?.kind === 'private' ? selectedConversation.participantId : null;
  const announcementId = selectedConversation?.kind === 'announcement' ? selectedConversation.announcementId : null;

  const loadThread = useCallback(async () => {
    if (!participantId && !announcementId) { setThread(null); return; }
    setThreadLoading(true); setThreadError('');
    try {
      const response = await portalApi.getThread({
        ...(participantId ? { userId: participantId } : {}),
        ...(announcementId ? { announcementId } : {}),
        page: 1,
        pageSize: 100
      });
      setThread(response);
    } catch (exception) {
      setThreadError(exception.message || 'Conversation could not be loaded.');
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, [announcementId, participantId, portalApi]);

  useEffect(() => { void loadThread(); }, [loadThread]);

  const openMessage = useCallback(async (message) => {
    if (!message || Number(message.senderId) === Number(userId) || message.isRead || openingMessageId) return;
    setOpeningMessageId(message.id); setError('');
    try {
      await portalApi.markMessageRead(message.id);
      setThread((current) => current ? {
        ...current,
        messages: (current.messages || []).map((item) => Number(item.id) === Number(message.id) ? { ...item, isRead: true } : item)
      } : current);
      await loadConversations({ silent: true });
    } catch (exception) {
      setError(exception.message || 'Could not open the message.');
    } finally {
      setOpeningMessageId(null);
    }
  }, [loadConversations, openingMessageId, portalApi, userId]);

  // Notification deep links open exactly the message they point to. Loading a
  // thread or selecting a conversation never writes read state.
  useEffect(() => {
    const linkedId = Number(query.message);
    if (!linkedId || !thread?.messages?.length || openedFromQueryRef.current === linkedId) return;
    const linked = thread.messages.find((message) => Number(message.id) === linkedId);
    if (!linked) return;
    openedFromQueryRef.current = linkedId;
    void openMessage(linked);
  }, [openMessage, query.message, thread]);

  useEffect(() => {
    if (!canLinkRequest) return undefined;
    let active = true;
    const getter = portalApi.getSupervisorRequests || portalApi.getRequesterRequests;
    if (!getter) return undefined;
    getter({ page: 1, limit: 100, status: '' })
      .then((response) => { if (active) setRequestOptions(response.requisitions || []); })
      .catch(() => { if (active) setRequestOptions([]); });
    return () => { active = false; };
  }, [canLinkRequest, portalApi]);

  function changeFilter(next) {
    const normalized = normalizeFilter(next);
    if (normalized === filter) return;
    setFilter(normalized);
    setPage(1);
  }

  function applySearch(event) {
    event.preventDefault();
    const next = searchDraft.trim();
    if (next === search) return;
    setSearch(next);
    setPage(1);
  }

  function clearSearch() {
    setSearchDraft('');
    setSearch('');
    setPage(1);
  }

  function selectConversation(conversation) {
    setSelectedKey(conversation.key);
    setMobileView('thread');
    const next = { ...query, filter, ...(search ? { search } : {}) };
    if (conversation.kind === 'announcement') {
      next.message = conversation.announcementId;
      delete next.userId;
    } else {
      next.userId = conversation.participantId;
      delete next.message;
    }
    navigate(inboxPage, next);
  }

  async function send(event) {
    event.preventDefault();
    if (sending || !participantId || (!body.trim() && !files.length)) return;
    setSending(true); setError('');
    try {
      const attachments = files.length ? await filesToAttachments(files) : undefined;
      await portalApi.sendMessage({
        recipientId: participantId,
        body: body.trim(),
        ...(canLinkRequest && relatedRequest ? { requisitionId: Number(relatedRequest) } : {}),
        ...(attachments ? { attachments } : {})
      });
      setBody(''); setFiles([]);
      await loadConversations({ silent: true });
      await loadThread();
    } catch (exception) {
      setError(exception.message || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  async function sendAnnouncement(event) {
    event.preventDefault();
    if (!isSupervisor || announcementBusy || (!announcementBody.trim() && !announcementFiles.length)) return;
    setAnnouncementBusy(true); setAnnouncementError('');
    try {
      const attachments = announcementFiles.length ? await filesToAttachments(announcementFiles) : undefined;
      await portalApi.sendMessage({
        announcement: true,
        body: announcementBody.trim(),
        ...(attachments ? { attachments } : {})
      });
      setAnnouncementBody(''); setAnnouncementFiles([]); setShowAnnouncementComposer(false);
      await loadConversations({ silent: true });
    } catch (exception) {
      setAnnouncementError(exception.message || 'Announcement could not be sent.');
    } finally {
      setAnnouncementBusy(false);
    }
  }

  const downloadAttachment = useCallback(async (id, fileName) => {
    await portalApi.downloadMessageAttachment(id, fileName);
  }, [portalApi]);
  const downloadError = useCallback((message) => setError(message), []);

  const counts = result.counts || {};
  const groups = useMemo(() => groupByDate(thread?.messages || []), [thread?.messages]);

  return <>
    <PageHeader
      eyebrow={isSupervisor ? 'Department communication' : portal === 'admin' ? 'Staff communication' : 'Your communication'}
      title={isSupervisor ? 'Department messages' : 'Messages'}
      description="Private conversations, unread messages, and Department announcements in one place."
      actions={<>
        {isSupervisor && <button type="button" onClick={() => setShowAnnouncementComposer((open) => !open)} className={secondaryButtonClass()}>
          <Megaphone size={14} />{showAnnouncementComposer ? 'Hide composer' : 'New announcement'}
        </button>}
        <button type="button" onClick={() => { setDetailsOpen((open) => !open); setMobileView((view) => view === 'details' ? 'thread' : 'details'); }}
          aria-pressed={detailsOpen} className={secondaryButtonClass()}>
          <Info size={14} />Details
        </button>
      </>}
    />

    <ErrorState message={error} onRetry={() => loadConversations({ silent: true })} />

    {showAnnouncementComposer && isSupervisor && <PageCard title="Department announcement" description="Sent to every active Requester in your Department.">
      <form onSubmit={sendAnnouncement} className="space-y-4 p-5">
        <label className="block text-xs font-bold">
          Announcement
          <textarea rows="3" value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)}
            placeholder="Share an update with all Requesters…" className="field h-auto py-2" />
        </label>
        <AttachmentPicker files={announcementFiles} onChange={setAnnouncementFiles} disabled={announcementBusy} />
        <ErrorState message={announcementError} />
        <button type="submit" disabled={announcementBusy || (!announcementBody.trim() && !announcementFiles.length)} className={primaryButtonClass()}>
          <Send size={14} />{announcementBusy ? 'Sending…' : 'Send announcement'}
        </button>
      </form>
    </PageCard>}

    <div className={`grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)${detailsOpen ? '_250px' : ''}]`}>
      <section className={`${mobileView === 'list' ? 'block' : 'hidden'} xl:block`} aria-label="Conversations">
        <PageCard title="Conversations" description={<span role="status">{result.total || 0} conversation{Number(result.total) === 1 ? '' : 's'}</span>}>
          <form onSubmit={applySearch} className="flex items-center gap-2 border-b border-subtle px-4 py-3">
            <Search size={14} className="shrink-0 text-black" />
            <input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search sender or message…" aria-label="Search messages" className="field mt-0 h-9 flex-1 bg-white" />
            {search && <button type="button" onClick={clearSearch} aria-label="Clear search" className="rounded p-1 text-black hover:bg-hover"><X size={14} /></button>}
          </form>
          <div role="tablist" aria-label="Message filters" className="flex flex-wrap gap-1 border-b border-subtle px-3 py-2">
            {FILTERS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={filter === item.key}
              onClick={() => changeFilter(item.key)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${filter === item.key ? 'bg-reference text-black' : 'text-black hover:bg-hover'}`}>
              {item.label}<span className="ml-1 font-extrabold">{badgeLabel(counts[item.key] || 0) || '0'}</span>
            </button>)}
          </div>
          {loading && !result.conversations.length ? <LoadingState label="Loading conversations…" /> : result.conversations.length ?
            <div className="max-h-[620px] overflow-y-auto" role="listbox" aria-label="Message conversations">
              {result.conversations.map((conversation) => <ConversationRow key={conversation.key} conversation={conversation}
                active={conversation.key === selectedKey} onSelect={() => selectConversation(conversation)} />)}
              {result.conversations.length < Number(result.total || 0) && <button type="button" onClick={() => setPage((current) => current + 1)}
                className="w-full px-4 py-3 text-[11px] font-bold text-black hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
                Load more conversations
              </button>}
            </div> :
            <EmptyState title="No conversations" description={search ? 'Try a different sender or message text.' : 'No messages match this view yet.'} />}
        </PageCard>
      </section>

      <section className={`${mobileView === 'thread' ? 'block' : 'hidden'} xl:block`} aria-label="Conversation">
        <PageCard
          title={selectedConversation ? selectedConversation.name : 'Select a conversation'}
          description={selectedConversation ? `${selectedConversation.email || selectedConversation.department || 'Department contact'}${selectedConversation.lastRequisitionReference ? ` · Re: ${selectedConversation.lastRequisitionReference}` : ''}` : 'Choose a conversation to read and reply.'}
          action={selectedConversation && <button type="button" onClick={() => setMobileView('list')}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-black hover:underline xl:hidden">
            <ArrowLeft size={13} />Inbox
          </button>}>
          {threadLoading ? <LoadingState label="Opening conversation…" /> : threadError ? <ErrorState message={threadError} onRetry={() => loadThread()} /> :
            !selectedConversation ? <EmptyState title="No conversation selected" description="Pick a conversation from the list to read and reply." /> :
              <>
                <div className="max-h-[500px] overflow-y-auto bg-white p-4">
                  {groups.length ? groups.map((group) => <div key={group.label}>
                    <div className="my-3 text-center text-[10px] font-bold uppercase tracking-wide text-black">{group.label}</div>
                    {group.messages.map((message) => <MessageBubble key={message.id} message={message} userId={userId}
                      onOpen={openMessage} opening={Number(openingMessageId) === Number(message.id)} onDownload={downloadAttachment} onError={downloadError} />)}
                  </div>) : <EmptyState title="No messages yet" description="Start the conversation with a message below." />}
                </div>
                {thread?.canReply ? <form onSubmit={send} className="space-y-3 border-t border-subtle p-4">
                  <label className="block text-xs font-bold">
                    Reply to {selectedConversation.name}
                    <textarea rows="3" value={body} onChange={(event) => setBody(event.target.value)}
                      placeholder="Write your message…" className="field h-auto py-2" />
                  </label>
                  {canLinkRequest && <label className="block text-xs font-bold">
                    Related request (optional)
                    <select value={relatedRequest} onChange={(event) => setRelatedRequest(event.target.value)} className="field">
                      <option value="">No related request</option>
                      {requestOptions.map((request) => <option key={request.id} value={request.id}>{request.reference} · {request.title}</option>)}
                      {relatedRequest && !requestOptions.some((request) => String(request.id) === String(relatedRequest)) &&
                        <option value={relatedRequest}>Request #{relatedRequest}</option>}
                    </select>
                  </label>}
                  <AttachmentPicker files={files} onChange={setFiles} disabled={sending} />
                  <button type="submit" disabled={sending || (!body.trim() && !files.length)} className={primaryButtonClass()}>
                    <Send size={14} />{sending ? 'Sending…' : 'Send message'}
                  </button>
                </form> : <div className="border-t border-subtle p-4 text-[11px] text-black">Department announcements are read-only.</div>}
              </>}
        </PageCard>
      </section>

      {detailsOpen && selectedConversation && <section className={`${mobileView === 'details' ? 'block' : 'hidden'} xl:block`} aria-label="Conversation details">
        <ConversationDetails conversation={selectedConversation} thread={thread}
          onClose={() => { setDetailsOpen(false); setMobileView('thread'); }}
          onDownload={downloadAttachment} onError={downloadError} />
      </section>}
    </div>

    <button type="button" onClick={() => navigate(dashboardPage(portal))}
      className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-black hover:underline">
      <ArrowLeft size={14} />Back to dashboard <ChevronRight size={12} className="hidden" />
    </button>
  </>;
}

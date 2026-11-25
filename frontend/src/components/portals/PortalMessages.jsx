import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, Megaphone, Paperclip, Send
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import {
  AttachmentPicker, EmptyState, ErrorState, LoadingState, PageHeader,
  PortalBadge, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import { filesToAttachments } from '../../utils/attachments.js';

function ConversationRow({ conversation, active, onClick }) {
  return <button type="button" onClick={onClick}
    className={`flex w-full items-center gap-3 border-b border-subtle px-4 py-3 text-left transition ${active ? 'bg-white' : 'hover:bg-white'}`}>
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-extrabold ${active ? 'border border-brand bg-white text-black' : 'bg-white text-muted'}`}>
      {String(conversation.name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-ink">{conversation.name}</span>
        {conversation.lastAt && <span className="shrink-0 text-[10px] text-muted">{dateLabel(conversation.lastAt, { month: 'short', day: 'numeric' })}</span>}
      </span>
      <span className="mt-1 block truncate text-[11px] text-muted">{conversation.lastBody || 'No messages yet'}</span>
      {conversation.lastRequisitionReference && <span className="mt-1 block text-[10px] font-semibold text-black">Re: {conversation.lastRequisitionReference}</span>}
    </span>
    {Number(conversation.unreadCount) > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full border border-brand bg-white px-1 text-[10px] font-bold text-black">{conversation.unreadCount}</span>}
  </button>;
}

function MessageBubble({ message, userId }) {
  const mine = message.senderId === userId;
  return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[85%] rounded-2xl border border-brand px-4 py-3 sm:max-w-[70%] ${mine ? 'rounded-br-sm bg-white text-black' : 'rounded-bl-sm bg-white text-ink'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold">
        <span>{mine ? 'You' : message.senderName || 'Other party'}</span>
        <span className={mine ? 'text-black' : 'text-muted'}>{dateTimeLabel(message.createdAt)}</span>
        {mine && <Check size={11} className="text-black" />}
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-5">{message.body || 'Document attached'}</p>
      {message.requisitionReference && <div className={`mt-2 rounded px-2 py-1 text-[10px] font-bold ${mine ? 'bg-white' : 'bg-white'}`}>
        Related request: {message.requisitionReference}
      </div>}
      {Number(message.attachmentCount) > 0 && <div className={`mt-2 flex items-center gap-1 text-[10px] font-semibold ${mine ? 'text-black' : 'text-muted'}`}>
        <Paperclip size={11} />{message.attachmentCount} attachment{message.attachmentCount > 1 ? 's' : ''}
      </div>}
    </div>
  </div>;
}

export default function PortalMessages({ portal, portalApi, query = {}, navigate, initial = null, userId = null }) {
  const isSupervisor = portal === 'supervisor';
  const inboxPage = isSupervisor ? 'Department Messages' : 'Messages';
  const [conversations, setConversations] = useState(initial?.conversations || []);
  const [announcements, setAnnouncements] = useState(initial?.announcements || []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(query.userId ? Number(query.userId) : null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [body, setBody] = useState('');
  const [relatedRequest, setRelatedRequest] = useState(query.request || '');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [requestOptions, setRequestOptions] = useState([]);
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementFiles, setAnnouncementFiles] = useState([]);
  const [announcementBusy, setAnnouncementBusy] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getConversations();
      setConversations(response.conversations || []);
      setAnnouncements(response.announcements || []);
    } catch (exception) {
      setError(exception.message || 'Conversations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    let active = true;
    const getter = isSupervisor ? portalApi.getSupervisorRequests : portalApi.getRequesterRequests;
    getter({ page: 1, limit: 100, status: '' })
      .then((response) => { if (active) setRequestOptions(response.requisitions || []); })
      .catch(() => { if (active) setRequestOptions([]); });
    return () => { active = false; };
  }, [portalApi, isSupervisor]);

  useEffect(() => {
    if (query.userId && Number(query.userId) !== selectedId) setSelectedId(Number(query.userId));
  }, [query.userId]);

  useEffect(() => {
    if (!selectedId && !query.userId && conversations.length) setSelectedId(Number(conversations[0].id));
  }, [conversations, selectedId, query.userId]);

  useEffect(() => { if (query.request) setRelatedRequest(String(query.request)); }, [query.request]);

  const loadThread = useCallback(async () => {
    if (!selectedId) { setThread(null); return; }
    setThreadLoading(true); setThreadError('');
    try {
      const response = await portalApi.getThread(selectedId);
      setThread(response);
      await loadInbox();
    } catch (exception) {
      setThreadError(exception.message || 'Conversation could not be loaded.');
      setThread(null);
    } finally {
      setThreadLoading(false);
    }
  }, [portalApi, selectedId, loadInbox]);

  useEffect(() => { loadThread(); }, [loadThread]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => Number(conversation.id) === selectedId),
    [conversations, selectedId]
  );

  function selectConversation(conversation) {
    setSelectedId(Number(conversation.id));
    const next = { ...query, userId: conversation.id };
    delete next.request;
    navigate(inboxPage, next);
  }

  async function send(event) {
    event.preventDefault();
    if (!selectedId || (!body.trim() && !files.length)) return;
    setSending(true); setError('');
    try {
      const attachments = files.length ? await filesToAttachments(files) : undefined;
      await portalApi.sendMessage({
        recipientId: selectedId,
        body: body.trim(),
        requisitionId: relatedRequest ? Number(relatedRequest) : undefined,
        attachments
      });
      setBody(''); setFiles([]);
      await loadThread();
    } catch (exception) {
      setError(exception.message || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  async function sendAnnouncement(event) {
    event.preventDefault();
    if (!isSupervisor || (!announcementBody.trim() && !announcementFiles.length)) return;
    setAnnouncementBusy(true); setAnnouncementError('');
    try {
      const attachments = announcementFiles.length ? await filesToAttachments(announcementFiles) : undefined;
      await portalApi.sendMessage({ announcement: true, body: announcementBody.trim(), attachments });
      setAnnouncementBody(''); setAnnouncementFiles([]); setShowAnnouncementComposer(false);
      await loadInbox();
    } catch (exception) {
      setAnnouncementError(exception.message || 'Announcement could not be sent.');
    } finally {
      setAnnouncementBusy(false);
    }
  }

  async function markRead(announcement) {
    try {
      await portalApi.markMessageRead(announcement.id);
      setAnnouncements((current) => current.map((item) => item.id === announcement.id ? { ...item, isRead: true } : item));
    } catch (exception) {
      setError(exception.message || 'Could not mark the announcement as read.');
    }
  }

  return <>
    <PageHeader
      eyebrow={isSupervisor ? 'Department communication' : 'Your communication'}
      title={isSupervisor ? 'Department messages' : 'Messages'}
      description={isSupervisor
        ? 'Private conversations with Requesters in your Department, plus Department-wide announcements.'
        : 'Your direct line to the assigned Department Supervisor, plus Department announcements.'}
      actions={isSupervisor && <button type="button" onClick={() => setShowAnnouncementComposer((open) => !open)} className={primaryButtonClass()}>
        <Megaphone size={14} />{showAnnouncementComposer ? 'Hide composer' : 'New announcement'}
      </button>}
    />

    <ErrorState message={error} onRetry={loadInbox} />

    {showAnnouncementComposer && isSupervisor && <PageCard title="Department announcement" description="Sent to every active Requester in your Department.">
      <form onSubmit={sendAnnouncement} className="space-y-4 p-5">
        <label className="block text-xs font-bold">
          Announcement
          <textarea rows="3" value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)}
            placeholder="Share an update with all Requesters…" className="field h-auto py-2" />
        </label>
        <AttachmentPicker files={announcementFiles} onChange={setAnnouncementFiles} />
        <ErrorState message={announcementError} />
        <button type="submit" disabled={announcementBusy || (!announcementBody.trim() && !announcementFiles.length)} className={primaryButtonClass()}>
          <Send size={14} />{announcementBusy ? 'Sending…' : 'Send announcement'}
        </button>
      </form>
    </PageCard>}

    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <PageCard title="Conversations" description={`${conversations.length} ${isSupervisor ? 'Requester' : 'Supervisor'} contact${conversations.length === 1 ? '' : 's'}`}>
        {loading && !initial ? <LoadingState label="Loading conversations…" /> : conversations.length ?
          <div className="max-h-[560px] overflow-y-auto">
            {conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation}
              active={Number(conversation.id) === selectedId} onClick={() => selectConversation(conversation)} />)}
          </div> :
          <EmptyState title="No contacts available" description={isSupervisor
            ? 'Active Requesters in your Department will appear here.'
            : 'Your assigned Department Supervisor will appear here.'} />}
      </PageCard>

      <PageCard
        title={activeConversation ? activeConversation.name : 'Select a conversation'}
        description={activeConversation ? `${activeConversation.email || 'Department contact'}${activeConversation.lastRequisitionReference ? ` · Re: ${activeConversation.lastRequisitionReference}` : ''}` : 'Choose a contact to view the thread.'}>
        {threadLoading ? <LoadingState label="Opening conversation…" /> : threadError ? <ErrorState message={threadError} onRetry={loadThread} /> :
          !selectedId ? <EmptyState title="No conversation selected" description="Pick a contact on the left to read and reply to messages." /> :
            <>
              <div className="flex max-h-[440px] flex-col gap-3 overflow-y-auto bg-white p-4">
                {thread?.messages?.length ? thread.messages.map((message) => <MessageBubble key={message.id} message={message} userId={userId} />)
                  : <EmptyState title="No messages yet" description="Start the conversation with a message below." />}
              </div>
              <form onSubmit={send} className="space-y-3 border-t border-subtle p-4">
                <label className="block text-xs font-bold">
                  Reply to {activeConversation?.name || 'contact'}
                  <textarea rows="3" value={body} onChange={(event) => setBody(event.target.value)}
                    placeholder="Write your message…" className="field h-auto py-2" />
                </label>
                <label className="block text-xs font-bold">
                  Related request (optional)
                  <select value={relatedRequest} onChange={(event) => setRelatedRequest(event.target.value)} className="field">
                    <option value="">No related request</option>
                    {requestOptions.map((request) => <option key={request.id} value={request.id}>{request.reference} · {request.title}</option>)}
                    {relatedRequest && !requestOptions.some((request) => String(request.id) === String(relatedRequest)) &&
                      <option value={relatedRequest}>Request #{relatedRequest}</option>}
                  </select>
                </label>
                <AttachmentPicker files={files} onChange={setFiles} />
                <button type="submit" disabled={sending || (!body.trim() && !files.length)} className={primaryButtonClass()}>
                  <Send size={14} />{sending ? 'Sending…' : 'Send message'}
                </button>
              </form>
            </>}
      </PageCard>
    </div>

    <PageCard title="Announcements" description={isSupervisor ? 'Announcements you have sent to the Department.' : 'Updates from your Department Supervisor.'}
      action={<PortalBadge tone="indigo"><Megaphone size={11} />{announcements.filter((item) => !item.isRead).length} unread</PortalBadge>}>
      {announcements.length ? <div className="divide-y">
        {announcements.map((announcement) => <div key={announcement.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${announcement.isRead ? '' : 'bg-white'}`}>
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted">
              <span>{announcement.senderName || 'Department Supervisor'}</span>
              <span>·</span><span>{dateTimeLabel(announcement.createdAt)}</span>
              {!announcement.isRead && <PortalBadge tone="indigo">New</PortalBadge>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{announcement.body}</p>
          </div>
          {!announcement.isRead && <button type="button" onClick={() => markRead(announcement)} className={secondaryButtonClass()}>
            <Check size={13} />Mark as read
          </button>}
        </div>)}
      </div> : <EmptyState title="No announcements" description="Department-wide updates will appear here." />}
    </PageCard>

    <button type="button" onClick={() => navigate(isSupervisor ? 'Supervisor Dashboard' : 'Requester Dashboard')}
      className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-black hover:underline">
      <ArrowLeft size={14} />Back to dashboard <ChevronRight size={12} className="hidden" />
    </button>
  </>;
}

import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, ChevronRight } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import { EmptyState, ErrorState, PageHeader, PortalBadge, primaryButtonClass } from './PortalUi.jsx';
import { dateTimeLabel } from '../../utils/format.js';
import { parseRoute } from '../../utils/routes.js';

function destinationLabel(link) {
  const parsed = parseRoute(link);
  return parsed.page || 'workspace';
}

export default function PortalNotifications({ notifications = [], portalApi, onOpenNotification, navigate, portal = 'requester' }) {
  const [items, setItems] = useState(notifications);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { setItems(notifications); }, [notifications]);

  const unread = items.filter((item) => !item.isRead).length;

  async function markRead(notification) {
    setBusyId(notification.id); setError('');
    try {
      await portalApi.markNotificationRead(notification.id);
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
      await portalApi.reload();
    } catch (exception) {
      setError(exception.message || 'Could not mark the notification as read.');
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    const pending = items.filter((item) => !item.isRead);
    if (!pending.length) return;
    setError('');
    try {
      await Promise.all(pending.map((item) => portalApi.markNotificationRead(item.id)));
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      await portalApi.reload();
    } catch (exception) {
      setError(exception.message || 'Some notifications could not be updated.');
    }
  }

  return <>
    <PageHeader
      eyebrow="Stay up to date"
      title="Notifications"
      description="Requests, approvals, messages and Department announcements in one place."
      actions={unread > 0 && <button type="button" onClick={markAllRead} className={primaryButtonClass()}>
        <CheckCheck size={14} />Mark all as read
      </button>}
    />

    <ErrorState message={error} onRetry={portalApi.reload} />

    <PageCard title="All notifications" description={unread ? `${unread} unread` : 'You are all caught up.'}
      action={<PortalBadge tone={unread ? 'amber' : 'emerald'}><Bell size={11} />{unread} unread</PortalBadge>}>
      {items.length ? <div className="divide-y">
        {items.map((notification) => {
          const link = notification.link || '';
          const canOpen = Boolean(parseRoute(link).portal);
          return <div key={notification.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${notification.isRead ? '' : 'bg-white'}`}>
            <button type="button" disabled={!canOpen} onClick={() => onOpenNotification(notification)}
              className="min-w-0 flex-1 text-left disabled:cursor-default">
              <div className="flex flex-wrap items-center gap-2">
                {!notification.isRead && <span className="h-2 w-2 rounded-full bg-reference" />}
                <span className="text-xs font-bold text-ink">{notification.title}</span>
                {!notification.isRead && <PortalBadge tone="rose">New</PortalBadge>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{notification.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                <span>{dateTimeLabel(notification.createdAt)}</span>
                {canOpen && <><span>·</span><span className="font-bold text-black">Open {destinationLabel(link)}</span><ChevronRight size={11} className="text-black" /></>}
              </div>
            </button>
            {!notification.isRead && <button type="button" disabled={busyId === notification.id} onClick={() => markRead(notification)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand bg-white px-3 py-1.5 text-[11px] font-bold text-muted hover:text-black disabled:opacity-50">
              <Check size={12} />{busyId === notification.id ? 'Saving…' : 'Mark read'}
            </button>}
          </div>;
        })}
      </div> : <EmptyState title="No notifications" description="Notices about your requests and messages will appear here." />}
    </PageCard>

    <button type="button" onClick={() => navigate(portal === 'supervisor' ? 'Supervisor Dashboard' : 'Requester Dashboard')} className="mt-4 text-xs font-bold text-black hover:underline">
      Back to dashboard
    </button>
  </>;
}

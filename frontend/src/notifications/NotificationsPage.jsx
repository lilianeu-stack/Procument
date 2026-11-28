import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Bell, Check, CheckCheck, Info, Trash2
} from 'lucide-react';
import PageCard from '../components/ui/PageCard.jsx';
import { EmptyState, ErrorState, PortalBadge, primaryButtonClass } from '../components/portals/PortalUi.jsx';
import { dateTimeLabel } from '../utils/format.js';
import { parseRoute } from '../utils/routes.js';
import { normalizeType } from './NotificationProvider.jsx';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['error', 'Errors'],
  ['warning', 'Warnings'],
  ['success', 'Success'],
  ['information', 'Information']
];

const TYPE_META = {
  error: { label: 'Error', icon: AlertCircle, background: '#FEF2F2', border: 'rgba(185, 28, 28, 0.24)' },
  warning: { label: 'Warning', icon: AlertTriangle, background: '#FFFBEB', border: 'rgba(180, 83, 9, 0.24)' },
  success: { label: 'Success', icon: Check, background: '#F0FDF4', border: 'rgba(21, 128, 61, 0.24)' },
  information: { label: 'Information', icon: Info, background: '#EFF6FF', border: 'rgba(29, 78, 216, 0.22)' }
};

function noticeType(notice) {
  return normalizeType(notice?.type || notice?.notificationType || notice?.category);
}

function destinationLabel(link) {
  return parseRoute(link || '').page || 'workspace';
}

export default function NotificationsPage({
  notifications = [], counts = {}, portalApi, onOpenNotification, navigate, portal = 'admin', id
}) {
  const [items, setItems] = useState(notifications);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => { setItems(Array.isArray(notifications) ? notifications : []); }, [notifications]);

  const backendCounts = counts?.notificationCounts || {};
  const unread = Number(counts?.notificationUnread ?? items.filter((item) => !item.isRead).length) || 0;
  const filterCount = (value) => Number(
    value === 'all' ? backendCounts.total : value === 'unread' ? unread : backendCounts[value]
  ) || 0;
  const visible = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unread') return items.filter((item) => !item.isRead);
    return items.filter((item) => noticeType(item) === filter);
  }, [filter, items]);

  async function refresh() {
    setItems(await portalApi.getNotifications());
    if (portalApi.reload) await portalApi.reload();
  }

  async function markRead(notification) {
    setBusyId(notification.id); setError('');
    try {
      await portalApi.markNotificationRead(notification.id);
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
      await portalApi.reload?.();
    } catch (exception) {
      setError(exception.message || 'Could not mark the notification as read.');
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    if (!unread && !items.some((item) => !item.isRead)) return;
    setBusyAll(true); setError('');
    try {
      await portalApi.markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      await portalApi.reload?.();
    } catch (exception) {
      setError(exception.message || 'Some notifications could not be updated.');
    } finally {
      setBusyAll(false);
    }
  }

  async function remove(notification) {
    setBusyId(notification.id); setError('');
    try {
      await portalApi.deleteNotification(notification.id);
      setItems((current) => current.filter((item) => item.id !== notification.id));
      await portalApi.reload?.();
    } catch (exception) {
      setError(exception.message || 'Could not dismiss the notification.');
    } finally {
      setBusyId(null);
    }
  }

  return <div className="space-y-5">
    <ErrorState message={error} onRetry={refresh} />
    <PageCard title="All notifications" description={unread ? `${unread} unread across this workspace` : 'You are all caught up.'}
      action={<div className="flex flex-wrap items-center gap-2">
        <PortalBadge tone={unread ? 'amber' : 'emerald'}><Bell size={11} />{unread} unread</PortalBadge>
        {unread > 0 && <button type="button" disabled={busyAll} onClick={markAllRead} className={primaryButtonClass()}>
          <CheckCheck size={14} />Mark all as read
        </button>}
      </div>}>
      <div id={id} className="flex flex-wrap items-center gap-1 border-b border-subtle bg-white px-5 py-3" role="tablist" aria-label="Notification filters">
        {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value}
          onClick={() => setFilter(value)}
          className={`rounded-md border px-2.5 py-1.5 text-[10px] font-bold ${filter === value ? 'border-accent-border bg-accent-tint text-black' : 'border-brand bg-white text-black'}`}>
          {label}{filterCount(value) ? ` ${filterCount(value)}` : ''}
        </button>)}
      </div>

      {visible.length ? <div className="divide-y divide-subtle">
        {visible.map((notification) => {
          const type = noticeType(notification);
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          const canOpen = Boolean(parseRoute(notification.link || notification.actionUrl || '').portal);
          return <article key={notification.id} className={`flex flex-wrap items-start gap-3 px-5 py-4 ${notification.isRead ? 'bg-white' : 'bg-accent-row'}`}>
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border"
              style={{ backgroundColor: meta.background, borderColor: meta.border }}>
              <Icon size={14} aria-hidden="true" />
            </span>
            <button type="button" disabled={!canOpen} onClick={() => onOpenNotification?.(notification)} className="min-w-0 flex-1 text-left disabled:cursor-default">
              <div className="flex flex-wrap items-center gap-2">
                {!notification.isRead && <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-black">New</span>}
                <span className="text-xs font-bold text-black">{notification.title}</span>
                <PortalBadge tone="slate">{meta.label}</PortalBadge>
                {notification.module && <span className="text-[10px] text-black">· {notification.module}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-black">{notification.body}</p>
              {notification.recommendedAction && <p className="mt-1 text-[10px] text-black">{notification.recommendedAction}</p>}
              <p className="mt-1.5 text-[10px] text-black">
                {dateTimeLabel(notification.createdAt)}
                {canOpen && <><span> · </span><span className="font-bold text-black">Open {destinationLabel(notification.link || notification.actionUrl)}</span></>}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              {!notification.isRead && <button type="button" disabled={busyId === notification.id} onClick={() => markRead(notification)}
                className="inline-flex items-center gap-1 rounded-lg border border-brand bg-white px-3 py-1.5 text-[11px] font-bold text-black disabled:cursor-not-allowed">
                <Check size={12} />{busyId === notification.id ? 'Saving…' : 'Mark read'}
              </button>}
              <button type="button" disabled={busyId === notification.id} onClick={() => remove(notification)} aria-label={`Dismiss ${notification.title}`}
                className="rounded-lg border border-brand bg-white p-1.5 text-black disabled:cursor-not-allowed">
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
          </article>;
        })}
      </div> : <EmptyState title="No notifications" description={filter === 'all' ? 'Notices will appear here when something needs your attention.' : `No notifications match ${filter}.`} />}
    </PageCard>

    <button type="button" onClick={() => navigate(portal === 'supervisor' ? 'Supervisor Dashboard'
      : portal === 'stockkeeper' ? 'Dashboard' : portal === 'requester' ? 'Requester Dashboard' : 'Overview')}
      className="text-xs font-bold text-black hover:underline">
      Back to dashboard
    </button>
  </div>;
}

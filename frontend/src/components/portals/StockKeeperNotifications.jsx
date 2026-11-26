import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, Filter } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import { dateTimeLabel } from '../../utils/format.js';
import { parseRoute } from '../../utils/routes.js';
import {
  EmptyState, ErrorState, PageHeader, PortalBadge, primaryButtonClass
} from './PortalUi.jsx';

const TYPES = [
  ['all', 'All types'],
  ['stock_request', 'Approved requests'],
  ['stock_in', 'Stock in'],
  ['stock_out', 'Stock out'],
  ['low_stock', 'Low stock'],
  ['zero_stock', 'Zero balance'],
  ['adjustment', 'Adjustments']
];

export default function StockKeeperNotifications({ notifications = [], portalApi, onOpenNotification }) {
  const [items, setItems] = useState(notifications);
  const [type, setType] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setItems(notifications); }, [notifications]);
  const unread = items.filter((item) => !item.isRead).length;
  const filtered = type === 'all' ? items : items.filter((item) => item.category === type);

  async function markRead(notification) {
    setError('');
    setBusy(true);
    try {
      await portalApi.markNotificationRead(notification.id);
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
      await portalApi.reload();
    } catch (exception) {
      setError(exception.message || 'Could not mark the notification as read.');
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    if (!unread) return;
    setError('');
    setBusy(true);
    try {
      await portalApi.markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      await portalApi.reload();
    } catch (exception) {
      setError(exception.message || 'Could not mark notifications as read.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-5">
    <PageHeader eyebrow="Inventory updates" title="Notification"
      description="Approved issues, stock transactions, adjustments, and inventory alerts."
      actions={unread > 0 && <button type="button" disabled={busy} onClick={markAllRead} className={primaryButtonClass()}>
        <CheckCheck size={14} />Mark all as read
      </button>} />
    <ErrorState message={error} onRetry={portalApi.reload} />
    <PageCard title="Notifications" description={unread ? `${unread} unread` : 'You are all caught up.'}
      action={<PortalBadge tone={unread ? 'amber' : 'emerald'}><Bell size={11} />{unread} unread</PortalBadge>}>
      <div className="flex items-center gap-2 border-b border-subtle bg-white px-5 py-3">
        <Filter size={13} className="text-black" />
        <label className="text-[10px] font-bold uppercase text-black" htmlFor="stock-notification-type">Type</label>
        <select id="stock-notification-type" value={type} onChange={(event) => setType(event.target.value)}
          className="rounded-lg border border-brand bg-white px-2 py-1.5 text-xs">
          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {filtered.length ? <div className="divide-y divide-subtle">
        {filtered.map((notification) => {
          const canOpen = Boolean(parseRoute(notification.link || '').portal);
          return <div key={notification.id} className={`flex flex-wrap items-start gap-3 px-5 py-4 ${notification.isRead ? '' : 'bg-white'}`}>
            <button type="button" disabled={!canOpen} onClick={() => onOpenNotification(notification)} className="min-w-0 flex-1 text-left disabled:cursor-default">
              <div className="flex flex-wrap items-center gap-2">
                {!notification.isRead && <span className="h-2 w-2 rounded-full bg-reference" />}
                <span className="text-xs font-bold">{notification.title}</span>
                <PortalBadge tone="slate">{TYPES.find(([value]) => value === notification.category)?.[1] || 'System'}</PortalBadge>
              </div>
              <p className="mt-1 text-xs leading-5 text-black">{notification.body}</p>
              <p className="mt-1 text-[10px] text-black">{dateTimeLabel(notification.createdAt)}</p>
            </button>
            {!notification.isRead && <button type="button" disabled={busy} onClick={() => markRead(notification)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand bg-white px-3 py-1.5 text-[11px] font-bold text-black hover:text-black disabled:opacity-50">
              <Check size={12} />Mark read
            </button>}
          </div>;
        })}
      </div> : <EmptyState title="No notifications" description={type === 'all' ? 'Inventory updates will appear here.' : 'No notifications match this type.'} />}
    </PageCard>
  </div>;
}

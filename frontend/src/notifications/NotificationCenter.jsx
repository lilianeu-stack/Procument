import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Bell, Check, CheckCheck, Info, Trash2
} from 'lucide-react';
import { dateTimeLabel } from '../utils/format.js';
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

export default function NotificationCenter({
  open, onToggle, notifications = [], counts = {}, busy = false,
  onNotification, onMarkRead, onMarkAllRead, onDelete, onViewAll
}) {
  const [filter, setFilter] = useState('all');
  const containerRef = useRef(null);
  const backendCounts = counts?.notificationCounts || {};
  const unread = Number(counts?.notificationUnread ?? notifications.filter((item) => !item.isRead).length) || 0;
  const filterCount = (value) => Number(
    value === 'all' ? backendCounts.total : value === 'unread' ? unread : backendCounts[value]
  ) || 0;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onToggle(false);
    };
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) onToggle(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onToggle]);

  const visible = useMemo(() => {
    const items = Array.isArray(notifications) ? notifications : [];
    if (filter === 'all') return items.slice(0, 8);
    if (filter === 'unread') return items.filter((item) => !item.isRead).slice(0, 8);
    return items.filter((item) => noticeType(item) === filter).slice(0, 8);
  }, [filter, notifications]);

  return <div className="relative" ref={containerRef}>
    <button aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={Boolean(open)}
      onClick={() => onToggle(!open)}
      className="relative grid h-9 w-9 place-items-center rounded-lg text-black transition-colors hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
      <Bell size={17} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true"
        className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border border-strong bg-white px-1 text-[9px] font-extrabold text-black">
        {unread > 99 ? '99+' : unread}
      </span>}
    </button>

    {open && <section aria-label="Notification center"
      className="absolute right-0 top-11 z-50 w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-strong bg-white shadow-dashboard">
      <div className="border-b border-subtle px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-extrabold text-black">Notification center</h2>
            <p className="mt-0.5 text-[10px] text-black">{unread} unread · {notifications.length} recent</p>
          </div>
          <button type="button" disabled={busy || !unread} onClick={() => onMarkAllRead?.()}
            className="inline-flex items-center gap-1 rounded-lg border border-brand bg-white px-2 py-1.5 text-[10px] font-bold text-black disabled:cursor-not-allowed">
            <CheckCheck size={12} aria-hidden="true" />Mark all
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Notification filters">
          {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-md border px-2 py-1 text-[10px] font-bold ${filter === value ? 'border-accent-border bg-accent-tint text-black' : 'border-brand bg-white text-black'}`}>
            {label}{filterCount(value) ? ` ${filterCount(value)}` : ''}
          </button>)}
        </div>
      </div>

      <div className="max-h-[340px] overflow-y-auto">
        {visible.length ? visible.map((notice) => {
          const type = noticeType(notice);
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          return <article key={notice.id} className={`border-b border-subtle p-3 last:border-b-0 ${notice.isRead ? 'bg-white' : 'bg-accent-row'}`}>
            <button type="button" onClick={() => onNotification?.(notice)} className="flex w-full gap-2 text-left">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border"
                style={{ backgroundColor: meta.background, borderColor: meta.border }}>
                <Icon size={13} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {!notice.isRead && <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-black">New</span>}
                  <span className="text-xs font-bold text-black">{notice.title}</span>
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-black">{notice.body}</span>
                <span className="mt-1 block text-[9px] text-black">
                  {meta.label}{notice.module ? ` · ${notice.module}` : ''} · {dateTimeLabel(notice.createdAt)}
                </span>
              </span>
            </button>
            <div className="mt-2 flex items-center justify-end gap-2">
              {!notice.isRead && <button type="button" disabled={busy} onClick={() => onMarkRead?.(notice.id)}
                className="inline-flex items-center gap-1 rounded-md border border-brand bg-white px-2 py-1 text-[10px] font-bold text-black disabled:cursor-not-allowed">
                <Check size={11} aria-hidden="true" />Mark read
              </button>}
              <button type="button" disabled={busy} onClick={() => onDelete?.(notice.id)} aria-label={`Dismiss ${notice.title}`}
                className="rounded-md border border-brand bg-white p-1 text-black disabled:cursor-not-allowed">
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
          </article>;
        }) : <p className="px-3 py-8 text-center text-xs text-black">No notifications match this filter.</p>}
      </div>

      <button type="button" onClick={() => { onViewAll?.(); onToggle(false); }}
        className="w-full border-t border-subtle bg-white px-3 py-2.5 text-[11px] font-bold text-black hover:bg-accent-tint">
        View all notifications
      </button>
    </section>}
  </div>;
}

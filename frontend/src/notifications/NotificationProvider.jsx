import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { api, setApiErrorHandler, setApiSuccessHandler } from '../services/api.js';

const NotificationContext = createContext(null);
const QUEUE_KEY = 'pims-pending-notifications';
const DEDUPE_WINDOW_MS = 90000;
const MAX_VISIBLE_TOASTS = 5;

export const NOTIFICATION_TYPES = ['error', 'warning', 'success', 'information'];

const TYPE_META = {
  error: { label: 'Error', icon: AlertCircle, background: '#FEF2F2', border: 'rgba(185, 28, 28, 0.28)' },
  warning: { label: 'Warning', icon: AlertTriangle, background: '#FFFBEB', border: 'rgba(180, 83, 9, 0.28)' },
  success: { label: 'Success', icon: CheckCircle2, background: '#F0FDF4', border: 'rgba(21, 128, 61, 0.28)' },
  information: { label: 'Information', icon: Info, background: '#EFF6FF', border: 'rgba(29, 78, 216, 0.25)' }
};

export function normalizeType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'info') return 'information';
  return NOTIFICATION_TYPES.includes(type) ? type : 'information';
}

function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    if (items.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    else localStorage.removeItem(QUEUE_KEY);
  } catch { /* private browser storage can be unavailable */ }
}

function moduleFromPath(path) {
  const value = String(path || '');
  if (value.startsWith('/messages')) return 'Messages';
  if (value.startsWith('/notifications')) return 'Notifications';
  if (value.startsWith('/portal/requester')) return 'My Procurement Requests';
  if (value.startsWith('/portal/supervisor')) return 'Department Supervisor Portal';
  if (value.startsWith('/portal/stockkeeper')) return 'Stock Keeper Portal';
  if (value.startsWith('/rfqs')) return 'RFQs';
  if (value.startsWith('/purchase-order')) return 'Purchase orders';
  if (value.startsWith('/procurement')) return 'Procurement';
  if (value.startsWith('/inventory')) return 'Inventory';
  if (value.startsWith('/store-requests')) return 'Store requests';
  if (value.startsWith('/goods-receipts')) return 'Goods receipts';
  if (value.startsWith('/invoices')) return 'Invoices';
  if (value.startsWith('/suppliers')) return 'Suppliers';
  if (value.startsWith('/email')) return 'Email';
  if (value.startsWith('/admin')) return 'Administration';
  return 'Workspace';
}

function ToastViewport({ toasts, onDismiss }) {
  return <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-label="System notifications">
    {toasts.map((toast) => {
      const meta = TYPE_META[toast.type] || TYPE_META.information;
      const Icon = meta.icon;
      return <div key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'}
        data-notification-type={toast.type}
        className="pointer-events-auto rounded-xl border bg-white p-3 shadow-dashboard"
        style={{ backgroundColor: meta.background, borderColor: meta.border }}>
        <div className="flex items-start gap-3">
          <Icon size={18} aria-hidden="true" className="mt-px shrink-0 text-black" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-extrabold text-black">{toast.title}</p>
              <button type="button" onClick={() => onDismiss(toast.id)} aria-label={`Dismiss ${toast.title}`}
                className="rounded-md p-0.5 text-black">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-black">{toast.message}</p>
            <p className="mt-1.5 text-[10px] text-black">
              {toast.module ? `${toast.module} · ` : ''}{toast.timeLabel}
            </p>
            {toast.recommendedAction && !toast.action && <p className="mt-1 text-[10px] text-black">{toast.recommendedAction}</p>}
            {toast.action && <button type="button" onClick={() => { toast.action.onClick(); onDismiss(toast.id); }}
              className="mt-2 rounded-lg border border-brand bg-white px-2.5 py-1 text-[10px] font-bold text-black">
              {toast.action.label}
            </button>}
          </div>
        </div>
      </div>;
    })}
  </div>;
}

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const recentRef = useRef(new Map());
  const sequenceRef = useRef(0);
  const flushingRef = useRef(false);

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || !localStorage.getItem('pims-token')) return;
    const queue = readQueue();
    if (!queue.length) return;
    flushingRef.current = true;
    const remaining = [];
    try {
      for (const item of queue) {
        try {
          await api('/notifications', {
            method: 'POST',
            body: JSON.stringify(item),
            suppressGlobalError: true
          });
        } catch (error) {
          if (error.status === 401) break;
          remaining.push(item);
        }
      }
    } finally {
      writeQueue(remaining);
      flushingRef.current = false;
    }
  }, []);

  const persist = useCallback(async (payload) => {
    if (!localStorage.getItem('pims-token')) return;
    try {
      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify(payload),
        suppressGlobalError: true
      });
    } catch (error) {
      if (error.status === 401) return;
      const queue = readQueue();
      const duplicate = queue.some((item) => item.dedupeKey && item.dedupeKey === payload.dedupeKey);
      if (!duplicate) queue.push(payload);
      writeQueue(queue.slice(-25));
    }
  }, []);

  const notify = useCallback((input = {}) => {
    const type = normalizeType(input.type);
    const title = String(input.title || TYPE_META[type].label).slice(0, 180);
    const message = String(input.message || input.body || '').trim().slice(0, 500);
    if (!message) return null;
    const dedupeKey = input.dedupeKey ? String(input.dedupeKey).slice(0, 191) : null;
    const now = Date.now();
    if (dedupeKey) {
      const recent = Number(recentRef.current.get(dedupeKey) || 0);
      if (recent && now - recent < DEDUPE_WINDOW_MS) return null;
      recentRef.current.set(dedupeKey, now);
    }
    const id = `toast-${++sequenceRef.current}`;
    const toast = {
      id, type, title, message,
      module: input.module || '',
      recommendedAction: input.recommendedAction || '',
      action: input.action || null,
      persistent: Boolean(input.persistent || type === 'error'),
      timeLabel: new Date().toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    };
    setToasts((current) => [...current.slice(-(MAX_VISIBLE_TOASTS - 1)), toast]);
    if (!toast.persistent) {
      const duration = type === 'success' ? 5000 : type === 'warning' ? 8000 : 6500;
      timersRef.current.set(id, window.setTimeout(() => dismiss(id), duration));
    }
    if (input.persist) {
      void persist({
        type, title, message,
        module: toast.module || undefined,
        relatedRecordId: input.relatedRecordId || undefined,
        actionUrl: input.actionUrl || undefined,
        recommendedAction: toast.recommendedAction || undefined,
        dedupeKey: dedupeKey || `client:${type}:${title}:${message}`
      });
    }
    return id;
  }, [dismiss, persist]);

  useEffect(() => {
    setApiErrorHandler((error) => {
      const path = String(error?.path || '');
      if (path.startsWith('/auth/') || path === '/notifications'
        || path.startsWith('/notifications/') || path === '/sidebar-counts') return;
      const status = Number(error?.status) || 0;
      const offline = status === 0 || status === 408;
      const type = offline || status >= 500 ? 'error' : 'warning';
      const title = offline ? 'Connection problem'
        : status === 403 || status === 401 ? 'Access denied'
          : status >= 500 ? 'System error' : 'Action failed';
      const message = String(error?.message || 'The request could not be completed.');
      notify({
        type,
        title,
        message,
        module: moduleFromPath(path),
        recommendedAction: offline
          ? 'Check your connection. The notice will be saved when the server is available again.'
          : status >= 500 ? 'Try again. If the problem continues, contact an administrator.'
            : 'Review your entry or access and try again.',
        dedupeKey: `api:${error?.method || 'GET'}:${path}:${status}:${message}`,
        persist: offline
      });
    });
    setApiSuccessHandler((path) => {
      const marker = `:${String(path || '')}:`;
      for (const key of recentRef.current.keys()) {
        if (key.includes(marker)) recentRef.current.delete(key);
      }
      void flushQueue();
    });
    const onOnline = () => { void flushQueue(); };
    window.addEventListener('online', onOnline);
    return () => {
      setApiErrorHandler(null);
      setApiSuccessHandler(null);
      window.removeEventListener('online', onOnline);
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [flushQueue, notify]);

  const run = useCallback(async (operation, options = {}) => {
    try {
      const result = await operation();
      if (options.success) {
        notify({ type: 'success', title: options.successTitle || 'Saved', message: options.success, module: options.module });
      }
      return result;
    } catch (error) {
      if (!error?.reported) {
        const status = Number(error?.status) || 0;
        notify({
          type: status >= 500 || status === 0 ? 'error' : 'warning',
          title: options.errorTitle || 'Operation failed',
          message: String(error?.message || 'The operation could not be completed.'),
          module: options.module,
          dedupeKey: options.dedupeKey,
          action: options.retry ? { label: 'Retry', onClick: options.retry } : null
        });
      }
      throw error;
    }
  }, [notify]);

  const value = useMemo(() => ({ notify, dismiss, run, flushQueue, toasts }), [notify, dismiss, run, flushQueue, toasts]);

  return <NotificationContext.Provider value={value}>
    {children}
    <ToastViewport toasts={toasts} onDismiss={dismiss} />
  </NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) return { notify: () => null, dismiss: () => {}, run: (operation) => operation(), flushQueue: async () => {}, toasts: [] };
  return context;
}

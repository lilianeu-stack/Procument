import { api } from './api.js';
import { PURCHASE_ORDERS_PAGE, RECEIVED_REQUESTS_PAGE } from '../utils/access.js';

// One request updates every sidebar link; counts themselves stay authoritative
// on the backend so no link ever derives a badge from a private list response.
export async function fetchSidebarCounts() {
  const result = await api('/sidebar-counts');
  return result?.counts && typeof result.counts === 'object' ? result.counts : {};
}

// Private Messages / Department Messages are deliberately absent: their badge
// clears only when the message itself is opened.
const MODULE_READ_PAGES = new Set([
  RECEIVED_REQUESTS_PAGE, 'RFQs', 'Email Inbox', PURCHASE_ORDERS_PAGE,
  'Approvals', 'Procurement Requests', 'Notifications',
  'My Procurement Requests', 'Requests from Supervisors', 'Stock Overview',
  'Stock In', 'Stock Out', 'Inventory Reports', 'Bin Card'
]);

export function shouldMarkModuleOnOpen(page) {
  return MODULE_READ_PAGES.has(page);
}

// Called after a page's own data has loaded, never on a bare navigation click.
export async function markModuleNotificationsRead(page) {
  const result = await api('/notifications/read-module', {
    method: 'PATCH',
    body: JSON.stringify({ page })
  });
  return Number(result?.updated) || 0;
}

export async function markAllNotificationsRead() {
  const result = await api('/notifications/read-all', { method: 'PATCH' });
  return Number(result?.updated) || 0;
}

export function badgeLabel(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return '';
  return value > 99 ? '99+' : String(Math.floor(value));
}

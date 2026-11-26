import { api } from './api.js';

// One request updates every sidebar link; counts themselves stay authoritative
// on the backend so no link ever derives a badge from a private list response.
export async function fetchSidebarCounts() {
  const result = await api('/sidebar-counts');
  return result?.counts && typeof result.counts === 'object' ? result.counts : {};
}

export function badgeLabel(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return '';
  return value > 99 ? '99+' : String(Math.floor(value));
}

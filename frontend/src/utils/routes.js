import { PORTALS } from './access.js';

const VALID_PORTALS = Object.values(PORTALS);

function parseQuery(raw) {
  const query = {};
  if (!raw) return query;
  const params = new URLSearchParams(raw);
  for (const [key, value] of params.entries()) {
    if (key) query[key] = value;
  }
  return query;
}

export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw) return { portal: null, page: null, query: {} };

  const queryIndex = raw.indexOf('?');
  const path = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? parseQuery(raw.slice(queryIndex + 1)) : {};

  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { portal: null, page: null, query };

  let portal;
  let page;
  try {
    portal = decodeURIComponent(parts[0]).toLowerCase();
    page = parts.slice(1).map((part) => decodeURIComponent(part)).join('/') || null;
  } catch {
    return { portal: null, page: null, query: {} };
  }
  if (!VALID_PORTALS.includes(portal)) return { portal: null, page: null, query: {} };
  return { portal, page, query };
}

export function buildRoute(portal, page, query = null) {
  const base = `#/${portal}/${encodeURIComponent(page || '')}`;
  if (!query || typeof query !== 'object') return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${base}?${suffix}` : base;
}

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

// Committee decision emails use a real token path instead of a hash fragment
// or query string so mail clients and link scanners cannot strip the token.
// Older emailed links used the hash form and the query form; both remain
// supported so committee members can still use the original email.
export function readRouteFromLocation(location) {
  const path = String(location?.pathname || '').replace(/\/+$/, '');

  const committeePath = /^\/committee-review\/([^/]+)$/.exec(path);
  if (committeePath) {
    let token = '';
    try { token = decodeURIComponent(committeePath[1]); }
    catch { token = committeePath[1]; }
    return {
      portal: PORTALS.COMMITTEE_REVIEW,
      page: 'Review',
      query: token ? { token } : {}
    };
  }

  if (path === '/committee-review') {
    const query = {};
    for (const [key, value] of new URLSearchParams(location?.search || '')) {
      if (key) query[key] = value;
    }
    return { portal: PORTALS.COMMITTEE_REVIEW, page: 'Review', query };
  }

  // Response forms sent to another person use a real public token path so the
  // link opens on any device. The older hash/query links stay valid.
  const responsePath = /^\/response\/([^/]+)$/.exec(path);
  if (responsePath) {
    let token = '';
    try { token = decodeURIComponent(responsePath[1]); }
    catch { token = responsePath[1]; }
    return {
      portal: PORTALS.RESPONSE,
      page: 'Response',
      query: token ? { token } : {}
    };
  }

  if (path === '/response') {
    const query = {};
    for (const [key, value] of new URLSearchParams(location?.search || '')) {
      if (key) query[key] = value;
    }
    return { portal: PORTALS.RESPONSE, page: 'Response', query };
  }

  const hash = String(location?.hash || '');
  if (hash && hash.length > 1) return parseRoute(hash);
  return parseRoute(hash);
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

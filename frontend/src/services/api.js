const API_URL = import.meta.env?.VITE_API_URL || '/api';
const REQUEST_TIMEOUT_MS = 20000;

let apiErrorHandler = null;
let apiSuccessHandler = null;

// The notification provider registers these once at the root. Keeping them as
// module-level callbacks avoids a circular import between the API client and
// the toast system while still letting every request share one error path.
export function setApiErrorHandler(handler) {
  apiErrorHandler = typeof handler === 'function' ? handler : null;
}

export function setApiSuccessHandler(handler) {
  apiSuccessHandler = typeof handler === 'function' ? handler : null;
}

function authHeaders(options) {
  const token = localStorage.getItem('pims-token');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  return {
    ...(!isFormData && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
}

function apiError(message, status, data, path, method, code) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  error.path = path;
  error.method = method;
  if (code) error.code = code;
  return error;
}

function reportError(error, options = {}) {
  if (options.suppressGlobalError) return;
  if (typeof apiErrorHandler === 'function') {
    try {
      apiErrorHandler(error);
      error.reported = true;
    } catch { /* notification UI must never break a request */ }
  }
}

function reportSuccess(path, method) {
  if (typeof apiSuccessHandler === 'function') {
    try { apiSuccessHandler(path, method); } catch { /* best-effort queued-error flush */ }
  }
}

async function fetchApi(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardSignal = () => controller.abort();
  if (options.signal) options.signal.addEventListener('abort', forwardSignal);

  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      method,
      signal: controller.signal,
      headers: authHeaders(options)
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError' && !options.signal?.aborted;
    const thrown = timedOut
      ? apiError('The server took too long to respond. Check your connection and try again.', 408, null, path, method, 'TIMEOUT')
      : apiError('Cannot reach the server. Check your connection and try again.', 0, null, path, method, 'NETWORK_ERROR');
    thrown.cause = error;
    reportError(thrown, options);
    throw thrown;
  } finally {
    window.clearTimeout(timeout);
    if (options.signal) options.signal.removeEventListener('abort', forwardSignal);
  }
}

function handleFailure(response, data, path, method, options = {}) {
  if (response.status === 401) localStorage.removeItem('pims-token');
  const message = data?.message || `Request failed (${response.status}).`;
  const error = apiError(message, response.status, data, path, method);
  error.requestId = data?.requestId || response.headers.get('X-Request-ID') || '';
  reportError(error, options);
  throw error;
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetchApi(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) handleFailure(response, data, path, method, options);
  reportSuccess(path, method);
  return data;
}

// Authenticated images cannot be loaded by a plain <img src>. This returns a
// blob so shared avatar components can create a short-lived object URL.
export async function apiBlob(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetchApi(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    handleFailure(response, data, path, method, options);
  }
  reportSuccess(path, method);
  return response.blob();
}

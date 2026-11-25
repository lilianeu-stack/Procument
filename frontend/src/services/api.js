const API_URL = import.meta.env.VITE_API_URL || '/api';

function authHeaders(options) {
  const token = localStorage.getItem('pims-token');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  return {
    ...(!isFormData && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
}

export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: authHeaders(options)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('pims-token');
    const error = new Error(data.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Authenticated images cannot be loaded by a plain <img src>. This returns a
// blob so shared avatar components can create a short-lived object URL.
export async function apiBlob(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: authHeaders(options)
  });
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('pims-token');
    const error = new Error(`Image request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.blob();
}

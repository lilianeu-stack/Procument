import { parseCsv } from './csv.js';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function filenameFromDisposition(header) {
  const match = String(header || '').match(/filename="?([^";]+)"?/i);
  return match ? match[1].trim() : null;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchExport(path) {
  const token = localStorage.getItem('pims-token');
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Download failed (${response.status}).`);
  }
  return response;
}

function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

// Print registers use the same unrestricted report query as the download
// actions. The backend CSV is the shared source of truth, so a printed table
// always contains every filtered row and never just the current page.
export async function fetchReportRows({ key, params = {}, reference = '' }) {
  const response = await fetchExport(withQuery(`/exports/${encodeURIComponent(key)}/csv`, {
    ...params,
    ...(reference ? { reference } : {})
  }));
  const table = parseCsv(await response.text());
  const headerIndex = table.findIndex((row, index) => index >= 2 && row.length > 1);
  if (headerIndex < 0) {
    return { columns: [], rows: [], metadata: table.map((cells) => cells[0] || '') };
  }
  return {
    columns: table[headerIndex],
    rows: table.slice(headerIndex + 1).filter((row) => row.length === table[headerIndex].length),
    metadata: table.slice(0, headerIndex).map((cells) => cells[0] || '')
  };
}

export async function downloadReport({ key, format = 'pdf', params = {}, reference = '' }) {
  const path = withQuery(`/exports/${encodeURIComponent(key)}/${format}`, {
    ...params,
    ...(reference ? { reference } : {})
  });
  const response = await fetchExport(path);
  const fallback = `${key}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const filename = filenameFromDisposition(response.headers.get('Content-Disposition')) || fallback;
  saveBlob(await response.blob(), filename);
  return filename;
}

export async function downloadRecord({ type, id, format = 'pdf', params = {} }) {
  const path = withQuery(`/exports/record/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${format}`, params);
  const response = await fetchExport(path);
  const fallback = `${type}-${id}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const filename = filenameFromDisposition(response.headers.get('Content-Disposition')) || fallback;
  saveBlob(await response.blob(), filename);
  return filename;
}

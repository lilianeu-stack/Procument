const API_URL = import.meta.env.VITE_API_URL || '/api';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

export const ACCEPTED_ATTACHMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp'
];

export const ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';

const EXTENSION_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

function readableSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

// Returns a validated subset plus a user-facing error describing rejected files.
export function validateFiles(fileList, existingCount = 0) {
  const files = Array.from(fileList || []);
  if (!files.length) return { files: [], error: '' };
  if (existingCount + files.length > MAX_ATTACHMENTS) {
    return { files: [], error: `A maximum of ${MAX_ATTACHMENTS} attachments is allowed.` };
  }
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const inferredType = file.type || EXTENSION_TYPES[extension];
    // Keep the browser-provided MIME type when available; the backend validates it too.
    if (inferredType && !ACCEPTED_ATTACHMENT_TYPES.includes(inferredType)) {
      rejected.push(`${file.name} (unsupported type. Use PDF, document, spreadsheet, CSV, text, PNG, JPEG or WebP.)`);
    } else if (!inferredType) {
      rejected.push(`${file.name} (unknown file type)`);
    } else if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push(`${file.name} (${readableSize(file.size)} exceeds the 5 MB limit)`);
    } else if (!file.size) {
      rejected.push(`${file.name} (empty file)`);
    } else {
      accepted.push(file);
    }
  }
  return { files: accepted, error: rejected.join(' ') };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function attachmentMimeType(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return file?.type || EXTENSION_TYPES[extension] || 'application/octet-stream';
}

export async function filesToAttachments(files) {
  return Promise.all((files || []).map(async (file) => ({
    fileName: file.name,
    mimeType: attachmentMimeType(file),
    data: await fileToBase64(file)
  })));
}

// Opens a supported attachment (PDF, image, text) in a new tab for preview.
export async function previewBinary(path, fallbackName = 'preview') {
  const token = localStorage.getItem('pims-token');
  const response = await fetch(`${API_URL}${path}${path.includes('?') ? '&' : '?'}inline=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    let message = `Preview failed (${response.status}).`;
    try {
      const body = await response.clone().json();
      if (body?.message) message = body.message;
    } catch { /* non-JSON error response */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function downloadText(content, fileName) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileNameFromDisposition(disposition, fallback) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(disposition || ''));
  if (!match) return fallback;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

// Binary downloads must bypass api() because api() parses every response as JSON.
export async function downloadBinary(path, fallbackName = 'download') {
  const token = localStorage.getItem('pims-token');
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    let message = `Download failed (${response.status}).`;
    try {
      const body = await response.clone().json();
      if (body?.message) message = body.message;
    } catch { /* non-JSON error response */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFromDisposition(response.headers.get('content-disposition'), fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

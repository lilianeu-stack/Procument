import { useRef, useState } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, Download, FileText, Loader2, Paperclip, Plus, RefreshCw, Search, X
} from 'lucide-react';
import { badgeTone } from '../../utils/status.js';
import {
  ATTACHMENT_ACCEPT, formatFileSize, validateFiles
} from '../../utils/attachments.js';
import { dateTimeLabel } from '../../utils/format.js';

export function PortalBadge({ tone = 'slate', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeTone(tone)} ${className}`}>
    {children}
  </span>;
}

const STAT_TONES = {
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  blue: 'bg-blue-50 text-blue-700',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-700'
};

export function StatCard({ label, value, note, icon: Icon, tone = 'indigo', onClick }) {
  return <button type="button" onClick={onClick} disabled={!onClick}
    className={`rounded-xl border border-slate-100 bg-white p-4 text-left shadow-card transition sm:p-5 ${onClick ? 'hover:-translate-y-0.5 hover:shadow-lg' : 'cursor-default'}`}>
    <div className="flex items-start justify-between gap-2">
      <span className="text-[12px] font-semibold text-muted sm:text-[13px]">{label}</span>
      {Icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${STAT_TONES[tone] || STAT_TONES.indigo}`}><Icon size={17} /></span>}
    </div>
    <div className="display-font mt-3 text-[26px] font-extrabold tracking-tight">{value ?? '—'}</div>
    <div className="mt-1 text-[11px] text-muted">{note}</div>
  </button>;
}

export function LoadingState({ label = 'Loading…' }) {
  return <div role="status" className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted">
    <Loader2 size={16} className="animate-spin" />{label}
  </div>;
}

export function ErrorState({ message, onRetry }) {
  if (!message) return null;
  return <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
    <span className="flex items-center gap-2"><AlertCircle size={15} />{message}</span>
    {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold underline">
      <RefreshCw size={12} />Retry
    </button>}
  </div>;
}

export function EmptyState({ title = 'Nothing to show', description, action }) {
  return <div className="grid min-h-44 place-items-center px-5 py-10 text-center">
    <div className="max-w-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-muted"><FileText size={20} /></span>
      <p className="mt-3 text-sm font-bold text-ink">{title}</p>
      {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  </div>;
}

export function FilterBar({ children }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/40 px-4 py-4 sm:px-5">{children}</div>;
}

export function FilterField({ label, children, className = 'w-full sm:w-48' }) {
  return <label className={`block ${className}`}>
    <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    {children}
  </label>;
}

export function SearchField({ value, onChange, placeholder = 'Search…', className = 'w-full sm:w-64' }) {
  return <FilterField label="Search" className={className}>
    <span className="relative block">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="field pl-9" />
    </span>
  </FilterField>;
}

export function TableScroll({ minWidth = 900, children }) {
  return <div className="overflow-x-auto"><div style={{ minWidth }}>{children}</div></div>;
}

export function TextLink({ onClick, children, className = '' }) {
  return <button type="button" onClick={onClick} className={`text-xs font-bold text-brand hover:underline ${className}`}>{children}</button>;
}

export function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.pages <= 1) return null;
  const { page, pages, total, limit } = pagination;
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(page * limit, total);
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[11px] text-muted sm:px-5">
    <span>Showing {first}–{last} of {total}</span>
    <div className="flex items-center gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={14} /></button>
      <span className="font-bold text-ink">Page {page} of {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}
        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 disabled:opacity-40" aria-label="Next page"><ChevronRight size={14} /></button>
    </div>
  </div>;
}

export function KeyValue({ label, children, className = '' }) {
  return <div className={className}>
    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
    <dd className="mt-1 break-words text-xs font-semibold text-ink">{children ?? '—'}</dd>
  </div>;
}

export function AttachmentPicker({ files = [], onChange, error = '', disabled = false, hint }) {
  const inputRef = useRef(null);
  const [localError, setLocalError] = useState('');

  function addFiles(event) {
    const result = validateFiles(event.target.files, files.length);
    setLocalError(result.error);
    if (result.files.length) onChange([...files, ...result.files]);
    event.target.value = '';
  }

  return <div>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={addFiles} disabled={disabled} className="hidden" />
      <button type="button" disabled={disabled || files.length >= 5} onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-muted hover:border-brand hover:text-brand disabled:opacity-50">
        <Plus size={13} />Add attachments
      </button>
      <span className="text-[10px] text-muted">{files.length}/5 files · PDF, Word, Excel, CSV, TXT or image · 5 MB max each</span>
    </div>
    {hint && <p className="mt-1 text-[10px] text-muted">{hint}</p>}
    {(localError || error) && <p role="alert" className="mt-2 text-[11px] text-red-600">{localError || error}</p>}
    {files.length > 0 && <ul className="mt-3 space-y-1.5">
      {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-2"><Paperclip size={13} className="shrink-0 text-muted" />
          <span className="truncate font-semibold">{file.name}</span>
          <span className="shrink-0 text-[10px] text-muted">{formatFileSize(file.size)}</span>
        </span>
        <button type="button" disabled={disabled} onClick={() => onChange(files.filter((_, position) => position !== index))} aria-label={`Remove ${file.name}`}
          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"><X size={13} /></button>
      </li>)}
    </ul>}
  </div>;
}

export function AttachmentList({ attachments = [], downloadPath, onError }) {
  if (!attachments.length) return <p className="text-xs text-muted">No attachments.</p>;
  return <ul className="space-y-2">
    {attachments.map((attachment) => <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Paperclip size={14} className="shrink-0 text-muted" />
        <span className="truncate text-xs font-semibold">{attachment.fileName}</span>
        <span className="shrink-0 text-[10px] text-muted">{formatFileSize(attachment.fileSize)}</span>
      </span>
      <button type="button" onClick={async () => {
        try { await downloadPath(attachment.id, attachment.fileName); }
        catch (error) { onError?.(error.message); }
      }} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-brand hover:underline">
        <Download size={12} />Download
      </button>
    </li>)}
  </ul>;
}

export function ActivityTimeline({ activity = [] }) {
  if (!activity.length) return <p className="text-xs text-muted">No activity recorded yet.</p>;
  return <ol className="space-y-4">
    {activity.map((entry) => <li key={entry.id} className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand ring-1 ring-brand" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold capitalize">{String(entry.action || 'activity').replace(/_/g, ' ')}</span>
        <span className="text-[10px] text-muted">{dateTimeLabel(entry.createdAt)}</span>
      </div>
      {entry.actor && <div className="mt-0.5 text-[11px] text-muted">by {entry.actor}</div>}
      {(entry.previousStatus || entry.newStatus) && <div className="mt-1 text-[10px] font-semibold text-brand">
        {entry.previousStatus || '—'} → {entry.newStatus || '—'}
      </div>}
      {entry.details && Object.keys(entry.details).length > 0 &&
        <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[10px] leading-4 text-muted">{JSON.stringify(entry.details, null, 0)}</pre>}
    </li>)}
  </ol>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      {eyebrow && <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">{eyebrow}</div>}
      <h2 className="display-font text-xl font-extrabold tracking-tight">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function primaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white hover:bg-brand/90 disabled:opacity-50 ${extra}`;
}

export function secondaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-ink hover:bg-slate-50 disabled:opacity-50 ${extra}`;
}

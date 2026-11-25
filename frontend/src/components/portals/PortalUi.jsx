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
  indigo: 'border border-brand bg-white text-black',
  emerald: 'border border-brand bg-white text-black',
  amber: 'border border-brand bg-white text-black',
  blue: 'border border-brand bg-white text-black',
  red: 'border border-brand bg-white text-black',
  slate: 'border border-brand bg-white text-black'
};

export function StatCard({ label, value, note, icon: Icon, tone = 'indigo', onClick }) {
  return <button type="button" onClick={onClick} disabled={!onClick}
    className={`group min-h-[168px] rounded-2xl border border-brand bg-white p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,.03)] transition duration-200 sm:p-5 ${onClick ? 'hover:-translate-y-0.5 hover:border-accent-border hover:bg-accent-tint' : 'cursor-default'}`}>
    <div className="flex items-start justify-between gap-3">
      <span className="pt-1 text-[11px] font-extrabold uppercase leading-4 tracking-[.08em] text-black/55">{label}</span>
      {Icon && <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone] || STAT_TONES.indigo}`}>
        <Icon size={18} strokeWidth={1.8} />
      </span>}
    </div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <div>
        <div className="display-font text-[32px] font-extrabold leading-none tracking-[-0.03em]">{value ?? '—'}</div>
        <div className="mt-2 max-w-[180px] text-[11px] leading-4 text-muted">{note}</div>
      </div>
    </div>
  </button>;
}

export function LoadingState({ label = 'Loading…' }) {
  return <div role="status" className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted">
    <Loader2 size={16} className="animate-spin" />{label}
  </div>;
}

export function ErrorState({ message, onRetry }) {
  if (!message) return null;
  return <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">
    <span className="flex items-center gap-2"><AlertCircle size={15} />{message}</span>
    {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold underline hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
      <RefreshCw size={12} />Retry
    </button>}
  </div>;
}

export function EmptyState({ title = 'Nothing to show', description, action }) {
  return <div className="grid min-h-44 place-items-center px-5 py-10 text-center">
    <div className="max-w-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white text-muted"><FileText size={20} /></span>
      <p className="mt-3 text-sm font-bold text-ink">{title}</p>
      {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  </div>;
}

export function FilterBar({ children }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-subtle bg-white px-4 py-4 sm:px-5">{children}</div>;
}

export function FilterField({ label, children, className = 'w-full sm:w-48' }) {
  return <label className={`block ${className}`}>
    <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    {children}
  </label>;
}

export function SearchField({ value, onChange, onClear, placeholder = 'Search…', className = 'w-full sm:w-64' }) {
  const showClear = Boolean(value) && typeof onClear === 'function';
  return <FilterField label="Search" className={className}>
    <span className="relative block">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className={`field pl-9 ${showClear ? 'pr-9' : ''}`} />
      {showClear && <button
        type="button"
        onClick={onClear}
        aria-label="Clear search"
        title="Clear search"
        className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border border-brand bg-white text-muted"
      >
        <X size={12} aria-hidden="true" />
      </button>}
    </span>
  </FilterField>;
}

export function TableScroll({ minWidth = 900, children, label = '', className = '' }) {
  const regionProps = label ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {};
  return <div className={`overflow-x-auto ${className}`} {...regionProps}><div style={{ minWidth }}>{children}</div></div>;
}

export function TextLink({ onClick, children, className = '', ...props }) {
  return <button type="button" onClick={onClick} className={`text-xs font-bold text-black hover:text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus ${className}`} {...props}>{children}</button>;
}

function paginationWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) items.push('start-gap');
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < pages - 1) items.push('end-gap');
  items.push(pages);
  return items;
}

export function Pagination({ pagination, onChange, limit, onLimitChange, limitOptions = [], tone = 'default', className = '' }) {
  if (!pagination) return null;
  const { page, pages, total } = pagination;
  const rowsPerPage = Number(limit || pagination.limit) || 10;
  const first = total ? (page - 1) * rowsPerPage + 1 : 0;
  const last = Math.min(page * rowsPerPage, total);

  if (tone !== 'register') {
    if (pages <= 1) return null;
    return <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-4 py-3 text-[11px] text-muted sm:px-5 ${className}`}>
      <span>Showing {first}–{last} of {total}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-brand disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={14} /></button>
        <span className="font-bold text-ink">Page {page} of {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-brand disabled:opacity-40" aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </div>;
  }

  const buttonClass = 'grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus';
  return <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 ${className}`}>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {limitOptions.length > 0 && onLimitChange && <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-black/55">
        Rows per page
        <select value={rowsPerPage} onChange={(event) => onLimitChange(Number(event.target.value))}
          className="field !mt-0 h-9 w-[72px] px-2 py-0 text-[11px]" aria-label="Rows per page">
          {limitOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>}
      <span className="text-[11px] font-semibold text-black/55" aria-live="polite">
        Showing <strong className="font-bold text-black">{first.toLocaleString('en-US')}–{last.toLocaleString('en-US')}</strong> of{' '}
        <strong className="font-bold text-black">{Number(total).toLocaleString('en-US')}</strong>
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[11px] font-semibold text-black/55">
        Page <strong className="font-bold text-black">{page}</strong> of <strong className="font-bold text-black">{pages}</strong>
      </span>
      <nav aria-label="Requests register pagination" className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"
          className="grid h-8 w-8 place-items-center rounded-lg border border-brand bg-white text-black transition hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-35">
          <ChevronLeft size={14} />
        </button>
        {paginationWindow(page, pages).map((item, index) => typeof item === 'number'
          ? <button key={item} type="button" onClick={() => onChange(item)} aria-current={item === page ? 'page' : undefined}
            className={`${buttonClass} ${item === page ? 'border-black bg-white text-black ring-1 ring-black' : 'border-brand bg-white text-black/70 hover:bg-accent-tint hover:text-accent-text'}`}>{item}</button>
          : <span key={`${item}-${index}`} aria-hidden="true" className="grid h-8 w-5 place-items-center text-[11px] text-black/35">…</span>)}
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"
          className="grid h-8 w-8 place-items-center rounded-lg border border-brand bg-white text-black transition hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-35">
          <ChevronRight size={14} />
        </button>
      </nav>
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand bg-white px-3 py-2 text-xs font-bold text-muted hover:border-accent-border hover:text-accent-text disabled:opacity-50">
        <Plus size={13} />Add attachments
      </button>
      <span className="text-[10px] text-muted">{files.length}/5 files · PDF, Word, Excel, CSV, TXT or image · 5 MB max each</span>
    </div>
    {hint && <p className="mt-1 text-[10px] text-muted">{hint}</p>}
    {(localError || error) && <p role="alert" className="mt-2 text-[11px] text-black">{localError || error}</p>}
    {files.length > 0 && <ul className="mt-3 space-y-1.5">
      {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-2"><Paperclip size={13} className="shrink-0 text-muted" />
          <span className="truncate font-semibold">{file.name}</span>
          <span className="shrink-0 text-[10px] text-muted">{formatFileSize(file.size)}</span>
        </span>
        <button type="button" disabled={disabled} onClick={() => onChange(files.filter((_, position) => position !== index))} aria-label={`Remove ${file.name}`}
          className="rounded p-1 text-muted transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"><X size={13} /></button>
      </li>)}
    </ul>}
  </div>;
}

export function AttachmentList({ attachments = [], downloadPath, onError }) {
  if (!attachments.length) return <p className="text-xs text-muted">No attachments.</p>;
  return <ul className="space-y-2">
    {attachments.map((attachment) => <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-brand bg-white px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Paperclip size={14} className="shrink-0 text-muted" />
        <span className="truncate text-xs font-semibold">{attachment.fileName}</span>
        <span className="shrink-0 text-[10px] text-muted">{formatFileSize(attachment.fileSize)}</span>
      </span>
      <button type="button" onClick={async () => {
        try { await downloadPath(attachment.id, attachment.fileName); }
        catch (error) { onError?.(error.message); }
      }} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-black hover:text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
        <Download size={12} />Download
      </button>
    </li>)}
  </ul>;
}

export function ActivityTimeline({ activity = [] }) {
  if (!activity.length) return <p className="text-xs text-muted">No activity recorded yet.</p>;
  return <ol className="space-y-4">
    {activity.map((entry) => <li key={entry.id} className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-reference ring-1 ring-brand" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold capitalize">{String(entry.action || 'activity').replace(/_/g, ' ')}</span>
        <span className="text-[10px] text-muted">{dateTimeLabel(entry.createdAt)}</span>
      </div>
      {entry.actor && <div className="mt-0.5 text-[11px] text-muted">by {entry.actor}</div>}
      {(entry.previousStatus || entry.newStatus) && <div className="mt-1 text-[10px] font-semibold text-black">
        {entry.previousStatus || '—'} → {entry.newStatus || '—'}
      </div>}
      {entry.details && Object.keys(entry.details).length > 0 &&
        <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[10px] leading-4 text-muted">{JSON.stringify(entry.details, null, 0)}</pre>}
    </li>)}
  </ol>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      {eyebrow && <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[.14em] text-black">{eyebrow}</div>}
      <h2 className="display-font text-xl font-extrabold tracking-tight">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function primaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-black transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:opacity-50 ${extra}`;
}

export function secondaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand bg-white px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-accent-tint hover:border-accent-border hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:opacity-50 ${extra}`;
}

import { badgeTone, statusLabel, statusTone } from '../../utils/status.js';

const POSITIVE_STATUSES = new Set([
  'Approved', 'Approved by Supervisor', 'Procurement Approved', 'Completed',
  'Paid', 'Received', 'Awarded', 'Active', 'Issued'
]);

export default function StatusBadge({ value, className = '', dotClassName, wrap = false }) {
  const tone = badgeTone(statusTone(value));
  const positive = POSITIVE_STATUSES.has(value);
  const dot = dotClassName || (positive ? 'bg-success' : 'bg-black/40');
  const shape = wrap
    ? 'inline-flex max-w-full items-start gap-1.5 whitespace-normal rounded-full border border-brand bg-white px-2.5 py-1 text-[11px] font-bold leading-4 text-black'
    : 'inline-flex items-center gap-1.5 rounded-full border border-brand bg-white px-2.5 py-1 text-[11px] font-bold text-black';
  return <span className={`${shape} ${tone} ${className}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot} ${wrap ? 'mt-1.5' : ''}`} />
    {wrap
      ? <span className="min-w-0 break-words">{statusLabel(value)}</span>
      : statusLabel(value)}
  </span>;
}

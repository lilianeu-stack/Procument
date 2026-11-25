import { badgeTone, statusLabel, statusTone } from '../../utils/status.js';

const POSITIVE_STATUSES = new Set([
  'Approved', 'Approved by Supervisor', 'Procurement Approved', 'Completed',
  'Paid', 'Received', 'Awarded', 'Active', 'Issued'
]);

export default function StatusBadge({ value, className = '', dotClassName }) {
  const tone = badgeTone(statusTone(value));
  const positive = POSITIVE_STATUSES.has(value);
  const dot = dotClassName || (positive ? 'bg-success' : 'bg-black/40');
  return <span className={`inline-flex items-center gap-1.5 rounded-full border border-brand bg-white px-2.5 py-1 text-[11px] font-bold text-black ${tone} ${className}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{statusLabel(value)}
  </span>;
}

import { badgeTone, statusLabel, statusTone } from '../../utils/status.js';

export default function StatusBadge({ value, className = '' }) {
  const tone = badgeTone(statusTone(value));
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone} ${className}`}>
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{statusLabel(value)}
  </span>;
}

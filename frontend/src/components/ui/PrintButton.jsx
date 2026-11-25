import { Printer } from 'lucide-react';

export default function PrintButton({ label = 'Print', className = '', disabled = false, title, tone = 'default', onClick }) {
  const style = tone === 'primary'
    ? 'h-10 rounded-xl border border-brand bg-brand px-4 text-xs font-bold text-black shadow-dashboard transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-50'
    : tone === 'toolbar'
    ? 'h-9 rounded-xl border border-brand bg-white px-3.5 text-xs font-bold text-black shadow-dashboard transition duration-200 hover:border-accent-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded-lg border border-brand bg-white px-3.5 py-2 text-xs font-bold text-ink hover:bg-white disabled:opacity-50';
  return <button
    type="button"
    onClick={onClick || (() => window.print())}
    disabled={disabled}
    title={title || `Print ${label.toLowerCase()}`}
    className={`no-print inline-flex items-center justify-center gap-1.5 ${style} ${className}`}
  >
    <Printer size={14} aria-hidden="true" />
    {label}
  </button>;
}

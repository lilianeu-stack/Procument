import { Printer } from 'lucide-react';

export default function PrintButton({ label = 'Print', className = '', disabled = false, title }) {
  return <button
    type="button"
    onClick={() => window.print()}
    disabled={disabled}
    title={title || `Print ${label.toLowerCase()}`}
    className={`no-print inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-ink hover:bg-slate-50 disabled:opacity-50 ${className}`}
  >
    <Printer size={14} aria-hidden="true" />
    {label}
  </button>;
}

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { downloadRecord, downloadReport } from '../../utils/exports.js';

const ICONS = { pdf: FileText, xlsx: FileSpreadsheet, csv: Download };
const FORMAT_LABELS = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };

export default function DownloadButton({
  exportKey, type, id, format = 'pdf', params = {}, reference = '',
  label, className = '', variant = 'secondary', tone = 'default', onSuccess, onError
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleClick() {
    setBusy(true);
    setMessage('');
    try {
      const filename = type && id
        ? await downloadRecord({ type, id, format, params })
        : await downloadReport({ key: exportKey, format, params, reference });
      setMessage(`Saved ${filename}`);
      onSuccess?.(filename);
    } catch (error) {
      setMessage(error.message || 'The download could not be completed.');
      onError?.(error);
    } finally {
      setBusy(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(''), 4500);
    }
  }

  const Icon = ICONS[format] || Download;
  const text = label || `Download ${FORMAT_LABELS[format] || format.toUpperCase()}`;
  const classes = tone === 'toolbar'
    ? 'h-10 rounded-xl border border-brand bg-white px-4 text-xs font-bold text-black shadow-dashboard transition duration-200 hover:border-accent-border hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-50'
    : `rounded-lg px-3.5 py-2 text-xs font-bold disabled:opacity-50 ${variant === 'primary'
      ? 'bg-brand text-black hover:bg-brand border border-brand'
      : 'border border-brand bg-white text-black hover:bg-white'}`;

  return <span className="relative inline-flex no-print">
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex items-center justify-center gap-1.5 ${classes} ${className}`}
    >
      <Icon size={14} aria-hidden="true" />
      {busy ? 'Preparing…' : text}
    </button>
    {message && <span
      role="status"
      className="absolute right-0 top-full z-30 mt-1 max-w-[260px] rounded-md border border-strong bg-white px-2 py-1 text-[10px] "
    >{message}</span>}
  </span>;
}

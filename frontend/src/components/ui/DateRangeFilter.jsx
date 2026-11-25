import { CalendarDays, X } from 'lucide-react';
import { datePresets, formatDate, validateDateRange } from '../../utils/dates.js';

const PRESETS = datePresets();

export default function DateRangeFilter({
  value = {}, fields = [], onChange, label = 'Date', className = '', compact = false
}) {
  const current = {
    preset: value.preset || '',
    from: value.from || '',
    to: value.to || '',
    dateField: value.dateField || fields[0]?.key || ''
  };
  const error = validateDateRange(current.from, current.to);
  const selectedField = fields.find((field) => field.key === current.dateField)?.label || label;
  const hasRange = Boolean(current.from || current.to);
  const rangeLabel = hasRange
    ? `${current.from ? formatDate(current.from) : 'Beginning'} – ${current.to ? formatDate(current.to) : 'Today'} · ${selectedField}`
    : 'No date filter applied.';

  function update(patch) {
    onChange?.({ ...current, ...patch });
  }

  function choosePreset(key) {
    const preset = PRESETS.find((item) => item.key === key);
    if (!preset) return;
    update({ preset: key, from: preset.from, to: preset.to });
  }

  if (compact) {
    return <div className={`no-print min-w-0 ${className}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">{label} type</span>
          <select
            value={current.dateField}
            onChange={(event) => update({ dateField: event.target.value })}
            className="field h-9 px-2.5 text-[11px] bg-white"
          >
            {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">Preset</span>
          <select
            value={current.preset}
            onChange={(event) => choosePreset(event.target.value)}
            className="field h-9 px-2.5 text-[11px] bg-white"
          >
            <option value="">Choose a range…</option>
            {PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">From</span>
          <input
            type="date"
            value={current.from}
            max={current.to || undefined}
            onChange={(event) => update({ from: event.target.value, preset: 'custom' })}
            className="field h-9 px-2.5 text-[11px] bg-white"
            aria-invalid={Boolean(error)}
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">To</span>
          <input
            type="date"
            value={current.to}
            min={current.from || undefined}
            onChange={(event) => update({ to: event.target.value, preset: 'custom' })}
            className="field h-9 px-2.5 text-[11px] bg-white"
            aria-invalid={Boolean(error)}
          />
        </label>
      </div>
      <div className="mt-1.5 truncate text-[10px] leading-4 text-muted" aria-live="polite" title={error || rangeLabel}>
        <span className={error ? 'font-semibold text-black' : ''}>{error || rangeLabel}</span>
      </div>
    </div>;
  }

  return <div className={`no-print rounded-lg border border-brand bg-white p-3 ${className}`}>
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">{label} type</label>
        <select
          value={current.dateField}
          onChange={(event) => update({ dateField: event.target.value })}
          className="field mt-1 h-9 max-w-[190px] bg-white"
        >
          {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">Preset</label>
        <select
          value={current.preset}
          onChange={(event) => choosePreset(event.target.value)}
          className="field mt-1 h-9 max-w-[170px] bg-white"
        >
          <option value="">Choose a range…</option>
          {PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">From</label>
        <input
          type="date"
          value={current.from}
          max={current.to || undefined}
          onChange={(event) => update({ from: event.target.value, preset: 'custom' })}
          className="field mt-1 h-9 w-[150px] bg-white"
          aria-invalid={Boolean(error)}
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">To</label>
        <input
          type="date"
          value={current.to}
          min={current.from || undefined}
          onChange={(event) => update({ to: event.target.value, preset: 'custom' })}
          className="field mt-1 h-9 w-[150px] bg-white"
          aria-invalid={Boolean(error)}
        />
      </div>
      {(current.from || current.to || current.preset || current.dateField !== fields[0]?.key) &&
        <button
          type="button"
          onClick={() => onChange?.({ preset: '', from: '', to: '', dateField: fields[0]?.key || '' })}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-brand bg-white px-2.5 text-[11px] font-bold text-muted transition-colors hover:bg-accent-tint hover:border-accent-border hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        >
          <X size={12} /> Clear
        </button>}
    </div>
    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted" aria-live="polite">
      <CalendarDays size={12} aria-hidden="true" />
      {error ? <span className="font-semibold text-black">{error}</span> : (
        current.from || current.to
          ? <span>Dates are inclusive and shown in local time.</span>
          : <span>No date filter applied.</span>
      )}
    </div>
  </div>;
}

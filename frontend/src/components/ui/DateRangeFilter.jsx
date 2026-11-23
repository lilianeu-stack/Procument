import { CalendarDays, X } from 'lucide-react';
import { datePresets, validateDateRange } from '../../utils/dates.js';

const PRESETS = datePresets();

export default function DateRangeFilter({
  value = {}, fields = [], onChange, label = 'Date', className = ''
}) {
  const current = {
    preset: value.preset || '',
    from: value.from || '',
    to: value.to || '',
    dateField: value.dateField || fields[0]?.key || ''
  };
  const error = validateDateRange(current.from, current.to);

  function update(patch) {
    onChange?.({ ...current, ...patch });
  }

  function choosePreset(key) {
    const preset = PRESETS.find((item) => item.key === key);
    if (!preset) return;
    update({ preset: key, from: preset.from, to: preset.to });
  }

  return <div className={`no-print rounded-lg border border-slate-200 bg-white p-3 ${className}`}>
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
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-muted hover:bg-slate-50"
        >
          <X size={12} /> Clear
        </button>}
    </div>
    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted" aria-live="polite">
      <CalendarDays size={12} aria-hidden="true" />
      {error ? <span className="font-semibold text-red-600">{error}</span> : (
        current.from || current.to
          ? <span>Dates are inclusive and shown in local time.</span>
          : <span>No date filter applied.</span>
      )}
    </div>
  </div>;
}

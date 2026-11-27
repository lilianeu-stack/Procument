import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import {
  dateInputPlaceholder, datePresets, formatDate, parseDateInput, validateDateRange
} from '../../utils/dates.js';

const PRESETS = datePresets();

const fieldClass = 'field mt-0 h-10 bg-white px-3 text-xs';
const labelClass = 'block text-[10px] font-bold uppercase leading-4 tracking-[.08em] text-black';

// A formatted text control keeps the configured date format visible while a
// hidden native input preserves the familiar calendar picker.
function DateField({ label, value, onChange, min, max, invalid }) {
  const format = dateInputPlaceholder();
  const errorId = useId();
  const pickerRef = useRef(null);
  const skipNextValueSync = useRef(false);
  const [text, setText] = useState(() => (value ? formatDate(value) : ''));
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (skipNextValueSync.current) {
      skipNextValueSync.current = false;
      return;
    }
    setText(value ? formatDate(value) : '');
    setLocalError('');
  }, [value]);

  function handleTextChange(event) {
    const raw = event.target.value;
    setText(raw);
    if (!raw.trim()) {
      setLocalError('');
      onChange('');
      return;
    }
    const iso = parseDateInput(raw);
    if (iso) {
      setLocalError('');
      onChange(iso);
    }
  }

  function handleBlur() {
    const raw = text.trim();
    if (!raw) {
      setLocalError('');
      onChange('');
      return;
    }
    const iso = parseDateInput(raw);
    if (!iso) {
      setLocalError(`Use ${format}.`);
      setText('');
      if (value) skipNextValueSync.current = true;
      onChange('');
      return;
    }
    setText(formatDate(iso));
    setLocalError('');
    onChange(iso);
  }

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else picker.click();
    } catch {
      picker.focus();
      picker.click();
    }
  }

  return <label className="block min-w-0">
    <span className={labelClass}>{label}</span>
    <span className="relative block">
      <input
        type="text"
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        spellCheck="false"
        value={text}
        placeholder={format}
        title={`Date format: ${format}`}
        onChange={handleTextChange}
        onBlur={handleBlur}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        className={`${fieldClass} pr-10`}
        aria-invalid={Boolean(invalid || localError)}
        aria-describedby={localError ? errorId : undefined}
      />
      <input
        ref={pickerRef}
        type="date"
        value={value}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-px w-px opacity-0"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label={`Choose ${label} date`}
        title={`Choose date (${format})`}
        className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md border border-transparent bg-white text-black"
      >
        <CalendarDays size={14} aria-hidden="true" />
      </button>
    </span>
    {localError && <span id={errorId} role="alert" className="mt-1 block text-[10px] font-semibold text-black">{localError}</span>}
  </label>;
}

export default function DateRangeFilter({
  value = {}, fields = [], onChange, label = 'Date', className = '', compact = false, fromToOnly = false
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
  const hasSelection = Boolean(current.preset || current.from || current.to
    || (fields.length > 1 && current.dateField !== fields[0]?.key));

  function update(patch) {
    onChange?.({ ...current, ...patch });
  }

  function updateSimple(patch) {
    onChange?.({ ...current, ...patch, preset: '' });
  }

  function choosePreset(key) {
    if (!key) {
      update({ preset: '', from: '', to: '' });
      return;
    }
    const preset = PRESETS.find((item) => item.key === key);
    if (!preset) return;
    update({ preset: key, from: preset.from, to: preset.to });
  }

  const selectClass = 'field mt-0 h-10 bg-white px-3 text-xs';
  const dateFields = <div className={`grid grid-cols-2 gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
    <label className="block min-w-0">
      <span className={labelClass}>{label} type</span>
      <select
        value={current.dateField}
        onChange={(event) => update({ dateField: event.target.value })}
        className={selectClass}
      >
        {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
    </label>
    <label className="block min-w-0">
      <span className={labelClass}>Preset</span>
      <select
        value={current.preset}
        onChange={(event) => choosePreset(event.target.value)}
        className={selectClass}
      >
        <option value="">Choose a range…</option>
        {PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
      </select>
    </label>
    <DateField
      label="From"
      value={current.from}
      onChange={(from) => update({ from, preset: 'custom' })}
      max={current.to || undefined}
      invalid={Boolean(error)}
    />
    <DateField
      label="To"
      value={current.to}
      onChange={(to) => update({ to, preset: 'custom' })}
      min={current.from || undefined}
      invalid={Boolean(error)}
    />
  </div>;

  const message = <div className="flex min-w-0 items-start gap-1.5 text-[10px] leading-4 text-black" aria-live="polite">
    <CalendarDays size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
    <span className={error ? 'font-semibold text-black' : ''} title={error || rangeLabel}>
      {error || rangeLabel}
    </span>
  </div>;

  if (fromToOnly) {
    return <div className={`no-print min-w-0 ${className}`}>
      <div className="grid grid-cols-2 gap-2">
        <DateField
          label="From"
          value={current.from}
          onChange={(from) => updateSimple({ from })}
          max={current.to || undefined}
          invalid={Boolean(error)}
        />
        <DateField
          label="To"
          value={current.to}
          onChange={(to) => updateSimple({ to })}
          min={current.from || undefined}
          invalid={Boolean(error)}
        />
      </div>
      {error && <div role="alert" className="mt-2 text-[10px] font-semibold text-black">{error}</div>}
    </div>;
  }

  if (compact) {
    return <div className={`no-print min-w-0 ${className}`}>
      {dateFields}
      <div className="mt-2 flex items-start gap-1.5">{message}</div>
    </div>;
  }

  return <div className={`no-print rounded-xl border border-brand bg-white p-3 sm:p-4 ${className}`}>
    {dateFields}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      {message}
      {hasSelection && <button
        type="button"
        onClick={() => onChange?.({ preset: '', from: '', to: '', dateField: fields[0]?.key || '' })}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand bg-white px-2.5 text-[10px] font-bold text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      >
        <X size={12} aria-hidden="true" />Clear dates
      </button>}
    </div>
  </div>;
}

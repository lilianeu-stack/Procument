// All API timestamps are stored in UTC. This module is the single place that
// converts them for display, using the configured local business timezone.
// Vite injects import.meta.env; plain Node (used by the unit tests) does not.
const env = typeof import.meta.env === 'object' && import.meta.env ? import.meta.env : {};
function storedSetting(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
}
export const DISPLAY_TIMEZONE = storedSetting('pims-timezone', env.VITE_DISPLAY_TIMEZONE || 'Africa/Kigali');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MYSQL_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let text = String(value).trim();
  if (!text) return null;
  const mysql = text.match(MYSQL_DATETIME);
  if (mysql) text = `${mysql[1]}T${mysql[2]}Z`;
  else if (ISO_DATE.test(text)) text = `${text}T00:00:00Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsInTimezone(date) {
  const activeTimezone = storedSetting('pims-timezone', env.VITE_DISPLAY_TIMEZONE || 'Africa/Kigali');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: activeTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZoneName: 'short'
  });
  const values = {};
  for (const part of formatter.formatToParts(date)) values[part.type] = part.value;
  return values;
}

export function formatDate(value) {
  const date = parseInstant(value);
  if (!date) return '—';
  const { day, month, year } = partsInTimezone(date);
  const format = storedSetting('pims-date-format', 'DD/MM/YYYY');
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`;
}

export function formatLongDate(value = new Date()) {
  const date = parseInstant(value) || new Date();
  const activeTimezone = storedSetting('pims-timezone', env.VITE_DISPLAY_TIMEZONE || 'Africa/Kigali');
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: activeTimezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Kigali',
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }).format(date);
  }
}

export function formatDateTime(value, { withZone = true } = {}) {
  const date = parseInstant(value);
  if (!date) return '—';
  const { day, month, year, hour, minute, timeZoneName } = partsInTimezone(date);
  const dateFormat = storedSetting('pims-date-format', 'DD/MM/YYYY');
  const dateText = dateFormat === 'MM/DD/YYYY' ? `${month}/${day}/${year}`
    : dateFormat === 'YYYY-MM-DD' ? `${year}-${month}-${day}` : `${day}/${month}/${year}`;
  const timeFormat = storedSetting('pims-time-format', '24');
  let displayTime = `${hour}:${minute}`;
  if (timeFormat === '12') {
    const hourNumber = Number(hour);
    displayTime = `${hourNumber % 12 || 12}:${minute} ${hourNumber >= 12 ? 'PM' : 'AM'}`;
  }
  return `${dateText} ${displayTime}${withZone && timeZoneName ? ` ${timeZoneName}` : ''}`;
}

export function toDateInputValue(value) {
  const date = parseInstant(value) || new Date();
  const { year, month, day } = partsInTimezone(date);
  return `${year}-${month}-${day}`;
}

export function toDateTimeInputValue(value = new Date()) {
  const date = parseInstant(value) || new Date();
  const { year, month, day, hour, minute } = partsInTimezone(date);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const WALL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// datetime-local values are wall-clock times in the configured display zone.
// Convert them to a UTC instant before sending them to the API.
export function toUtcDateTimeInputValue(value) {
  const match = String(value || '').trim().match(WALL_DATETIME);
  if (!match) return '';
  const [, year, month, day, hour, minute] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(target)) return '';
  const timeZone = storedSetting('pims-timezone', env.VITE_DISPLAY_TIMEZONE || 'Africa/Kigali');
  const wallParts = (instant) => {
    const values = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant)) values[part.type] = part.value;
    return values;
  };
  try {
    let guess = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = wallParts(new Date(guess));
      const asUtc = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour), Number(parts.minute), Number(parts.second)
      );
      const difference = target - asUtc;
      if (!difference) break;
      guess += difference;
    }
    return new Date(guess).toISOString();
  } catch {
    return new Date(target).toISOString();
  }
}

// The native date control renders the browser locale, which can disagree with
// the configured business format. Filter fields use a formatted text value and
// a hidden native picker, so this helper keeps both presentations in sync.
export function configuredDateFormat() {
  return storedSetting('pims-date-format', 'DD/MM/YYYY');
}

export function dateInputPlaceholder() {
  const format = configuredDateFormat();
  return format === 'MM/DD/YYYY' ? 'MM/DD/YYYY'
    : format === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
}

export function parseDateInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const format = configuredDateFormat();
  const parts = text.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
  if (!parts) return '';
  let year; let month; let day;
  if (format === 'YYYY-MM-DD') {
    [, year, month, day] = parts;
  } else if (format === 'MM/DD/YYYY') {
    [, month, day, year] = parts;
  } else {
    [, day, month, year] = parts;
  }
  if (year.length !== 4) return '';
  const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : '';
}

function isoFromParts(year, month, day, offsetDays = 0) {
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

export function todayIso(offsetDays = 0) {
  const { year, month, day } = partsInTimezone(new Date());
  return isoFromParts(Number(year), Number(month), Number(day), offsetDays);
}

export function datePresets() {
  const today = todayIso();
  const yesterday = todayIso(-1);
  const [year, month, day] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekStart = isoFromParts(year, month, day, -((weekday + 6) % 7));
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: yesterday, to: yesterday },
    { key: 'week', label: 'This week', from: weekStart, to: today },
    { key: 'month', label: 'This month', from: `${year}-${String(month).padStart(2, '0')}-01`, to: today },
    { key: 'quarter', label: 'This quarter', from: `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`, to: today },
    { key: 'year', label: 'This year', from: `${year}-01-01`, to: today },
    { key: 'custom', label: 'Custom range', from: '', to: '' }
  ];
}

export function validateDateRange(from, to) {
  const start = String(from || '').trim();
  const end = String(to || '').trim();
  if (!start && !end) return '';
  if (!isIsoDate(start) || !isIsoDate(end)) return 'Choose valid start and end dates.';
  if (end < start) return 'End date must be on or after start date.';
  return '';
}

export function validateBusinessDate(value, label, { required = false, allowPast = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return required ? `${label} is required.` : '';
  if (!isIsoDate(raw)) return `${label} must be a valid date.`;
  if (!allowPast && raw < todayIso()) return `${label} cannot be in the past.`;
  return '';
}

export function validateDateOrder(values, pairs) {
  for (const [startKey, endKey, startLabel, endLabel] of pairs) {
    if (values[startKey] && values[endKey] && values[endKey] < values[startKey]) {
      return `${endLabel || endKey} must be on or after ${startLabel || startKey}.`;
    }
  }
  return '';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function toUtcDateTime(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  if (isIsoDate(value)) return `${value} 00:00:00`;
  if (ISO_DATETIME.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

export function validateDateRange(from, to, { required = false } = {}) {
  const fromValue = from == null ? '' : String(from).trim();
  const toValue = to == null ? '' : String(to).trim();
  if (!fromValue && !toValue) {
    if (required) return { error: 'Both start date and end date are required.' };
    return { from: null, to: null };
  }
  if (!isIsoDate(fromValue) || !isIsoDate(toValue)) {
    return { error: 'Dates must use YYYY-MM-DD.' };
  }
  if (toValue < fromValue) {
    return { error: 'End date must be on or after start date.' };
  }
  return {
    from: `${fromValue} 00:00:00`,
    // Inclusive of the whole end day.
    to: `${toValue} 23:59:59`
  };
}

export function parseDateFilter(query, allowedFields, { defaultField, required = false } = {}) {
  const fields = Array.isArray(allowedFields) ? allowedFields : Object.keys(allowedFields);
  const rawField = String(query.dateField || defaultField || '').trim();
  const field = fields.includes(rawField) ? rawField : defaultField || fields[0];
  const range = validateDateRange(query.from, query.to, { required });
  if (range.error) return { error: range.error };
  return {
    field,
    from: range.from,
    to: range.to,
    active: Boolean(range.from || range.to)
  };
}

export function dateFilterClause(filter, columnMap, params) {
  const column = columnMap[filter.field];
  if (!filter.active || !column) return '';
  const clauses = [];
  if (filter.from) {
    clauses.push(`${column} >= ?`);
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push(`${column} <= ?`);
    params.push(filter.to);
  }
  return clauses.length ? ` AND (${clauses.join(' AND ')})` : '';
}

export function validateBusinessDate(value, label, { required = false, allowPast = true } = {}) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) {
    return required ? { error: `${label} is required.` } : { value: null };
  }
  if (!isIsoDate(raw)) return { error: `${label} must be a valid date in YYYY-MM-DD format.` };
  if (!allowPast && raw < new Date().toISOString().slice(0, 10)) {
    return { error: `${label} cannot be in the past.` };
  }
  return { value: raw };
}

export function businessDate(value, label, options) {
  const result = validateBusinessDate(value, label, options);
  if (result.error) throw Object.assign(new Error(result.error), { status: 400 });
  return result.value;
}

export function validateBusinessDateTime(value, label, { required = false, allowPast = true } = {}) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) {
    return required ? { error: `${label} is required.` } : { value: null };
  }
  // Date-only payloads remain valid for older clients and tests. They keep the
  // existing whole-day treatment instead of being rejected as past midnight.
  if (isIsoDate(raw)) {
    const dateResult = validateBusinessDate(raw, label, { required, allowPast });
    if (dateResult.error) return dateResult;
    return { value: `${raw} 00:00:00` };
  }
  if (!isIsoDateTime(raw)) {
    return { error: `${label} must be a valid date and time.` };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${label} must be a valid date and time.` };
  }
  if (!allowPast && parsed.getTime() < Date.now()) {
    return { error: `${label} cannot be in the past.` };
  }
  return { value: parsed.toISOString().slice(0, 19).replace('T', ' ') };
}

export function businessDateTime(value, label, options) {
  const result = validateBusinessDateTime(value, label, options);
  if (result.error) throw Object.assign(new Error(result.error), { status: 400 });
  return result.value;
}

export function validateDateOrder(values, pairs) {
  for (const [startLabel, endLabel] of pairs) {
    const start = values[startLabel];
    const end = values[endLabel];
    if (start && end && end < start) {
      return { error: `${endLabel} must be on or after ${startLabel}.` };
    }
  }
  return {};
}

export function enforceDateOrder(values, pairs) {
  const result = validateDateOrder(values, pairs);
  if (result.error) throw Object.assign(new Error(result.error), { status: 400 });
}

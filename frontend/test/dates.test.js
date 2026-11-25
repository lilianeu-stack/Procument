import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  datePresets, formatDate, formatDateTime, isIsoDate,
  toDateInputValue, toDateTimeInputValue, toUtcDateTimeInputValue,
  validateBusinessDate, validateDateOrder, validateDateRange
} from '../src/utils/dates.js';
import { dateQueryForFilter, reportForPage } from '../src/utils/reportFields.js';

test('dates are displayed in the configured local timezone', () => {
  // Africa/Kigali is UTC+2: this UTC instant is already the next local day.
  assert.equal(formatDate('2026-01-15T23:30:00Z'), '16/01/2026');
  assert.equal(formatDateTime('2026-01-15T23:30:00Z', { withZone: false }), '16/01/2026 01:30');
  assert.equal(toDateInputValue('2026-01-15T23:30:00Z'), '2026-01-16');
});

test('MySQL timestamps and invalid values are handled safely', () => {
  assert.equal(formatDate('2026-01-15 20:00:00'), '15/01/2026');
  assert.equal(formatDate('not-a-date'), '—');
  assert.equal(formatDateTime('', { withZone: false }), '—');
});

test('datetime-local values keep hours and minutes through a timezone round trip', () => {
  const local = '2026-11-25T10:30';
  const utc = toUtcDateTimeInputValue(local);
  assert.equal(utc, '2026-11-25T08:30:00.000Z');
  assert.equal(formatDateTime(utc, { withZone: false }), '25/11/2026 10:30');
  assert.equal(toDateTimeInputValue(utc), local);
  assert.equal(toUtcDateTimeInputValue(''), '');
});

test('date presets cover every required range and start weeks on Monday', () => {
  const presets = datePresets();
  const keys = presets.map((preset) => preset.key);
  for (const key of ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'custom']) {
    assert.ok(keys.includes(key), `missing preset: ${key}`);
  }
  const week = presets.find((preset) => preset.key === 'week');
  const weekday = new Date(`${week.from}T00:00:00Z`).getUTCDay();
  assert.equal(weekday, 1);
  assert.ok(week.to >= week.from);
});

test('range validation prevents impossible and invalid ranges', () => {
  assert.equal(validateDateRange('', ''), '');
  assert.equal(validateDateRange('2026-02-01', '2026-02-01'), '');
  assert.ok(validateDateRange('2026-02-01', '2026-01-31').includes('on or after'));
  assert.ok(validateDateRange('2026-02-30', '2026-03-01'));
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-29'), false);
});

test('business date helpers reject invalid dates and reversed ranges', () => {
  assert.equal(validateBusinessDate('2026-02-28', 'Required by', { required: true }), '');
  assert.ok(validateBusinessDate('', 'Required by', { required: true }));
  assert.ok(validateBusinessDate('not-a-date', 'Required by'));
  assert.equal(validateDateOrder(
    { start: '2026-02-01', end: '2026-02-02' },
    [['start', 'end', 'Start', 'End']]
  ), '');
  assert.ok(validateDateOrder(
    { start: '2026-02-02', end: '2026-02-01' },
    [['start', 'end', 'Start', 'End']]
  ));
});

test('report field mappings use business-appropriate dates', () => {
  assert.equal(reportForPage('Goods receipts').defaultField, 'received');
  assert.equal(reportForPage('Invoices').defaultField, 'submitted');
  assert.ok(reportForPage('Stock movements').fields.some((field) => field.key === 'movement'));
  assert.equal(reportForPage('Overview'), null);
  assert.deepEqual(dateQueryForFilter({ from: '2026-01-01', to: '2026-01-31', dateField: 'paid' }), {
    from: '2026-01-01', to: '2026-01-31', dateField: 'paid'
  });
  assert.deepEqual(dateQueryForFilter(null), {});
  assert.equal(reportForPage('Audit logs'), null, 'the removed admin page has no report mapping');
});

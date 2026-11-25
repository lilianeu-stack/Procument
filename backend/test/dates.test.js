import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDateTime, validateBusinessDateTime } from '../src/utils/dates.js';

test('RFQ datetime validation keeps hours and minutes', () => {
  assert.equal(businessDateTime('2026-11-25T10:30Z', 'Send start date'), '2026-11-25 10:30:00');
  assert.equal(businessDateTime('2026-11-25', 'Send start date'), '2026-11-25 00:00:00');
  assert.ok(validateBusinessDateTime('not-a-date', 'Send start date').error);
  assert.ok(validateBusinessDateTime('2020-01-01T09:00Z', 'Send start date', { allowPast: false }).error);
});

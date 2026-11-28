import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requisitionDisplayReference } from '../src/utils/requisition-display.js';

test('backend requisition display reference uses HHR without a department segment', () => {
  assert.equal(requisitionDisplayReference({
    submittedAt: '2026-11-28T12:05:00Z',
    department: 'Finance',
    departmentSequence: 3,
    reference: 'PR-2026-097524'
  }), 'HHR/28/11/26/0003');
});

test('backend requisition display reference prefers an API-supplied value', () => {
  assert.equal(requisitionDisplayReference({
    displayReference: 'HHR/28/11/26/0003',
    submittedAt: '2026-11-28T21:05:00Z'
  }), 'HHR/28/11/26/0003');
});

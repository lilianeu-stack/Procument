import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requisitionDisplayReference } from '../src/utils/requisitionDisplay.js';

test('requisition display reference uses HHR, request date and sequence without department', () => {
  assert.equal(requisitionDisplayReference({
    department: 'Finance',
    submittedAt: '2026-01-15T23:30:00Z',
    departmentSequence: 7
  }), 'HHR/16/01/26/0007');
});

test('requisition display reference prefers the reference supplied by the API', () => {
  assert.equal(requisitionDisplayReference({
    displayReference: 'HHR/28/11/26/0003',
    submittedAt: '2026-01-15T23:30:00Z',
    departmentSequence: 7
  }), 'HHR/28/11/26/0003');
});

test('requisition display reference falls back safely for drafts', () => {
  assert.equal(requisitionDisplayReference({
    department: 'Procurement',
    createdAt: '2026-11-28 10:05:00'
  }), 'HHR/28/11/26/0001');
  assert.equal(requisitionDisplayReference({}), 'HHR/—/—/—/0001');
});

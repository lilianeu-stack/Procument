import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseOrderScope, requisitionScope, storeRequestScope } from '../src/lib/scopes.js';

test('requisitions are scoped to requesters, supervisors, or procurement administrators', () => {
  assert.deepEqual(requisitionScope({ id: 7, role: 'requestor' }), {
    clause: 'r.requester_id = ?',
    params: [7]
  });
  assert.deepEqual(requisitionScope({ id: 4, role: 'supervisor', departmentId: 3 }), {
    clause: 'r.department_id = ?',
    params: [3]
  });
  assert.deepEqual(requisitionScope({ id: 4, role: 'supervisor' }), {
    clause: '1 = 0',
    params: []
  });
  assert.equal(requisitionScope({ role: 'procurement_admin' }).clause, '1 = 1');
  assert.equal(requisitionScope({ role: 'finance' }).clause, '1 = 0');
});

test('store requests are scoped to request owners and supervisor departments', () => {
  assert.deepEqual(storeRequestScope({ id: 9, role: 'requestor' }), {
    clause: 'sr.requester_id = ?',
    params: [9]
  });
  assert.deepEqual(storeRequestScope({ id: 4, role: 'supervisor', departmentId: 8 }), {
    clause: 'sr.department_id = ?',
    params: [8]
  });
  assert.equal(storeRequestScope({ role: 'storekeeper' }).clause, '1 = 1');
});

test('purchase order visibility is limited to business roles and supervisor departments', () => {
  assert.equal(purchaseOrderScope({ role: 'procurement_admin' }).clause, '1 = 1');
  assert.equal(purchaseOrderScope({ role: 'requestor' }).clause, '1 = 0');
  const supervisorScope = purchaseOrderScope({ role: 'supervisor', departmentId: 5 });
  assert.match(supervisorScope.clause, /r\.department_id = \?/);
  assert.deepEqual(supervisorScope.params, [5]);
});

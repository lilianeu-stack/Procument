import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  departmentDependencyCounts, departmentDependencyText, requiresDepartmentReassignment
} from '../src/utils/deletePolicy.js';

const adminPages = readFileSync(new URL('../src/pages/AdminPages.jsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/components/ui/Modal.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const adminRoutes = readFileSync(new URL('../../backend/src/routes/admin.js', import.meta.url), 'utf8');

test('department dependency policy covers every related historical record', () => {
  const department = {
    childCount: 7,
    userCount: 2,
    requisitionCount: 1,
    storeRequestCount: 3,
    itemCount: 4,
    stockMovementCount: 5,
    messageCount: 6
  };
  assert.equal(departmentDependencyCounts(department).length, 7);
  assert.equal(requiresDepartmentReassignment(department), true);
  const text = departmentDependencyText(department);
  for (const fragment of ['7 subdepartment(s)', '2 user(s)', '1 requisition(s)', '3 store request(s)', '4 inventory item(s)', '5 stock movement(s)', '6 message(s)']) {
    assert.ok(text.includes(fragment), `${fragment} must be shown before deletion`);
  }
  assert.equal(requiresDepartmentReassignment({ userCount: 0, messageCount: 0 }), false);
  assert.equal(requiresDepartmentReassignment({ childCount: 1 }), false);
  assert.match(departmentDependencyText({ childCount: 1 }), /must be moved or deleted first/);
});

test('confirmation dialogs are explicit, error-aware, and single-flight', () => {
  assert.ok(adminPages.includes('role="alertdialog"'));
  assert.ok(adminPages.includes('role="alert"'));
  assert.ok(adminPages.includes('Confirm Delete'));
  assert.ok(adminPages.includes('if (dialogSubmitting.current) return;'));
  assert.ok(adminPages.includes('disabled={busy || disabled}'));
  assert.ok(adminPages.includes('disabled={busy}'));
  assert.ok(adminPages.includes('dismissible={!busy}'));
  assert.ok(modal.includes('dismissible = true'));
});

test('deactivate and activate actions require confirmation', () => {
  assert.ok(adminPages.includes("dialog === 'toggle-user'"));
  assert.ok(adminPages.includes('Confirm Deactivate'));
  assert.ok(adminPages.includes('Confirm Activate'));
  assert.ok(adminPages.includes('onToggleUser(person.id, nextActive)'));
  assert.ok(adminPages.includes('updateDepartmentUser(person.id, { active: nextActive })'));
});

test('delete actions call the correct backend endpoints and refresh data', () => {
  assert.ok(app.includes("request(`/admin/departments/${id}`, { reassignTo }, 'DELETE')"));
  assert.ok(app.includes('loadData().then(() => result)'));
  assert.ok(app.includes("mutate(`/admin/users/${id}`, {}, 'DELETE')"));
  assert.ok(app.includes("mutate(`/admin/users/${id}/status`, { active }, 'PATCH')"));
});

test('backend department deletion reassigns all dependencies and blocks conflicts', () => {
  assert.ok(adminRoutes.includes("['users', 'requisitions', 'store_requests', 'items', 'inventory_movements', 'messages']"));
  assert.ok(adminRoutes.includes('subdepartment(s)'));
  assert.ok(adminRoutes.includes('UPDATE ${table} SET department_id = ? WHERE department_id = ?'));
  assert.ok(adminRoutes.includes('departmentDependencyMessage(usage)'));
  assert.ok(adminRoutes.includes("role = 'supervisor' AND active = TRUE"));
  assert.ok(adminRoutes.includes("'department_deleted'"));
});

test('backend user deletion is a soft delete with an audit record', () => {
  assert.ok(adminRoutes.includes('UPDATE users SET active = FALSE WHERE id = ?'));
  assert.ok(!adminRoutes.includes('DELETE FROM users WHERE id = ?'));
  assert.ok(adminRoutes.includes("'user_deleted'"));
});

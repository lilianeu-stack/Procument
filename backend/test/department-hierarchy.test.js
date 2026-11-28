import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pool, { DEPARTMENT_HIERARCHY, applySchemaMigrations, seedDepartmentHierarchy } from '../src/config/db.js';

let obsoleteUserId;

after(async () => {
  if (obsoleteUserId) await pool.execute('DELETE FROM users WHERE id = ?', [obsoleteUserId]);
  await pool.end();
});

test('department seeder keeps only the approved hierarchy and preserves linked users', async () => {
  await applySchemaMigrations();

  const stamp = Date.now();
  const [obsolete] = await pool.execute(
    'INSERT INTO departments (name, description) VALUES (?, ?)',
    [`QA Obsolete Department ${stamp}`, 'QA seed cleanup department']
  );
  const [user] = await pool.execute(
    `INSERT INTO users (name, email, password_hash, role, department_id, active)
     VALUES (?, ?, ?, 'requestor', ?, TRUE)`,
    [
      'QA Obsolete User',
      `qa.obsolete.${stamp}@example.org`,
      'qa-obsolete-password-hash',
      Number(obsolete.insertId)
    ]
  );
  obsoleteUserId = Number(user.insertId);

  await seedDepartmentHierarchy();

  const [[movedUser]] = await pool.execute('SELECT department_id FROM users WHERE id = ?', [obsoleteUserId]);
  const [[procurement]] = await pool.execute("SELECT id FROM departments WHERE name = 'Procurement' LIMIT 1");
  assert.equal(Number(movedUser.department_id), Number(procurement.id), 'Linked users must be reassigned, not deleted.');

  const [rows] = await pool.execute('SELECT id, name, parent_id AS parentId FROM departments ORDER BY id');
  const expectedNames = [
    ...Object.keys(DEPARTMENT_HIERARCHY),
    ...Object.values(DEPARTMENT_HIERARCHY).flat()
  ].sort();
  assert.deepEqual(rows.map((row) => row.name).sort(), expectedNames);

  const byName = new Map(rows.map((row) => [row.name, row]));
  for (const [departmentName, subdepartments] of Object.entries(DEPARTMENT_HIERARCHY)) {
    const department = byName.get(departmentName);
    assert.equal(department.parentId, null, `${departmentName} must be a top-level department.`);
    for (const subdepartmentName of subdepartments) {
      assert.equal(
        Number(byName.get(subdepartmentName).parentId),
        Number(department.id),
        `${subdepartmentName} must belong to ${departmentName}.`
      );
    }
  }
});

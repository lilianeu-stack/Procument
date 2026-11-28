import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin users page manages departments as a two-level hierarchy', () => {
  const adminPages = source('../src/pages/AdminPages.jsx');
  const app = source('../src/App.jsx');

  assert.match(adminPages, /topLevelDepartments = departments\.filter\(\(department\) => department\.parentId === null \|\| department\.parentId === undefined\)/);
  assert.match(adminPages, /subdepartments = departments\.filter\(\(department\) => department\.parentId !== null && department\.parentId !== undefined\)/);
  assert.match(adminPages, /const childUsers = children\.reduce/);
  assert.match(adminPages, /currentSubdepartments\.map/);
  assert.match(adminPages, /const parent = department\.parentName \|\| 'Other'/);
  assert.match(adminPages, /\(groups\[parent\] \|\|= \[\]\)\.push\(department\)/);
  assert.match(adminPages, /<optgroup key=\{parent\} label=\{parent\}>/);
  assert.match(adminPages, /parentName=\{departments\.find/);
  assert.match(adminPages, /parentId: parentId \|\| null/);
  assert.doesNotMatch(adminPages, /Administration Office/);

  assert.match(app, /onCreateDepartment: \(form\) => mutate\('\/admin\/departments', form\)/);
  assert.match(app, /onUpdateDepartment: \(id, form\) => mutate\(`\/admin\/departments\/\$\{id\}`, form, 'PATCH'\)/);
  assert.match(app, /onDeleteDepartment: \(id, reassignTo\) => request\(`\/admin\/departments\/\$\{id\}`/);
});

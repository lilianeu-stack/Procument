const DEPARTMENT_DEPENDENCIES = [
  ['childCount', 'subdepartment(s)'],
  ['userCount', 'user(s)'],
  ['requisitionCount', 'requisition(s)'],
  ['storeRequestCount', 'store request(s)'],
  ['itemCount', 'inventory item(s)'],
  ['stockMovementCount', 'stock movement(s)'],
  ['messageCount', 'message(s)']
];
const REASSIGNABLE_DEPENDENCIES = DEPARTMENT_DEPENDENCIES.filter(([key]) => key !== 'childCount');

export function departmentDependencyCounts(department = {}) {
  return DEPARTMENT_DEPENDENCIES
    .map(([key, label]) => ({ key, label, count: Math.max(0, Number(department[key]) || 0) }))
    .filter((dependency) => dependency.count > 0);
}

export function requiresDepartmentReassignment(department) {
  return REASSIGNABLE_DEPENDENCIES
    .some(([key]) => Math.max(0, Number(department[key]) || 0) > 0);
}

export function departmentDependencyText(department) {
  const dependencies = departmentDependencyCounts(department);
  if (!dependencies.length) return 'This department has no linked users or records.';
  const childCount = Math.max(0, Number(department.childCount) || 0);
  const childrenText = childCount
    ? `This department contains ${childCount} subdepartment(s), which must be moved or deleted first.`
    : '';
  const records = dependencies.filter((dependency) => dependency.key !== 'childCount');
  const recordsText = records.length
    ? `This department is referenced by ${records.map(({ count, label }) => `${count} ${label}`).join(', ')}. All of them will be reassigned; none will be deleted.`
    : '';
  return [childrenText, recordsText].filter(Boolean).join(' ');
}

const DEPARTMENT_DEPENDENCIES = [
  ['userCount', 'user(s)'],
  ['requisitionCount', 'requisition(s)'],
  ['storeRequestCount', 'store request(s)'],
  ['itemCount', 'inventory item(s)'],
  ['stockMovementCount', 'stock movement(s)'],
  ['messageCount', 'message(s)']
];

export function departmentDependencyCounts(department = {}) {
  return DEPARTMENT_DEPENDENCIES
    .map(([key, label]) => ({ key, label, count: Math.max(0, Number(department[key]) || 0) }))
    .filter((dependency) => dependency.count > 0);
}

export function requiresDepartmentReassignment(department) {
  return departmentDependencyCounts(department).length > 0;
}

export function departmentDependencyText(department) {
  const dependencies = departmentDependencyCounts(department);
  if (!dependencies.length) return 'This department has no linked users or records.';
  const summary = dependencies.map(({ count, label }) => `${count} ${label}`).join(', ');
  return `This department is referenced by ${summary}. All of them will be reassigned; none will be deleted.`;
}

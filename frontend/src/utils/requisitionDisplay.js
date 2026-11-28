import { dateParts } from './dates.js';

// Display-only requisition reference: HHR/<DD>/<MM>/<YY>/<0001>.
// The requester's department is intentionally omitted. The stored PR-...
// reference stays unchanged so workflow links, emails, exports and audits keep
// resolving to the same record. When the API supplies displayReference we use
// it verbatim so the UI, emails and notifications always agree.
export function requisitionDisplayReference(requisition = {}) {
  if (requisition.displayReference) return requisition.displayReference;
  const parts = dateParts(requisition.submittedAt || requisition.createdAt);
  const day = parts?.day || '—';
  const month = parts?.month || '—';
  const year = parts?.year?.slice(-2) || '—';
  const sequence = String(requisition.departmentSequence || 1).padStart(4, '0');
  return `HHR/${day}/${month}/${year}/${sequence}`;
}

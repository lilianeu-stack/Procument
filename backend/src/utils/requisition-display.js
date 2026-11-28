const DISPLAY_TIMEZONE = process.env.DISPLAY_TIMEZONE || 'Africa/Kigali';

function asInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let text = String(value).trim();
  if (!text) return null;
  // MySQL DATETIME values have no zone suffix; they represent stored UTC.
  const mysql = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (mysql) text = `${mysql[1]}T${mysql[2].length === 5 ? `${mysql[2]}:00` : mysql[2]}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateParts(value) {
  const date = asInstant(value);
  if (!date) return null;
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

// Display-only requisition reference: HHR/<DD>/<MM>/<YY>/<0001>.
// The stored PR-... reference is deliberately untouched so workflow links,
// exports, audits and email reply tags keep resolving to the same record.
export function requisitionDisplayReference(requisition = {}) {
  if (requisition.displayReference) return requisition.displayReference;
  const submitted = requisition.displaySubmittedAt || requisition.submittedAt || requisition.submitted_at
    || requisition.displayCreatedAt || requisition.createdAt || requisition.created_at;
  const parts = dateParts(submitted);
  const day = parts?.day || '—';
  const month = parts?.month || '—';
  const year = parts?.year?.slice(-2) || '—';
  const sequence = Number(
    requisition.displayDepartmentSequence ?? requisition.departmentSequence ?? requisition.department_sequence
  ) || 1;
  return `HHR/${day}/${month}/${year}/${String(sequence).padStart(4, '0')}`;
}

// Fields needed to build the display reference from a requisitions row. The
// display-specific aliases avoid colliding with an existing createdAt/submittedAt
// column already selected by the surrounding query.
export const REQUISITION_DISPLAY_SQL = `
  r.submitted_at AS displaySubmittedAt, r.created_at AS displayCreatedAt,
  (SELECT COUNT(*) FROM requisitions rr
     WHERE rr.requester_id = r.requester_id
       AND rr.department_id <=> r.department_id
       AND rr.id <= r.id) AS displayDepartmentSequence`;

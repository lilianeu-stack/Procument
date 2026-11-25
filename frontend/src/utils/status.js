// Single source of truth for requisition status labels and badge tones.
// Short legacy values (Pending / Approved / Rejected / In procurement) are kept
// unchanged so existing Administrator screens keep their familiar wording.

export const STATUS_LABELS = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  'Pending Supervisor Approval': 'Pending Supervisor Approval',
  'Information Required': 'Information Required',
  'Approved by Supervisor': 'Approved by Supervisor',
  'Rejected by Supervisor': 'Rejected by Supervisor',
  'Forwarded to Procurement': 'Forwarded to Procurement',
  'Under Procurement Review': 'Under Procurement Review',
  'Procurement Approved': 'Procurement Approved',
  'Procurement Rejected': 'Procurement Rejected',
  Processing: 'Processing',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  // Legacy / generic values still used outside the portals.
  Pending: 'Pending',
  Approved: 'Approved',
  Rejected: 'Rejected',
  'In procurement': 'In procurement',
  'Pending approval': 'Pending approval',
  'Low stock': 'Low stock',
  Paid: 'Paid',
  Issued: 'Issued',
  Received: 'Received',
  Sent: 'Sent',
  Evaluating: 'Evaluating',
  Awarded: 'Awarded',
  Active: 'Active',
  Inactive: 'Inactive'
};

export const STATUS_TONES = {
  Draft: 'slate',
  Submitted: 'blue',
  'Pending Supervisor Approval': 'amber',
  'Information Required': 'orange',
  'Approved by Supervisor': 'emerald',
  'Rejected by Supervisor': 'red',
  'Forwarded to Procurement': 'indigo',
  'Under Procurement Review': 'blue',
  'Procurement Approved': 'emerald',
  'Procurement Rejected': 'red',
  Processing: 'blue',
  Completed: 'emerald',
  Cancelled: 'slate',
  Pending: 'amber',
  Approved: 'emerald',
  Rejected: 'red',
  'In procurement': 'indigo',
  'Pending approval': 'amber',
  'Low stock': 'amber',
  Paid: 'emerald',
  Issued: 'indigo',
  Received: 'emerald',
  Sent: 'blue',
  Evaluating: 'amber',
  Awarded: 'emerald',
  Active: 'emerald',
  Inactive: 'slate'
};

export const BADGE_TONES = {
  slate: 'border border-brand bg-white text-black',
  blue: 'border border-brand bg-white text-black',
  indigo: 'border border-brand bg-white text-black',
  amber: 'border border-brand bg-white text-black',
  orange: 'border border-brand bg-white text-black',
  emerald: 'border border-brand bg-white text-black',
  red: 'border border-brand bg-white text-black',
  rose: 'border border-brand bg-white text-black'
};

export function statusLabel(value) {
  if (!value) return 'Draft';
  return STATUS_LABELS[value] || String(value);
}

export function statusTone(value) {
  return STATUS_TONES[value] || 'slate';
}

export function badgeTone(tone) {
  return BADGE_TONES[tone] || BADGE_TONES.slate;
}

export const SUPERVISOR_PENDING = 'Pending Supervisor Approval';
export const APPROVED_STATUSES = ['Approved by Supervisor', 'Forwarded to Procurement'];
export const APPROVED_STATUS_FILTER = APPROVED_STATUSES.join(',');

export const REQUEST_STATUS_OPTIONS = [
  'Draft',
  'Submitted',
  'Pending Supervisor Approval',
  'Information Required',
  'Approved by Supervisor',
  'Rejected by Supervisor',
  'Forwarded to Procurement',
  'Under Procurement Review',
  'Procurement Approved',
  'Procurement Rejected',
  'Processing',
  'Completed',
  'Cancelled'
];

// Map human-friendly query values to the exact values the API expects.
const STATUS_ALIASES = {
  all: '',
  pending: SUPERVISOR_PENDING,
  information: 'Information Required',
  approved: 'Approved by Supervisor',
  rejected: 'Rejected by Supervisor',
  forwarded: 'Forwarded to Procurement',
  review: 'Under Procurement Review',
  completed: 'Completed',
  submitted: 'Submitted',
  draft: 'Draft'
};

export function normalizeStatus(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'all') return '';
  const lower = raw.toLowerCase();
  if (['approved group', 'approved-group', 'approved forwarded', 'approved or forwarded'].includes(lower)) {
    return APPROVED_STATUS_FILTER;
  }
  if (raw.includes(',')) {
    return raw.split(',').map((part) => normalizeStatus(part)).filter(Boolean).join(',');
  }
  return STATUS_ALIASES[lower] || raw;
}

export function isPendingApproval(status) {
  return status === SUPERVISOR_PENDING;
}

export function isDraft(status) {
  return status === 'Draft';
}

export function isInformationRequired(status) {
  return status === 'Information Required';
}

export function isCompletedRequest(status) {
  return ['Completed', 'Procurement Approved', 'Procurement Rejected', 'Cancelled'].includes(status);
}

export function decisionLabel(decision) {
  return decision || '—';
}

export function decisionTone(decision) {
  if (decision === 'Approve') return 'emerald';
  if (decision === 'Reject') return 'red';
  if (decision === 'Request Information') return 'amber';
  return 'slate';
}

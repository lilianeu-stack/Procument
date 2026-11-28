export const REQUISITION_STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING: 'Pending Supervisor Approval',
  INFORMATION: 'Information Required',
  APPROVED: 'Approved by Supervisor',
  REJECTED: 'Rejected by Supervisor',
  FORWARDED: 'Forwarded to Procurement',
  UNDER_REVIEW: 'Under Procurement Review',
  PROCUREMENT_APPROVED: 'Procurement Approved',
  PROCUREMENT_REJECTED: 'Procurement Rejected',
  PROCESSING: 'Processing',
  AWAITING_STOCK_ISSUE: 'Awaiting Stock Issue',
  PARTIALLY_ISSUED: 'Partially Issued',
  RETURNED_TO_SUPERVISOR: 'Returned to Supervisor',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

export const STATUS_LABELS = {
  [REQUISITION_STATUS.DRAFT]: 'Draft',
  [REQUISITION_STATUS.SUBMITTED]: 'Submitted',
  [REQUISITION_STATUS.PENDING]: 'Pending Supervisor Approval',
  [REQUISITION_STATUS.INFORMATION]: 'Information Required',
  [REQUISITION_STATUS.APPROVED]: 'Approved by Supervisor',
  [REQUISITION_STATUS.REJECTED]: 'Rejected by Supervisor',
  [REQUISITION_STATUS.FORWARDED]: 'Forwarded to Procurement',
  [REQUISITION_STATUS.UNDER_REVIEW]: 'Under Procurement Review',
  [REQUISITION_STATUS.PROCUREMENT_APPROVED]: 'Procurement Approved',
  [REQUISITION_STATUS.PROCUREMENT_REJECTED]: 'Procurement Rejected',
  [REQUISITION_STATUS.PROCESSING]: 'Processing',
  [REQUISITION_STATUS.AWAITING_STOCK_ISSUE]: 'Awaiting Stock Issue',
  [REQUISITION_STATUS.PARTIALLY_ISSUED]: 'Partially Issued',
  [REQUISITION_STATUS.RETURNED_TO_SUPERVISOR]: 'Returned to Supervisor',
  [REQUISITION_STATUS.COMPLETED]: 'Completed',
  [REQUISITION_STATUS.CANCELLED]: 'Cancelled',
  Pending: 'Pending (legacy)',
  Approved: 'Approved (legacy)',
  Rejected: 'Rejected (legacy)',
  'In procurement': 'In procurement'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Draft';
}

// Statuses that the existing Procurement team can act on when preparing an RFQ.
// `Approved by Supervisor` is deliberately excluded: approval alone never sends a
// document to Procurement. Department requests must be explicitly forwarded first.
// The short `Approved` value is a legacy status kept for historical records that
// were created by the Administrator-side workflow before the Department portals.
export const PROCUREMENT_READY_STATUSES = [
  REQUISITION_STATUS.FORWARDED,
  REQUISITION_STATUS.UNDER_REVIEW,
  'Approved'
];

// Groups used by the received-requests statistics and card filters. Legacy
// labels remain included so historical forwarded records are not lost.
export const RECEIVED_STATUS_GROUPS = {
  new: [REQUISITION_STATUS.FORWARDED, 'Approved'],
  underReview: [REQUISITION_STATUS.UNDER_REVIEW],
  processing: [REQUISITION_STATUS.PROCESSING, REQUISITION_STATUS.PROCUREMENT_APPROVED],
  completed: [REQUISITION_STATUS.COMPLETED],
  rejected: [REQUISITION_STATUS.PROCUREMENT_REJECTED, 'Rejected']
};

// A Department request is only visible to Procurement once its forwarding
// action completed. The forwarded_by_supervisor column is the authoritative
// marker; the status is only the workflow label.
export function isForwardedToProcurement(row) {
  return Boolean(row && (
    row.forwardedBySupervisor != null || row.forwarded_by_supervisor != null
  ));
}

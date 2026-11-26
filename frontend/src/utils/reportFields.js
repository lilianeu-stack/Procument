import { PROCUREMENT_COMMITTEE_PAGE, RECEIVED_REQUESTS_PAGE } from './access.js';

const REQUISITION_FIELDS = [
  { key: 'submitted', label: 'Date submitted' },
  { key: 'forwarded', label: 'Date forwarded' },
  { key: 'approved', label: 'Supervisor decision' },
  { key: 'required', label: 'Required by' },
  { key: 'created', label: 'Date created' }
];

export const PAGE_REPORTS = {
  Overview: null,
  Requisitions: { exportKey: 'requisitions', title: 'Purchase requisitions', fields: REQUISITION_FIELDS, defaultField: 'submitted' },
  Approvals: { exportKey: 'requisitions', title: 'Requisition approvals', fields: REQUISITION_FIELDS, defaultField: 'approved' },
  [RECEIVED_REQUESTS_PAGE]: {
    exportKey: 'receivedRequests', title: 'Requests received from Departments',
    fields: REQUISITION_FIELDS, defaultField: 'forwarded'
  },
  RFQs: {
    exportKey: 'rfqs', title: 'Requests for quotation',
    fields: [
      { key: 'issued', label: 'Date issued' }, { key: 'due', label: 'Quotation due date' },
      { key: 'closed', label: 'Date closed' }, { key: 'created', label: 'Date created' }
    ],
    defaultField: 'issued'
  },
  'Purchase orders': {
    exportKey: 'purchaseOrders', title: 'Purchase orders',
    fields: [
      { key: 'created', label: 'Date created' }, { key: 'approved', label: 'Date approved' },
      { key: 'delivery', label: 'Delivery date' }
    ],
    defaultField: 'created'
  },
  'Goods receipts': {
    exportKey: 'goodsReceipts', title: 'Goods received notes',
    fields: [{ key: 'received', label: 'Date received' }, { key: 'expected', label: 'Expected delivery' }],
    defaultField: 'received'
  },
  Invoices: {
    exportKey: 'invoices', title: 'Invoices',
    fields: [
      { key: 'submitted', label: 'Date submitted' }, { key: 'approved', label: 'Date approved' },
      { key: 'paid', label: 'Date paid' }, { key: 'due', label: 'Payment due date' },
      { key: 'created', label: 'Date created' }
    ],
    defaultField: 'submitted'
  },
  'Store requests': {
    exportKey: 'storeRequests', title: 'Store requests',
    fields: [
      { key: 'submitted', label: 'Date submitted' }, { key: 'approved', label: 'Date approved' },
      { key: 'issued', label: 'Date issued' }, { key: 'required', label: 'Required by' },
      { key: 'created', label: 'Date created' }
    ],
    defaultField: 'submitted'
  },
  'Stock overview': {
    exportKey: 'inventory', title: 'Inventory catalogue',
    fields: [{ key: 'updated', label: 'Last updated' }], defaultField: 'updated'
  },
  'Stock movements': {
    exportKey: 'inventoryMovements', title: 'Inventory movements',
    fields: [{ key: 'movement', label: 'Movement date' }, { key: 'created', label: 'Date recorded' }],
    defaultField: 'movement'
  },
  Suppliers: {
    exportKey: 'suppliers', title: 'Suppliers',
    fields: [{ key: 'created', label: 'Date added' }, { key: 'updated', label: 'Last updated' }],
    defaultField: 'created'
  },
  Users: {
    exportKey: 'users', title: 'User accounts',
    fields: [{ key: 'created', label: 'Date created' }, { key: 'login', label: 'Last login' }],
    defaultField: 'created'
  },
  [PROCUREMENT_COMMITTEE_PAGE]: {
    exportKey: 'committeeMembers', title: 'Procurement Committee members',
    fields: [{ key: 'created', label: 'Date added' }], defaultField: 'created'
  }
};

export function reportForPage(page) {
  return PAGE_REPORTS[page] || null;
}

export function dateQueryForFilter(filter) {
  if (!filter) return {};
  return {
    from: filter.from || '',
    to: filter.to || '',
    dateField: filter.dateField || ''
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import pool from '../config/db.js';
import { dateFilterClause, parseDateFilter } from '../utils/dates.js';
import { withPortalIdentity } from '../utils/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [
  process.env.BRAND_LOGO_PATH,
  path.resolve(__dirname, '../../../frontend/public/procurement-logo.png'),
  path.resolve(__dirname, '../../../../frontend/public/procurement-logo.png')
].filter(Boolean);

const BRAND = {
  organization: 'Hope Haven',
  title: 'Procurement Management System',
  caption: 'PROCUREMENT & STORES'
};

const EXPORT_DEFINITIONS = {
  requisitions: {
    label: 'Purchase Requisitions',
    role: 'admin',
    dateFields: { created: 'r.created_at', submitted: 'r.submitted_at', approved: 'r.supervisor_decision_at', forwarded: 'r.forwarded_at', required: 'r.required_by' },
    defaultField: 'submitted',
    sql: `
      SELECT r.reference AS Reference, r.title AS Title, COALESCE(u.name, '—') AS Requester,
        COALESCE(d.name, '—') AS Department, r.status AS Status, r.priority AS Priority,
        COALESCE(r.required_by, '—') AS 'Required by',
        COALESCE(r.submitted_at, '—') AS 'Submitted at',
        COALESCE(r.supervisor_decision_at, '—') AS 'Approved at',
        COALESCE(r.forwarded_at, '—') AS 'Forwarded at',
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS Total
      FROM requisitions r
      JOIN users u ON u.id = r.requester_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE 1 = 1 {{dateFilter}}
      GROUP BY r.id ORDER BY COALESCE(r.submitted_at, r.created_at) DESC`
  },
  receivedRequests: {
    label: 'Requests Received from Departments',
    role: 'procurement',
    dateFields: { forwarded: 'r.forwarded_at', submitted: 'r.submitted_at', created: 'r.created_at', approved: 'r.supervisor_decision_at' },
    defaultField: 'forwarded',
    sql: `
      SELECT r.reference AS Reference, r.title AS Title,
        COALESCE(d.name, '—') AS Department, u.name AS Requester,
        su.name AS 'Approved by', fwd.name AS 'Forwarded by',
        r.status AS Status, COALESCE(r.submitted_at, '—') AS 'Submitted at',
        r.forwarded_at AS 'Forwarded at',
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS Total
      FROM requisitions r
      JOIN users u ON u.id = r.requester_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN users su ON su.id = r.supervisor_id
      LEFT JOIN users fwd ON fwd.id = r.forwarded_by_supervisor
      LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE r.forwarded_by_supervisor IS NOT NULL AND r.forwarded_at IS NOT NULL {{dateFilter}}
      GROUP BY r.id ORDER BY r.forwarded_at DESC`
  },
  rfqs: {
    label: 'Requests for Quotation',
    role: 'procurement',
    dateFields: { issued: 'f.issued_at', due: 'f.due_date', closed: 'f.closed_at', created: 'f.created_at' },
    defaultField: 'issued',
    sql: `
      SELECT f.reference AS Reference, r.reference AS Requisition, f.status AS Status,
        COALESCE(f.issued_at, '—') AS 'Issued at', COALESCE(f.due_date, '—') AS 'Due date',
        COALESCE(f.closed_at, '—') AS 'Closed at', COUNT(DISTINCT fs.supplier_id) AS 'Suppliers invited',
        COUNT(DISTINCT q.id) AS Quotations
      FROM rfqs f JOIN requisitions r ON r.id = f.requisition_id
      LEFT JOIN rfq_suppliers fs ON fs.rfq_id = f.id
      LEFT JOIN quotations q ON q.rfq_id = f.id
      WHERE 1 = 1 {{dateFilter}}
      GROUP BY f.id ORDER BY COALESCE(f.issued_at, f.created_at) DESC`
  },
  purchaseOrders: {
    label: 'Purchase Orders',
    role: 'procurement',
    dateFields: { created: 'p.created_at', approved: 'p.approved_at', delivery: 'p.delivery_date' },
    defaultField: 'created',
    sql: `
      SELECT p.reference AS Reference, COALESCE(r.reference, '—') AS Requisition,
        COALESCE(f.reference, '—') AS RFQ, s.name AS Supplier, p.total AS Total,
        p.status AS Status, COALESCE(p.delivery_date, '—') AS 'Delivery date',
        COALESCE(p.approved_at, '—') AS 'Approved at', COALESCE(p.created_at, '—') AS 'Created at'
      FROM purchase_orders p
      JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN rfqs f ON f.id = p.rfq_id
      LEFT JOIN requisitions r ON r.id = f.requisition_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY p.created_at DESC`
  },
  goodsReceipts: {
    label: 'Goods Received Notes',
    role: 'procurement',
    dateFields: { received: 'g.received_at', expected: 'g.expected_at' },
    defaultField: 'received',
    sql: `
      SELECT g.reference AS Reference, COALESCE(p.reference, '—') AS 'Purchase order',
        g.source AS Source, u.name AS 'Received by',
        COALESCE(g.expected_at, '—') AS 'Expected at', g.received_at AS 'Received at',
        GROUP_CONCAT(CONCAT(i.name, ' × ', gi.quantity) SEPARATOR ', ') AS Items
      FROM goods_receipts g
      LEFT JOIN purchase_orders p ON p.id = g.purchase_order_id
      JOIN users u ON u.id = g.received_by
      JOIN goods_receipt_items gi ON gi.goods_receipt_id = g.id
      JOIN items i ON i.id = gi.item_id
      WHERE 1 = 1 {{dateFilter}}
      GROUP BY g.id ORDER BY g.received_at DESC`
  },
  invoices: {
    label: 'Invoices',
    role: 'finance',
    dateFields: { submitted: 'i.submitted_at', approved: 'i.approved_at', paid: 'i.paid_at', due: 'i.due_date', created: 'i.created_at' },
    defaultField: 'submitted',
    sql: `
      SELECT i.reference AS Reference, p.reference AS 'Purchase order', s.name AS Supplier,
        i.amount AS Amount, i.status AS Status, COALESCE(i.invoice_date, '—') AS 'Invoice date',
        COALESCE(i.due_date, '—') AS 'Due date', COALESCE(i.submitted_at, '—') AS 'Submitted at',
        COALESCE(i.approved_at, '—') AS 'Approved at', COALESCE(i.paid_at, '—') AS 'Paid at'
      FROM invoices i
      JOIN purchase_orders p ON p.id = i.purchase_order_id
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY COALESCE(i.submitted_at, i.created_at) DESC`
  },
  storeRequests: {
    label: 'Store Requests',
    role: 'storekeeper',
    dateFields: { submitted: 'sr.submitted_at', approved: 'sr.approved_at', issued: 'sr.issued_at', required: 'sr.required_by', created: 'sr.created_at' },
    defaultField: 'submitted',
    sql: `
      SELECT sr.reference AS Reference, u.name AS Requester, COALESCE(d.name, '—') AS Department,
        sr.purpose AS Purpose, sr.status AS Status,
        COALESCE(sr.required_by, '—') AS 'Required by',
        COALESCE(sr.submitted_at, '—') AS 'Submitted at',
        COALESCE(sr.approved_at, '—') AS 'Approved at',
        COALESCE(sr.issued_at, '—') AS 'Issued at',
        GROUP_CONCAT(CONCAT(i.name, ' × ', sri.quantity) SEPARATOR ', ') AS Items
      FROM store_requests sr
      JOIN users u ON u.id = sr.requester_id
      LEFT JOIN departments d ON d.id = sr.department_id
      JOIN store_request_items sri ON sri.store_request_id = sr.id
      JOIN items i ON i.id = sri.item_id
      WHERE 1 = 1 {{dateFilter}}
      GROUP BY sr.id ORDER BY COALESCE(sr.submitted_at, sr.created_at) DESC`
  },
  inventory: {
    label: 'Inventory Catalogue',
    role: 'storekeeper',
    dateFields: { updated: 'i.updated_at' },
    defaultField: 'updated',
    sql: `
      SELECT i.sku AS SKU, i.name AS Item, i.category AS Category, i.unit AS Unit,
        i.quantity AS 'Quantity on hand', i.reorder_level AS 'Reorder level',
        i.unit_cost AS 'Unit cost', IF(i.quantity <= i.reorder_level, 'Low stock', 'OK') AS Status,
        i.updated_at AS 'Updated at'
      FROM items i
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY i.name`
  },
  inventoryMovements: {
    label: 'Inventory Movements',
    role: 'storekeeper',
    dateFields: { movement: 'COALESCE(m.movement_at, m.created_at)', created: 'm.created_at' },
    defaultField: 'movement',
    sql: `
      SELECT m.id AS ID, i.sku AS SKU, i.name AS Item, m.movement_type AS Type,
        m.quantity AS Quantity, m.source AS Source, m.balance_after AS Balance,
        COALESCE(u.name, '—') AS 'Recorded by',
        COALESCE(m.movement_at, m.created_at) AS 'Movement at'
      FROM inventory_movements m
      JOIN items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY COALESCE(m.movement_at, m.created_at) DESC`
  },
  suppliers: {
    label: 'Suppliers',
    role: 'procurement',
    dateFields: { created: 's.created_at', updated: 's.updated_at' },
    defaultField: 'created',
    sql: `
      SELECT s.name AS Supplier, COALESCE(s.contact_name, '—') AS Contact,
        COALESCE(s.email, '—') AS Email, COALESCE(s.phone, '—') AS Phone,
        s.rating AS Rating, s.status AS Status, s.created_at AS 'Created at'
      FROM suppliers s
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY s.name`
  },
  users: {
    label: 'User Accounts',
    role: 'admin',
    dateFields: { created: 'u.created_at', login: 'u.last_login_at', updated: 'u.updated_at' },
    defaultField: 'created',
    sql: `
      SELECT u.name AS Name, u.email AS Email, u.role AS Role,
        COALESCE(d.name, '—') AS Department,
        IF(u.active, 'Active', 'Inactive') AS Status,
        u.created_at AS 'Created at', COALESCE(u.last_login_at, '—') AS 'Last login at'
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY u.name`
  },
  auditLogs: {
    label: 'Audit & Activity Log',
    role: 'admin',
    dateFields: { created: 'a.created_at' },
    defaultField: 'created',
    sql: `
      SELECT a.id AS ID, a.created_at AS Timestamp, COALESCE(u.name, 'System') AS Actor,
        a.action AS 'Activity type', a.entity_type AS 'Record type', a.entity_id AS 'Record ID',
        COALESCE(a.previous_status, '—') AS 'Previous status',
        COALESCE(a.new_status, '—') AS 'New status',
        COALESCE(a.details, '—') AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY a.created_at DESC, a.id DESC`
  }
};

const RECORD_QUERIES = {
  requisition: {
    roles: ['admin', 'procurement', 'supervisor', 'requestor'],
    label: 'Purchase Requisition',
    sql: `
      SELECT r.id, r.requester_id AS requesterId, r.reference, r.title, r.justification, r.budget_code AS budgetCode,
        r.priority, r.required_by AS requiredBy, r.status,
        r.submitted_at AS submittedAt, r.forwarded_at AS forwardedAt,
        r.supervisor_decision AS supervisorDecision,
        r.supervisor_decision_at AS supervisorDecisionAt,
        r.supervisor_notes AS supervisorNotes,
        r.procurement_decision_at AS procurementDecisionAt,
        r.completed_at AS completedAt, r.created_at AS createdAt,
        u.name AS requester, u.department_id AS requesterDepartmentId,
        d.name AS department, su.name AS supervisorName,
        fwd.name AS forwardedByName, su.department_id AS supervisorDepartmentId,
        COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total,
        COUNT(ri.id) AS itemCount
      FROM requisitions r
      JOIN users u ON u.id = r.requester_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN users su ON su.id = r.supervisor_id
      LEFT JOIN users fwd ON fwd.id = r.forwarded_by_supervisor
      LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE r.id = ? GROUP BY r.id`,
    itemsSql: `
      SELECT ri.item_name AS Item, COALESCE(ri.description, '') AS Description,
        ri.quantity AS Quantity, ri.unit AS Unit,
        ri.estimated_unit_cost AS 'Unit cost',
        ri.quantity * ri.estimated_unit_cost AS 'Line total'
      FROM requisition_items ri WHERE ri.requisition_id = ? ORDER BY ri.id`,
    activitySql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM requisition_activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.requisition_id = ? ORDER BY a.created_at, a.id`
  },
  storeRequest: {
    roles: ['admin', 'storekeeper'],
    label: 'Store Request',
    sql: `
      SELECT sr.id, sr.reference, sr.purpose, sr.status, sr.required_by AS requiredBy,
        sr.submitted_at AS submittedAt, sr.approved_at AS approvedAt,
        sr.issued_at AS issuedAt, sr.created_at AS createdAt,
        u.name AS requester, u.department_id AS requesterDepartmentId,
        d.name AS department, reviewer.name AS reviewedByName
      FROM store_requests sr JOIN users u ON u.id = sr.requester_id
      LEFT JOIN departments d ON d.id = sr.department_id
      LEFT JOIN users reviewer ON reviewer.id = sr.reviewed_by
      WHERE sr.id = ?`,
    itemsSql: `
      SELECT i.name AS Item, i.sku AS SKU, sri.quantity AS 'Requested',
        sri.issued_quantity AS Issued, i.unit AS Unit
      FROM store_request_items sri JOIN items i ON i.id = sri.item_id
      WHERE sri.store_request_id = ? ORDER BY i.name`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'store_request' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  rfq: {
    roles: ['admin', 'procurement', 'committee'],
    label: 'Request for Quotation',
    sql: `
      SELECT f.id, f.reference, f.status, f.due_date AS dueDate,
        f.issued_at AS issuedAt, f.closed_at AS closedAt, f.created_at AS createdAt,
        r.reference AS requisition, u.name AS createdBy,
        supplier.name AS awardedSupplier
      FROM rfqs f JOIN requisitions r ON r.id = f.requisition_id
      JOIN users u ON u.id = f.created_by
      LEFT JOIN quotations q ON q.id = f.selected_quotation_id
      LEFT JOIN suppliers supplier ON supplier.id = q.supplier_id
      WHERE f.id = ?`,
    itemsSql: `
      SELECT s.name AS Supplier, COALESCE(s.contact_name, '') AS Contact,
        COALESCE(s.email, '') AS Email, q.amount AS Amount,
        q.delivery_days AS 'Delivery days', q.quality_score AS Quality,
        q.rating_score AS Rating
      FROM rfq_suppliers fs JOIN suppliers s ON s.id = fs.supplier_id
      LEFT JOIN quotations q ON q.rfq_id = fs.rfq_id AND q.supplier_id = s.id
      WHERE fs.rfq_id = ? ORDER BY q.amount, s.name`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'rfq' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  purchaseOrder: {
    roles: ['admin', 'procurement', 'approver'],
    label: 'Purchase Order',
    sql: `
      SELECT p.id, p.reference, p.total, p.status, p.delivery_date AS deliveryDate,
        p.approved_at AS approvedAt, p.created_at AS createdAt,
        s.name AS supplier, s.contact_name AS contactName, s.email AS supplierEmail,
        r.reference AS requisition, f.reference AS rfq,
        creator.name AS createdBy, reviewer.name AS approvedBy
      FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      JOIN rfqs f ON f.id = p.rfq_id JOIN requisitions r ON r.id = f.requisition_id
      JOIN users creator ON creator.id = p.created_by
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      WHERE p.id = ?`,
    itemsSql: `
      SELECT poi.item_name AS Item, poi.quantity AS Quantity,
        poi.unit_price AS 'Unit price', poi.line_total AS 'Line total'
      FROM purchase_order_items poi WHERE poi.purchase_order_id = ? ORDER BY poi.id`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'purchase_order' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  goodsReceipt: {
    roles: ['admin', 'procurement', 'storekeeper'],
    label: 'Goods Received Note',
    sql: `
      SELECT g.id, g.reference, g.source, g.expected_at AS expectedAt,
        g.received_at AS receivedAt, u.name AS receivedBy,
        p.reference AS purchaseOrder
      FROM goods_receipts g JOIN users u ON u.id = g.received_by
      LEFT JOIN purchase_orders p ON p.id = g.purchase_order_id
      WHERE g.id = ?`,
    itemsSql: `
      SELECT i.name AS Item, i.sku AS SKU, gi.quantity AS Quantity, i.unit AS Unit
      FROM goods_receipt_items gi JOIN items i ON i.id = gi.item_id
      WHERE gi.goods_receipt_id = ? ORDER BY i.name`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'goods_receipt' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  invoice: {
    roles: ['admin', 'finance', 'procurement'],
    label: 'Invoice',
    sql: `
      SELECT i.id, i.reference, i.amount, i.status, i.invoice_date AS invoiceDate,
        i.due_date AS dueDate, i.submitted_at AS submittedAt,
        i.approved_at AS approvedAt, i.paid_at AS paidAt,
        p.reference AS purchaseOrder, s.name AS supplier,
        submitter.name AS submittedBy, reviewer.name AS reviewedBy
      FROM invoices i JOIN purchase_orders p ON p.id = i.purchase_order_id
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN users submitter ON submitter.id = i.submitted_by
      LEFT JOIN users reviewer ON reviewer.id = i.reviewed_by
      WHERE i.id = ?`,
    itemsSql: `
      SELECT p.reference AS 'Purchase order', s.name AS Supplier,
        i.amount AS Amount, i.status AS Status
      FROM invoices i JOIN purchase_orders p ON p.id = i.purchase_order_id
      JOIN suppliers s ON s.id = p.supplier_id WHERE i.id = ?`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status', a.details AS Details
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'invoice' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  }
};

function recordMeta(row, definition) {
  const labelMap = {
    reference: 'Reference', title: 'Title', status: 'Status', requester: 'Requester',
    department: 'Department', supervisorName: 'Supervisor', forwardedByName: 'Forwarded by',
    submittedAt: 'Submitted', forwardedAt: 'Forwarded', requiredBy: 'Required by',
    supervisorDecision: 'Supervisor decision', supervisorDecisionAt: 'Supervisor decision date',
    approvedAt: 'Approved', approvedBy: 'Approved by', issuedAt: 'Issued',
    paidAt: 'Paid', dueDate: 'Due date', deliveryDate: 'Delivery date',
    receivedAt: 'Received', expectedAt: 'Expected', receivedBy: 'Received by',
    createdAt: 'Created', createdBy: 'Created by', supplier: 'Supplier',
    contactName: 'Contact', supplierEmail: 'Supplier email',
    purchaseOrder: 'Purchase order', requisition: 'Requisition', rfq: 'RFQ',
    invoiceDate: 'Invoice date', amount: 'Amount', total: 'Total',
    justification: 'Justification', budgetCode: 'Budget code', priority: 'Priority',
    purpose: 'Purpose', source: 'Source', awardedSupplier: 'Awarded supplier'
  };
  return Object.entries(row)
    .filter(([key, value]) => !['id', 'requesterId', 'requesterDepartmentId', 'supervisorDepartmentId'].includes(key))
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: labelMap[key] || key.replace(/([A-Z])/g, ' $1'), value: displayValue(value) }));
}

export async function fetchRecord(type, id, user) {
  const definition = RECORD_QUERIES[type];
  if (!definition) {
    const error = new Error('Unknown record type.');
    error.status = 404;
    throw error;
  }
  const identity = withPortalIdentity(user);
  if (!identity || !definition.roles.includes(identity.role)) {
    const error = new Error('You do not have permission to export this record.');
    error.status = 403;
    throw error;
  }
  const [[row]] = await pool.query(definition.sql, [id]);
  if (!row) {
    const error = new Error('Record not found.');
    error.status = 404;
    throw error;
  }
  if (identity.role === 'requestor' && type === 'requisition' && Number(row.requesterId) !== Number(user.id)) {
    const error = new Error('You can only export your own requests.');
    error.status = 403;
    throw error;
  }
  if (identity.role === 'supervisor' && type === 'requisition') {
    const allowedDepartment = row.supervisorDepartmentId ?? row.requesterDepartmentId;
    if (Number(user.departmentId) !== Number(allowedDepartment)) {
      const error = new Error('This request belongs to another Department.');
      error.status = 403;
      throw error;
    }
  }
  const itemsQuery = definition.itemsSql ? definition.itemsSql : null;
  const historyQuery = definition.activitySql || definition.auditSql;
  const [items] = itemsQuery ? await pool.query(itemsQuery, [id]) : [[]];
  const [activity] = historyQuery ? await pool.query(historyQuery, [id]) : [[]];
  return {
    label: definition.label,
    reference: row.reference || String(id),
    row,
    meta: recordMeta(row, definition),
    items,
    activity,
    notes: row.supervisorNotes || row.justification || row.purpose || ''
  };
}

function recordFooter(doc) {
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`, 40, doc.page.height - 34);
    doc.text(`Page ${index + 1} of ${pages.count}`, 40, doc.page.height - 34, {
      width: doc.page.width - 80, align: 'right'
    });
  }
}

export async function renderRecordPdf(record) {
  const doc = new PDFDocument({
    size: 'A4', margin: 40,
    info: { Title: `${record.label} ${record.reference}`, Author: BRAND.organization }
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawBrand(doc);
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#172638').text(record.label, 40, y);
  y += 20;
  doc.font('Helvetica').fontSize(10).fillColor('#3656a5').text(`Reference: ${record.reference}`, 40, y);
  y += 24;

  function ensure(height) {
    if (y + height > doc.page.height - 56) {
      doc.addPage();
      y = 48;
      drawBrand(doc);
      y = 116;
    }
  }

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text('Record details', 40, y);
  y += 16;
  const half = (doc.page.width - 100) / 2;
  for (let index = 0; index < record.meta.length; index += 2) {
    ensure(32);
    const rowY = y;
    for (const offset of [0, 1]) {
      const entry = record.meta[index + offset];
      if (!entry) continue;
      const x = 40 + offset * half;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text(entry.label.toUpperCase(), x, rowY);
      doc.font('Helvetica').fontSize(9).fillColor('#172638')
        .text(entry.value, x, rowY + 11, { width: half - 12, lineBreak: false, ellipsis: true });
    }
    y += 32;
  }
  y += 12;

  if (record.notes) {
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text('Notes / justification', 40, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#172638')
      .text(record.notes, 40, y, { width: doc.page.width - 80 });
    y = doc.y + 14;
  }

  async function table(title, rows) {
    if (!rows.length) return;
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(title, 40, y);
    y += 18;
    const columns = Object.keys(rows[0]);
    const usable = doc.page.width - 80;
    const widths = columns.map((column) => {
      const longest = Math.max(column.length, ...rows.slice(0, 12).map((row) => displayValue(row[column]).length));
      return Math.min(220, Math.max(70, longest * 5));
    });
    const scale = usable / widths.reduce((sum, width) => sum + width, 0);
    const scaled = widths.map((width) => width * scale);
    let x = 40;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').rect(40, y, usable, 20).fill('#3656a5');
    columns.forEach((column, index) => {
      doc.fillColor('#fff').text(String(column).toUpperCase(), x + 4, y + 6, { width: scaled[index] - 8, ellipsis: true });
      x += scaled[index];
    });
    y += 20;
    doc.fillColor('#172638').font('Helvetica').fontSize(8);
    rows.forEach((row, rowIndex) => {
      if (y + 20 > doc.page.height - 56) {
        doc.addPage(); y = 48; drawBrand(doc); y = 116;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(title, 40, y);
        y += 18;
        doc.fillColor('#172638').font('Helvetica').fontSize(8);
      }
      if (rowIndex % 2 === 1) doc.rect(40, y, usable, 20).fillOpacity(0.05).fill('#3656a5').fillOpacity(1);
      x = 40;
      columns.forEach((column, index) => {
        doc.fillColor('#172638').text(displayValue(row[column]), x + 4, y + 6, {
          width: scaled[index] - 8, ellipsis: true, lineBreak: false
        });
        x += scaled[index];
      });
      y += 20;
    });
    y += 14;
  }

  await table('Items and details', record.items);
  await table('Activity and approval history', record.activity);
  recordFooter(doc);
  doc.end();
  return done;
}

export async function renderRecordXlsx(record) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.organization;
  workbook.title = `${record.label} ${record.reference}`;
  const summary = workbook.addWorksheet('Summary');
  summary.getCell('A1').value = BRAND.organization;
  summary.getCell('A1').font = { bold: true, size: 15 };
  summary.getCell('A2').value = BRAND.title;
  summary.getCell('A3').value = `${record.label}: ${record.reference}`;
  summary.getCell('A3').font = { bold: true, size: 12 };
  let rowNumber = 5;
  for (const entry of record.meta) {
    summary.getCell(rowNumber, 1).value = entry.label;
    summary.getCell(rowNumber, 1).font = { bold: true };
    summary.getCell(rowNumber, 2).value = entry.value;
    rowNumber += 1;
  }
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 70;

  function addSheet(name, rows) {
    if (!rows.length) return;
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    const columns = Object.keys(rows[0]);
    sheet.addRow(columns).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3656A5' } };
    rows.forEach((data) => sheet.addRow(columns.map((column) => displayValue(data[column]))));
    columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = Math.min(45, Math.max(16, column.length + 4));
    });
    sheet.headerFooter.oddFooter = '&CPage &P of &N';
  }
  addSheet('Items', record.items);
  addSheet('Activity', record.activity);
  summary.headerFooter.oddFooter = '&CPage &P of &N';
  return workbook.xlsx.writeBuffer();
}

export function renderRecordCsv(record) {
  const lines = [
    `"${BRAND.organization}"`,
    `"${BRAND.title}"`,
    `"${record.label}","${record.reference}"`,
    '"Field","Value"',
    ...record.meta.map((entry) => `"${entry.label}","${String(entry.value).replace(/"/g, '""')}"`)
  ];
  if (record.items.length) {
    const columns = Object.keys(record.items[0]);
    lines.push('', columns.map((column) => `"${column}"`).join(','));
    for (const item of record.items) lines.push(columns.map((column) => `"${String(displayValue(item[column])).replace(/"/g, '""')}"`).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

function logoPath() {
  return LOGO_CANDIDATES.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
}

export function exportFilename(label, format, reference = '') {
  const date = new Date().toISOString().slice(0, 10);
  const subject = safeFilename(reference || label);
  return `${subject}-${date}.${format}`;
}

const PORTAL_EXPORT_KEY = 'portalRequisitions';
const PORTAL_EXPORT_FIELDS = {
  submitted: 'COALESCE(r.submitted_at, r.created_at)',
  created: 'r.created_at',
  approved: 'r.supervisor_decision_at',
  forwarded: 'r.forwarded_at',
  required: 'r.required_by'
};

// Portal reports are never global: Requesters receive only their own rows and
// Supervisors only rows from their assigned Department. The same predicates
// used by the list screens are applied here so downloads match what is visible.
export async function fetchPortalRequisitions(query, user) {
  const identity = withPortalIdentity(user);
  if (!identity || !['requestor', 'supervisor'].includes(identity.role)) {
    const error = new Error('You do not have permission to export this report.');
    error.status = 403;
    throw error;
  }

  const where = [];
  const params = [];
  if (identity.role === 'requestor') {
    where.push('r.requester_id = ?');
    params.push(user.id);
  } else {
    const [[account]] = await pool.execute('SELECT department_id FROM users WHERE id = ?', [user.id]);
    if (!account?.department_id) {
      const error = new Error('Your account is not assigned to a Department.');
      error.status = 403;
      throw error;
    }
    where.push('r.department_id = ?');
    params.push(account.department_id);
  }

  const status = String(query.status || '').trim().slice(0, 80);
  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (['1', 'true'].includes(String(query.hasDecision || '').toLowerCase())) {
    where.push('r.supervisor_decision_at IS NOT NULL');
  }
  const search = String(query.search || '').trim().toLowerCase().slice(0, 120);
  if (search) {
    where.push(`(LOWER(r.reference) LIKE ? OR LOWER(r.title) LIKE ? OR LOWER(u.name) LIKE ?)`);
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }
  const filter = parseDateFilter(query, PORTAL_EXPORT_FIELDS, { defaultField: 'submitted' });
  if (filter.error) {
    const error = new Error(filter.error);
    error.status = 400;
    throw error;
  }
  const dateClause = dateFilterClause(filter, PORTAL_EXPORT_FIELDS, params);
  if (dateClause) where.push(dateClause.replace(/^ AND \(|\)$/g, ''));

  const [rows] = await pool.query(
    `SELECT r.reference AS Reference, r.title AS Title,
      COALESCE(d.name, '—') AS Department, u.name AS Requester,
      COALESCE(su.name, '—') AS Supervisor, r.status AS Status,
      r.priority AS Priority, COALESCE(r.required_by, '—') AS 'Required by',
      COALESCE(r.submitted_at, r.created_at) AS 'Submitted at',
      COALESCE(r.supervisor_decision_at, '—') AS 'Approved at',
      COALESCE(r.forwarded_at, '—') AS 'Forwarded at',
      COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS Total
     FROM requisitions r
     JOIN users u ON u.id = r.requester_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN users su ON su.id = r.supervisor_id
     LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
     WHERE ${where.join(' AND ')}
     GROUP BY r.id ORDER BY COALESCE(r.submitted_at, r.created_at) DESC, r.id DESC`,
    params
  );

  return {
    label: identity.role === 'requestor' ? 'My purchase requisitions' : 'Department purchase requisitions',
    rows,
    dateField: filter.field,
    from: query.from || '',
    to: query.to || ''
  };
}

export function availableExports() {
  const reports = Object.entries(EXPORT_DEFINITIONS).map(([key, definition]) => ({
    key, label: definition.label, role: definition.role,
    dateFields: Object.keys(definition.dateFields)
  }));
  reports.push({
    key: PORTAL_EXPORT_KEY,
    label: 'My / Department purchase requisitions',
    role: 'requestor or supervisor',
    dateFields: Object.keys(PORTAL_EXPORT_FIELDS)
  });
  return reports;
}

export function canExport(user, key) {
  if (!user) return false;
  const identity = withPortalIdentity(user);
  if (key === PORTAL_EXPORT_KEY) return ['requestor', 'supervisor'].includes(identity.role);
  const definition = EXPORT_DEFINITIONS[key];
  if (!definition) return false;
  if (identity.role === 'admin') return true;
  return identity.portal === 'admin' && identity.role === definition.role;
}

function displayValue(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return `${text.slice(0, 10)} ${text.slice(11)} UTC`;
  return text;
}

export async function fetchExportRows(key, query, user) {
  if (key === PORTAL_EXPORT_KEY) {
    if (!canExport(user, key)) {
      const error = new Error('You do not have permission to export this report.');
      error.status = 403;
      throw error;
    }
    return fetchPortalRequisitions(query, user);
  }
  const definition = EXPORT_DEFINITIONS[key];
  if (!definition) {
    const error = new Error('Unknown export.');
    error.status = 404;
    throw error;
  }
  if (!canExport(user, key)) {
    const error = new Error('You do not have permission to export this report.');
    error.status = 403;
    throw error;
  }
  const filter = parseDateFilter(query, definition.dateFields, { defaultField: definition.defaultField });
  if (filter.error) {
    const error = new Error(filter.error);
    error.status = 400;
    throw error;
  }
  const params = [];
  const clause = dateFilterClause(filter, definition.dateFields, params);
  const sql = definition.sql.replace('{{dateFilter}}', clause);
  const [rows] = await pool.query(sql, params);
  return {
    label: definition.label,
    rows,
    dateField: filter.field,
    from: query.from || '',
    to: query.to || ''
  };
}

function drawBrand(doc) {
  const logo = logoPath();
  const margin = 40;
  if (logo) doc.image(logo, margin, 34, { width: 52, height: 52, fit: [52, 52], contain: true });
  const textX = logo ? margin + 62 : margin;
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#172638').text(BRAND.organization, textX, 38);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#3656a5').text(BRAND.title, textX, 60);
  doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(BRAND.caption, textX, 78);
  doc.moveTo(margin, 98).lineTo(doc.page.width - margin, 98).strokeColor('#cbd5e1').stroke();
}

export async function renderPdf(report, reference = '') {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, info: { Title: report.label, Author: BRAND.organization } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawBrand(doc);
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#172638').text(reference ? `${report.label}: ${reference}` : report.label, 40, y);
  y += 22;
  if (report.from || report.to) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
      .text(`Filtered by ${report.dateField}: ${report.from || 'beginning'} to ${report.to || 'today'}`, 40, y);
    y += 18;
  }
  doc.font('Helvetica').fontSize(9).fillColor('#64748b')
    .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`, 40, y);
  y += 24;

  const columns = Object.keys(report.rows[0] || { Generated: '' });
  const usableWidth = doc.page.width - 80;
  const rawWidths = columns.map((column) => {
    const samples = report.rows.slice(0, 20).map((row) => displayValue(row[column]).length);
    return Math.min(190, Math.max(70, column.length * 8, ...samples.map((length) => length * 5)));
  });
  const widthScale = usableWidth / rawWidths.reduce((sum, width) => sum + width, 0);
  const widths = rawWidths.map((width) => width * widthScale);
  const rowHeight = 24;

  function drawHeader() {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
    let x = 40;
    for (const [index, column] of columns.entries()) {
      doc.text(String(column).toUpperCase(), x + 5, y + 7, { width: widths[index] - 10, height: 12, ellipsis: true });
      x += widths[index];
    }
    y += rowHeight;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#cbd5e1').stroke();
  }

  drawHeader();
  doc.font('Helvetica').fontSize(8).fillColor('#172638');
  report.rows.forEach((row, rowIndex) => {
    if (y + rowHeight > doc.page.height - 52) {
      doc.addPage({ layout: 'landscape' });
      y = 46;
      drawBrand(doc);
      y = 116;
      drawHeader();
      doc.font('Helvetica').fontSize(8).fillColor('#172638');
    }
    let x = 40;
    for (const [index, column] of columns.entries()) {
      doc.text(displayValue(row[column]), x + 5, y + 7, { width: widths[index] - 10, height: 12, ellipsis: true, lineBreak: false });
      x += widths[index];
    }
    y += rowHeight;
    if (rowIndex % 2 === 1) {
      doc.rect(40, y - rowHeight, usableWidth, rowHeight).fillOpacity(0.04).fill('#3656a5').fillOpacity(1);
    }
  });

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Page ${index + 1} of ${pages.count}`, 40, doc.page.height - 32, { width: doc.page.width - 80, align: 'right' });
  }
  doc.end();
  return done;
}

export async function renderXlsx(report, reference = '') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.organization;
  workbook.title = report.label;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(report.label.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 6 }]
  });

  const logo = logoPath();
  if (logo) {
    try {
      const imageId = workbook.addImage({ filename: logo, extension: 'png' });
      sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 68, height: 68 } });
    } catch { /* Branding image is optional if the source asset is unavailable. */ }
  }
  sheet.getCell('B2').value = BRAND.organization;
  sheet.getCell('B2').font = { bold: true, size: 16, color: { argb: 'FF172638' } };
  sheet.getCell('B3').value = BRAND.title;
  sheet.getCell('B3').font = { bold: true, size: 11, color: { argb: 'FF3656A5' } };
  sheet.getCell('B4').value = BRAND.caption;
  sheet.getCell('B4').font = { size: 9, color: { argb: 'FF64748B' } };
  sheet.getCell('B5').value = reference ? `${report.label}: ${reference}` : report.label;
  sheet.getCell('B5').font = { bold: true, size: 11 };
  sheet.getCell('B6').value = report.from || report.to
    ? `Filtered by ${report.dateField}: ${report.from || 'beginning'} to ${report.to || 'today'}`
    : `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  sheet.getCell('B6').font = { size: 9, color: { argb: 'FF64748B' } };

  const columns = report.rows.length ? Object.keys(report.rows[0]) : ['No records found'];
  const headerRow = sheet.getRow(8);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3656A5' } };
    cell.alignment = { vertical: 'middle' };
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(14, column.length + 4));
  });
  headerRow.height = 22;

  report.rows.forEach((row) => {
    const values = columns.map((column) => {
      const value = row[column];
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && /cost|total|amount|rating|balance|quantity|level/i.test(column)) {
        return Number(value);
      }
      return displayValue(value);
    });
    const sheetRow = sheet.addRow(values);
    sheetRow.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      if (/cost|total|amount|rating/i.test(String(columns[cell.col - 1])) && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
      }
    });
  });
  sheet.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: columns.length } };
  sheet.headerFooter.oddFooter = '&CPage &P of &N';
  return workbook.xlsx.writeBuffer();
}

export function renderCsv(report) {
  const columns = report.rows.length ? Object.keys(report.rows[0]) : ['No records found'];
  const escape = (value) => `"${displayValue(value).replace(/"/g, '""')}"`;
  const lines = [
    `"${BRAND.organization}"`,
    `"${BRAND.title}"`,
    `"${report.label}"`,
    columns.map(escape).join(','),
    ...report.rows.map((row) => columns.map((column) => escape(row[column])).join(','))
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

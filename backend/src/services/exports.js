import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import pool from '../config/db.js';
import { dateFilterClause, parseDateFilter } from '../utils/dates.js';
import { amountInWords } from '../utils/money.js';
import { withPortalIdentity } from '../utils/roles.js';
import { getSettings } from './settings.js';
import {
  RECEIVED_STATUS_GROUPS, REQUISITION_STATUS
} from '../utils/requisition-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [
  process.env.BRAND_LOGO_PATH,
  path.resolve(__dirname, '../../public/procurement-logo.png'),
  path.resolve(__dirname, '../../../frontend/public/procurement-logo.png'),
  path.resolve(__dirname, '../../../../frontend/public/procurement-logo.png')
].filter(Boolean);

const BRAND = {
  organization: 'Hope Haven',
  title: 'Procurement Management System',
  caption: 'PROCUREMENT & STORES'
};
const THEME = {
  brand: '#FFFFFF',
  surface: '#FFFFFF',
  ink: '#000000',
  border: '#000000',
  green: '#7CB342',
  // Palette sampled from the supplied design image: light page, white card,
  // deep teal masthead, navy/slate type and soft blue-grey table panels.
  page: '#F4F7F6',
  card: '#FFFFFF',
  teal: '#123D3A',
  navy: '#172A39',
  muted: '#475569',
  rule: '#CFD0D1',
  stripe: '#F8FAFC',
  stripeStrong: '#F1F5F9'
};
const XLSX_INK = 'FF000000';
const XLSX_HEADER_FILL = 'FFF2F2F2';
const XLSX_BORDER = 'FFD9D9D9';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rolesFor = (definition) => (Array.isArray(definition.role) ? definition.role : [definition.role]);

const EXPORT_DEFINITIONS = {
  requisitions: {
    label: 'Purchase Requisitions',
    role: ['admin', 'approver'],
    scope: 'approver-pending',
    dateFields: { created: 'r.created_at', submitted: 'r.submitted_at', approved: 'r.supervisor_decision_at', forwarded: 'r.forwarded_at', required: 'r.required_by' },
    defaultField: 'submitted',
    textFilters: [
      {
        key: 'search',
        clause: `(r.reference LIKE ? OR r.title LIKE ? OR u.name LIKE ? OR COALESCE(d.name, '') LIKE ?
          OR COALESCE(su.name, '') LIKE ? OR COALESCE(r.supervisor_decision, '') LIKE ? OR r.status LIKE ?)`
      },
      { key: 'status', clause: 'r.status = ?', exact: true }
    ],
    sortable: {
      reference: 'r.reference', requester: 'u.name', department: 'COALESCE(d.name, \'\')',
      status: 'r.status', submitted: 'COALESCE(r.submitted_at, r.created_at)'
    },
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
      LEFT JOIN users su ON su.id = r.supervisor_id
      LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE 1 = 1 {{dateFilter}}
      GROUP BY r.id ORDER BY COALESCE(r.submitted_at, r.created_at) DESC`
  },
  receivedRequests: {
    label: 'Requests Received from Departments',
    role: 'procurement',
    dateFields: {
      forwarded: 'r.forwarded_at', submitted: 'r.submitted_at', created: 'r.created_at',
      approved: 'r.supervisor_decision_at', required: 'r.required_by'
    },
    defaultField: 'forwarded',
    groupFilters: { statusGroup: RECEIVED_STATUS_GROUPS },
    sortable: {
      reference: 'r.reference', requester: 'u.name', department: 'COALESCE(d.name, \'\')',
      submitted: 'COALESCE(r.submitted_at, r.created_at)',
      submittedAt: 'COALESCE(r.submitted_at, r.created_at)',
      forwarded: 'r.forwarded_at', status: 'r.status'
    },
    textFilters: [
      { key: 'reference', clause: 'r.reference LIKE ?' },
      { key: 'requester', clause: 'u.name LIKE ?' },
      { key: 'departmentQuery', clause: "COALESCE(d.name, '') LIKE ?" },
      { key: 'department', clause: 'd.name = ?', exact: true },
      { key: 'status', clause: 'r.status = ?', exact: true },
      {
        key: 'search',
        clause: "(r.reference LIKE ? OR r.title LIKE ? OR u.name LIKE ? OR COALESCE(d.name, '') LIKE ? OR r.justification LIKE ?)"
      }
    ],
    sql: `
      SELECT r.reference AS Reference, r.title AS Title,
        COALESCE(d.name, '—') AS Department, u.name AS Requester,
        su.name AS 'Approved by', fwd.name AS 'Forwarded by',
        r.status AS Status, COALESCE(r.submitted_at, '—') AS 'Submitted at',
        r.forwarded_at AS 'Forwarded at',
        (SELECT COUNT(*) FROM requisition_items ri WHERE ri.requisition_id = r.id) AS 'Number of items',
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
    sortable: { reference: 'f.reference', issued: 'COALESCE(f.issued_at, f.created_at)', due: 'f.due_date', status: 'f.status' },
    textFilters: [
      { key: 'reference', clause: 'f.reference LIKE ?' },
      { key: 'requisition', clause: '(r.reference LIKE ? OR r.title LIKE ?)' },
      {
        key: 'supplier',
        clause: `EXISTS (SELECT 1 FROM rfq_suppliers fsi JOIN suppliers si ON si.id = fsi.supplier_id
          WHERE fsi.rfq_id = f.id AND (si.name LIKE ? OR si.email LIKE ?))`
      },
      { key: 'status', clause: 'f.status = ?', exact: true }
    ],
    customFilters: {
      hasResponses: {
        yes: '(SELECT COUNT(*) FROM quotations qc WHERE qc.rfq_id = f.id) > 0',
        no: '(SELECT COUNT(*) FROM quotations qc WHERE qc.rfq_id = f.id) = 0'
      }
    },
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
    groupFilters: {
      statusGroup: {
        'Pending approval': ['Pending approval'],
        Approved: ['Approved', 'Partially received', 'Received']
      }
    },
    textFilters: [
      { key: 'requisitionId', clause: 'f.requisition_id = ?', exact: true },
      { key: 'rfqId', clause: 'p.rfq_id = ?', exact: true }
    ],
    sortable: {
      reference: 'p.reference', supplier: 's.name', status: 'p.status',
      created: 'p.created_at', approved: 'p.approved_at'
    },
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
    role: ['finance', 'procurement'],
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
    role: ['storekeeper', 'procurement'],
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
    role: ['storekeeper', 'procurement'],
    dateFields: { updated: 'i.updated_at' },
    defaultField: 'updated',
    textFilters: [
      { key: 'search', clause: '(i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ?)' }
    ],
    customFilters: {
      lowStock: { true: 'i.quantity <= i.reorder_level', 1: 'i.quantity <= i.reorder_level' }
    },
    sortable: {
      item: 'i.name', sku: 'i.sku', category: 'i.category',
      quantity: 'i.quantity', status: 'i.quantity', updated: 'i.updated_at'
    },
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
    role: ['storekeeper', 'procurement'],
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
    textFilters: [
      {
        key: 'search',
        clause: '(s.name LIKE ? OR COALESCE(s.contact_name, \'\') LIKE ? OR COALESCE(s.email, \'\') LIKE ? OR COALESCE(s.phone, \'\') LIKE ?)'
      }
    ],
    sortable: { supplier: 's.name', contact: 's.contact_name', status: 's.status', created: 's.created_at' },
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
    textFilters: [
      {
        key: 'search',
        clause: `(u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ? OR COALESCE(d.name, '') LIKE ? OR COALESCE(u.phone, '') LIKE ?)`
      },
      { key: 'role', clause: 'u.role = ?', exact: true },
      { key: 'status', clause: "LOWER(IF(u.active, 'Active', 'Inactive')) = LOWER(?)", exact: true },
      { key: 'departmentId', clause: 'u.department_id = ?', exact: true }
    ],
    sortable: {
      name: 'u.name', role: 'u.role', department: 'COALESCE(d.name, \'\')',
      status: 'u.active', created: 'u.created_at'
    },
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
        COALESCE(a.new_status, '—') AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY a.created_at DESC, a.id DESC`
  },
  committeeMembers: {
    label: 'Procurement Committee Members',
    role: ['admin', 'procurement'],
    dateFields: { created: 'cm.created_at' },
    defaultField: 'created',
    textFilters: [
      { key: 'search', clause: '(cm.first_name LIKE ? OR cm.last_name LIKE ? OR cm.email LIKE ? OR cm.phone LIKE ?)' }
    ],
    sortable: { name: 'cm.last_name, cm.first_name', email: 'cm.email', created: 'cm.created_at' },
    sql: `
      SELECT CONCAT(cm.first_name, ' ', cm.last_name) AS Name, cm.email AS Email,
        COALESCE(cm.phone, '—') AS Phone, cm.created_at AS 'Created at'
      FROM procurement_committee_members cm
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY cm.last_name, cm.first_name`
  },
  supervisorRequesters: {
    label: 'Department Requesters',
    role: 'supervisor',
    dateFields: { created: 'u.created_at' },
    defaultField: 'created',
    scope: 'supervisor-user',
    textFilters: [
      { key: 'search', clause: '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)' },
      { key: 'name', clause: 'u.name LIKE ?' },
      { key: 'email', clause: 'u.email LIKE ?' },
      { key: 'status', clause: "LOWER(IF(u.active, 'Active', 'Inactive')) = LOWER(?)", exact: true }
    ],
    sortable: { name: 'u.name', email: 'u.email', status: 'u.active' },
    sql: `
      SELECT u.name AS Requester, u.email AS Email, COALESCE(u.phone, '—') AS Phone,
        IF(u.active, 'Active', 'Inactive') AS Status,
        (SELECT COUNT(*) FROM requisitions r WHERE r.requester_id = u.id) AS Requests,
        u.created_at AS 'Created at'
      FROM users u
      WHERE u.role = 'requestor' AND u.active = TRUE {{dateFilter}}
      ORDER BY u.name`
  },
  supervisorStock: {
    label: 'Department Stock Overview',
    role: 'supervisor',
    dateFields: { updated: 'i.updated_at' },
    defaultField: 'updated',
    scope: 'supervisor-stock',
    textFilters: [
      { key: 'search', clause: '(i.sku LIKE ? OR i.name LIKE ? OR i.category LIKE ?)' },
      { key: 'category', clause: 'i.category = ?', exact: true },
      {
        key: 'status',
        clause: `(CASE WHEN i.quantity = 0 THEN 'Out of Stock'
          WHEN i.quantity <= i.reorder_level THEN 'Low Stock' ELSE 'Available' END) = ?`,
        exact: true
      }
    ],
    sortable: { item: 'i.name', category: 'i.category', quantity: 'i.quantity', status: 'i.quantity' },
    sql: `
      SELECT i.sku AS SKU, i.name AS Item, i.category AS Category, i.unit AS Unit,
        i.quantity AS 'Quantity on hand', i.reorder_level AS 'Reorder level',
        i.unit_cost AS 'Unit cost',
        (CASE WHEN i.quantity = 0 THEN 'Out of Stock'
          WHEN i.quantity <= i.reorder_level THEN 'Low Stock' ELSE 'Available' END) AS Status,
        i.updated_at AS 'Updated at'
      FROM items i
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY i.category, i.name`
  },
  stockkeeperRequesters: {
    label: 'Requesters',
    role: 'storekeeper',
    dateFields: { created: 'u.created_at' },
    defaultField: 'created',
    textFilters: [
      { key: 'search', clause: '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR d.name LIKE ?)' },
      { key: 'name', clause: 'u.name LIKE ?' },
      { key: 'email', clause: 'u.email LIKE ?' },
      { key: 'department', clause: 'd.name LIKE ?' },
      { key: 'departmentId', clause: 'u.department_id = ?', exact: true },
      { key: 'status', clause: "LOWER(IF(u.active, 'Active', 'Inactive')) = LOWER(?)", exact: true }
    ],
    sortable: {
      name: 'u.name', department: 'COALESCE(d.name, \'\')', status: 'u.active',
      issues: 'COALESCE(issueSummary.stockIssues, 0)'
    },
    sql: `
      SELECT u.name AS Requester, u.email AS Email, COALESCE(u.phone, '—') AS Phone,
        COALESCE(d.name, '—') AS Department, IF(u.active, 'Active', 'Inactive') AS Status,
        COALESCE(issueSummary.stockIssues, 0) AS 'Stock issues', u.created_at AS 'Created at'
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN (
        SELECT requester_id, COUNT(*) AS stockIssues FROM inventory_movements
        WHERE movement_type = 'Issue' AND direction = 'Out' GROUP BY requester_id
      ) issueSummary ON issueSummary.requester_id = u.id
      WHERE u.role = 'requestor' {{dateFilter}}
      ORDER BY u.name`
  },
  stockkeeperItems: {
    label: 'Stock Register',
    role: 'storekeeper',
    dateFields: { updated: 'i.updated_at' },
    defaultField: 'updated',
    textFilters: [
      { key: 'search', clause: '(i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ? OR COALESCE(d.name, \'\') LIKE ?)' }
    ],
    sortable: {
      item: 'i.name', category: 'i.category', location: 'COALESCE(d.name, \'\')',
      balance: 'i.quantity', status: 'i.quantity'
    },
    sql: `
      SELECT i.sku AS SKU, i.name AS Item, i.category AS Category,
        COALESCE(d.name, 'General storage') AS Location, i.unit AS Unit,
        i.quantity AS 'Current balance', i.reorder_level AS 'Minimum level',
        i.unit_cost AS 'Unit cost', i.updated_at AS 'Updated at',
        CASE WHEN i.quantity = 0 THEN 'Out of stock'
          WHEN i.quantity <= i.reorder_level THEN 'Low stock' ELSE 'Available' END AS Status
      FROM items i LEFT JOIN departments d ON d.id = i.department_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY i.name`
  },
  stockkeeperTransactions: {
    label: 'Stock Transactions',
    role: 'storekeeper',
    dateFields: { movement: 'COALESCE(m.movement_at, m.created_at)', created: 'm.created_at' },
    defaultField: 'movement',
    textFilters: [
      { key: 'itemId', clause: 'm.item_id = ?', exact: true },
      { key: 'requesterId', clause: 'm.requester_id = ?', exact: true },
      { key: 'search', clause: '(i.name LIKE ? OR i.sku LIKE ? OR m.reference_no LIKE ? OR m.source LIKE ?)' }
    ],
    customFilters: {
      issueOut: { true: "m.movement_type = 'Issue' AND m.direction = 'Out'" }
    },
    sortable: { date: 'COALESCE(m.movement_at, m.created_at)', item: 'i.name', type: 'm.movement_type' },
    sql: `
      SELECT i.sku AS SKU, i.name AS Item,
        COALESCE(m.movement_at, m.created_at) AS 'Transaction date',
        COALESCE(m.reference_no, m.source, '—') AS Reference,
        COALESCE(m.description, m.source, '—') AS Description,
        m.movement_type AS Type, m.quantity AS Quantity,
        m.balance_after AS Balance, COALESCE(u.name, '—') AS 'Updated by'
      FROM inventory_movements m
      JOIN items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE 1 = 1 {{dateFilter}}
      ORDER BY COALESCE(m.movement_at, m.created_at) DESC, m.id DESC`
  },
  stockkeeperBinCard: {
    label: 'Bin Card',
    role: 'storekeeper',
    dateFields: { movement: 'COALESCE(m.movement_at, m.created_at)', created: 'm.created_at' },
    defaultField: 'movement',
    scope: 'bin-card-item',
    sql: `
      SELECT \`Item code\`, Item, Unit, Reference, Description,
        \`Transaction date\`, \`Stock in\`, \`Stock out\`, Balance, \`Updated by\`
      FROM (
        SELECT * FROM (
          SELECT i.sku AS 'Item code', i.name AS Item, i.unit AS Unit,
            'Opening balance' AS Reference, 'Opening balance' AS Description,
            '' AS 'Transaction date', '' AS 'Stock in', '' AS 'Stock out',
            (i.quantity - COALESCE(totals.netMovement, 0)) AS Balance,
            '' AS 'Updated by', 0 AS sortOrder
          FROM items i
          LEFT JOIN (
            SELECT item_id, SUM(CASE WHEN direction = 'In' THEN quantity ELSE -quantity END) AS netMovement
            FROM inventory_movements GROUP BY item_id
          ) totals ON totals.item_id = i.id
          WHERE i.id = ?
          UNION ALL
          SELECT i.sku, i.name, i.unit,
            COALESCE(m.reference_no, m.source, '—'),
            COALESCE(m.description, m.source, m.movement_type, '—'),
            COALESCE(m.movement_at, m.created_at),
            CASE WHEN m.direction = 'In' THEN m.quantity ELSE '' END,
            CASE WHEN m.direction = 'Out' THEN m.quantity ELSE '' END,
            m.balance_after, COALESCE(u.name, '—'), 1
          FROM inventory_movements m
          JOIN items i ON i.id = m.item_id
          LEFT JOIN users u ON u.id = m.user_id
          WHERE 1 = 1 {{dateFilter}} {{scopeFilter}}
        ) ledger
        ORDER BY sortOrder, \`Transaction date\`, Reference
      ) ordered`
  }
};

const RECORD_QUERIES = {
  requisition: {
    roles: ['admin', 'procurement', 'supervisor', 'requestor'],
    label: 'Purchase Requisition',
    sql: `
      SELECT r.id, r.requester_id AS requesterId, r.reference, r.title, r.location,
        r.justification, r.budget_code AS budgetCode,
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
        COALESCE(ri.remarks, '') AS Remarks,
        ri.quantity AS Quantity, ri.unit AS Unit,
        ri.estimated_unit_cost AS 'Unit cost',
        ri.quantity * ri.estimated_unit_cost AS 'Line total'
      FROM requisition_items ri WHERE ri.requisition_id = ? ORDER BY ri.id`,
    activitySql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status'
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
        a.new_status AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'store_request' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  rfq: {
    roles: ['admin', 'procurement', 'committee'],
    label: 'Request for Quotation',
    sql: `
      SELECT f.id, f.reference, f.status, f.due_date AS dueDate,
        f.instructions, f.terms,
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
        a.new_status AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'rfq' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  rfqQuotation: {
    roles: ['admin', 'procurement', 'committee'],
    label: 'RFQ Quotation',
    sql: `
      SELECT q.id, CONCAT(s.name, ' · ', f.reference) AS reference,
        s.name AS supplier, f.reference AS rfq, r.reference AS requisition,
        q.amount, q.delivery_days AS deliveryDays,
        q.quality_score AS qualityScore, q.rating_score AS ratingScore,
        q.notes, q.submitted_at AS submittedAt
      FROM quotations q
      JOIN suppliers s ON s.id = q.supplier_id
      JOIN rfqs f ON f.id = q.rfq_id
      JOIN requisitions r ON r.id = f.requisition_id
      WHERE q.id = ?`
  },
  purchaseOrder: {
    roles: ['admin', 'procurement', 'approver'],
    label: 'Purchase Order',
    sql: `
      SELECT p.id, p.reference, p.type, p.total, p.status, p.delivery_date AS deliveryDate,
        p.supplier_contact AS supplierContact, p.supplier_address AS supplierAddress,
        p.subtotal, p.vat_rate AS vatRate, p.vat_amount AS vatAmount,
        p.amount_in_words AS amountInWords,
        p.prepared_signature AS preparedSignature, p.approved_signature AS approvedSignature,
        p.approved_at AS approvedAt, p.created_at AS createdAt,
        s.name AS supplier, s.contact_name AS contactName, s.phone AS supplierPhone,
        s.email AS supplierEmail, s.address AS registeredAddress,
        r.reference AS requisition, r.id AS requisitionId, f.reference AS rfq, f.id AS rfqId,
        creator.name AS preparedBy, creator.name AS createdBy, reviewer.name AS approvedBy
      FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      JOIN rfqs f ON f.id = p.rfq_id JOIN requisitions r ON r.id = f.requisition_id
      JOIN users creator ON creator.id = p.created_by
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      WHERE p.id = ?`,
    itemsSql: `
      SELECT poi.item_name AS Item, COALESCE(poi.description, '') AS Description,
        poi.quantity AS Quantity, poi.unit AS Unit,
        poi.unit_price AS 'Unit price', poi.line_total AS 'Line total'
      FROM purchase_order_items poi WHERE poi.purchase_order_id = ? ORDER BY poi.id`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'purchase_order' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  supplierPricingResponse: {
    roles: ['admin', 'procurement', 'approver', 'committee', 'finance'],
    label: 'Supplier Pricing Response',
    sql: `
      SELECT res.id, CONCAT(res.supplier_name, ' · ', po.reference) AS reference,
        res.status, res.supplier_name AS supplier, res.supplier_email AS supplierEmail,
        res.subtotal, res.vat_rate AS vatRate, res.vat_amount AS vatAmount,
        res.other_charges AS otherCharges, res.total,
        res.quotation_validity AS validity, res.delivery_lead_time AS leadTime,
        res.comments, res.technical_remarks AS technicalRemarks,
        res.submitted_at AS submittedAt, res.awarded,
        req.reference AS pricingRequest, req.po_reference AS purchaseOrder,
        s.name AS registeredSupplierName, s.email AS registeredSupplierEmail
      FROM purchase_order_pricing_responses res
      JOIN purchase_order_pricing_requests req ON req.id = res.request_id
      JOIN purchase_orders po ON po.id = res.purchase_order_id
      JOIN suppliers s ON s.id = res.supplier_id
      WHERE res.id = ?`,
    itemsSql: `
      SELECT pri.item_no AS 'Item no', COALESCE(pri.description, pri.item_name) AS Description,
        pri.quantity AS Quantity, pri.unit AS Unit,
        pri.unit_price AS 'Unit price', pri.line_total AS 'Line total'
      FROM purchase_order_pricing_response_items pri
      WHERE pri.response_id = ? ORDER BY pri.item_no, pri.id`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'supplier_pricing_response' AND a.entity_id = ? ORDER BY a.created_at, a.id`
  },
  supplierQuoteComparison: {
    roles: ['admin', 'procurement', 'approver', 'committee', 'finance'],
    label: 'Supplier Quotation Comparison',
    sql: `
      SELECT req.id AS requestId, req.reference, po.reference AS purchaseOrder,
        f.reference AS rfq, r.reference AS requisition,
        req.submission_deadline AS deadline, req.currency, req.status,
        req.awarded_at AS awardedAt, req.award_comment AS awardComment
      FROM purchase_order_pricing_requests req
      LEFT JOIN purchase_orders po ON po.id = req.purchase_order_id
      LEFT JOIN rfqs f ON f.id = req.rfq_id
      LEFT JOIN requisitions r ON r.id = req.requisition_id
      WHERE req.id = ?`,
    itemsSql: `
      SELECT res.supplier_name AS Supplier, res.supplier_email AS 'Supplier email',
        pri.item_no AS 'Item no', COALESCE(pri.description, pri.item_name) AS Description,
        pri.quantity AS Quantity, pri.unit AS Unit,
        pri.unit_price AS 'Unit price', pri.line_total AS 'Line total',
        res.total AS 'Quoted total', res.delivery_lead_time AS 'Delivery lead time',
        res.quotation_validity AS Validity, res.comments AS Remarks
      FROM purchase_order_pricing_responses res
      JOIN purchase_order_pricing_response_items pri ON pri.response_id = res.id
      WHERE res.request_id = ? AND res.status = 'Submitted'
      ORDER BY res.id, pri.item_no, pri.id`,
    auditSql: `
      SELECT a.action AS Action, COALESCE(u.name, 'System') AS Actor,
        a.created_at AS 'Timestamp', a.previous_status AS 'Previous status',
        a.new_status AS 'New status'
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'purchase_order_pricing_request' AND a.entity_id = ? ORDER BY a.created_at, a.id`
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
        a.new_status AS 'New status'
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
        a.new_status AS 'New status'
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
    purpose: 'Purpose', source: 'Source', awardedSupplier: 'Awarded supplier',
    location: 'Location', remarks: 'Remarks', type: 'Type',
    supplierContact: 'Supplier contact', supplierAddress: 'Supplier address',
    registeredAddress: 'Registered address', subtotal: 'Subtotal',
    vatRate: 'VAT rate', vatAmount: 'VAT amount', amountInWords: 'Amount in words',
    preparedBy: 'Prepared by', requisitionId: 'Requisition ID', rfqId: 'RFQ ID',
    requestId: 'Pricing request ID', pricingRequest: 'Pricing request',
    purchaseOrderReference: 'Purchase order reference', registeredSupplierName: 'Registered supplier name',
    registeredSupplierEmail: 'Registered supplier email', validity: 'Quotation validity',
    leadTime: 'Delivery lead time', technicalRemarks: 'Technical remarks',
    submittedAt: 'Submitted', awarded: 'Awarded', deadline: 'Submission deadline',
    currency: 'Currency', awardComment: 'Award comment'
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
    type,
    label: definition.label,
    reference: row.reference || String(id),
    row,
    meta: recordMeta(row, definition),
    items,
    activity,
    notes: row.supervisorNotes || row.justification || row.purpose || ''
  };
}

function paintDocumentPage(doc) {
  const inset = 24;
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(THEME.page).restore();
  doc.save()
    .rect(inset, inset, doc.page.width - inset * 2, doc.page.height - inset * 2)
    .fill(THEME.card)
    .restore();
  return inset;
}

function recordFooter(doc) {
  const pages = doc.bufferedPageRange();
  const generated = `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 12;
    doc.font('Helvetica').fontSize(8).fillColor(THEME.muted)
      .text(generated, 40, footerY, { width: 260, lineBreak: false });
    doc.text(`Page ${index - pages.start + 1} of ${pages.count}`, 40, footerY, {
      width: doc.page.width - 80, align: 'right', lineBreak: false
    });
  }
}

function documentValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text === '—' ? '' : text;
}

function documentDate(value) {
  const text = documentValue(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : text;
}

function moneyText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function officialHeader(doc, record, title) {
  const inset = paintDocumentPage(doc);
  const margin = 40;
  const bandHeight = 70;
  doc.save()
    .rect(inset, inset, doc.page.width - inset * 2, bandHeight)
    .fill(THEME.teal)
    .restore();

  const logo = logoPath();
  if (logo) {
    try {
      doc.image(logo, margin, 32, { width: 48, height: 48, fit: [48, 48], contain: true });
    } catch { /* Branding is optional if the asset cannot be read. */ }
  }
  const textX = logo ? margin + 58 : margin;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(THEME.card)
    .text(BRAND.organization, textX, 39, { width: 260, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(8).fillColor('#D8DFDF')
    .text(BRAND.caption, textX, 61, { width: 260, lineBreak: false, ellipsis: true });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(THEME.navy)
    .text(title, margin, 106, { width: doc.page.width - 80, align: 'center', lineBreak: false });
  const meta = [
    `Reference: ${documentValue(record.reference)}`,
    `Status: ${documentValue(record.row.status)}`,
    `Date: ${documentDate(record.row.submittedAt || record.row.createdAt)}`
  ].filter((part) => !part.endsWith(': '));
  doc.font('Helvetica').fontSize(8).fillColor(THEME.muted)
    .text(meta.join('  |  '), margin, 132, {
      width: doc.page.width - 80, align: 'center', lineBreak: false, ellipsis: true
    });
  doc.moveTo(margin, 150).lineTo(doc.page.width - margin, 150).strokeColor(THEME.rule).stroke();
  return 166;
}

function officialPageStart(record, title) {
  return (doc) => officialHeader(doc, record, title);
}

function ensureSpace(doc, y, height, pageStart) {
  if (y + height <= doc.page.height - 56) return y;
  doc.addPage();
  return pageStart(doc);
}

function drawOfficialField(doc, label, value, x, y, width) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text(label, x, y, { width, lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(THEME.navy)
    .text(documentValue(value), x, y + 14, { width, lineBreak: false, ellipsis: true });
}

async function signatureBuffer(value) {
  if (typeof value !== 'string') return null;
  const dataUrl = value.trim().match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
  const base64 = dataUrl ? dataUrl[2] : value.trim();
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return null;
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch { return null; }
  if (!buffer.length) return null;
  const mime = dataUrl ? dataUrl[1].toLowerCase() : '';
  if (mime === 'image/png' || mime === 'image/jpeg') return buffer;
  // Browser signature pads commonly arrive as WebP, which PDFKit cannot embed.
  // Normalising unsupported formats to PNG keeps the uploaded image visible.
  try {
    return await sharp(buffer).png().toBuffer();
  } catch { return null; }
}

async function drawSignatureField(doc, label, value, signature, x, y, width) {
  const panelHeight = 92;
  doc.save().rect(x - 8, y - 8, width, panelHeight).fill(THEME.stripe).restore();
  doc.save().rect(x - 8, y - 8, 3, panelHeight).fill(THEME.teal).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text(label, x, y, { width: width - 16, lineBreak: false });
  const image = await signatureBuffer(signature);
  if (image) {
    try {
      doc.image(image, x, y + 14, { fit: [width - 24, 52], align: 'left', valign: 'bottom' });
    } catch { /* a corrupt cached signature must not block the document */ }
  }
  doc.moveTo(x, y + 70).lineTo(x + width - 16, y + 70).strokeColor(THEME.rule).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(THEME.navy)
    .text(documentValue(value), x, y + 74, { width: width - 16, lineBreak: false, ellipsis: true });
}

function drawOfficialTable(doc, { columns, rows, y, emptyRows = 0, pageStart, rowHeight = 22 }) {
  const margin = 40;
  const width = doc.page.width - 80;
  const weightTotal = columns.reduce((sum, column) => sum + column.weight, 0);
  const widths = columns.map((column) => width * column.weight / weightTotal);
  let currentY = y;

  function drawHeader() {
    doc.save().rect(margin, currentY, width, 22).fill(THEME.stripeStrong).restore();
    let x = margin;
    columns.forEach((column, index) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(THEME.navy)
        .text(column.label, x + 5, currentY + 7, {
          width: widths[index] - 10, align: column.align || 'left', lineBreak: false, ellipsis: true
        });
      x += widths[index];
    });
    currentY += 22;
  }

  function drawRow(values, shaded) {
    if (shaded) doc.save().rect(margin, currentY, width, rowHeight).fill(THEME.stripe).restore();
    let x = margin;
    columns.forEach((column, index) => {
      doc.font('Helvetica').fontSize(8).fillColor(THEME.navy)
        .text(documentValue(values[column.key]), x + 5, currentY + 6, {
          width: widths[index] - 10, align: column.align || 'left', lineBreak: false, ellipsis: true
        });
      x += widths[index];
    });
    doc.moveTo(margin, currentY + rowHeight).lineTo(margin + width, currentY + rowHeight)
      .strokeColor(THEME.rule).stroke();
    currentY += rowHeight;
  }

  drawHeader();
  [...rows, ...Array.from({ length: emptyRows }, () => ({}))].forEach((values, index) => {
    if (currentY + rowHeight > doc.page.height - 56) {
      doc.addPage();
      currentY = pageStart(doc);
      drawHeader();
    }
    drawRow(values, index % 2 === 1);
  });
  return currentY + 12;
}

function drawRequisitionDocument(doc, record) {
  const row = record.row;
  const pageStart = officialPageStart(record, 'MATERIAL REQUEST FORM');
  let y = pageStart(doc);
  const columnWidth = (doc.page.width - 100) / 2;
  const secondColumnX = 40 + columnWidth + 20;

  drawOfficialField(doc, 'Requesting Department:', row.department || row.supervisorDepartment, 40, y, columnWidth);
  drawOfficialField(doc, 'Location where the items are needed:', row.location, secondColumnX, y, columnWidth);
  y += 40;

  const itemRows = record.items.map((item, index) => ({
    number: String(index + 1),
    description: [documentValue(item.Item), documentValue(item.Description)].filter(Boolean).join(' - '),
    quantity: documentValue(item.Quantity),
    unit: documentValue(item.Unit),
    remarks: documentValue(item.Remarks)
  }));
  y = drawOfficialTable(doc, {
    columns: [
      { key: 'number', label: 'Item #', weight: 0.6, align: 'center' },
      { key: 'description', label: 'Item Description', weight: 2.4 },
      { key: 'quantity', label: 'Quantity', weight: 0.8, align: 'center' },
      { key: 'unit', label: 'Unity of Measures', weight: 1.1 },
      { key: 'remarks', label: 'Remarks', weight: 1.4 }
    ],
    rows: itemRows,
    emptyRows: Math.max(0, 11 - itemRows.length),
    y,
    pageStart
  });

  y = ensureSpace(doc, y, 90, pageStart);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.ink)
    .text('Purposes the goods are requested for:', 40, y, { width: doc.page.width - 80, lineBreak: false });
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
    .text(documentValue(row.justification), 40, y, { width: doc.page.width - 80 });
  y = Math.max(doc.y + 10, y + 24);

  y = ensureSpace(doc, y, 80, pageStart);
  const approved = row.supervisorDecision === 'Approved' && Boolean(row.supervisorDecisionAt);
  const signatureColumns = [
    ['Name(Requested by):', documentValue(row.requester)],
    ['Signature:', documentValue(row.requester)],
    ['Date:', documentDate(row.submittedAt || row.createdAt)]
  ];
  const approvalColumns = [
    ['Name(Approved by):', approved ? documentValue(row.supervisorName) : ''],
    ['Signature:', approved ? documentValue(row.supervisorName) : ''],
    ['Date:', approved ? documentDate(row.supervisorDecisionAt) : '']
  ];
  const signatureWidth = (doc.page.width - 100) / 3;
  for (const [index, [label, value]] of signatureColumns.entries()) {
    drawOfficialField(doc, label, value, 40 + index * (signatureWidth + 8), y, signatureWidth);
  }
  y += 42;
  for (const [index, [label, value]] of approvalColumns.entries()) {
    drawOfficialField(doc, label, value, 40 + index * (signatureWidth + 8), y, signatureWidth);
  }
}

async function drawPurchaseOrderDocument(doc, record) {
  const row = record.row;
  const pageStart = officialPageStart(record, 'PURCHASE ORDER');
  let y = pageStart(doc);
  const columnWidth = (doc.page.width - 100) / 2;
  const secondColumnX = 40 + columnWidth + 20;
  const contact = documentValue(row.supplierContact)
    || [row.contactName, row.supplierPhone, row.supplierEmail].map(documentValue).filter(Boolean).join(' / ');
  const address = documentValue(row.supplierAddress) || documentValue(row.registeredAddress);

  drawOfficialField(doc, 'Supplier:', row.supplier, 40, y, columnWidth);
  drawOfficialField(doc, 'P.O No:', row.reference, secondColumnX, y, columnWidth);
  y += 38;
  drawOfficialField(doc, 'Supplier Contact:', contact, 40, y, columnWidth);
  drawOfficialField(doc, 'Type:', row.type || 'Standard', secondColumnX, y, columnWidth);
  y += 38;
  drawOfficialField(doc, 'Address:', address, 40, y, columnWidth);
  drawOfficialField(doc, 'Date:', documentDate(row.createdAt), secondColumnX, y, columnWidth);
  y += 38;
  drawOfficialField(doc, 'Date of Delivery:', documentDate(row.deliveryDate), 40, y, columnWidth);
  drawOfficialField(doc, 'Payment Modalities:', '100%', secondColumnX, y, columnWidth);
  y += 34;
  doc.save().rect(40, y, doc.page.width - 80, 34).fill(THEME.stripe).restore();
  doc.save().rect(40, y, 3, 34).fill(THEME.teal).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text('Gentlemen:', 48, y + 5, { width: doc.page.width - 96, lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(THEME.navy)
    .text('Please furnish this office the following articles subject to the terms and conditions contained herein.', 48, y + 18, {
      width: doc.page.width - 96, lineBreak: false, ellipsis: true
    });
  y += 44;

  const itemRows = record.items.map((item, index) => ({
    number: String(index + 1),
    quantity: documentValue(item.Quantity),
    unit: documentValue(item.Unit) || 'unit',
    description: [documentValue(item.Item), documentValue(item.Description)].filter(Boolean).join(' - '),
    unitPrice: moneyText(item['Unit price']),
    lineTotal: moneyText(item['Line total'])
  }));
  y = drawOfficialTable(doc, {
    columns: [
      { key: 'number', label: 'Item No.', weight: 0.8, align: 'center' },
      { key: 'quantity', label: 'Quantity', weight: 0.7, align: 'center' },
      { key: 'unit', label: 'Unit', weight: 0.7, align: 'center' },
      { key: 'description', label: 'Description', weight: 2.0 },
      { key: 'unitPrice', label: 'Unit Price', weight: 1.1, align: 'right' },
      { key: 'lineTotal', label: 'Total Price', weight: 1.1, align: 'right' }
    ],
    rows: itemRows,
    emptyRows: 0,
    y,
    pageStart
  });

  y = ensureSpace(doc, y, 132, pageStart);
  const valueX = doc.page.width - 40 - 210;
  const totalValue = `${moneyText(row.total)} RWF`;
  doc.save().rect(valueX - 12, y - 8, 222, 48).fill(THEME.stripe).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text('VAT:', valueX, y, { width: 90, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(THEME.navy)
    .text(`${documentValue(row.vatRate) || '0'}% - ${moneyText(row.vatAmount)} RWF`, valueX + 96, y, {
      width: 114, align: 'right', lineBreak: false
    });
  y += 18;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text('Total Amount:', valueX, y, { width: 90, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(THEME.navy)
    .text(totalValue, valueX + 96, y, { width: 114, align: 'right', lineBreak: false });
  y += 30;

  doc.save().rect(40, y - 8, doc.page.width - 80, 46).fill(THEME.stripeStrong).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(THEME.navy)
    .text('Total Amount in Words: Rwandan Francs', 48, y, {
      width: doc.page.width - 96, lineBreak: false
    });
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(THEME.navy)
    .text(documentValue(row.amountInWords) || amountInWords(row.total), 48, y, {
      width: doc.page.width - 96, lineBreak: false, ellipsis: true
    });
  y += 17;
  doc.font('Helvetica').fontSize(8).fillColor(THEME.muted)
    .text('Currency: Rwandan Francs (RWF)', 48, y, { width: doc.page.width - 96, lineBreak: false });
  y += 26;

  y = ensureSpace(doc, y, 110, pageStart);
  const approved = Boolean(row.approvedAt && row.approvedBy);
  await drawSignatureField(doc, 'Prepared By:', row.preparedBy, row.preparedSignature, 40, y, columnWidth);
  await drawSignatureField(
    doc, 'Approved By:',
    approved ? `${row.approvedBy} - ${documentDate(row.approvedAt)}` : '',
    row.approvedSignature, secondColumnX, y, columnWidth
  );
}

async function drawGenericRecordDocument(doc, record) {
  drawBrand(doc);
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(THEME.ink).text(record.label, 40, y);
  y += 20;
  doc.font('Helvetica').fontSize(10).fillColor(THEME.ink).text(`Reference: ${record.reference}`, 40, y);
  y += 24;

  function ensure(height) {
    if (y + height > doc.page.height - 56) {
      doc.addPage();
      y = 48;
      drawBrand(doc);
      y = 116;
    }
  }

  doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.ink).text('Record details', 40, y);
  y += 16;
  const half = (doc.page.width - 100) / 2;
  for (let index = 0; index < record.meta.length; index += 2) {
    ensure(32);
    const rowY = y;
    for (const offset of [0, 1]) {
      const entry = record.meta[index + offset];
      if (!entry) continue;
      const x = 40 + offset * half;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(THEME.ink).text(entry.label.toUpperCase(), x, rowY);
      doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
        .text(entry.value, x, rowY + 11, { width: half - 12, lineBreak: false, ellipsis: true });
    }
    y += 32;
  }
  y += 12;

  if (record.notes) {
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.ink).text('Notes / justification', 40, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
      .text(record.notes, 40, y, { width: doc.page.width - 80 });
    y = doc.y + 14;
  }

  async function table(title, rows) {
    if (!rows.length) return;
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.ink).text(title, 40, y);
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
    doc.font('Helvetica-Bold').fontSize(8).fillColor(THEME.ink).rect(40, y, usable, 20).fill(THEME.brand);
    columns.forEach((column, index) => {
      doc.fillColor(THEME.ink).text(String(column).toUpperCase(), x + 4, y + 6, { width: scaled[index] - 8, ellipsis: true });
      x += scaled[index];
    });
    y += 20;
    doc.fillColor(THEME.ink).font('Helvetica').fontSize(8);
    rows.forEach((row, rowIndex) => {
      if (y + 20 > doc.page.height - 56) {
        doc.addPage(); y = 48; drawBrand(doc); y = 116;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(THEME.ink).text(title, 40, y);
        y += 18;
        doc.fillColor(THEME.ink).font('Helvetica').fontSize(8);
      }
      if (rowIndex % 2 === 1) doc.rect(40, y, usable, 20).fill(THEME.surface);
      x = 40;
      columns.forEach((column, index) => {
        doc.fillColor(THEME.ink).text(displayValue(row[column]), x + 4, y + 6, {
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
}

export async function renderRecordPdf(record) {
  const doc = new PDFDocument({
    size: 'A4', margin: 40, compress: false, bufferPages: true,
    info: { Title: `${record.label} ${record.reference}`, Author: BRAND.organization }
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (record.type === 'requisition') drawRequisitionDocument(doc, record);
  else if (record.type === 'purchaseOrder') await drawPurchaseOrderDocument(doc, record);
  else await drawGenericRecordDocument(doc, record);
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
    sheet.addRow(columns).font = { bold: true, color: { argb: XLSX_INK } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_HEADER_FILL } };
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
const PORTAL_SORTABLE = {
  reference: 'r.reference', title: 'r.title', requester: 'u.name',
  department: 'COALESCE(d.name, \'\')', status: 'r.status',
  submitted: 'COALESCE(r.submitted_at, r.created_at)', approved: 'r.supervisor_decision_at'
};

const APPROVED_EXPORT_STATUSES = [REQUISITION_STATUS.APPROVED, REQUISITION_STATUS.FORWARDED];
const EXPORT_STATUS_ALIASES = {
  draft: REQUISITION_STATUS.DRAFT,
  submitted: REQUISITION_STATUS.SUBMITTED,
  pending: REQUISITION_STATUS.PENDING,
  'pending approval': REQUISITION_STATUS.PENDING,
  information: REQUISITION_STATUS.INFORMATION,
  'information required': REQUISITION_STATUS.INFORMATION,
  approved: REQUISITION_STATUS.APPROVED,
  rejected: REQUISITION_STATUS.REJECTED,
  forwarded: REQUISITION_STATUS.FORWARDED,
  review: REQUISITION_STATUS.UNDER_REVIEW,
  'under procurement review': REQUISITION_STATUS.UNDER_REVIEW,
  completed: REQUISITION_STATUS.COMPLETED,
  cancelled: REQUISITION_STATUS.CANCELLED
};

function normalizeExportStatuses(value) {
  const raw = String(value || '').trim().slice(0, 200);
  if (!raw) return [];
  const values = raw.split(',').flatMap((part) => {
    const status = part.trim();
    if (!status) return [];
    const lower = status.toLowerCase();
    if (['approved group', 'approved-group', 'approved forwarded', 'approved or forwarded'].includes(lower)) {
      return APPROVED_EXPORT_STATUSES;
    }
    return [hasOwn(EXPORT_STATUS_ALIASES, lower) ? EXPORT_STATUS_ALIASES[lower] : status];
  });
  return [...new Set(values.filter(Boolean))];
}

async function reportFormatting() {
  try {
    const settings = await getSettings();
    return {
      currency: settings.default_currency || 'USD',
      currencySymbol: settings.currency_symbol || '',
      precision: Number.isInteger(Number(settings.decimal_precision))
        ? Number(settings.decimal_precision) : 2,
      timezone: settings.timezone || 'UTC',
      dateFormat: settings.date_format || 'DD/MM/YYYY',
      timeFormat: settings.time_format || '24'
    };
  } catch {
    return {
      currency: 'USD', currencySymbol: '', precision: 2,
      timezone: 'UTC', dateFormat: 'DD/MM/YYYY', timeFormat: '24'
    };
  }
}

function isMoneyColumn(column) {
  return /cost|total|amount|price|balance/i.test(String(column || ''));
}

function isNumericValue(value) {
  return typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value ?? ''));
}

const EXPORT_DATE_VALUE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(?:\s*UTC)?$/;

function isDateValue(value) {
  return typeof value === 'string' && EXPORT_DATE_VALUE.test(value.trim());
}

function parseReportDate(value) {
  if (value instanceof Date) return value;
  const match = EXPORT_DATE_VALUE.exec(String(value || '').trim());
  if (!match) return new Date(value);
  return new Date(`${match[1]}T${match[2]}:${match[3] || '00'}Z`);
}

function formatReportDateTime(value, report = {}) {
  const date = parseReportDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: report.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  } catch {
    parts = { year: '', month: '', day: '', hour: '', minute: '', timeZoneName: 'UTC' };
  }
  const { year, month, day } = parts;
  const dateText = report.dateFormat === 'MM/DD/YYYY' ? `${month}/${day}/${year}`
    : report.dateFormat === 'YYYY-MM-DD' ? `${year}-${month}-${day}`
      : `${day}/${month}/${year}`;
  let timeText = `${parts.hour}:${parts.minute}`;
  if (report.timeFormat === '12') {
    const hour = Number(parts.hour);
    timeText = `${hour % 12 || 12}:${parts.minute} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  return `${dateText} ${timeText}${parts.timeZoneName ? ` ${parts.timeZoneName}` : ''}`;
}

function exportFormatValue(value, column, report = {}) {
  if (value instanceof Date || isDateValue(value)) return formatReportDateTime(value, report);
  if (isMoneyColumn(column) && isNumericValue(value)) {
    const precision = Number.isInteger(report.precision) ? report.precision : 2;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: report.currency || 'USD',
        minimumFractionDigits: precision, maximumFractionDigits: precision
      }).format(Number(value));
    } catch {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(Number(value));
    }
  }
  return displayValue(value);
}

function xlsxCellValue(value, column) {
  if (isMoneyColumn(column) && isNumericValue(value)) return Number(value);
  if (isDateValue(value)) return parseReportDate(value);
  return value == null ? '—' : value;
}

function xlsxNumberFormat(column, report = {}) {
  const precision = Number.isInteger(report.precision) ? report.precision : 2;
  const digits = precision > 0 ? `.${'0'.repeat(precision)}` : '';
  if (isMoneyColumn(column)) {
    const symbol = report.currencySymbol || { USD: '$', EUR: '€', GBP: '£' }[report.currency];
    return symbol ? `"${symbol}"#,##0${digits}` : `#,##0${digits} "${report.currency || 'USD'}"`;
  }
  return undefined;
}

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

  const requesterId = Number(query.requesterId);
  if (Number.isInteger(requesterId) && requesterId > 0) {
    where.push('r.requester_id = ?');
    params.push(requesterId);
  }
  const rawStatus = String(query.status || '').trim().slice(0, 200);
  const statuses = normalizeExportStatuses(rawStatus);
  if (statuses.length === 1) {
    where.push('r.status = ?');
    params.push(statuses[0]);
  } else if (statuses.length > 1) {
    where.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (['1', 'true'].includes(String(query.hasDecision || '').toLowerCase())) {
    where.push('r.supervisor_decision_at IS NOT NULL');
  }
  const search = String(query.search || '').trim().toLowerCase().slice(0, 120);
  if (search) {
    where.push(`(LOWER(r.reference) LIKE ? OR LOWER(r.title) LIKE ? OR LOWER(u.name) LIKE ?
      OR LOWER(COALESCE(r.justification, '')) LIKE ? OR EXISTS (
        SELECT 1 FROM requisition_items si
        WHERE si.requisition_id = r.id
          AND (LOWER(si.item_name) LIKE ? OR LOWER(COALESCE(si.description, '')) LIKE ?
            OR LOWER(COALESCE(si.remarks, '')) LIKE ?)
      ))`);
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const filter = parseDateFilter(query, PORTAL_EXPORT_FIELDS, { defaultField: 'submitted' });
  if (filter.error) {
    const error = new Error(filter.error);
    error.status = 400;
    throw error;
  }
  const dateClause = dateFilterClause(filter, PORTAL_EXPORT_FIELDS, params);
  if (dateClause) where.push(dateClause.replace(/^ AND \(|\)$/g, ''));

  let sql = `SELECT r.reference AS Reference, r.title AS Title,
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
     GROUP BY r.id ORDER BY COALESCE(r.submitted_at, r.created_at) DESC, r.id DESC`;
  sql = applySort(sql, { sortable: PORTAL_SORTABLE }, query);
  const [rows] = await pool.query(sql, params);

  const appliedFilters = [];
  if (Number.isInteger(requesterId) && requesterId > 0) appliedFilters.push(`Requester ID: ${requesterId}`);
  if (statuses.length) appliedFilters.push(`Status: ${statuses.join(', ')}`);
  if (query.search) appliedFilters.push(`Search: ${String(query.search).trim()}`);
  if (PORTAL_SORTABLE[String(query.sort || '').trim()]) {
    appliedFilters.push(`Sort: ${query.sort} ${String(query.direction || '').toLowerCase() === 'asc' ? 'ascending' : 'descending'}`);
  }
  if (filter.active) {
    appliedFilters.push(`${filter.field}: ${query.from || 'beginning'} to ${query.to || 'today'}`);
  }
  return {
    label: identity.role === 'requestor' ? 'My purchase requisitions' : 'Department purchase requisitions',
    rows,
    dateField: filter.field,
    from: query.from || '',
    to: query.to || '',
    filters: appliedFilters.join(' · ') || 'None',
    ...await reportFormatting()
  };
}

export function availableExports() {
  const reports = Object.entries(EXPORT_DEFINITIONS).map(([key, definition]) => ({
    key, label: definition.label, role: rolesFor(definition),
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
  return rolesFor(definition).includes(identity.role);
}

async function reportScope(definition, query, user) {
  if (!definition.scope) return { clause: '', params: [] };
  const identity = withPortalIdentity(user);
  if (definition.scope === 'bin-card-item') {
    const itemId = Number(query.itemId);
    if (!Number.isInteger(itemId) || itemId < 1) {
      const error = new Error('Select a valid inventory item before exporting its Bin Card.');
      error.status = 400;
      throw error;
    }
    return { clause: 'AND m.item_id = ?', params: [itemId, itemId] };
  }
  if (definition.scope === 'approver-pending') {
    return identity.role === 'approver'
      ? { clause: "AND r.status = 'Pending Supervisor Approval'", params: [] }
      : { clause: '', params: [] };
  }
  if (identity.role !== 'supervisor') return { clause: '', params: [] };
  const [[account]] = await pool.execute('SELECT department_id FROM users WHERE id = ?', [user.id]);
  if (!account?.department_id) {
    const error = new Error('Your account is not assigned to a Department.');
    error.status = 403;
    throw error;
  }
  return {
    clause: definition.scope === 'supervisor-stock'
      ? 'AND (i.department_id = ? OR i.department_id IS NULL)'
      : 'AND u.department_id = ?',
    params: [account.department_id]
  };
}

function applySort(sql, definition, query) {
  const sort = String(query.sort || '').trim();
  if (!definition.sortable || !hasOwn(definition.sortable, sort)) return sql;
  const direction = String(query.direction || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return sql.replace(/\bORDER\s+BY\b[\s\S]*$/i, `ORDER BY ${definition.sortable[sort]} ${direction}`);
}

function displayValue(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return `${text.slice(0, 10)} ${text.slice(11)} UTC`;
  return text;
}

function textFilterClause(definition, query, params) {
  const clauses = [];
  for (const filter of definition.textFilters || []) {
    const raw = String(query[filter.key] || '').trim().slice(0, 120);
    if (!raw) continue;
    clauses.push(filter.clause);
    const value = filter.exact ? raw : `%${raw}%`;
    const placeholders = (filter.clause.match(/\?/g) || []).length;
    for (let index = 0; index < placeholders; index += 1) params.push(value);
  }
  for (const [param, groups] of Object.entries(definition.groupFilters || {})) {
    const group = String(query[param] || '').trim();
    if (!hasOwn(groups, group)) continue;
    const statuses = groups[group];
    clauses.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  for (const [param, clausesByValue] of Object.entries(definition.customFilters || {})) {
    const value = String(query[param] || '').trim();
    if (!hasOwn(clausesByValue, value)) continue;
    clauses.push(clausesByValue[value]);
  }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

function describeFilters(definition, query, filter) {
  const items = [];
  if (filter.active) {
    items.push(`${filter.field}: ${query.from || 'beginning'} to ${query.to || 'today'}`);
  }
  for (const entry of definition.textFilters || []) {
    const raw = String(query[entry.key] || '').trim();
    if (raw) items.push(`${entry.key}: ${raw}`);
  }
  for (const [param, groups] of Object.entries(definition.groupFilters || {})) {
    const group = String(query[param] || '').trim();
    if (hasOwn(groups, group)) items.push(`${param}: ${group}`);
  }
  for (const [param, values] of Object.entries(definition.customFilters || {})) {
    const value = String(query[param] || '').trim();
    if (hasOwn(values, value)) items.push(`${param}: ${query[param]}`);
  }
  if (definition.scope === 'bin-card-item' && query.itemId) items.push(`Item ID: ${query.itemId}`);
  const sort = String(query.sort || '').trim();
  if (definition.sortable && hasOwn(definition.sortable, sort)) {
    items.push(`Sort: ${sort} ${String(query.direction || '').toLowerCase() === 'asc' ? 'ascending' : 'descending'}`);
  }
  return items.join(' · ') || 'None';
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
  const dateParams = [];
  const textParams = [];
  const dateClause = dateFilterClause(filter, definition.dateFields, dateParams);
  const textClause = textFilterClause(definition, query, textParams);
  const scope = await reportScope(definition, query, user);

  // The Bin Card ledger binds the item before its date filter, then binds the
  // same item again in the transaction branch. Other reports append their
  // scope predicates at the shared filter placeholder.
  const isBinCard = definition.scope === 'bin-card-item';
  const params = isBinCard
    ? [scope.params[0], ...dateParams, ...textParams, scope.params[1]]
    : [...dateParams, ...textParams, ...scope.params];
  const clause = dateClause + textClause + (isBinCard ? '' : scope.clause);
  const sql = applySort(
    definition.sql
      .replace('{{dateFilter}}', clause)
      .replace('{{scopeFilter}}', scope.clause),
    definition,
    query
  );
  const [rows] = await pool.query(sql, params);

  return {
    label: definition.label,
    rows,
    dateField: filter.field,
    from: query.from || '',
    to: query.to || '',
    filters: describeFilters(definition, query, filter),
    ...await reportFormatting()
  };
}

function drawBrand(doc) {
  const logo = logoPath();
  const margin = 40;
  if (logo) {
    try {
      doc.image(logo, margin, 34, { width: 52, height: 52, fit: [52, 52], contain: true });
    } catch { /* Branding is optional if the asset cannot be read. */ }
  }
  const textX = logo ? margin + 62 : margin;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(THEME.green).text(BRAND.organization, textX, 38);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(THEME.ink).text(BRAND.title, textX, 60);
  doc.font('Helvetica').fontSize(8).fillColor(THEME.ink).text(BRAND.caption, textX, 78);
  doc.moveTo(margin, 98).lineTo(doc.page.width - margin, 98).strokeColor(THEME.green).stroke();
}

export async function renderPdf(report, reference = '') {
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margin: 40, bufferPages: true,
    info: { Title: report.label, Author: BRAND.organization }
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawBrand(doc);
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(THEME.ink).text(reference ? `${report.label}: ${reference}` : report.label, 40, y);
  y += 22;
  doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
    .text(`Applied filters: ${report.filters || 'None'}`, 40, y, { width: doc.page.width - 80 });
  y += 18;
  if (report.from || report.to) {
    doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
      .text(`Filtered by ${report.dateField}: ${report.from || 'beginning'} to ${report.to || 'today'}`, 40, y);
    y += 18;
  }
  doc.font('Helvetica').fontSize(9).fillColor(THEME.ink)
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
    doc.font('Helvetica-Bold').fontSize(8).fillColor(THEME.ink);
    let x = 40;
    for (const [index, column] of columns.entries()) {
      doc.text(String(column).toUpperCase(), x + 5, y + 7, { width: widths[index] - 10, height: 12, ellipsis: true });
      x += widths[index];
    }
    y += rowHeight;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(THEME.border).stroke();
  }

  drawHeader();
  doc.font('Helvetica').fontSize(8).fillColor(THEME.ink);
  report.rows.forEach((row, rowIndex) => {
    if (y + rowHeight > doc.page.height - 52) {
      doc.addPage({ layout: 'landscape' });
      y = 46;
      drawBrand(doc);
      y = 116;
      drawHeader();
      doc.font('Helvetica').fontSize(8).fillColor(THEME.ink);
    }
    if (rowIndex % 2 === 1) {
      doc.save().rect(40, y, usableWidth, rowHeight).fill(THEME.surface).restore();
    }
    let x = 40;
    for (const [index, column] of columns.entries()) {
      doc.text(exportFormatValue(row[column], column, report), x + 5, y + 7, { width: widths[index] - 10, height: 12, ellipsis: true, lineBreak: false });
      x += widths[index];
    }
    y += rowHeight;
  });

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(8).fillColor(THEME.ink)
      .text(`Page ${index - pages.start + 1} of ${pages.count}`, 40, doc.page.height - 32, { width: doc.page.width - 80, align: 'right' });
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
    views: [{ state: 'frozen', ySplit: 8 }]
  });

  const logo = logoPath();
  if (logo) {
    try {
      const imageId = workbook.addImage({ filename: logo, extension: 'png' });
      sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 68, height: 68 } });
    } catch { /* Branding image is optional if the source asset is unavailable. */ }
  }
  sheet.getCell('B2').value = BRAND.organization;
  sheet.getCell('B2').font = { bold: true, size: 16, color: { argb: XLSX_INK } };
  sheet.getCell('B3').value = BRAND.title;
  sheet.getCell('B3').font = { bold: true, size: 11, color: { argb: XLSX_INK } };
  sheet.getCell('B4').value = BRAND.caption;
  sheet.getCell('B4').font = { size: 9, color: { argb: XLSX_INK } };
  sheet.getCell('B5').value = reference ? `${report.label}: ${reference}` : report.label;
  sheet.getCell('B5').font = { bold: true, size: 11 };
  sheet.getCell('B6').value = `Applied filters: ${report.filters || 'None'} · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  sheet.getCell('B6').font = { size: 9, color: { argb: XLSX_INK } };

  const columns = report.rows.length ? Object.keys(report.rows[0]) : ['No records found'];
  const headerRow = sheet.getRow(8);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column;
    cell.font = { bold: true, color: { argb: XLSX_INK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(14, column.length + 4));
  });
  headerRow.height = 22;

  report.rows.forEach((row) => {
    const values = columns.map((column) => xlsxCellValue(row[column], column, report));
    const sheetRow = sheet.addRow(values);
    sheetRow.eachCell((cell) => {
      const column = columns[cell.col - 1];
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: XLSX_BORDER } } };
      const format = xlsxNumberFormat(column, report);
      if (format && typeof cell.value === 'number') cell.numFmt = format;
      else if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
    });
  });
  sheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: Math.max(8, 8 + report.rows.length), column: columns.length }
  };
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
    `"Applied filters: ${String(report.filters || 'None').replace(/"/g, '""')}"`,
    `"Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC"`,
    columns.map(escape).join(','),
    ...report.rows.map((row) => columns.map((column) => `"${exportFormatValue(row[column], column, report).replace(/"/g, '""')}"`).join(','))
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

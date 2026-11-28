import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pool from '../config/db.js';
import { createNotification, writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { dateFilterClause, parseDateFilter } from '../utils/dates.js';
import { normalizeSignature } from '../utils/signature.js';
import { REQUISITION_DISPLAY_SQL, requisitionDisplayReference } from '../utils/requisition-display.js';
import {
  PROCUREMENT_READY_STATUSES, REQUISITION_STATUS, statusLabel
} from '../utils/requisition-status.js';
import { getSettings } from '../services/settings.js';

const router = Router();

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

const STATUS_ALIASES = {
  all: null,
  draft: REQUISITION_STATUS.DRAFT,
  submitted: REQUISITION_STATUS.SUBMITTED,
  pending: REQUISITION_STATUS.PENDING,
  information: REQUISITION_STATUS.INFORMATION,
  approved: REQUISITION_STATUS.APPROVED,
  rejected: REQUISITION_STATUS.REJECTED,
  forwarded: REQUISITION_STATUS.FORWARDED,
  review: REQUISITION_STATUS.UNDER_REVIEW,
  completed: REQUISITION_STATUS.COMPLETED,
  cancelled: REQUISITION_STATUS.CANCELLED
};

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function reference() {
  const settings = await getSettings();
  const prefix = settings.purchase_request_prefix || 'PR';
  return `${prefix}-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeStatus(value) {
  const raw = text(value, 60);
  if (!raw) return null;
  if (STATUS_ALIASES[raw.toLowerCase()] !== undefined) return STATUS_ALIASES[raw.toLowerCase()];
  return raw;
}

function parseItems(value) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); }
    catch { throw httpError(400, 'Request items are not valid JSON.'); }
  }
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'Add at least one item to the request.');
  if (items.length > 100) throw httpError(400, 'A request can contain at most 100 items.');
  const seenIds = new Set();
  return items.map((item) => {
    const quantity = Number(item.quantity);
    const estimatedUnitCost = Number(item.estimatedUnitCost);
    const itemName = text(item.itemName || item.name, 180);
    const id = item.id === undefined || item.id === null || item.id === ''
      ? null : Number(item.id);
    if (id !== null && (!Number.isInteger(id) || id < 1)) {
      throw httpError(400, 'An item has an invalid identifier.');
    }
    if (id !== null && seenIds.has(id)) {
      throw httpError(400, 'The same item cannot appear twice in a request.');
    }
    if (id !== null) seenIds.add(id);
    if (!itemName || !Number.isInteger(quantity) || quantity < 1 ||
        !Number.isFinite(estimatedUnitCost) || estimatedUnitCost < 0) {
      throw httpError(400, 'Each item needs a name, a positive whole quantity, and a valid estimated unit cost.');
    }
    return {
      id,
      itemName,
      description: text(item.description, 1000),
      remarks: text(item.remarks, 2000),
      quantity,
      unit: text(item.unit, 30) || 'unit',
      estimatedUnitCost: Math.round(estimatedUnitCost * 100) / 100
    };
  });
}

function parseAttachments(value) {
  if (!value) return [];
  let attachments = value;
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); }
    catch { throw httpError(400, 'Attachments are not valid JSON.'); }
  }
  if (!Array.isArray(attachments)) throw httpError(400, 'Attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) throw httpError(400, `A maximum of ${MAX_ATTACHMENTS} attachments is supported.`);
  return attachments.map((attachment) => {
    const fileName = text(attachment.fileName || attachment.name, 255);
    const mimeType = text(attachment.mimeType || attachment.type, 150) || 'application/octet-stream';
    const data = String(attachment.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!fileName || !data) throw httpError(400, 'An attachment is missing its file name or contents.');
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw httpError(400, `Unsupported attachment type: ${mimeType}. Upload PDF, document, spreadsheet, CSV, text, or image files.`);
    }
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
      throw httpError(400, 'Each attachment must be smaller than 5 MB.');
    }
    return { fileName, mimeType, buffer };
  });
}

async function transaction(handler, res, next) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

async function assignedDepartment(req, res) {
  const departmentId = parseId(req.user.departmentId);
  if (!departmentId) {
    res.status(403).json({ message: 'Your account is not assigned to a Department.' });
    return null;
  }
  const [rows] = await pool.execute(
    `SELECT d.id, d.name, d.description,
      (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS userCount,
      (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'requestor' AND u.active = TRUE) AS requesterCount
     FROM departments d WHERE d.id = ? LIMIT 1`,
    [departmentId]
  );
  if (!rows[0]) {
    res.status(403).json({ message: 'Your Department assignment is no longer valid.' });
    return null;
  }
  return { ...rows[0], userCount: Number(rows[0].userCount), requesterCount: Number(rows[0].requesterCount) };
}

async function activeSupervisor(connection, departmentId) {
  const [rows] = await connection.execute(
    `SELECT id, name, email FROM users
      WHERE role = 'supervisor' AND active = TRUE AND department_id = ?
      ORDER BY id LIMIT 1`,
    [departmentId]
  );
  return rows[0] || null;
}

async function notifyRoles(connection, roles, title, body, link) {
  if (!roles.length) return;
  const placeholders = roles.map(() => '?').join(',');
  const [users] = await connection.execute(
    `SELECT id FROM users WHERE active = TRUE AND role IN (${placeholders})`,
    roles
  );
  for (const user of users) await createNotification(connection, user.id, title, body, link);
}

async function recordActivity(connection, requisitionId, userId, action, details = {}, status = {}) {
  await connection.execute(
    `INSERT INTO requisition_activity
       (requisition_id, user_id, action, details, previous_status, new_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requisitionId, userId || null, action, JSON.stringify(details),
      status.previousStatus || null, status.newStatus || null
    ]
  );
  await writeAudit(connection, userId, action, 'requisition', requisitionId, details, status);
}

function requisitionQuery(where = '') {
  return `
    SELECT r.id, r.reference, r.title, r.location, r.justification, r.budget_code AS budgetCode,
      r.required_by AS requiredBy, r.priority, r.status, r.status AS statusLabel,
      r.submitted_at AS submittedAt, r.created_at AS createdAt, r.forwarded_at AS forwardedAt,
      r.forwarded_by_supervisor AS forwardedBySupervisor, fwd.name AS forwardedByName,
      fwd_d.name AS supervisorDepartment,
      r.department_id AS departmentId, d.name AS department,
      r.requester_id AS requesterId, u.name AS requester, u.email AS requesterEmail,
      u.phone AS requesterPhone,
      r.supervisor_id AS supervisorId, su.name AS supervisorName,
      r.supervisor_decision AS supervisorDecision,
      r.supervisor_decision_at AS supervisorDecisionAt,
      r.supervisor_signature AS supervisorSignature,
      r.supervisor_notes AS supervisorNotes,
      r.information_response AS informationResponse,
      (SELECT COUNT(*) FROM requisitions rr
        WHERE rr.requester_id = r.requester_id
          AND rr.department_id <=> r.department_id
          AND rr.id <= r.id) AS departmentSequence,
      COALESCE(SUM(ri.quantity * ri.estimated_unit_cost), 0) AS total,
      COUNT(DISTINCT ra.id) AS attachmentCount,
      GROUP_CONCAT(CONCAT(ri.item_name, ' × ', ri.quantity, ' ', ri.unit) ORDER BY ri.id SEPARATOR ', ') AS itemsSummary
    FROM requisitions r
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN users su ON su.id = r.supervisor_id
    LEFT JOIN users fwd ON fwd.id = r.forwarded_by_supervisor
    LEFT JOIN departments fwd_d ON fwd_d.id = fwd.department_id
    LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
    LEFT JOIN requisition_attachments ra ON ra.requisition_id = r.id
    ${where}
    GROUP BY r.id`;
}

function mapRequisition(row) {
  const displayReference = requisitionDisplayReference(row);
  return {
    ...row,
    displayReference,
    title: row.title || `${displayReference} procurement request`,
    statusLabel: statusLabel(row.status),
    total: Number(row.total) || 0,
    attachmentCount: Number(row.attachmentCount) || 0,
    departmentId: row.departmentId ?? null,
    requesterId: Number(row.requesterId),
    supervisorId: row.supervisorId ?? null,
    forwardedBySupervisor: row.forwardedBySupervisor == null ? null : Number(row.forwardedBySupervisor)
  };
}

async function loadRequisition(connection, id, req) {
  let where = 'WHERE r.id = ?';
  const params = [id];
  if (req.user.role === 'requestor') {
    where += ' AND r.requester_id = ?';
    params.push(req.user.id);
  } else if (req.user.role === 'supervisor') {
    where += ' AND r.department_id = ?';
    params.push(parseId(req.user.departmentId) || 0);
  }
  const [rows] = await connection.execute(requisitionQuery(where), params);
  if (!rows[0]) throw httpError(404, 'Request not found or you do not have access to it.');
  const row = rows[0];
  // Stable 1-based position of this request among the Requester's requests in
  // the same Department. Used for the HHR/<department>/<date>/<sequence> display
  // reference without changing the stored reference or any workflow lookups.
  const [sequenceRows] = await connection.execute(
    `SELECT COUNT(*) AS departmentSequence
       FROM requisitions
      WHERE requester_id = ? AND department_id = ? AND id <= ?`,
    [row.requesterId, row.departmentId ?? null, id]
  );
  return mapRequisition({
    ...row,
    departmentSequence: Number(sequenceRows[0]?.departmentSequence) || 1
  });
}

async function loadRequisitionParts(connection, id) {
  const [items] = await connection.execute(
    `SELECT id, item_name AS itemName, description, remarks, quantity, unit,
      estimated_unit_cost AS estimatedUnitCost
     FROM requisition_items WHERE requisition_id = ? ORDER BY id`,
    [id]
  );
  const [attachments] = await connection.execute(
    `SELECT id, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, created_at AS createdAt
     FROM requisition_attachments WHERE requisition_id = ? ORDER BY id`,
    [id]
  );
  const [activity] = await connection.execute(
    `SELECT id, action, details,
      previous_status AS previousStatus, new_status AS newStatus,
      created_at AS createdAt,
      (SELECT name FROM users WHERE users.id = requisition_activity.user_id) AS actor
     FROM requisition_activity WHERE requisition_id = ? ORDER BY created_at DESC, id DESC`,
    [id]
  );
  return {
    items: items.map((item) => ({ ...item, estimatedUnitCost: Number(item.estimatedUnitCost), lineTotal: Number(item.quantity) * Number(item.estimatedUnitCost) })),
    attachments,
    activity: activity.map((entry) => ({
      ...entry,
      details: typeof entry.details === 'string' ? JSON.parse(entry.details) : (entry.details || {})
    }))
  };
}

async function saveAttachments(connection, table, ownerColumn, ownerId, uploaderId, attachments) {
  for (const attachment of attachments) {
    if (table === 'requisition_attachments') {
      await connection.execute(
        `INSERT INTO requisition_attachments
          (requisition_id, uploader_id, file_name, mime_type, file_size, file_data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ownerId, uploaderId || null, attachment.fileName, attachment.mimeType, attachment.buffer.length, attachment.buffer]
      );
    } else {
      await connection.execute(
        `INSERT INTO message_attachments (message_id, file_name, mime_type, file_size, file_data)
         VALUES (?, ?, ?, ?, ?)`,
        [ownerId, attachment.fileName, attachment.mimeType, attachment.buffer.length, attachment.buffer]
      );
    }
  }
}

async function submitRequisition(connection, requisition, req, response = '', attachments = []) {
  if (requisition.status !== REQUISITION_STATUS.DRAFT && requisition.status !== REQUISITION_STATUS.INFORMATION) {
    throw httpError(409, 'Only a draft or a request needing information can be submitted.');
  }
  if (requisition.status === REQUISITION_STATUS.INFORMATION && !response) {
    throw httpError(400, 'Describe how you addressed the requested information before resubmitting.');
  }
  const departmentId = parseId(requisition.departmentId);
  if (!departmentId) throw httpError(403, 'This request has no assigned Department.');
  const supervisor = await activeSupervisor(connection, departmentId);
  if (!supervisor) {
    throw httpError(409, 'Your Department has no active Supervisor. Contact an Administrator before submitting this request.');
  }
  const [items] = await connection.execute('SELECT id FROM requisition_items WHERE requisition_id = ? LIMIT 1', [requisition.id]);
  if (!items.length) throw httpError(400, 'Add at least one item before submitting.');
  if (!text(requisition.title) || !text(requisition.location) || !text(requisition.justification)) {
    throw httpError(400, 'Complete the title, location, and description or purpose before submitting.');
  }

  await connection.execute(
    `UPDATE requisitions
       SET status = ?, submitted_at = NOW(), supervisor_id = ?, supervisor_decision = NULL,
         supervisor_decision_at = NULL, supervisor_signature = NULL, forwarded_at = NULL, forwarded_by_supervisor = NULL,
         information_response = CASE WHEN ? = '' THEN information_response ELSE ? END
     WHERE id = ?`,
    [REQUISITION_STATUS.PENDING, supervisor.id, response, response, requisition.id]
  );
  await saveAttachments(connection, 'requisition_attachments', 'requisition_id', requisition.id, req.user.id, attachments);
  await recordActivity(connection, requisition.id, req.user.id,
    requisition.status === REQUISITION_STATUS.INFORMATION ? 'resubmitted' : 'submitted',
    { supervisorId: supervisor.id, supervisorName: supervisor.name, response: response || null },
    { previousStatus: requisition.status, newStatus: REQUISITION_STATUS.PENDING });
  const link = `#/supervisor/Approvals?request=${requisition.id}`;
  await createNotification(connection, supervisor.id, 'New request awaiting approval',
    `${requisition.displayReference || requisitionDisplayReference(requisition)} was submitted by ${req.user.name} and routed to you.`, link);
  await createNotification(connection, req.user.id, 'Request submitted',
    `${requisition.displayReference || requisitionDisplayReference(requisition)} was submitted to ${supervisor.name} for approval.`,
    `#/requester/My%20Procurement%20Requests?request=${requisition.id}`);
  return {
    id: requisition.id,
    reference: requisition.reference,
    status: REQUISITION_STATUS.PENDING,
    statusLabel: statusLabel(REQUISITION_STATUS.PENDING),
    message: `Request routed to ${supervisor.name}.`
  };
}

async function summaryStats(connection, scope, departmentId) {
  const where = scope === 'requester' ? 'requester_id = ?' : 'department_id = ?';
  const [rows] = await connection.execute(
    `SELECT
      COUNT(*) AS total,
      SUM(status = 'Draft') AS draft,
      SUM(status = 'Submitted') AS submitted,
      SUM(status = 'Pending Supervisor Approval') AS pending,
      SUM(status = 'Information Required') AS informationRequired,
      SUM(status IN ('Approved by Supervisor', 'Forwarded to Procurement')) AS approved,
      SUM(status = 'Rejected by Supervisor') AS rejected,
      SUM(status = 'Forwarded to Procurement') AS forwarded,
      SUM(status = 'Under Procurement Review') AS underReview,
      SUM(status IN ('Completed', 'Procurement Approved')) AS completed
     FROM requisitions WHERE ${where}`,
    [departmentId]
  );
  const result = rows[0] || {};
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Number(value) || 0]));
}

async function unreadNotifications(userId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE is_read = FALSE AND (user_id = ? OR user_id IS NULL)`,
    [userId]
  );
  return Number(rows[0]?.total) || 0;
}

async function unreadMessages(userId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM message_recipients WHERE user_id = ? AND is_read = FALSE',
    [userId]
  );
  return Number(rows[0]?.total) || 0;
}

router.get('/session', (req, res) => res.json({ portal: req.user.portal, user: req.user }));

router.get('/supervisor/summary', allowRoles('supervisor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const [stock] = await pool.execute(
      `SELECT
        COUNT(*) AS stockItems,
        SUM(quantity <= reorder_level) AS lowStock,
        SUM(quantity = 0) AS outOfStock
       FROM items WHERE department_id = ? OR department_id IS NULL`,
      [department.id]
    );
    return res.json({
      portal: 'supervisor',
      user: req.user,
      department,
      stats: {
        ...await summaryStats(pool, 'supervisor', department.id),
        requesters: department.requesterCount,
        stockItems: Number(stock[0]?.stockItems) || 0,
        lowStock: Number(stock[0]?.lowStock) || 0,
        outOfStock: Number(stock[0]?.outOfStock) || 0,
        unreadNotifications: await unreadNotifications(req.user.id),
        unreadMessages: await unreadMessages(req.user.id)
      }
    });
  } catch (error) { return next(error); }
});

router.get('/requester/summary', allowRoles('requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return res.json({
      portal: 'requester',
      user: req.user,
      department,
      stats: {
        ...await summaryStats(pool, 'requester', req.user.id),
        unreadNotifications: await unreadNotifications(req.user.id),
        unreadMessages: await unreadMessages(req.user.id)
      }
    });
  } catch (error) { return next(error); }
});

router.get('/supervisor/requesters', allowRoles('supervisor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const [requesters] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at AS createdAt,
        (SELECT COUNT(*) FROM requisitions r WHERE r.requester_id = u.id) AS requestCount
       FROM users u WHERE u.department_id = ? AND u.role = 'requestor' AND u.active = TRUE
       ORDER BY u.name, u.id`,
      [department.id]
    );
    return res.json({ department, requesters });
  } catch (error) { return next(error); }
});

router.get('/supervisor/department-users', allowRoles('supervisor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.created_at AS createdAt,
        (SELECT COUNT(*) FROM requisitions r WHERE r.requester_id = u.id) AS requestCount
       FROM users u WHERE u.department_id = ? AND u.active = TRUE
       ORDER BY FIELD(u.role, 'supervisor', 'requestor', 'storekeeper', 'approver', 'procurement', 'finance', 'committee', 'admin'), u.name, u.id`,
      [department.id]
    );
    return res.json({ department, users });
  } catch (error) { return next(error); }
});

router.get('/department', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return res.json({ department });
  } catch (error) { return next(error); }
});

router.get('/department/:id', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  const requestedId = parseId(req.params.id);
  if (!requestedId) return res.status(400).json({ message: 'Invalid department identifier.' });
  if (requestedId !== parseId(req.user.departmentId)) {
    return res.status(403).json({ message: 'You can only access your assigned Department.' });
  }
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return res.json({ department });
  } catch (error) { return next(error); }
});

function listRequisitions(role) {
  return async (req, res, next) => {
    try {
      const department = await assignedDepartment(req, res);
      if (!department) return;
      const page = positiveInt(req.query.page, 1);
      const limit = Math.min(positiveInt(req.query.limit, 10), 100);
      const where = [`1 = 1`];
      const params = [];
      if (role === 'requestor') { where.push('q.requesterId = ?'); params.push(req.user.id); }
      else { where.push('q.departmentId = ?'); params.push(department.id); }
      const statusValues = text(req.query.status, 200)
        .split(',')
        .map((value) => normalizeStatus(value))
        .filter(Boolean);
      if (statusValues.length === 1) {
        where.push('q.status = ?');
        params.push(statusValues[0]);
      } else if (statusValues.length > 1) {
        where.push(`q.status IN (${statusValues.map(() => '?').join(',')})`);
        params.push(...statusValues);
      }
      if (['1', 'true'].includes(String(req.query.hasDecision || '').toLowerCase())) {
        where.push('q.supervisorDecisionAt IS NOT NULL');
      }
      const search = text(req.query.search, 120);
      if (search) {
        where.push(`(q.reference LIKE ? OR q.title LIKE ? OR q.requester LIKE ? OR q.itemsSummary LIKE ?
          OR q.justification LIKE ? OR EXISTS (
            SELECT 1 FROM requisition_items si
            WHERE si.requisition_id = q.id
              AND (si.item_name LIKE ? OR COALESCE(si.description, '') LIKE ? OR COALESCE(si.remarks, '') LIKE ?)
          ))`);
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
      }
      const columns = {
        submitted: 'COALESCE(q.submittedAt, q.createdAt)',
        created: 'q.createdAt',
        approved: 'q.supervisorDecisionAt',
        forwarded: 'q.forwardedAt',
        required: 'q.requiredBy'
      };
      const filter = parseDateFilter(req.query, columns, { defaultField: 'submitted' });
      if (filter.error) return res.status(400).json({ message: filter.error });
      const dateClause = dateFilterClause(filter, columns, params);
      const base = `SELECT * FROM (${requisitionQuery()}) q WHERE ${where.join(' AND ')}${dateClause}`;
      const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM (${base}) counted`, params);
      const [rows] = await pool.execute(
        `${base} ORDER BY q.createdAt DESC, q.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      const total = Number(countRow?.total) || 0;
      return res.json({
        requisitions: rows.map(mapRequisition),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      });
    } catch (error) { return next(error); }
  };
}

router.get('/requester/requisitions', allowRoles('requestor'), listRequisitions('requestor'));
router.get('/supervisor/requisitions', allowRoles('supervisor'), listRequisitions('supervisor'));

function getRequisitionDetail(role) {
  return async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
      const department = await assignedDepartment(req, res);
      if (!department) return;
      return await transaction(async (connection) => {
        const requisition = await loadRequisition(connection, id, { ...req, user: { ...req.user, role } });
        return { body: { requisition: { ...requisition, ...await loadRequisitionParts(connection, id) } } };
      }, res, next);
    } catch (error) { return next(error); }
  };
}

router.get('/requester/requisitions/:id', allowRoles('requestor'), getRequisitionDetail('requestor'));
router.get('/supervisor/requisitions/:id', allowRoles('supervisor'), getRequisitionDetail('supervisor'));

router.post('/requester/requisitions', allowRoles('requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const action = req.body.action === 'submit' ? 'submit' : 'draft';
    const items = parseItems(req.body.items);
    const attachments = parseAttachments(req.body.attachments);
    const title = text(req.body.title, 180);
    const location = text(req.body.location, 255);
    const justification = text(req.body.justification, 5000);
    const budgetCode = text(req.body.budgetCode, 60);
    const requiredBy = /^\d{4}-\d{2}-\d{2}$/.test(req.body.requiredBy || '') ? req.body.requiredBy : null;
    const priority = ['Low', 'Medium', 'High', 'Urgent'].includes(req.body.priority) ? req.body.priority : 'Medium';
    if (action === 'submit' && (!title || !location || !justification)) {
      return res.status(400).json({ message: 'Complete the title, location, and description or purpose before submitting.' });
    }
    return await transaction(async (connection) => {
      const reqReference = await reference();
      const [result] = await connection.execute(
        `INSERT INTO requisitions
          (reference, requester_id, department_id, title, location, justification, budget_code, required_by, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reqReference, req.user.id, department.id, title || null, location || null,
          justification, budgetCode, requiredBy, priority, REQUISITION_STATUS.DRAFT]
      );
      const requisitionId = Number(result.insertId);
      for (const item of items) {
        await connection.execute(
          `INSERT INTO requisition_items
            (requisition_id, item_name, description, remarks, quantity, unit, estimated_unit_cost)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [requisitionId, item.itemName, item.description || null, item.remarks || null,
            item.quantity, item.unit, item.estimatedUnitCost]
        );
      }
      await saveAttachments(connection, 'requisition_attachments', 'requisition_id', requisitionId, req.user.id, attachments);
      await recordActivity(connection, requisitionId, req.user.id, 'created', { action, itemCount: items.length });
      if (action === 'submit') {
        const created = await loadRequisition(connection, requisitionId, req);
        const submitted = await submitRequisition(connection, created, req);
        return { status: 201, body: submitted };
      }
      await createNotification(connection, req.user.id, 'Draft saved',
        `${reqReference} was saved as a draft.`, `#/requester/Create%20Purchase%20Request?request=${requisitionId}`);
      return {
        status: 201,
        body: {
          id: requisitionId, reference: reqReference, status: REQUISITION_STATUS.DRAFT,
          statusLabel: statusLabel(REQUISITION_STATUS.DRAFT), message: 'Draft saved.'
        }
      };
    }, res, next);
  } catch (error) { return next(error); }
});

// Drafts can be corrected in place. Reference, status, Department, ownership
// and activity history are deliberately untouched: this is an edit, not a new
// submission and never a workflow transition.
router.patch('/requester/requisitions/:id', allowRoles('requestor'), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return await transaction(async (connection) => {
      const existing = await loadRequisition(connection, id, req);
      if (existing.status !== REQUISITION_STATUS.DRAFT) {
        throw httpError(409, 'Only draft requests can be edited.');
      }
      const items = parseItems(req.body.items);
      const title = text(req.body.title, 180);
      const location = text(req.body.location, 255);
      const justification = text(req.body.justification, 5000);
      const budgetCode = text(req.body.budgetCode, 60);
      const requiredBy = /^\d{4}-\d{2}-\d{2}$/.test(req.body.requiredBy || '') ? req.body.requiredBy : null;
      const priority = ['Low', 'Medium', 'High', 'Urgent'].includes(req.body.priority) ? req.body.priority : 'Medium';

      const [currentRows] = await connection.execute(
        'SELECT id FROM requisition_items WHERE requisition_id = ?',
        [id]
      );
      const currentIds = new Set(currentRows.map((row) => Number(row.id)));
      for (const item of items) {
        if (item.id !== null && !currentIds.has(item.id)) {
          throw httpError(400, 'An item does not belong to this draft.');
        }
      }

      await connection.execute(
        `UPDATE requisitions
            SET title = ?, location = ?, justification = ?, budget_code = ?,
              required_by = ?, priority = ?
          WHERE id = ? AND status = ?`,
        [title || null, location || null, justification, budgetCode, requiredBy, priority,
          id, REQUISITION_STATUS.DRAFT]
      );

      const keptIds = [];
      for (const item of items) {
        if (item.id !== null) {
          await connection.execute(
            `UPDATE requisition_items
                SET item_name = ?, description = ?, remarks = ?, quantity = ?,
                  unit = ?, estimated_unit_cost = ?
              WHERE id = ? AND requisition_id = ?`,
            [item.itemName, item.description || null, item.remarks || null, item.quantity,
              item.unit, item.estimatedUnitCost, item.id, id]
          );
          keptIds.push(item.id);
        } else {
          const [inserted] = await connection.execute(
            `INSERT INTO requisition_items
              (requisition_id, item_name, description, remarks, quantity, unit, estimated_unit_cost)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, item.itemName, item.description || null, item.remarks || null,
              item.quantity, item.unit, item.estimatedUnitCost]
          );
          keptIds.push(Number(inserted.insertId));
        }
      }
      const placeholders = keptIds.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM requisition_items WHERE requisition_id = ? AND id NOT IN (${placeholders})`,
        [id, ...keptIds]
      );

      const updated = await loadRequisition(connection, id, req);
      return {
        body: {
          id,
          reference: existing.reference,
          status: existing.status,
          statusLabel: statusLabel(existing.status),
          message: 'Draft updated.',
          requisition: { ...updated, ...await loadRequisitionParts(connection, id) }
        }
      };
    }, res, next);
  } catch (error) { return next(error); }
});

router.post('/requester/requisitions/:id/submit', allowRoles('requestor'), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  try {
    return await transaction(async (connection) => {
      const requisition = await loadRequisition(connection, id, req);
      return { body: await submitRequisition(connection, requisition, req, text(req.body.response, 2000), parseAttachments(req.body.attachments)) };
    }, res, next);
  } catch (error) { return next(error); }
});

router.post('/requester/requisitions/:id/resubmit', allowRoles('requestor'), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  try {
    return await transaction(async (connection) => {
      const requisition = await loadRequisition(connection, id, req);
      if (requisition.status !== REQUISITION_STATUS.INFORMATION) {
        throw httpError(409, 'This request is not waiting for additional information.');
      }
      return { body: await submitRequisition(connection, requisition, req, text(req.body.response, 2000), parseAttachments(req.body.attachments)) };
    }, res, next);
  } catch (error) { return next(error); }
});

router.post('/supervisor/requisitions/:id/decision', allowRoles('supervisor'), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  const decision = req.body.decision;
  if (!['Approve', 'Reject', 'Request Information'].includes(decision)) {
    return res.status(400).json({ message: 'Choose approve, reject, or request information.' });
  }
  const reason = text(req.body.reason, 2000);
  if (decision !== 'Approve' && !reason) {
    return res.status(400).json({ message: 'A reason is required when rejecting or requesting information.' });
  }
  const decisionValue = {
    Approve: 'Approved', Reject: 'Rejected', 'Request Information': 'Information Required'
  }[decision];
  try {
    const signature = decision === 'Approve' && req.body.signature
      ? await normalizeSignature(req.body.signature, 'Approved by')
      : null;
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return await transaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT r.id, r.reference, r.requester_id AS requesterId, r.status, r.department_id AS departmentId,
          r.title, u.name AS requesterName, ${REQUISITION_DISPLAY_SQL}
         FROM requisitions r JOIN users u ON u.id = r.requester_id
         WHERE r.id = ? AND r.department_id = ? FOR UPDATE`,
        [id, department.id]
      );
      const requisition = rows[0];
      if (!requisition) throw httpError(404, 'Request not found in your Department.');
      requisition.displayReference = requisitionDisplayReference(requisition);
      if (requisition.status !== REQUISITION_STATUS.PENDING) {
        throw httpError(409, 'This request has already been decided and cannot be actioned again.');
      }
      let status;
      if (decision === 'Approve') status = REQUISITION_STATUS.APPROVED;
      else if (decision === 'Reject') status = REQUISITION_STATUS.REJECTED;
      else status = REQUISITION_STATUS.INFORMATION;

      // Approval closes the Supervisor's review. It deliberately does NOT set
      // any forwarding marker: sending the document to Procurement is a separate
      // explicit action performed through /forward.
      await connection.execute(
        `UPDATE requisitions
           SET status = ?, supervisor_id = ?, supervisor_decision = ?, supervisor_decision_at = NOW(),
             supervisor_signature = ?, supervisor_notes = ?
         WHERE id = ?`,
        [status, req.user.id, decisionValue, signature, reason || null, id]
      );
      await recordActivity(connection, id, req.user.id,
        decision === 'Approve' ? 'approved_by_supervisor' : decision === 'Reject' ? 'rejected_by_supervisor' : 'information_requested',
        { decision, reason: reason || null },
        { previousStatus: requisition.status, newStatus: status });

      const requesterLink = `#/requester/My%20Procurement%20Requests?request=${id}`;
      if (decision === 'Approve') {
        await createNotification(connection, requisition.requesterId, 'Request approved by Supervisor',
          `${requisition.displayReference} was approved by ${req.user.name}. Your Supervisor will forward it to Procurement.`, requesterLink);
      } else if (decision === 'Reject') {
        await createNotification(connection, requisition.requesterId, 'Request rejected by Supervisor',
          `${requisition.displayReference} was rejected. Reason: ${reason}`, requesterLink);
      } else {
        await createNotification(connection, requisition.requesterId, 'Additional information requested',
          `${requisition.displayReference} needs more information. ${reason}`, `#/requester/Messages?userId=${req.user.id}&request=${id}`);
      }
      return {
        body: {
          message: decision === 'Approve' ? 'Request approved. Forward it to Procurement when ready.'
            : decision === 'Reject' ? 'Request rejected.' : 'Information request sent to the Requester.',
          status,
          statusLabel: statusLabel(status)
        }
      };
    }, res, next);
  } catch (error) { return next(error); }
});

// Explicit, single-use Supervisor forwarding. Approval never calls this; only
// a Supervisor who owns the Department and approved the request may forward it.
router.post('/supervisor/requisitions/:id/forward', allowRoles('supervisor'), async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid request identifier.' });
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    return await transaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT r.id, r.reference, r.requester_id AS requesterId, r.status, r.department_id AS departmentId,
          r.supervisor_id AS supervisorId, r.supervisor_decision AS supervisorDecision,
          r.forwarded_by_supervisor AS forwardedBySupervisor, r.forwarded_at AS forwardedAt,
          r.title, u.name AS requesterName, ${REQUISITION_DISPLAY_SQL}
         FROM requisitions r JOIN users u ON u.id = r.requester_id
         WHERE r.id = ? AND r.department_id = ? FOR UPDATE`,
        [id, department.id]
      );
      const requisition = rows[0];
      if (!requisition) throw httpError(404, 'Request not found in your Department.');
      requisition.displayReference = requisitionDisplayReference(requisition);

      // Duplicate forwarding is impossible: the marker and the status are both
      // checked, so a retry, a double-click, or a direct API call cannot resend.
      if (requisition.forwardedBySupervisor != null || requisition.forwardedAt != null
          || requisition.status === REQUISITION_STATUS.FORWARDED) {
        throw httpError(409, 'This request has already been forwarded to Procurement.');
      }
      if (requisition.status !== REQUISITION_STATUS.APPROVED) {
        const message = requisition.status === REQUISITION_STATUS.REJECTED
          ? 'A rejected request cannot be forwarded.'
          : requisition.status === REQUISITION_STATUS.INFORMATION
            ? 'A request awaiting additional information cannot be forwarded.'
            : 'Only an approved request can be forwarded to Procurement.';
        throw httpError(409, message);
      }
      if (requisition.supervisorDecision !== 'Approved') {
        throw httpError(409, 'The request must be approved by a Supervisor before it can be forwarded.');
      }
      if (Number(requisition.supervisorId) !== Number(req.user.id)) {
        throw httpError(403, 'Only the Supervisor who approved this request can forward it.');
      }
      const [supervisors] = await connection.execute(
        `SELECT id FROM users WHERE id = ? AND role = 'supervisor' AND active = TRUE AND department_id = ? LIMIT 1`,
        [req.user.id, department.id]
      );
      if (!supervisors.length) throw httpError(403, 'Your Supervisor assignment is no longer active.');

      await connection.execute(
        'UPDATE requisitions SET status = ?, forwarded_by_supervisor = ?, forwarded_at = NOW() WHERE id = ?',
        [REQUISITION_STATUS.FORWARDED, req.user.id, id]
      );
      await recordActivity(connection, id, req.user.id, 'forwarded_to_procurement', {
        destination: 'Procurement',
        reference: requisition.reference,
        supervisorId: req.user.id,
        supervisorName: req.user.name,
        department: department.name
      }, { previousStatus: requisition.status, newStatus: REQUISITION_STATUS.FORWARDED });

      const requesterLink = `#/requester/My%20Procurement%20Requests?request=${id}`;
      await createNotification(connection, requisition.requesterId, 'Request forwarded to Procurement',
        `${requisition.displayReference} was approved by ${req.user.name} and forwarded to Procurement.`, requesterLink);
      await notifyRoles(connection, ['admin', 'procurement'], 'Department request forwarded to Procurement',
        `${requisition.displayReference} from ${requisition.requesterName} was approved and forwarded by ${req.user.name}.`,
        `#/admin/Requests%20Received%20from%20Departments?request=${id}`);

      const [[updated]] = await connection.execute('SELECT forwarded_at AS forwardedAt FROM requisitions WHERE id = ?', [id]);
      return {
        body: {
          id,
          reference: requisition.reference,
          status: REQUISITION_STATUS.FORWARDED,
          statusLabel: statusLabel(REQUISITION_STATUS.FORWARDED),
          forwardedAt: updated?.forwardedAt || null,
          message: 'Request forwarded to Procurement.'
        }
      };
    }, res, next);
  } catch (error) { return next(error); }
});

router.get('/requisitions/:id/attachments/:attachmentId', allowRoles('requestor', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const requisitionId = parseId(req.params.id);
    const attachmentId = parseId(req.params.attachmentId);
    if (!requisitionId || !attachmentId) return res.status(400).json({ message: 'Invalid attachment identifier.' });
    await loadRequisition(pool, requisitionId, req);
    const [rows] = await pool.execute(
      `SELECT file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, file_data AS fileData
       FROM requisition_attachments WHERE id = ? AND requisition_id = ? LIMIT 1`,
      [attachmentId, requisitionId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Attachment not found.' });
    res.setHeader('Content-Type', rows[0].mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${String(rows[0].fileName).replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Content-Length', rows[0].fileSize);
    return res.send(rows[0].fileData);
  } catch (error) { return next(error); }
});

function otherParty(req, otherId) {
  const id = parseId(otherId);
  if (!id) throw httpError(400, 'Invalid conversation participant.');
  const departmentId = parseId(req.user.departmentId);
  if (!departmentId) throw httpError(403, 'Your account is not assigned to a Department.');
  const expectedRole = req.user.role === 'requestor' ? 'supervisor' : 'requestor';
  if (!['supervisor', 'requestor'].includes(req.user.role)) throw httpError(403, 'This messaging area is not available to your role.');
  return { id, departmentId, expectedRole };
}

async function validateConversation(req, otherId) {
  const party = otherParty(req, otherId);
  const [rows] = await pool.execute(
    `SELECT id, name, email FROM users
      WHERE id = ? AND department_id = ? AND role = ? AND active = TRUE LIMIT 1`,
    [party.id, party.departmentId, party.expectedRole]
  );
  if (!rows[0]) throw httpError(403, 'You can only communicate with your authorized Department contact.');
  return rows[0];
}

async function messageRows(connection, where, params, viewerId) {
  const [rows] = await connection.execute(
    `SELECT m.id, m.body, m.created_at AS createdAt, m.sender_id AS senderId,
      sender.name AS senderName, sender.profile_photo AS senderPhoto,
      m.recipient_id AS recipientId, recipient.name AS recipientName,
      recipient.profile_photo AS recipientPhoto,
      m.requisition_id AS requisitionId, rr.reference AS requisitionReference,
      rr.submitted_at AS requisitionSubmittedAt, rr.created_at AS requisitionCreatedAt,
      (SELECT COUNT(*) FROM requisitions req
        WHERE req.requester_id = rr.requester_id
          AND req.department_id <=> rr.department_id
          AND req.id <= rr.id) AS departmentSequence,
      m.is_announcement AS isAnnouncement,
      CASE WHEN m.sender_id = ? THEN TRUE ELSE COALESCE(mr.is_read, FALSE) END AS isRead,
      (SELECT COUNT(*) FROM message_attachments ma WHERE ma.message_id = m.id) AS attachmentCount
     FROM messages m
     JOIN users sender ON sender.id = m.sender_id
     LEFT JOIN users recipient ON recipient.id = m.recipient_id
     LEFT JOIN requisitions rr ON rr.id = m.requisition_id
     LEFT JOIN message_recipients mr ON mr.message_id = m.id AND mr.user_id = ?
     WHERE ${where} ORDER BY m.created_at DESC, m.id DESC`,
    [viewerId, viewerId, ...params]
  );
  return rows.map((row) => ({
    ...row,
    requisitionDisplayReference: row.requisitionReference ? requisitionDisplayReference({
      submittedAt: row.requisitionSubmittedAt,
      createdAt: row.requisitionCreatedAt,
      departmentSequence: row.departmentSequence
    }) : null,
    isAnnouncement: Boolean(row.isAnnouncement),
    isRead: Boolean(row.isRead),
    attachmentCount: Number(row.attachmentCount) || 0
  }));
}

router.get('/messages/conversations', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const isSupervisor = req.user.role === 'supervisor';
    const [people] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.profile_photo AS photo,
        (SELECT COUNT(*) FROM message_recipients mr
          JOIN messages m ON m.id = mr.message_id
         WHERE mr.user_id = ? AND mr.is_read = FALSE AND m.sender_id = u.id AND m.is_announcement = FALSE) AS unreadCount,
        last.body AS lastBody, last.created_at AS lastAt, last.requisition_id AS lastRequisitionId,
        rr.reference AS lastRequisitionReference,
        rr.submitted_at AS lastRequisitionSubmittedAt, rr.created_at AS lastRequisitionCreatedAt,
        (SELECT COUNT(*) FROM requisitions req
          WHERE req.requester_id = rr.requester_id
            AND req.department_id <=> rr.department_id
            AND req.id <= rr.id) AS lastRequisitionSequence
       FROM users u
       LEFT JOIN messages last ON last.id = (
         SELECT m.id FROM messages m
         WHERE m.department_id = ? AND m.is_announcement = FALSE
           AND ((m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id))
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1
       )
       LEFT JOIN requisitions rr ON rr.id = last.requisition_id
       WHERE u.department_id = ? AND u.role = ? AND u.active = TRUE
       ORDER BY last.created_at DESC, u.name`,
      [req.user.id, department.id, req.user.id, req.user.id, department.id, isSupervisor ? 'requestor' : 'supervisor']
    );
    const [announcements] = await pool.execute(
      `SELECT m.id, m.body, m.created_at AS createdAt, m.is_announcement AS isAnnouncement,
        m.sender_id AS senderId,
        CASE WHEN m.sender_id = ? THEN TRUE ELSE COALESCE(mr.is_read, FALSE) END AS isRead,
        sender.name AS senderName, sender.profile_photo AS senderPhoto
       FROM messages m
       LEFT JOIN message_recipients mr ON mr.message_id = m.id AND mr.user_id = ?
       JOIN users sender ON sender.id = m.sender_id
       WHERE m.department_id = ? AND m.is_announcement = TRUE
         AND (m.sender_id = ? OR mr.user_id IS NOT NULL)
       ORDER BY m.created_at DESC, m.id DESC`,
      [req.user.id, req.user.id, department.id, req.user.id]
    );
    return res.json({
      conversations: people.map((person) => ({
        ...person,
        lastRequisitionDisplayReference: person.lastRequisitionReference ? requisitionDisplayReference({
          submittedAt: person.lastRequisitionSubmittedAt,
          createdAt: person.lastRequisitionCreatedAt,
          departmentSequence: person.lastRequisitionSequence
        }) : null,
        unreadCount: Number(person.unreadCount) || 0
      })),
      announcements: announcements.map((notice) => ({ ...notice, isAnnouncement: Boolean(notice.isAnnouncement), isRead: Boolean(notice.isRead) })),
      department
    });
  } catch (error) { return next(error); }
});

router.get('/messages/thread', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const participant = await validateConversation(req, req.query.userId);
    // Loading a conversation never changes read state. Read state changes only
    // when the reader opens one message through PATCH /messages/:id/read, so
    // sibling messages and other recipients stay unread.
    const messages = await messageRows(pool,
      `m.department_id = ? AND m.is_announcement = FALSE
       AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`,
      [department.id, req.user.id, participant.id, participant.id, req.user.id],
      req.user.id
    );
    return res.json({ participant, messages, department });
  } catch (error) { return next(error); }
});

router.post('/messages', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const body = text(req.body.body, 5000);
    const attachments = parseAttachments(req.body.attachments);
    if (!body && !attachments.length) return res.status(400).json({ message: 'Write a message or attach a document.' });
    const isAnnouncement = req.body.announcement === true || req.body.announcement === 'true';
    if (isAnnouncement && req.user.role !== 'supervisor') {
      return res.status(403).json({ message: 'Only Supervisors can send Department announcements.' });
    }
    let participant = null;
    let requisitionId = null;
    if (!isAnnouncement) participant = await validateConversation(req, req.body.recipientId);
    if (req.body.requisitionId) {
      requisitionId = parseId(req.body.requisitionId);
      if (!requisitionId) return res.status(400).json({ message: 'Invalid request reference.' });
      const where = req.user.role === 'requestor' ? 'id = ? AND requester_id = ?' : 'id = ? AND department_id = ?';
      const [requests] = await pool.execute(`SELECT id, reference FROM requisitions WHERE ${where} LIMIT 1`,
        [requisitionId, req.user.role === 'requestor' ? req.user.id : department.id]);
      if (!requests.length) return res.status(403).json({ message: 'The message must relate to one of your authorized requests.' });
    }
    return await transaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO messages (department_id, requisition_id, sender_id, recipient_id, body, is_announcement)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [department.id, requisitionId, req.user.id, participant?.id || null, body, isAnnouncement ? 1 : 0]
      );
      const messageId = Number(result.insertId);
      let recipients = [];
      if (isAnnouncement) {
        const [rows] = await connection.execute(
          `SELECT id FROM users WHERE department_id = ? AND role = 'requestor' AND active = TRUE`,
          [department.id]
        );
        recipients = rows.map((row) => row.id);
      } else {
        recipients = [participant.id];
      }
      for (const userId of recipients) {
        await connection.execute('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
      }
      await saveAttachments(connection, 'message_attachments', 'message_id', messageId, req.user.id, attachments);
      await writeAudit(connection, req.user.id, isAnnouncement ? 'department_announcement' : 'message_sent',
        'message', messageId, { departmentId: department.id, recipientCount: recipients.length, requisitionId });
      const link = isAnnouncement
        ? `#/requester/Messages?message=${messageId}`
        : `#/${req.user.role === 'requestor' ? 'supervisor/Department%20Messages' : 'requester/Messages'}?userId=${req.user.id}&request=${requisitionId || ''}&message=${messageId}`;
      for (const userId of recipients) {
        await createNotification(connection, userId, isAnnouncement ? 'Department announcement' : 'New message',
          `${req.user.name}: ${body || 'A document was attached.'}`, link, 'message');
      }
      return { status: 201, body: { id: messageId, message: isAnnouncement ? 'Announcement sent to your Department.' : 'Message sent.' } };
    }, res, next);
  } catch (error) { return next(error); }
});

router.patch('/messages/:id/read', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  const messageId = parseId(req.params.id);
  if (!messageId) return res.status(400).json({ message: 'Invalid message identifier.' });
  try {
    const [result] = await pool.execute(
      `UPDATE message_recipients SET is_read = TRUE, read_at = NOW()
       WHERE message_id = ? AND user_id = ?`,
      [messageId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Message not found.' });
    await pool.execute(
      `UPDATE notifications SET is_read = TRUE
        WHERE user_id = ? AND is_read = FALSE AND category = 'message'
          AND link LIKE CONCAT('%message=', ?)`,
      [req.user.id, messageId]
    );
    return res.json({ message: 'Message marked as read.' });
  } catch (error) { return next(error); }
});

router.get('/messages/attachments/:attachmentId', allowRoles('supervisor', 'requestor'), async (req, res, next) => {
  const attachmentId = parseId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ message: 'Invalid attachment identifier.' });
  try {
    const [rows] = await pool.execute(
      `SELECT ma.file_name AS fileName, ma.mime_type AS mimeType, ma.file_size AS fileSize,
        ma.file_data AS fileData, m.sender_id AS senderId, m.department_id AS departmentId, m.is_announcement AS isAnnouncement
       FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
       WHERE ma.id = ? LIMIT 1`,
      [attachmentId]
    );
    const attachment = rows[0];
    if (!attachment) return res.status(404).json({ message: 'Attachment not found.' });
    const [readers] = await pool.execute(
      'SELECT user_id FROM message_recipients WHERE message_id = (SELECT message_id FROM message_attachments WHERE id = ?)',
      [attachmentId]
    );
    const allowed = attachment.senderId === req.user.id
      || readers.some((reader) => reader.user_id === req.user.id)
      || (req.user.role === 'supervisor' && attachment.departmentId === parseId(req.user.departmentId));
    if (!allowed) return res.status(403).json({ message: 'You do not have access to this attachment.' });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${String(attachment.fileName).replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Content-Length', attachment.fileSize);
    return res.send(attachment.fileData);
  } catch (error) { return next(error); }
});

router.get('/supervisor/stock', allowRoles('supervisor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const [rows] = await pool.execute(
      `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity, i.reorder_level AS reorderLevel,
        i.unit_cost AS unitCost, i.updated_at AS updatedAt,
        COALESCE((SELECT SUM(im.quantity) FROM inventory_movements im
          WHERE im.item_id = i.id AND im.movement_type = 'Issue'), 0) AS issuedQuantity,
        0 AS reservedQuantity,
        CASE WHEN i.quantity = 0 THEN 'Out of Stock'
          WHEN i.quantity <= i.reorder_level THEN 'Low Stock' ELSE 'Available' END AS stockStatus
       FROM items i
       WHERE i.department_id = ? OR i.department_id IS NULL
       ORDER BY i.category, i.name`,
      [department.id]
    );
    const search = text(req.query.search, 120).toLowerCase();
    const category = text(req.query.category, 100);
    const status = text(req.query.status, 30);
    let items = rows.map((row) => ({ ...row, issuedQuantity: Number(row.issuedQuantity) || 0, unitCost: Number(row.unitCost) }));
    if (search) items = items.filter((item) => `${item.sku} ${item.name} ${item.category}`.toLowerCase().includes(search));
    if (category) items = items.filter((item) => item.category === category);
    if (status) items = items.filter((item) => item.stockStatus === status);
    return res.json({
      department,
      items,
      categories: [...new Set(rows.map((row) => row.category))].sort(),
      message: 'Read-only view of the existing Inventory module. Reserved quantities are not tracked in this system.'
    });
  } catch (error) { return next(error); }
});

router.get('/supervisor/stock/:id', allowRoles('supervisor'), async (req, res, next) => {
  try {
    const department = await assignedDepartment(req, res);
    if (!department) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid stock item identifier.' });
    const [rows] = await pool.execute(
      `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity, i.reorder_level AS reorderLevel,
        i.unit_cost AS unitCost, i.updated_at AS updatedAt, d.name AS department,
        COALESCE((SELECT SUM(im.quantity) FROM inventory_movements im
          WHERE im.item_id = i.id AND im.movement_type = 'Issue'), 0) AS issuedQuantity,
        CASE WHEN i.quantity = 0 THEN 'Out of Stock'
          WHEN i.quantity <= i.reorder_level THEN 'Low Stock' ELSE 'Available' END AS stockStatus
       FROM items i LEFT JOIN departments d ON d.id = i.department_id
       WHERE i.id = ? AND (i.department_id = ? OR i.department_id IS NULL) LIMIT 1`,
      [id, department.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Stock item not found for your Department.' });
    const [movements] = await pool.execute(
      `SELECT id, movement_type AS movementType, quantity, source, balance_after AS balanceAfter, created_at AS createdAt,
        (SELECT name FROM users WHERE users.id = inventory_movements.user_id) AS actor
       FROM inventory_movements WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
      [id]
    );
    return res.json({ item: rows[0], movements });
  } catch (error) { return next(error); }
});

export { PROCUREMENT_READY_STATUSES };
export default router;

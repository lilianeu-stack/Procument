import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { errorCode, log } from '../lib/logger.js';
import { USER_ROLES } from '../utils/roles.js';

// One shared pool for the whole process. ESM module caching means server.js,
// app.js and every route module all receive this exact same instance.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 100,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  decimalNumbers: true
});

pool.on('connection', (connection) => {
  // TIMESTAMP and DATETIME values must mean one thing throughout the system.
  // The API stores UTC and the frontend converts to the configured display
  // timezone, so pin each pooled session to UTC before it runs application SQL.
  // The pool forwards the core connection here, which uses the callback API.
  connection.query("SET time_zone = '+00:00'", (error) => {
    if (error) log('WARN', `Could not set the MySQL session timezone (${errorCode(error)}).`);
  });
  connection.on('error', (error) => {
    log('WARN', `A MySQL connection was interrupted (${errorCode(error)}); the pool will reconnect on demand.`);
  });
});

// Real connectivity + authentication check: mysql2 authenticates when a
// connection is acquired, and SELECT 1 proves the connection can run queries.
export async function verifyDatabaseConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    return true;
  } finally {
    connection.release();
  }
}

// Idempotent schema extensions for existing installations. Fresh installs get
// these columns from backend/database/schema.sql as well.
const REQUISITION_STATUSES = [
  'Draft', 'Submitted', 'Pending Supervisor Approval', 'Information Required',
  'Approved by Supervisor', 'Rejected by Supervisor', 'Forwarded to Procurement',
  'Under Procurement Review', 'Procurement Approved', 'Procurement Rejected',
  'Processing', 'Completed', 'Cancelled',
  // Legacy statuses are retained so existing procurement records keep working.
  'Pending', 'Approved', 'Rejected', 'In procurement'
];

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Boolean(rows[0]?.total);
}

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Boolean(rows[0]?.total);
}

async function constraintExists(table, constraint) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, constraint]
  );
  return Boolean(rows[0]?.total);
}

async function indexExists(table, index) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Boolean(rows[0]?.total);
}

// Departments form a two-level hierarchy: department -> subdepartment. Users
// are assigned to subdepartments. Idempotent, so it is safe on every startup.
export async function seedDepartmentHierarchy() {
  const findId = async (name) => {
    const [rows] = await pool.execute('SELECT id FROM departments WHERE name = ? LIMIT 1', [name]);
    return rows[0]?.id || null;
  };

  const ensure = async (name, parentName = null) => {
    const parentId = parentName ? await findId(parentName) : null;
    const existingId = await findId(name);
    if (!existingId) {
      const [result] = await pool.execute(
        'INSERT INTO departments (name, parent_id) VALUES (?, ?)', [name, parentId]
      );
      return result.insertId;
    }
    if (parentName && parentId) {
      // Only adopt legacy flat departments; never move a subdepartment that
      // an administrator has already placed.
      await pool.execute(
        'UPDATE departments SET parent_id = ? WHERE id = ? AND parent_id IS NULL', [parentId, existingId]
      );
    }
    return existingId;
  };

  for (const name of ['Administration', 'Education', 'Facilities', 'Finance']) await ensure(name);

  // Keep existing records by converting the old flat departments into
  // subdepartments instead of deleting them.
  await ensure('Administration Office', 'Administration');
  await ensure('Procurement', 'Administration');
  await ensure('Stores', 'Facilities');

  // IT lives inside Facilities.
  const itId = await findId('IT');
  const legacyItId = await findId('IT Department');
  if (!itId && legacyItId) {
    const facilitiesId = await findId('Facilities');
    await pool.execute('UPDATE departments SET name = ?, parent_id = ? WHERE id = ?', ['IT', facilitiesId, legacyItId]);
  } else {
    await ensure('IT', 'Facilities');
  }
}

export async function applySchemaMigrations() {
  // Pool connections already set UTC; this also covers callers that use an
  // externally supplied connection during startup or tests.
  await pool.query("SET time_zone = '+00:00'");

  const [quotationItemTables] = await pool.query(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'quotation_items'"
  );
  if (!Number(quotationItemTables[0]?.total)) {
    await pool.query(`
      CREATE TABLE quotation_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        quotation_id INT UNSIGNED NOT NULL,
        requisition_item_id INT UNSIGNED NULL,
        item_name VARCHAR(180) NOT NULL,
        description TEXT NULL,
        quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
        unit VARCHAR(30) NOT NULL DEFAULT 'unit',
        unit_price DECIMAL(12,2) NOT NULL,
        line_total DECIMAL(12,2) NOT NULL,
        comment TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_quotation_item (quotation_id, requisition_item_id),
        CONSTRAINT fk_quotation_item_quote FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
      )
    `);
  }

  // RFQ deadlines include an hour and minute, so the stored column must keep
  // the time component instead of truncating it to a date.
  const [rfqDueDateColumns] = await pool.query(
    "SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'rfqs' AND column_name = 'due_date'"
  );
  if (rfqDueDateColumns[0]?.DATA_TYPE === 'date') {
    await pool.query('ALTER TABLE rfqs MODIFY due_date DATETIME NULL');
  }

  // Older installations predate this table but still run the column additions
  // below. Create it first so the ALTERs are safe; the later table bootstrap
  // is idempotent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requisition_email_threads (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      requisition_id INT UNSIGNED NOT NULL,
      token CHAR(32) NOT NULL,
      recipient_email VARCHAR(190) NOT NULL,
      recipient_phone VARCHAR(50) NULL,
      message TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      response_submitted_at DATETIME NULL,
      CONSTRAINT uq_requisition_email_thread_token UNIQUE (token),
      CONSTRAINT fk_requisition_email_thread_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
      CONSTRAINT fk_requisition_email_thread_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  const additions = [
    { table: 'departments', column: 'description', ddl: 'ALTER TABLE departments ADD COLUMN description VARCHAR(255) NULL AFTER name' },
    { table: 'departments', column: 'parent_id', ddl: 'ALTER TABLE departments ADD COLUMN parent_id INT UNSIGNED NULL AFTER description' },
    { table: 'users', column: 'phone', ddl: 'ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER email' },
    { table: 'items', column: 'department_id', ddl: 'ALTER TABLE items ADD COLUMN department_id INT UNSIGNED NULL AFTER id' },
    { table: 'requisitions', column: 'title', ddl: 'ALTER TABLE requisitions ADD COLUMN title VARCHAR(180) NULL AFTER department_id' },
    { table: 'requisitions', column: 'required_by', ddl: 'ALTER TABLE requisitions ADD COLUMN required_by DATE NULL AFTER budget_code' },
    { table: 'requisitions', column: 'priority', ddl: "ALTER TABLE requisitions ADD COLUMN priority ENUM('Low','Medium','High','Urgent') NOT NULL DEFAULT 'Medium' AFTER budget_code" },
    { table: 'requisitions', column: 'supervisor_id', ddl: 'ALTER TABLE requisitions ADD COLUMN supervisor_id INT UNSIGNED NULL AFTER reviewed_at' },
    { table: 'requisitions', column: 'supervisor_decision', ddl: "ALTER TABLE requisitions ADD COLUMN supervisor_decision ENUM('Approved','Rejected','Information Required') NULL AFTER supervisor_id" },
    { table: 'requisitions', column: 'supervisor_decision_at', ddl: 'ALTER TABLE requisitions ADD COLUMN supervisor_decision_at DATETIME NULL AFTER supervisor_decision' },
    { table: 'requisitions', column: 'supervisor_notes', ddl: 'ALTER TABLE requisitions ADD COLUMN supervisor_notes TEXT NULL AFTER supervisor_decision_at' },
    { table: 'requisitions', column: 'information_response', ddl: 'ALTER TABLE requisitions ADD COLUMN information_response TEXT NULL AFTER supervisor_notes' },
    { table: 'requisitions', column: 'submitted_at', ddl: 'ALTER TABLE requisitions ADD COLUMN submitted_at DATETIME NULL AFTER information_response' },
    { table: 'requisitions', column: 'forwarded_at', ddl: 'ALTER TABLE requisitions ADD COLUMN forwarded_at DATETIME NULL AFTER submitted_at' },
    // Authoritative marker that a Department Supervisor explicitly forwarded the
    // request. A status alone is not enough: approval never forwards a document.
    { table: 'requisitions', column: 'forwarded_by_supervisor', ddl: 'ALTER TABLE requisitions ADD COLUMN forwarded_by_supervisor INT UNSIGNED NULL AFTER forwarded_at' },
    { table: 'requisition_items', column: 'description', ddl: 'ALTER TABLE requisition_items ADD COLUMN description TEXT NULL AFTER item_name' },
    { table: 'requisition_items', column: 'unit', ddl: "ALTER TABLE requisition_items ADD COLUMN unit VARCHAR(30) NOT NULL DEFAULT 'unit' AFTER quantity" },

    // Official material-request form fields. The form's purpose maps to the
    // existing justification column; these two columns carry only new data.
    { table: 'requisitions', column: 'location', ddl: 'ALTER TABLE requisitions ADD COLUMN location VARCHAR(255) NULL AFTER title' },
    { table: 'requisition_items', column: 'remarks', ddl: 'ALTER TABLE requisition_items ADD COLUMN remarks TEXT NULL AFTER description' },

    // Registered supplier address used by the official purchase-order form.
    { table: 'suppliers', column: 'address', ddl: 'ALTER TABLE suppliers ADD COLUMN address VARCHAR(255) NULL AFTER phone' },
    { table: 'suppliers', column: 'city', ddl: 'ALTER TABLE suppliers ADD COLUMN city VARCHAR(60) NULL AFTER address' },
    { table: 'suppliers', column: 'district', ddl: 'ALTER TABLE suppliers ADD COLUMN district VARCHAR(60) NULL AFTER city' },
    { table: 'suppliers', column: 'sector', ddl: 'ALTER TABLE suppliers ADD COLUMN sector VARCHAR(60) NULL AFTER district' },
    { table: 'suppliers', column: 'cell', ddl: 'ALTER TABLE suppliers ADD COLUMN cell VARCHAR(60) NULL AFTER sector' },

    // Official purchase-order document fields. Existing rows receive safe
    // defaults and keep their historical status, reference and amounts.
    { table: 'purchase_orders', column: 'type', ddl: "ALTER TABLE purchase_orders ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'Standard' AFTER supplier_id" },
    { table: 'purchase_orders', column: 'supplier_contact', ddl: 'ALTER TABLE purchase_orders ADD COLUMN supplier_contact VARCHAR(150) NULL AFTER type' },
    { table: 'purchase_orders', column: 'supplier_address', ddl: 'ALTER TABLE purchase_orders ADD COLUMN supplier_address VARCHAR(255) NULL AFTER supplier_contact' },
    // Uploaded signature images are stored as processed WebP data URLs so the
    // official document can print them without a second authenticated request.
    { table: 'purchase_orders', column: 'prepared_signature', ddl: 'ALTER TABLE purchase_orders ADD COLUMN prepared_signature MEDIUMTEXT NULL AFTER supplier_address' },
    { table: 'purchase_orders', column: 'approved_signature', ddl: 'ALTER TABLE purchase_orders ADD COLUMN approved_signature MEDIUMTEXT NULL AFTER prepared_signature' },
    { table: 'purchase_orders', column: 'subtotal', ddl: 'ALTER TABLE purchase_orders ADD COLUMN subtotal DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER approved_signature' },
    { table: 'purchase_orders', column: 'vat_rate', ddl: 'ALTER TABLE purchase_orders ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER subtotal' },
    { table: 'purchase_orders', column: 'vat_amount', ddl: 'ALTER TABLE purchase_orders ADD COLUMN vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER vat_rate' },
    { table: 'purchase_orders', column: 'amount_in_words', ddl: 'ALTER TABLE purchase_orders ADD COLUMN amount_in_words VARCHAR(500) NULL AFTER vat_amount' },
    { table: 'purchase_order_items', column: 'description', ddl: 'ALTER TABLE purchase_order_items ADD COLUMN description TEXT NULL AFTER item_name' },
    { table: 'purchase_order_items', column: 'unit', ddl: "ALTER TABLE purchase_order_items ADD COLUMN unit VARCHAR(30) NOT NULL DEFAULT 'unit' AFTER quantity" },

    // Audit and lifecycle metadata. `updated_at` is maintained by MySQL and is
    // never accepted from a request body.
    { table: 'departments', column: 'updated_at', ddl: 'ALTER TABLE departments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'users', column: 'updated_at', ddl: 'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'users', column: 'last_login_at', ddl: 'ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER updated_at' },
    // Self-service profile photos store only a safe storage reference here.
    { table: 'users', column: 'profile_photo', ddl: 'ALTER TABLE users ADD COLUMN profile_photo VARCHAR(255) NULL AFTER last_login_at' },
    { table: 'suppliers', column: 'updated_at', ddl: 'ALTER TABLE suppliers ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'requisitions', column: 'updated_at', ddl: 'ALTER TABLE requisitions ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'requisitions', column: 'procurement_decision_at', ddl: 'ALTER TABLE requisitions ADD COLUMN procurement_decision_at DATETIME NULL AFTER forwarded_by_supervisor' },
    { table: 'requisitions', column: 'completed_at', ddl: 'ALTER TABLE requisitions ADD COLUMN completed_at DATETIME NULL AFTER procurement_decision_at' },
    { table: 'requisition_attachments', column: 'updated_at', ddl: 'ALTER TABLE requisition_attachments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'requisition_activity', column: 'previous_status', ddl: 'ALTER TABLE requisition_activity ADD COLUMN previous_status VARCHAR(80) NULL AFTER details' },
    { table: 'requisition_activity', column: 'new_status', ddl: 'ALTER TABLE requisition_activity ADD COLUMN new_status VARCHAR(80) NULL AFTER previous_status' },
    { table: 'messages', column: 'updated_at', ddl: 'ALTER TABLE messages ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'inventory_movements', column: 'movement_at', ddl: 'ALTER TABLE inventory_movements ADD COLUMN movement_at DATETIME NULL AFTER balance_after' },
    { table: 'inventory_movements', column: 'direction', ddl: "ALTER TABLE inventory_movements ADD COLUMN direction ENUM('In','Out') NOT NULL DEFAULT 'In' AFTER movement_type" },
    { table: 'inventory_movements', column: 'reference_no', ddl: 'ALTER TABLE inventory_movements ADD COLUMN reference_no VARCHAR(40) NULL AFTER quantity' },
    { table: 'inventory_movements', column: 'description', ddl: 'ALTER TABLE inventory_movements ADD COLUMN description TEXT NULL AFTER source' },
    { table: 'inventory_movements', column: 'requester_id', ddl: 'ALTER TABLE inventory_movements ADD COLUMN requester_id INT UNSIGNED NULL AFTER description' },
    { table: 'inventory_movements', column: 'received_by', ddl: 'ALTER TABLE inventory_movements ADD COLUMN received_by VARCHAR(150) NULL AFTER requester_id' },
    { table: 'inventory_movements', column: 'department_id', ddl: 'ALTER TABLE inventory_movements ADD COLUMN department_id INT UNSIGNED NULL AFTER requester_id' },
    { table: 'inventory_movements', column: 'store_request_id', ddl: 'ALTER TABLE inventory_movements ADD COLUMN store_request_id INT UNSIGNED NULL AFTER department_id' },
    { table: 'inventory_movements', column: 'idempotency_key', ddl: 'ALTER TABLE inventory_movements ADD COLUMN idempotency_key VARCHAR(80) NULL AFTER store_request_id' },
    { table: 'rfqs', column: 'issued_at', ddl: 'ALTER TABLE rfqs ADD COLUMN issued_at DATETIME NULL AFTER selected_quotation_id' },
    { table: 'rfqs', column: 'message', ddl: 'ALTER TABLE rfqs ADD COLUMN message TEXT NULL AFTER issued_at' },
    { table: 'rfqs', column: 'instructions', ddl: 'ALTER TABLE rfqs ADD COLUMN instructions TEXT NULL AFTER due_date' },
    { table: 'rfqs', column: 'terms', ddl: 'ALTER TABLE rfqs ADD COLUMN terms TEXT NULL AFTER instructions' },
    // Prevents duplicate RFQs when the administrator double-clicks Send RFQ or
    // retries a request whose first response was lost.
    { table: 'rfqs', column: 'idempotency_key', ddl: 'ALTER TABLE rfqs ADD COLUMN idempotency_key VARCHAR(80) NULL AFTER reference' },
    { table: 'rfqs', column: 'closed_at', ddl: 'ALTER TABLE rfqs ADD COLUMN closed_at DATETIME NULL AFTER issued_at' },
    { table: 'rfqs', column: 'updated_at', ddl: 'ALTER TABLE rfqs ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'quotations', column: 'submitted_at', ddl: 'ALTER TABLE quotations ADD COLUMN submitted_at DATETIME NULL AFTER notes' },
    { table: 'quotations', column: 'updated_at', ddl: 'ALTER TABLE quotations ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    // Each outbound response form keeps its original email metadata so an old
    // link can be resent safely with the current public application address.
    { table: 'requisition_email_threads', column: 'recipient_phone', ddl: 'ALTER TABLE requisition_email_threads ADD COLUMN recipient_phone VARCHAR(50) NULL AFTER recipient_email' },
    { table: 'requisition_email_threads', column: 'message', ddl: 'ALTER TABLE requisition_email_threads ADD COLUMN message TEXT NULL AFTER recipient_phone' },
    { table: 'requisition_email_threads', column: 'response_submitted_at', ddl: 'ALTER TABLE requisition_email_threads ADD COLUMN response_submitted_at DATETIME NULL AFTER created_at' },
    { table: 'purchase_orders', column: 'approved_at', ddl: 'ALTER TABLE purchase_orders ADD COLUMN approved_at DATETIME NULL AFTER reviewed_by' },
    { table: 'purchase_orders', column: 'updated_at', ddl: 'ALTER TABLE purchase_orders ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'purchase_orders', column: 'supplier_pricing_status', ddl: "ALTER TABLE purchase_orders ADD COLUMN supplier_pricing_status VARCHAR(30) NOT NULL DEFAULT 'Not requested' AFTER status" },
    { table: 'goods_receipts', column: 'expected_at', ddl: 'ALTER TABLE goods_receipts ADD COLUMN expected_at DATETIME NULL AFTER received_by' },
    { table: 'goods_receipts', column: 'updated_at', ddl: 'ALTER TABLE goods_receipts ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER received_at' },
    { table: 'invoices', column: 'invoice_date', ddl: 'ALTER TABLE invoices ADD COLUMN invoice_date DATE NULL AFTER status' },
    { table: 'invoices', column: 'due_date', ddl: 'ALTER TABLE invoices ADD COLUMN due_date DATE NULL AFTER invoice_date' },
    { table: 'invoices', column: 'submitted_at', ddl: 'ALTER TABLE invoices ADD COLUMN submitted_at DATETIME NULL AFTER reviewed_by' },
    { table: 'invoices', column: 'approved_at', ddl: 'ALTER TABLE invoices ADD COLUMN approved_at DATETIME NULL AFTER submitted_at' },
    { table: 'invoices', column: 'paid_at', ddl: 'ALTER TABLE invoices ADD COLUMN paid_at DATETIME NULL AFTER approved_at' },
    { table: 'invoices', column: 'updated_at', ddl: 'ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'store_requests', column: 'submitted_at', ddl: 'ALTER TABLE store_requests ADD COLUMN submitted_at DATETIME NULL AFTER reviewed_by' },
    { table: 'store_requests', column: 'approved_at', ddl: 'ALTER TABLE store_requests ADD COLUMN approved_at DATETIME NULL AFTER submitted_at' },
    { table: 'store_requests', column: 'issued_at', ddl: 'ALTER TABLE store_requests ADD COLUMN issued_at DATETIME NULL AFTER approved_at' },
    { table: 'store_requests', column: 'required_by', ddl: 'ALTER TABLE store_requests ADD COLUMN required_by DATE NULL AFTER issued_at' },
    { table: 'store_requests', column: 'updated_at', ddl: 'ALTER TABLE store_requests ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'notifications', column: 'updated_at', ddl: 'ALTER TABLE notifications ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
    { table: 'notifications', column: 'category', ddl: "ALTER TABLE notifications ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'general' AFTER link" },
    { table: 'audit_logs', column: 'previous_status', ddl: 'ALTER TABLE audit_logs ADD COLUMN previous_status VARCHAR(80) NULL AFTER details' },
    { table: 'audit_logs', column: 'new_status', ddl: 'ALTER TABLE audit_logs ADD COLUMN new_status VARCHAR(80) NULL AFTER previous_status' },
    // Recommendation details captured when a committee form is emailed. Older
    // installations need these columns; fresh tables create them directly.
    { table: 'rfq_committee_reviews', column: 'recommended_supplier_id', ddl: 'ALTER TABLE rfq_committee_reviews ADD COLUMN recommended_supplier_id INT UNSIGNED NULL AFTER recipient_email' },
    { table: 'rfq_committee_reviews', column: 'reason', ddl: 'ALTER TABLE rfq_committee_reviews ADD COLUMN reason TEXT NULL AFTER recommended_supplier_id' }
  ];
  for (const migration of additions) {
    if (!(await tableExists(migration.table))) continue;
    if (!(await columnExists(migration.table, migration.column))) await pool.query(migration.ddl);
  }
  await pool.query("UPDATE inventory_movements SET direction = 'Out' WHERE movement_type = 'Issue'");
  await pool.query("UPDATE inventory_movements SET reference_no = CONCAT('LEGACY-', id) WHERE reference_no IS NULL");

  const foreignKeys = [
    { table: 'rfq_committee_reviews', name: 'fk_rfq_committee_review_supplier', ddl: 'ALTER TABLE rfq_committee_reviews ADD CONSTRAINT fk_rfq_committee_review_supplier FOREIGN KEY (recommended_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL' },
    { table: 'departments', name: 'fk_departments_parent', ddl: 'ALTER TABLE departments ADD CONSTRAINT fk_departments_parent FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE RESTRICT' },
    { table: 'items', name: 'fk_items_department', ddl: 'ALTER TABLE items ADD CONSTRAINT fk_items_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL' },
    { table: 'requisitions', name: 'fk_req_supervisor', ddl: 'ALTER TABLE requisitions ADD CONSTRAINT fk_req_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL' },
    { table: 'requisitions', name: 'fk_req_forwarded_by', ddl: 'ALTER TABLE requisitions ADD CONSTRAINT fk_req_forwarded_by FOREIGN KEY (forwarded_by_supervisor) REFERENCES users(id) ON DELETE SET NULL' },
    { table: 'inventory_movements', name: 'fk_movement_requester', ddl: 'ALTER TABLE inventory_movements ADD CONSTRAINT fk_movement_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL' },
    { table: 'inventory_movements', name: 'fk_movement_department', ddl: 'ALTER TABLE inventory_movements ADD CONSTRAINT fk_movement_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL' },
    { table: 'inventory_movements', name: 'fk_movement_store_request', ddl: 'ALTER TABLE inventory_movements ADD CONSTRAINT fk_movement_store_request FOREIGN KEY (store_request_id) REFERENCES store_requests(id) ON DELETE SET NULL' }
  ];
  for (const key of foreignKeys) {
    if (!(await tableExists(key.table))) continue;
    if (!(await constraintExists(key.table, key.name))) await pool.query(key.ddl);
  }

  const indexes = [
    { table: 'requisitions', name: 'idx_req_requester_status', ddl: 'CREATE INDEX idx_req_requester_status ON requisitions (requester_id, status)' },
    { table: 'requisitions', name: 'idx_req_department_status', ddl: 'CREATE INDEX idx_req_department_status ON requisitions (department_id, status)' },
    { table: 'requisition_activity', name: 'idx_req_activity_date', ddl: 'CREATE INDEX idx_req_activity_date ON requisition_activity (requisition_id, created_at)' },
    { table: 'messages', name: 'idx_messages_thread', ddl: 'CREATE INDEX idx_messages_thread ON messages (department_id, sender_id, recipient_id, created_at)' },
    { table: 'notifications', name: 'idx_notifications_user_date', ddl: 'CREATE INDEX idx_notifications_user_date ON notifications (user_id, created_at)' },
    { table: 'inventory_movements', name: 'uq_inventory_movement_reference', ddl: 'CREATE UNIQUE INDEX uq_inventory_movement_reference ON inventory_movements (reference_no)' },
    { table: 'inventory_movements', name: 'uq_inventory_movement_idempotency', ddl: 'CREATE UNIQUE INDEX uq_inventory_movement_idempotency ON inventory_movements (idempotency_key)' },
    { table: 'inventory_movements', name: 'idx_inventory_movement_requester_date', ddl: 'CREATE INDEX idx_inventory_movement_requester_date ON inventory_movements (requester_id, movement_at)' },
    { table: 'inventory_movements', name: 'idx_inventory_movement_request', ddl: 'CREATE INDEX idx_inventory_movement_request ON inventory_movements (store_request_id)' },
    { table: 'rfqs', name: 'uq_rfqs_idempotency', ddl: 'CREATE UNIQUE INDEX uq_rfqs_idempotency ON rfqs (idempotency_key)' }
  ];
  for (const index of indexes) {
    if (!(await indexExists(index.table, index.name))) await pool.query(index.ddl);
  }

  const enumUpdates = [
    { table: 'users', column: 'role', values: USER_ROLES, required: "'storekeeper'", definition: `ENUM(${USER_ROLES.map((role) => `'${role}'`).join(', ')}) NOT NULL DEFAULT 'requestor'` },
    { table: 'requisitions', column: 'status', values: REQUISITION_STATUSES, required: "'Forwarded to Procurement'", definition: `ENUM(${REQUISITION_STATUSES.map((status) => `'${status}'`).join(', ')}) NOT NULL DEFAULT 'Pending'` },
    { table: 'rfqs', column: 'status', values: ['Draft', 'Sent', 'Evaluating', 'Awarded', 'Closed'], required: "'Draft'", definition: "ENUM('Draft','Sent','Evaluating','Awarded','Closed') NOT NULL DEFAULT 'Sent'" }
  ];
  for (const update of enumUpdates) {
    const [rows] = await pool.query(
      `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [update.table, update.column]
    );
    const columnType = rows[0]?.columnType || '';
    if (columnType && !columnType.includes(update.required)) {
      await pool.query(`ALTER TABLE ${update.table} MODIFY COLUMN ${update.column} ${update.definition}`);
    }
  }

  await pool.query('ALTER TABLE notifications MODIFY COLUMN link VARCHAR(255) NULL');

  const tables = [
    `CREATE TABLE IF NOT EXISTS application_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value JSON NOT NULL,
      updated_by INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_app_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS procurement_committee_members (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      phone VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS requisition_attachments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      requisition_id INT UNSIGNED NOT NULL,
      uploader_id INT UNSIGNED NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(150) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      file_data LONGBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_req_attach_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
      CONSTRAINT fk_req_attach_user FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS requisition_activity (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      requisition_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_req_activity_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
      CONSTRAINT fk_req_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      department_id INT UNSIGNED NOT NULL,
      requisition_id INT UNSIGNED NULL,
      sender_id INT UNSIGNED NOT NULL,
      recipient_id INT UNSIGNED NULL,
      body TEXT NOT NULL,
      is_announcement BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_messages_department FOREIGN KEY (department_id) REFERENCES departments(id),
      CONSTRAINT fk_messages_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL,
      CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id),
      CONSTRAINT fk_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS message_recipients (
      message_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at DATETIME NULL,
      PRIMARY KEY (message_id, user_id),
      CONSTRAINT fk_msg_recipient_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_msg_recipient_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS message_attachments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      message_id BIGINT UNSIGNED NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(150) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      file_data LONGBLOB NOT NULL,
      CONSTRAINT fk_msg_attach_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS rfq_email_deliveries (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      rfq_id INT UNSIGNED NOT NULL,
      supplier_id INT UNSIGNED NOT NULL,
      recipient_email VARCHAR(190) NOT NULL,
      rfq_reference VARCHAR(30) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Pending',
      provider_message_id VARCHAR(255) NULL,
      provider_response VARCHAR(255) NULL,
      error_details TEXT NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      sent_at DATETIME NULL,
      accepted_at DATETIME NULL,
      delivered_at DATETIME NULL,
      bounced_at DATETIME NULL,
      opened_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_rfq_email_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      CONSTRAINT fk_rfq_email_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      INDEX idx_rfq_email_status (rfq_id, status)
    )`,
    `CREATE TABLE IF NOT EXISTS rfq_committee_reviews (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      rfq_id INT UNSIGNED NOT NULL,
      token CHAR(64) NOT NULL UNIQUE,
      committee_member_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NULL,
      recipient_name VARCHAR(200) NOT NULL,
      recipient_email VARCHAR(190) NOT NULL,
      recommended_supplier_id INT UNSIGNED NULL,
      reason TEXT NULL,
      report_snapshot JSON NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      sent_at DATETIME NULL,
      opened_at DATETIME NULL,
      submitted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT uq_rfq_committee_review_token UNIQUE (token),
      CONSTRAINT fk_rfq_committee_review_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      CONSTRAINT fk_rfq_committee_review_member FOREIGN KEY (committee_member_id) REFERENCES procurement_committee_members(id) ON DELETE SET NULL,
      CONSTRAINT fk_rfq_committee_review_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_rfq_committee_review_supplier FOREIGN KEY (recommended_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      INDEX idx_rfq_committee_review_rfq (rfq_id, status)
    )`,
    `CREATE TABLE IF NOT EXISTS rfq_committee_decisions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      review_id BIGINT UNSIGNED NOT NULL,
      supplier_id INT UNSIGNED NOT NULL,
      decision ENUM('Accepted','Rejected') NOT NULL,
      reason TEXT NULL,
      responder_name VARCHAR(150) NULL,
      decided_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_rfq_committee_decision UNIQUE (review_id, supplier_id),
      CONSTRAINT fk_rfq_committee_decision_review FOREIGN KEY (review_id) REFERENCES rfq_committee_reviews(id) ON DELETE CASCADE,
      CONSTRAINT fk_rfq_committee_decision_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )`,
    `CREATE TABLE IF NOT EXISTS google_email_connection (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      mailbox VARCHAR(190) NOT NULL,
      refresh_token MEDIUMTEXT NOT NULL,
      token_iv CHAR(24) NOT NULL,
      token_tag CHAR(32) NOT NULL,
      granted_scopes TEXT NOT NULL,
      connected_by INT UNSIGNED NULL,
      connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_google_email_connected_by FOREIGN KEY (connected_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS google_email_oauth_states (
      state_hash CHAR(64) NOT NULL PRIMARY KEY,
      created_by INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_google_email_state_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_google_email_state_expiry (expires_at)
    )`,
    `CREATE TABLE IF NOT EXISTS google_email_messages (
      gmail_message_id VARCHAR(190) NOT NULL PRIMARY KEY,
      thread_id VARCHAR(190) NOT NULL,
      sender VARCHAR(500) NOT NULL DEFAULT '',
      recipient VARCHAR(500) NOT NULL DEFAULT '',
      subject VARCHAR(998) NOT NULL DEFAULT '',
      snippet VARCHAR(1000) NOT NULL DEFAULT '',
      body_text MEDIUMTEXT NOT NULL,
      labels JSON NOT NULL,
      unread BOOLEAN NOT NULL DEFAULT FALSE,
      received_at DATETIME NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_google_email_received (received_at)
    )`,
    `CREATE TABLE IF NOT EXISTS requisition_email_threads (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      requisition_id INT UNSIGNED NOT NULL,
      token CHAR(32) NOT NULL,
      recipient_email VARCHAR(190) NOT NULL,
      recipient_phone VARCHAR(50) NULL,
      message TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      response_submitted_at DATETIME NULL,
      CONSTRAINT uq_requisition_email_thread_token UNIQUE (token),
      CONSTRAINT fk_requisition_email_thread_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
      CONSTRAINT fk_requisition_email_thread_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS requisition_email_comments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      requisition_id INT UNSIGNED NOT NULL,
      thread_id BIGINT UNSIGNED NULL,
      gmail_message_id VARCHAR(190) NOT NULL,
      sender VARCHAR(500) NOT NULL DEFAULT '',
      recipient VARCHAR(500) NOT NULL DEFAULT '',
      subject VARCHAR(998) NOT NULL DEFAULT '',
      comment TEXT NOT NULL,
      body_text MEDIUMTEXT NULL,
      received_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_requisition_email_comment_message UNIQUE (gmail_message_id),
      CONSTRAINT fk_requisition_email_comment_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
      CONSTRAINT fk_requisition_email_comment_thread FOREIGN KEY (thread_id) REFERENCES requisition_email_threads(id) ON DELETE SET NULL,
      INDEX idx_requisition_email_comment_req_date (requisition_id, received_at)
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_approval_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      purchase_order_id INT UNSIGNED NOT NULL,
      po_reference VARCHAR(30) NOT NULL,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      sender_user_id INT UNSIGNED NULL,
      sender_name VARCHAR(150) NOT NULL,
      sender_email VARCHAR(190) NOT NULL,
      recipient_user_id INT UNSIGNED NULL,
      recipient_name VARCHAR(150) NOT NULL,
      recipient_email VARCHAR(190) NOT NULL,
      recipient_role VARCHAR(40) NOT NULL,
      token_hash CHAR(64) NULL,
      status ENUM('Pending','Approved','Rejected','Revoked','Expired','Superseded') NOT NULL DEFAULT 'Pending',
      message VARCHAR(1000) NULL,
      sent_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      viewed_at DATETIME NULL,
      decided_at DATETIME NULL,
      decision_comment VARCHAR(2000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_po_approval_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_approval_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_po_approval_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uq_po_approval_token_hash (token_hash),
      INDEX idx_po_approval_order (purchase_order_id, created_at),
      INDEX idx_po_approval_status (status, expires_at)
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_pricing_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      reference VARCHAR(30) NOT NULL UNIQUE,
      purchase_order_id INT UNSIGNED NOT NULL,
      po_reference VARCHAR(30) NOT NULL,
      rfq_id INT UNSIGNED NULL,
      rfq_reference VARCHAR(30) NULL,
      requisition_id INT UNSIGNED NULL,
      requisition_reference VARCHAR(190) NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
      submission_deadline DATE NULL,
      message VARCHAR(1000) NULL,
      status ENUM('Open','Closed','Awarded','Cancelled') NOT NULL DEFAULT 'Open',
      created_by INT UNSIGNED NULL,
      awarded_response_id BIGINT UNSIGNED NULL,
      awarded_at DATETIME NULL,
      awarded_by INT UNSIGNED NULL,
      award_comment VARCHAR(2000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_po_pricing_request_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_pricing_request_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_po_pricing_request_order_status (purchase_order_id, status),
      INDEX idx_po_pricing_request_rfq (rfq_id)
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_pricing_responses (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      request_id BIGINT UNSIGNED NOT NULL,
      purchase_order_id INT UNSIGNED NOT NULL,
      supplier_id INT UNSIGNED NOT NULL,
      supplier_name VARCHAR(190) NOT NULL,
      supplier_email VARCHAR(190) NOT NULL,
      supplier_contact VARCHAR(190) NULL,
      supplier_address VARCHAR(500) NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      status ENUM('Pending','Invited','Opened','Draft','Submitted','Revoked','Expired','Email failed') NOT NULL DEFAULT 'Pending',
      email_status VARCHAR(40) NOT NULL DEFAULT 'Pending',
      email_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      provider_message_id VARCHAR(255) NULL,
      provider_response VARCHAR(255) NULL,
      email_error TEXT NULL,
      sent_at DATETIME NULL,
      accepted_at DATETIME NULL,
      delivered_at DATETIME NULL,
      bounced_at DATETIME NULL,
      opened_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      draft_saved_at DATETIME NULL,
      submitted_at DATETIME NULL,
      revoked_at DATETIME NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      other_charges DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      quotation_validity VARCHAR(120) NULL,
      delivery_lead_time VARCHAR(120) NULL,
      comments VARCHAR(2000) NULL,
      technical_remarks VARCHAR(2000) NULL,
      awarded TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_po_pricing_response_request FOREIGN KEY (request_id) REFERENCES purchase_order_pricing_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_pricing_response_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_pricing_response_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      UNIQUE KEY uq_po_pricing_response_supplier (request_id, supplier_id),
      INDEX idx_po_pricing_response_status_expiry (status, expires_at),
      INDEX idx_po_pricing_response_email_status (email_status),
      INDEX idx_po_pricing_response_provider_message (provider_message_id)
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_pricing_response_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      response_id BIGINT UNSIGNED NOT NULL,
      purchase_order_item_id INT UNSIGNED NOT NULL,
      item_no INT UNSIGNED NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      quantity DECIMAL(12,2) NOT NULL,
      unit VARCHAR(50) NOT NULL,
      unit_price DECIMAL(12,4) NULL,
      line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_po_pricing_item_response FOREIGN KEY (response_id) REFERENCES purchase_order_pricing_responses(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_pricing_item_order_line FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE CASCADE,
      UNIQUE KEY uq_po_pricing_item_line (response_id, purchase_order_item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_movement_attachments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      movement_id BIGINT UNSIGNED NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(150) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      file_data LONGBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_movement_attachment_movement FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT
    )`
  ];
  for (const ddl of tables) await pool.query(ddl);
  await seedDepartmentHierarchy();
}

export default pool;

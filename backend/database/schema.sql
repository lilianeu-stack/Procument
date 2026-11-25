CREATE DATABASE IF NOT EXISTS Procument
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE Procument;

-- Timestamps are stored in UTC. MySQL converts TIMESTAMP values from the
-- session timezone on write and back to the session timezone on read, so every
-- application connection pins the session to UTC.
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(50) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','supervisor','requestor','approver','procurement','storekeeper','finance','committee') NOT NULL DEFAULT 'requestor',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  profile_photo VARCHAR(255) NULL,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  contact_name VARCHAR(150) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(50) NULL,
  address VARCHAR(255) NULL,
  rating DECIMAL(2,1) NOT NULL DEFAULT 0,
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NULL,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  reorder_level INT UNSIGNED NOT NULL DEFAULT 10,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS requisitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  requester_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  title VARCHAR(180) NULL,
  location VARCHAR(255) NULL,
  justification TEXT NOT NULL,
  budget_code VARCHAR(60) NOT NULL,
  required_by DATE NULL,
  priority ENUM('Low','Medium','High','Urgent') NOT NULL DEFAULT 'Medium',
  status ENUM(
    'Draft','Submitted','Pending Supervisor Approval','Information Required',
    'Approved by Supervisor','Rejected by Supervisor','Forwarded to Procurement',
    'Under Procurement Review','Procurement Approved','Procurement Rejected',
    'Processing','Completed','Cancelled',
    'Pending','Approved','Rejected','In procurement'
  ) NOT NULL DEFAULT 'Pending',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  supervisor_id INT UNSIGNED NULL,
  supervisor_decision ENUM('Approved','Rejected','Information Required') NULL,
  supervisor_decision_at DATETIME NULL,
  supervisor_notes TEXT NULL,
  information_response TEXT NULL,
  submitted_at DATETIME NULL,
  forwarded_at DATETIME NULL,
  forwarded_by_supervisor INT UNSIGNED NULL,
  procurement_decision_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_req_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_forwarded_by FOREIGN KEY (forwarded_by_supervisor) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_req_requester_status (requester_id, status),
  INDEX idx_req_department_status (department_id, status)
);

CREATE TABLE IF NOT EXISTS requisition_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  remarks TEXT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  estimated_unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_req_items_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requisition_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  uploader_id INT UNSIGNED NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  file_data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_attach_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_attach_user FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS requisition_activity (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  details JSON NULL,
  previous_status VARCHAR(80) NULL,
  new_status VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_activity_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_req_activity_date (requisition_id, created_at)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NOT NULL,
  requisition_id INT UNSIGNED NULL,
  sender_id INT UNSIGNED NOT NULL,
  recipient_id INT UNSIGNED NULL,
  body TEXT NOT NULL,
  is_announcement BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_messages_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id),
  CONSTRAINT fk_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_messages_thread (department_id, sender_id, recipient_id, created_at)
);

CREATE TABLE IF NOT EXISTS message_recipients (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at DATETIME NULL,
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT fk_msg_recipient_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_recipient_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  file_data LONGBLOB NOT NULL,
  CONSTRAINT fk_msg_attach_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  movement_type ENUM('Receipt','Issue','Adjustment') NOT NULL,
  direction ENUM('In','Out') NOT NULL DEFAULT 'In',
  quantity INT UNSIGNED NOT NULL,
  reference_no VARCHAR(40) NULL,
  source VARCHAR(180) NOT NULL,
  description TEXT NULL,
  requester_id INT UNSIGNED NULL,
  received_by VARCHAR(150) NULL,
  department_id INT UNSIGNED NULL,
  store_request_id INT UNSIGNED NULL,
  idempotency_key VARCHAR(80) NULL,
  balance_after INT UNSIGNED NOT NULL,
  movement_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_movement_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_movement_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_movement_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  INDEX idx_movements_item_date (item_id, created_at),
  UNIQUE KEY uq_inventory_movement_reference (reference_no),
  UNIQUE KEY uq_inventory_movement_idempotency (idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_movement_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  movement_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  file_data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_attachment_movement FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS rfqs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  idempotency_key VARCHAR(80) NULL,
  requisition_id INT UNSIGNED NOT NULL,
  due_date DATE NULL,
  instructions TEXT NULL,
  terms TEXT NULL,
  status ENUM('Draft','Sent','Evaluating','Awarded','Closed') NOT NULL DEFAULT 'Sent',
  selected_quotation_id INT UNSIGNED NULL,
  issued_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_rfqs_idempotency UNIQUE (idempotency_key),
  CONSTRAINT fk_rfq_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
  CONSTRAINT fk_rfq_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rfq_suppliers (
  rfq_id INT UNSIGNED NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (rfq_id, supplier_id),
  CONSTRAINT fk_rfq_supplier_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_supplier_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS rfq_email_deliveries (
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
);

CREATE TABLE IF NOT EXISTS quotations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rfq_id INT UNSIGNED NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  delivery_days INT UNSIGNED NOT NULL,
  quality_score DECIMAL(3,1) NOT NULL DEFAULT 0,
  rating_score DECIMAL(3,1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  submitted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_quotation_supplier (rfq_id, supplier_id),
  CONSTRAINT fk_quote_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  rfq_id INT UNSIGNED NOT NULL,
  quotation_id INT UNSIGNED NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'Standard',
  supplier_contact VARCHAR(150) NULL,
  supplier_address VARCHAR(255) NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_in_words VARCHAR(500) NULL,
  total DECIMAL(12,2) NOT NULL,
  delivery_date DATE NULL,
  status ENUM('Pending approval','Approved','Rejected','Partially received','Received') NOT NULL DEFAULT 'Pending approval',
  supplier_pricing_status VARCHAR(30) NOT NULL DEFAULT 'Not requested',
  created_by INT UNSIGNED NOT NULL,
  reviewed_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs(id),
  CONSTRAINT fk_po_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_po_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_po_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  unit_price DECIMAL(12,4) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_po_line_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

-- One record per secure review link. It keeps the full send/view/decision/revoke
-- history without creating a second Purchase Order or duplicating its financials.
CREATE TABLE IF NOT EXISTS purchase_order_approval_requests (
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
);

-- Supplier pricing requests keep the original Purchase Order untouched. Each
-- supplier receives a unique bearer link whose raw token is never stored; only
-- its SHA-256 hash is kept for lookup.
CREATE TABLE IF NOT EXISTS purchase_order_pricing_requests (
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
);

CREATE TABLE IF NOT EXISTS purchase_order_pricing_responses (
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
);

CREATE TABLE IF NOT EXISTS purchase_order_pricing_response_items (
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
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  purchase_order_id INT UNSIGNED NULL,
  source VARCHAR(180) NOT NULL,
  received_by INT UNSIGNED NOT NULL,
  expected_at DATETIME NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grn_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_grn_user FOREIGN KEY (received_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goods_receipt_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  CONSTRAINT fk_grn_item_receipt FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_grn_item_catalog FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(60) NOT NULL,
  purchase_order_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('Pending','Approved','Paid','Rejected') NOT NULL DEFAULT 'Pending',
  invoice_date DATE NULL,
  due_date DATE NULL,
  submitted_by INT UNSIGNED NOT NULL,
  reviewed_by INT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_po_reference (purchase_order_id, reference),
  CONSTRAINT fk_invoice_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_invoice_submitter FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT fk_invoice_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  requester_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  purpose TEXT NOT NULL,
  status ENUM('Pending','Approved','Rejected','Issued') NOT NULL DEFAULT 'Pending',
  reviewed_by INT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  issued_at DATETIME NULL,
  required_by DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_store_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_store_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_request_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_request_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  issued_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_store_item_request FOREIGN KEY (store_request_id) REFERENCES store_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_item_catalog FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(500) NOT NULL,
  link VARCHAR(255) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_date (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  details JSON NULL,
  previous_status VARCHAR(80) NULL,
  new_status VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity_date (entity_type, entity_id, created_at)
);

INSERT IGNORE INTO departments (name) VALUES
  ('Finance'), ('Procurement'), ('Stores'), ('Facilities'), ('Education'), ('Administration');

INSERT IGNORE INTO suppliers (id, name, contact_name, email, phone, rating) VALUES
  (1, 'Bright Office Supplies', 'Grace Niyonzima', 'sales@brightoffice.example', '+250 788 120 400', 4.8),
  (2, 'TechSource Rwanda', 'Eric Habimana', 'hello@techsource.example', '+250 788 240 110', 4.6),
  (3, 'Campus Furnishings', 'Aline Mukamana', 'orders@campusfurnishings.example', '+250 788 630 220', 4.3);

INSERT IGNORE INTO items (sku, name, category, unit, quantity, reorder_level, unit_cost) VALUES
  ('IT-0142', 'Laptop computer', 'Electronics', 'unit', 24, 10, 950.00),
  ('OF-0088', 'Ergonomic office chair', 'Furniture', 'unit', 8, 15, 145.00),
  ('OF-0019', 'A4 copy paper (ream)', 'Stationery', 'ream', 136, 40, 4.50),
  ('IT-0210', 'Wireless keyboard', 'Electronics', 'unit', 42, 12, 28.00),
  ('CL-0034', 'Whiteboard marker set', 'Stationery', 'set', 17, 20, 8.00),
  ('OF-0111', 'Student desk', 'Furniture', 'unit', 31, 8, 88.00);

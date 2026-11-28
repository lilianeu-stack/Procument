CREATE DATABASE IF NOT EXISTS Procument
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE Procument;

-- Timestamps are stored in UTC. MySQL converts TIMESTAMP values from the
-- session timezone on write and back to the session timezone on read, so every
-- application connection pins the session to UTC.
SET time_zone = '+00:00';

-- One-time data conversions are recorded here so a server restart cannot apply
-- a historical backfill to newly created records.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  parent_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_departments_parent FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE RESTRICT
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
  city VARCHAR(60) NULL,
  district VARCHAR(60) NULL,
  sector VARCHAR(60) NULL,
  cell VARCHAR(60) NULL,
  rating DECIMAL(2,1) NOT NULL DEFAULT 0,
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS procurement_committee_members (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NULL,
  storage_location VARCHAR(150) NULL,
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
    'Processing','Awaiting Stock Issue','Partially Issued','Returned to Supervisor',
    'Completed','Cancelled',
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
  routing_destination ENUM('Procurement','Stock Keeper','Split') NULL,
  routing_comments TEXT NULL,
  routed_by_supervisor INT UNSIGNED NULL,
  routed_at DATETIME NULL,
  procurement_decision_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_req_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_forwarded_by FOREIGN KEY (forwarded_by_supervisor) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_routed_by FOREIGN KEY (routed_by_supervisor) REFERENCES users(id) ON DELETE SET NULL,
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

-- Supervisor routing allocations. One requested line can be split between the
-- Stock Keeper (available quantity) and Procurement (quantity to purchase).
-- Every quantity remains traceable to the original requisition item.
CREATE TABLE IF NOT EXISTS requisition_routing_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  requisition_item_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NULL,
  destination ENUM('Procurement','Stock Keeper') NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  available_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  issued_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  returned_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('Pending','Issued','Returned') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_routing_line_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_routing_line_item_line FOREIGN KEY (requisition_item_id) REFERENCES requisition_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_routing_line_catalog_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
  INDEX idx_routing_line_requisition (requisition_id, destination, status)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NULL,
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
  CONSTRAINT fk_msg_recipient_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_msg_recipient_unread (user_id, is_read, message_id)
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
  purchase_order_id INT UNSIGNED NULL,
  goods_receipt_id INT UNSIGNED NULL,
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
  due_date DATETIME NULL,
  instructions TEXT NULL,
  terms TEXT NULL,
  status ENUM('Draft','Sent','Evaluating','Awarded','Closed') NOT NULL DEFAULT 'Sent',
  selected_quotation_id INT UNSIGNED NULL,
  issued_at DATETIME NULL,
  message TEXT NULL,
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

-- One token per Committee member and RFQ. The same token is reused if the
-- batch is resent, so each public form accepts exactly one decision set.
CREATE TABLE IF NOT EXISTS rfq_committee_reviews (
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
);

CREATE TABLE IF NOT EXISTS rfq_committee_decisions (
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

CREATE TABLE IF NOT EXISTS quotation_items (
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
  prepared_signature MEDIUMTEXT NULL,
  approved_signature MEDIUMTEXT NULL,
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

-- Storekeeper pre-delivery queue. One row is created for each purchase-order
-- line when the signed official PO is sent to its supplier. Decisions are
-- terminal: rejected lines never create stock, accepted lines create one stock
-- receipt against the inventory catalogue.
CREATE TABLE IF NOT EXISTS purchase_order_delivery_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT UNSIGNED NOT NULL,
  purchase_order_item_id INT UNSIGNED NOT NULL,
  po_reference VARCHAR(30) NOT NULL,
  supplier_name VARCHAR(190) NOT NULL,
  supplier_email VARCHAR(190) NULL,
  requisition_id INT UNSIGNED NULL,
  requisition_reference VARCHAR(190) NULL,
  department_id INT UNSIGNED NULL,
  department_name VARCHAR(180) NULL,
  item_name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  unit_price DECIMAL(12,4) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_date DATE NULL,
  status ENUM('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
  decision_reason TEXT NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(150) NULL,
  decided_at DATETIME NULL,
  inventory_item_id INT UNSIGNED NULL,
  inventory_movement_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_po_delivery_item UNIQUE (purchase_order_item_id),
  CONSTRAINT fk_po_delivery_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_delivery_order_item FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_delivery_decided_by FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_delivery_inventory_item FOREIGN KEY (inventory_item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_delivery_movement FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE SET NULL,
  INDEX idx_po_delivery_status (status, created_at),
  INDEX idx_po_delivery_order (purchase_order_id)
);

-- Procurement's Allow/Deny gate for turning a sent purchase order into a GRN.
-- Denied orders are hidden from the sent-supplier workspace; only Allowed
-- orders can produce a Good Received Note for the supplier.
CREATE TABLE IF NOT EXISTS grn_supplier_decisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT UNSIGNED NOT NULL,
  status ENUM('Allowed','Denied') NOT NULL,
  reason TEXT NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(150) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_grn_supplier_decision_order UNIQUE (purchase_order_id),
  CONSTRAINT fk_grn_supplier_decision_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_grn_supplier_decision_user FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
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
  -- Official Good Received Note form fields. Sent purchase orders populate
  -- these from the supplier and requisition captured at send time.
  supplier_id INT UNSIGNED NULL,
  supplied_by VARCHAR(190) NULL,
  receiving_department VARCHAR(180) NULL,
  received_by_name VARCHAR(150) NULL,
  verified_by_name VARCHAR(150) NULL,
  received_signature LONGTEXT NULL,
  verified_signature LONGTEXT NULL,
  grn_date DATE NULL,
  comments TEXT NULL,
  idempotency_key VARCHAR(80) NULL,
  UNIQUE KEY uq_goods_receipt_idempotency (idempotency_key),
  CONSTRAINT fk_grn_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_grn_user FOREIGN KEY (received_by) REFERENCES users(id),
  CONSTRAINT fk_grn_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goods_receipt_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  comment TEXT NULL,
  delivered_quantity INT UNSIGNED NULL,
  damaged_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  `condition` VARCHAR(40) NULL,
  comments TEXT NULL,
  department_id INT UNSIGNED NULL,
  storage_location VARCHAR(150) NULL,
  INDEX idx_grn_item_receipt (goods_receipt_id, item_id),
  CONSTRAINT fk_grn_item_receipt FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_grn_item_catalog FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_grn_item_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
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
  requisition_id INT UNSIGNED NULL,
  purpose TEXT NOT NULL,
  status ENUM('Pending','Approved','Rejected','Issued') NOT NULL DEFAULT 'Pending',
  stockkeeper_decision ENUM('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
  stockkeeper_decision_by INT UNSIGNED NULL,
  stockkeeper_decision_at DATETIME NULL,
  stockkeeper_comments TEXT NULL,
  rejection_reason TEXT NULL,
  stockkeeper_viewed_at DATETIME NULL,
  reviewed_by INT UNSIGNED NULL,
  routed_by_supervisor INT UNSIGNED NULL,
  routed_at DATETIME NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  issued_at DATETIME NULL,
  required_by DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_store_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_store_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_request_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_request_routed_by FOREIGN KEY (routed_by_supervisor) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_request_decided_by FOREIGN KEY (stockkeeper_decision_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_store_request_requisition (requisition_id)
);

CREATE TABLE IF NOT EXISTS store_request_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_request_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NULL,
  requisition_item_id INT UNSIGNED NULL,
  requested_item_name VARCHAR(180) NULL,
  requested_unit VARCHAR(30) NULL,
  quantity INT UNSIGNED NOT NULL,
  accepted_quantity INT UNSIGNED NULL,
  issued_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_store_item_request FOREIGN KEY (store_request_id) REFERENCES store_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_item_catalog FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_store_item_requisition_line FOREIGN KEY (requisition_item_id) REFERENCES requisition_items(id) ON DELETE SET NULL,
  KEY idx_store_item_requisition_line (requisition_item_id)
);

-- Recipients of a Supervisor-routed request. Explicit assignment is the
-- authoritative per-request grant; department scope remains the default.
CREATE TABLE IF NOT EXISTS store_request_assignments (
  store_request_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_request_id, user_id),
  KEY idx_store_request_assignment_user (user_id),
  CONSTRAINT fk_store_request_assignment_request FOREIGN KEY (store_request_id) REFERENCES store_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_request_assignment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Physical count discrepancies discovered by a Stock Keeper. Issued quantities
-- and their stock transactions remain untouched; only the unissued shortfall is
-- returned to the Supervisor for a new routing decision.
CREATE TABLE IF NOT EXISTS requisition_routing_returns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  store_request_id INT UNSIGNED NOT NULL,
  requisition_item_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NULL,
  available_quantity INT UNSIGNED NOT NULL,
  unavailable_quantity INT UNSIGNED NOT NULL,
  reason TEXT NULL,
  reported_by INT UNSIGNED NULL,
  status ENUM('Awaiting Supervisor Decision','Forwarded to Procurement') NOT NULL DEFAULT 'Awaiting Supervisor Decision',
  forwarded_by INT UNSIGNED NULL,
  forwarded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_routing_return_requisition FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_routing_return_store_request FOREIGN KEY (store_request_id) REFERENCES store_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_routing_return_item_line FOREIGN KEY (requisition_item_id) REFERENCES requisition_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_routing_return_catalog_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_routing_return_reporter FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_routing_return_forwarder FOREIGN KEY (forwarded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_routing_return_requisition (requisition_id, status)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(500) NOT NULL,
  link VARCHAR(255) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  notification_type VARCHAR(20) NOT NULL DEFAULT 'information',
  module VARCHAR(120) NULL,
  related_record_id VARCHAR(80) NULL,
  action_url VARCHAR(500) NULL,
  recommended_action VARCHAR(200) NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at DATETIME NULL,
  dedupe_key VARCHAR(191) NULL,
  request_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_date (user_id, created_at),
  INDEX idx_notifications_type_user_date (notification_type, user_id, created_at),
  UNIQUE INDEX uq_notifications_dedupe (user_id, dedupe_key)
);

-- Per-recipient read receipts. Shared/broadcast notification rows stay visible
-- as unread for every user until that user records a receipt.
CREATE TABLE IF NOT EXISTS notification_read_receipts (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT fk_notification_read_notification FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS google_email_connection (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  mailbox VARCHAR(190) NOT NULL,
  refresh_token MEDIUMTEXT NOT NULL,
  token_iv CHAR(24) NOT NULL,
  token_tag CHAR(32) NOT NULL,
  granted_scopes TEXT NOT NULL,
  connected_by INT UNSIGNED NULL,
  connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_google_email_connected_by FOREIGN KEY (connected_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS google_email_oauth_states (
  state_hash CHAR(64) NOT NULL PRIMARY KEY,
  created_by INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_google_email_state_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_google_email_state_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS google_email_messages (
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
);

-- A shared mailbox message is unread independently for each authorized user.
CREATE TABLE IF NOT EXISTS email_message_read_receipts (
  gmail_message_id VARCHAR(190) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gmail_message_id, user_id),
  CONSTRAINT fk_email_read_message FOREIGN KEY (gmail_message_id) REFERENCES google_email_messages(gmail_message_id) ON DELETE CASCADE,
  CONSTRAINT fk_email_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One row per outbound requisition form email. The token is included in the
-- subject so a recipient reply can be linked back to the correct request.
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
);

-- Comments received by email from people who were sent a requisition form.
CREATE TABLE IF NOT EXISTS requisition_email_comments (
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
);

-- Departments form a two-level hierarchy: department -> subdepartment.
-- Only the requested departments are seeded; the startup seeder also prunes
-- anything outside this list on an existing database.
INSERT IGNORE INTO departments (name, parent_id) VALUES
  ('Administration', NULL), ('Education', NULL), ('Facility', NULL), ('Stores', NULL);

INSERT IGNORE INTO departments (name, parent_id)
SELECT 'Procurement', id FROM departments WHERE name = 'Administration';

INSERT IGNORE INTO departments (name, parent_id)
SELECT 'IT', id FROM departments WHERE name = 'Facility';

INSERT IGNORE INTO departments (name, parent_id)
SELECT 'StoreKeeper', id FROM departments WHERE name = 'Stores';

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

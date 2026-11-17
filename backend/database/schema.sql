CREATE DATABASE IF NOT EXISTS Procument
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE Procument;

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','requestor','approver','procurement','storekeeper','finance','committee') NOT NULL DEFAULT 'requestor',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  contact_name VARCHAR(150) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(50) NULL,
  rating DECIMAL(2,1) NOT NULL DEFAULT 0,
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'unit',
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  reorder_level INT UNSIGNED NOT NULL DEFAULT 10,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requisitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  requester_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  justification TEXT NOT NULL,
  budget_code VARCHAR(60) NOT NULL,
  status ENUM('Pending','Approved','Rejected','In procurement') NOT NULL DEFAULT 'Pending',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_req_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_req_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS requisition_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  estimated_unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_req_items_req FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  movement_type ENUM('Receipt','Issue','Adjustment') NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  source VARCHAR(180) NOT NULL,
  balance_after INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_movement_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_movements_item_date (item_id, created_at)
);

CREATE TABLE IF NOT EXISTS rfqs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  requisition_id INT UNSIGNED NOT NULL,
  due_date DATE NULL,
  status ENUM('Sent','Evaluating','Awarded','Closed') NOT NULL DEFAULT 'Sent',
  selected_quotation_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS quotations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rfq_id INT UNSIGNED NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  delivery_days INT UNSIGNED NOT NULL,
  quality_score DECIMAL(3,1) NOT NULL DEFAULT 0,
  rating_score DECIMAL(3,1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  total DECIMAL(12,2) NOT NULL,
  delivery_date DATE NULL,
  status ENUM('Pending approval','Approved','Rejected','Partially received','Received') NOT NULL DEFAULT 'Pending approval',
  created_by INT UNSIGNED NOT NULL,
  reviewed_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,4) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_po_line_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  purchase_order_id INT UNSIGNED NULL,
  source VARCHAR(180) NOT NULL,
  received_by INT UNSIGNED NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  submitted_by INT UNSIGNED NOT NULL,
  reviewed_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  link VARCHAR(180) NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

import pool from '../config/db.js';

export const SETTINGS_DEFAULTS = {
  system_name: 'Procurement Management System',
  organization_name: 'Hope Haven',
  organization_logo: '/procurement-logo.png',
  organization_address: '',
  organization_email: '',
  organization_phone: '',
  organization_website: '',
  organization_country: '',
  organization_city: '',
  theme: 'light',
  table_page_size: 10,
  date_format: 'DD/MM/YYYY',
  time_format: '24',
  timezone: 'UTC',
  week_start: 'Monday',
  default_currency: 'RWF',
  currency_symbol: 'RWF',
  decimal_precision: 2,
  tax_rate: 0,
  payment_terms_days: 30,
  purchase_request_prefix: 'PR',
  purchase_order_prefix: 'PO',
  goods_receipt_prefix: 'GRN',
  invoice_prefix: 'INV',
  supplier_prefix: 'SUP',
  procurement_method: 'Competitive bidding',
  low_stock_notifications: true,
  approval_notifications: true,
  delivery_notifications: true,
  in_app_notifications: true,
  email_notifications: false,
  password_min_length: 12,
  session_timeout_minutes: 480,
  login_attempt_limit: 5,
  account_lockout_minutes: 15,
  audit_logging: true,
  document_page_size: 'A4',
  document_header: 'Hope Haven Procurement',
  document_footer: 'Controlled procurement document',
  print_signature_sections: true,
  default_export_format: 'xlsx',
  duplicate_import_detection: true,
  maintenance_mode: false
};

const TYPES = {
  system_name: 'string', organization_name: 'string', organization_logo: 'string',
  organization_address: 'string', organization_email: 'string', organization_phone: 'string',
  organization_website: 'string', organization_country: 'string', organization_city: 'string',
  theme: 'string', table_page_size: 'number', date_format: 'string', time_format: 'string',
  timezone: 'string', week_start: 'string', default_currency: 'string', currency_symbol: 'string',
  decimal_precision: 'number', tax_rate: 'number', payment_terms_days: 'number',
  purchase_request_prefix: 'string', purchase_order_prefix: 'string', goods_receipt_prefix: 'string',
  invoice_prefix: 'string', supplier_prefix: 'string', procurement_method: 'string',
  low_stock_notifications: 'boolean', approval_notifications: 'boolean',
  delivery_notifications: 'boolean', in_app_notifications: 'boolean',
  email_notifications: 'boolean', password_min_length: 'number',
  session_timeout_minutes: 'number', login_attempt_limit: 'number',
  account_lockout_minutes: 'number', audit_logging: 'boolean',
  document_page_size: 'string', document_header: 'string', document_footer: 'string',
  print_signature_sections: 'boolean', default_export_format: 'string',
  duplicate_import_detection: 'boolean', maintenance_mode: 'boolean'
};

const ENUMS = {
  theme: ['light', 'dark', 'system'],
  date_format: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
  time_format: ['12', '24'],
  week_start: ['Monday', 'Sunday'],
  default_currency: ['RWF'],
  document_page_size: ['A4', 'Letter'],
  default_export_format: ['xlsx', 'csv', 'pdf']
};

let cache = null;
let cacheTime = 0;
const CACHE_MS = 30000;

function isJsonNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateSetting(key, rawValue) {
  if (!(key in SETTINGS_DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  const type = TYPES[key];
  let value = rawValue;
  if (type === 'number') {
    value = Number(rawValue);
    if (!isJsonNumber(value)) throw new Error(`Invalid numeric value for ${key}.`);
  } else if (type === 'boolean') {
    if (typeof rawValue === 'boolean') value = rawValue;
    else if (rawValue === 'true' || rawValue === 1) value = true;
    else if (rawValue === 'false' || rawValue === 0) value = false;
    else throw new Error(`Invalid boolean value for ${key}.`);
  } else {
    value = String(rawValue ?? '').trim();
  }

  if (ENUMS[key] && !ENUMS[key].includes(value)) {
    throw new Error(`Invalid value for ${key}. Choose one of: ${ENUMS[key].join(', ')}.`);
  }
  if (key.endsWith('_prefix') && !/^[A-Z][A-Z0-9-]{0,9}$/.test(value)) {
    throw new Error(`${key} must be 1-10 uppercase letters, numbers or hyphens.`);
  }
  if (key.includes('email') && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Invalid email for ${key}.`);
  }
  if (key === 'organization_website' && value) {
    try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { throw new Error('Organization website must be a valid HTTP or HTTPS URL.'); }
  }
  if (key === 'organization_logo' && value !== '/procurement-logo.png') {
    throw new Error('Organization logo must use the official /procurement-logo.png asset.');
  }
  if (key === 'table_page_size' && ![10, 25, 50].includes(value)) {
    throw new Error('Table page size must be 10, 25 or 50.');
  }
  if (key === 'decimal_precision' && (value < 0 || value > 4)) {
    throw new Error('Decimal precision must be between 0 and 4.');
  }
  if (key === 'tax_rate' && (value < 0 || value > 100)) {
    throw new Error('Tax rate must be between 0 and 100.');
  }
  if (key === 'password_min_length' && (value < 8 || value > 64)) {
    throw new Error('Minimum password length must be between 8 and 64.');
  }
  if (key === 'session_timeout_minutes' && (value < 5 || value > 1440)) {
    throw new Error('Session timeout must be between 5 and 1440 minutes.');
  }
  if (key === 'login_attempt_limit' && (value < 3 || value > 20)) {
    throw new Error('Login attempt limit must be between 3 and 20.');
  }
  if (key === 'account_lockout_minutes' && (value < 1 || value > 1440)) {
    throw new Error('Account lockout time must be between 1 and 1440 minutes.');
  }
  return value;
}

// MySQL JSON columns are returned already decoded by mysql2. Only strings
// retrieved from a plain-text column still need JSON parsing.
function decodeSettingValue(value, key) {
  if (value === null || value === undefined) return SETTINGS_DEFAULTS[key];
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return value; }
}

export async function getSettings() {
  if (cache && Date.now() - cacheTime < CACHE_MS) return { ...cache };
  const [rows] = await pool.execute(
    'SELECT setting_key, setting_value FROM application_settings ORDER BY setting_key'
  );
  const stored = {};
  for (const row of rows) {
    stored[row.setting_key] = decodeSettingValue(row.setting_value, row.setting_key);
  }
  if (stored.default_currency !== 'RWF') stored.default_currency = 'RWF';
  if (stored.currency_symbol !== 'RWF') stored.currency_symbol = 'RWF';
  cache = { ...SETTINGS_DEFAULTS, ...stored };
  cacheTime = Date.now();
  return { ...cache };
}

export function clearSettingsCache() {
  cache = null;
  cacheTime = 0;
}

export async function saveSettings(values, actorId) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Settings must be supplied as an object.');
  }
  const entries = Object.entries(values);
  if (!entries.length) throw new Error('No settings were supplied.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const changes = {};
    for (const [key, rawValue] of entries) {
      const value = validateSetting(key, rawValue);
      const [existing] = await connection.execute(
        'SELECT setting_value FROM application_settings WHERE setting_key = ? LIMIT 1',
        [key]
      );
      const previous = existing.length
        ? decodeSettingValue(existing[0].setting_value, key)
        : SETTINGS_DEFAULTS[key];
      if (JSON.stringify(previous) === JSON.stringify(value)) continue;
      await connection.execute(
        `INSERT INTO application_settings (setting_key, setting_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [key, JSON.stringify(value), actorId]
      );
      changes[key] = { previous, value };
    }
    if (Object.keys(changes).length) {
      await connection.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES (?, 'settings_updated', 'application_settings', 'settings', ?)`,
        [actorId, JSON.stringify(changes)]
      );
    }
    await connection.commit();
    clearSettingsCache();
    return { changes, saved: Object.keys(changes).length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

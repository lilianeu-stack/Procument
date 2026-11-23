const PLACEHOLDER = /^(REPLACE_WITH|YOUR[_-]|CHANGE[_-]?ME|CHANGEME|TODO|EXAMPLE|PLACEHOLDER)/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function value(name) {
  return String(process.env[name] ?? '').trim();
}

function isUsable(name) {
  const current = value(name);
  return Boolean(current) && !PLACEHOLDER.test(current);
}

// No credentials or secrets are ever returned by this helper. Only variable
// names and non-secret sender metadata are exposed to authenticated admins.
export function emailConfigStatus() {
  const missing = [];
  const host = value('SMTP_HOST');
  const portValue = value('SMTP_PORT') || '587';
  const user = value('SMTP_USER');
  const pass = String(process.env.SMTP_PASS ?? '');
  const from = value('SMTP_FROM');

  if (!isUsable('SMTP_HOST')) missing.push('SMTP_HOST');
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) missing.push('SMTP_PORT');
  if (!isUsable('SMTP_USER')) missing.push('SMTP_USER');
  if (!pass || PLACEHOLDER.test(pass.trim())) missing.push('SMTP_PASS');
  if (!EMAIL_PATTERN.test(from)) missing.push('SMTP_FROM');

  const secure = /^(1|true|yes|on)$/i.test(value('SMTP_SECURE'));
  const appBaseUrl = value('APP_BASE_URL') || value('CLIENT_ORIGIN') || 'http://localhost:5173';
  if (!/^https?:\/\//i.test(appBaseUrl)) missing.push('APP_BASE_URL');

  return {
    provider: 'SMTP',
    configured: missing.length === 0,
    missing,
    hostConfigured: Boolean(host),
    port: Number(portValue) || 587,
    secure,
    from: from || null,
    fromName: value('SMTP_FROM_NAME') || 'Hope Haven Procurement',
    appBaseUrl,
    webhookConfigured: isUsable('EMAIL_WEBHOOK_SECRET'),
    deliveryConfirmation: 'Webhook required for Delivered status; SMTP acceptance is not delivery confirmation.'
  };
}

export function validEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim().toLowerCase());
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function smtpTransportOptions() {
  const config = emailConfigStatus();
  if (!config.configured) {
    const error = new Error(`Email delivery is not configured. Missing environment variable(s): ${config.missing.join(', ')}.`);
    error.code = 'EMAIL_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return {
    host: value('SMTP_HOST'),
    port: config.port,
    secure: config.secure,
    // STARTTLS is required by default on non-implicit-TLS ports. Local test
    // relays can explicitly opt out with SMTP_REQUIRE_TLS=false.
    requireTLS: !config.secure && !/^(0|false|no|off)$/i.test(value('SMTP_REQUIRE_TLS')),
    auth: {
      user: value('SMTP_USER'),
      pass: String(process.env.SMTP_PASS ?? '')
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  };
}

export function sanitizeEmailError(error) {
  const secrets = [value('SMTP_PASS'), value('SMTP_USER')].filter(Boolean);
  let message = error?.message || 'Email provider rejected the message.';
  for (const secret of secrets) message = message.split(secret).join('[hidden]');
  return {
    code: /^[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'EMAIL_ERROR',
    message: message.slice(0, 400)
  };
}

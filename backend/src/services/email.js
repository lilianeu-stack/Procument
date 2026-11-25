import nodemailer from 'nodemailer';
import { log } from '../lib/logger.js';
import { sendGoogleEmail } from './google-email.js';
import {
  emailConfigStatus, normalizeEmail, sanitizeEmailError,
  smtpTransportOptions, validEmail
} from '../utils/email-config.js';

let cachedTransport = null;
let cachedKey = '';

function transportKey() {
  const config = emailConfigStatus();
  return [config.hostConfigured, config.port, config.secure, config.from].join('|');
}

export function getTransporter(override = null) {
  if (override) return override;
  const key = transportKey();
  if (!cachedTransport || cachedKey !== key) {
    cachedTransport = nodemailer.createTransport(smtpTransportOptions());
    cachedKey = key;
  }
  return cachedTransport;
}

export function supplierLink(token) {
  const config = emailConfigStatus();
  const base = config.appBaseUrl.replace(/\/+$/, '');
  return `${base}/#/supplier/RFQ?token=${encodeURIComponent(token)}`;
}

// Each Committee member receives their own token, so a decision submitted from
// one link cannot be attributed to or used to change another member's review.
// A real path (rather than a hash fragment) survives email link scanners that
// strip or rewrite fragments. The old hash links are still supported by the app.
export function committeeReviewLink(token) {
  const config = emailConfigStatus();
  const base = config.appBaseUrl.replace(/\/+$/, '');
  return `${base}/committee-review?token=${encodeURIComponent(token)}`;
}

// Always awaited by callers. Never claims inbox delivery: SMTP only proves the
// provider accepted the message at the time of submission.
export async function sendEmail(message, override = null) {
  const recipient = normalizeEmail(message.to);
  if (!validEmail(recipient)) {
    return { ok: false, status: 'Failed', reason: 'invalid_recipient', error: { code: 'INVALID_RECIPIENT', message: 'The recipient email address is invalid.' } };
  }
  const config = emailConfigStatus();
  if (!config.configured && !override) {
    try {
      return await sendGoogleEmail(message);
    } catch (error) {
      if (error.code === 'INVALID_EMAIL_MESSAGE') {
        return { ok: false, status: 'Failed', reason: 'invalid_message', error: { code: 'INVALID_EMAIL_MESSAGE', message: error.message } };
      }
      if (error.status === 409 || error.status === 503) {
        return {
          ok: false,
          status: 'Failed',
          reason: 'not_configured',
          error: {
            code: error.status === 409 ? 'GOOGLE_EMAIL_NOT_CONNECTED' : 'EMAIL_NOT_CONFIGURED',
            message: error.message
          }
        };
      }
      const sanitized = sanitizeEmailError(error);
      log('ERROR', `Google email failed (${sanitized.code}): ${sanitized.message}`);
      return { ok: false, status: 'Failed', reason: 'provider_error', error: sanitized };
    }
  }

  try {
    const transporter = getTransporter(override);
    const info = await transporter.sendMail({
      from: { name: config.fromName, address: config.from },
      to: recipient,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
    const accepted = Array.isArray(info?.accepted) ? info.accepted.map(normalizeEmail) : [];
    const rejected = Array.isArray(info?.rejected) ? info.rejected.map(normalizeEmail) : [];
    if (!accepted.includes(recipient) || rejected.includes(recipient)) {
      return {
        ok: false,
        status: 'Failed',
        reason: 'provider_rejected_recipient',
        providerMessageId: info?.messageId || null,
        error: { code: 'PROVIDER_REJECTED', message: 'The email provider rejected this recipient.' }
      };
    }
    return {
      ok: true,
      status: 'Accepted by Email Provider',
      providerMessageId: info?.messageId || null,
      providerResponse: String(info?.response || '').slice(0, 240) || null,
      accepted: accepted.length ? 1 : 0,
      rejected: rejected.length
    };
  } catch (error) {
    const sanitized = sanitizeEmailError(error);
    log('ERROR', `Supplier email failed for ${recipient} (${sanitized.code}): ${sanitized.message}`);
    return { ok: false, status: 'Failed', reason: 'provider_error', error: sanitized };
  }
}

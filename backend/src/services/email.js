import nodemailer from 'nodemailer';
import { log } from '../lib/logger.js';
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function htmlParagraphs(lines) {
  return lines.map((line) => `<p style="margin:0 0 12px;line-height:1.55">${escapeHtml(line)}</p>`).join('');
}

export function supplierLink(token) {
  const config = emailConfigStatus();
  const base = config.appBaseUrl.replace(/\/+$/, '');
  return `${base}/#/supplier/RFQ?token=${encodeURIComponent(token)}`;
}

function wrapHtml(title, lines, action = null) {
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;padding:24px;font-family:Arial,sans-serif;color:#172a39">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#123d3a;padding:20px 28px;color:#fff;font-size:16px;font-weight:bold">Hope Haven · Procurement &amp; Stores</td></tr>
      <tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 18px">${escapeHtml(title)}</h1>
        ${htmlParagraphs(lines)}
        ${action ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#123d3a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#5b6b73;word-break:break-all">${escapeHtml(action.url)}</p>` : ''}
        <p style="margin-top:24px;font-size:12px;color:#5b6b73">This message was sent only to the Supplier named above. Do not forward the link; it is unique to your organization.</p>
      </td></tr>
    </table></body></html>`;
}

export function buildRfqEmail({ supplierName, reference, requisitionReference, title, dueDate, rawToken, notes = '' }) {
  const link = supplierLink(rawToken);
  const lines = [
    `Dear ${supplierName || 'Supplier'},`,
    `Hope Haven invites you to submit a quotation for ${reference}${requisitionReference ? ` (requisition ${requisitionReference})` : ''}.`,
    title ? `Request: ${title}` : '',
    dueDate ? `Quotation deadline: ${dueDate}.` : 'Quotation deadline: as stated in the quotation document.',
    notes ? `Additional information: ${notes}` : '',
    'Use the secure link below to view the full request and submit your quotation.'
  ].filter(Boolean);
  return {
    subject: `Request for Quotation ${reference} · Hope Haven`,
    text: `${lines.join('\n\n')}\n\nView RFQ & Submit Quotation:\n${link}\n`,
    html: wrapHtml(`Request for Quotation ${reference}`, lines, { label: 'View RFQ & Submit Quotation', url: link })
  };
}

export function buildTestEmail() {
  const lines = [
    'This is a delivery verification message from the Hope Haven Procurement Management System.',
    'If you received this email, SMTP authentication and message acceptance are working. Acceptance by the provider is not the same as confirmed inbox delivery.'
  ];
  return {
    subject: 'Procurement Management System · Email delivery test',
    text: `${lines.join('\n\n')}\n`,
    html: wrapHtml('Email delivery test', lines)
  };
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
    return {
      ok: false,
      status: 'Failed',
      reason: 'not_configured',
      error: {
        code: 'EMAIL_NOT_CONFIGURED',
        message: `Email delivery is not configured. Missing environment variable(s): ${config.missing.join(', ')}.`
      }
    };
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

export async function verifyEmailConnection(override = null) {
  const config = emailConfigStatus();
  if (!config.configured && !override) {
    return {
      ok: false,
      message: `Email delivery is not configured. Missing environment variable(s): ${config.missing.join(', ')}.`
    };
  }
  try {
    await getTransporter(override).verify();
    return { ok: true, message: 'SMTP connection and authentication verified.' };
  } catch (error) {
    const sanitized = sanitizeEmailError(error);
    log('ERROR', `SMTP verification failed (${sanitized.code}): ${sanitized.message}`);
    return { ok: false, message: sanitized.message, code: sanitized.code };
  }
}

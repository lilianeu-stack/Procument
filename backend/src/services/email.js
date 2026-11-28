import nodemailer from 'nodemailer';
import { log } from '../lib/logger.js';
import { googleConnectionStatus, sendGoogleEmail } from './google-email.js';
import {
  emailConfigStatus, normalizeEmail, sanitizeEmailError,
  smtpTransportOptions, validEmail
} from '../utils/email-config.js';
import { inlineSignatureImage } from '../utils/email-reply.js';

const EMAIL_THEME = { surface: '#FFFFFF', ink: '#000000', border: '#000000' };
const RFQ_SIGNATURE_CID = 'rfq-sender-signature';

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

function appUrl(path) {
  const config = emailConfigStatus();
  return `${config.appBaseUrl.replace(/\/+$/, '')}${path}`;
}

export function supplierLink(token) {
  return appUrl(`/#/supplier/RFQ?token=${encodeURIComponent(token)}`);
}

// Each Committee member receives their own token, so a decision submitted from
// one link cannot be attributed to or used to change another member's review.
// The token is a real path segment rather than a hash fragment or query string:
// mail clients and link scanners are far less likely to strip it. The older
// hash and query links are still supported by the app.
export function committeeReviewLink(token) {
  return appUrl(`/committee-review/${encodeURIComponent(token)}`);
}

// Requisition response forms use the same real token path so the link works in
// any mail client and on any device. Older hash links remain supported by the
// frontend for forms that were sent before this change.
export function requestResponseLink(token) {
  return appUrl(`/response/${encodeURIComponent(token)}`);
}

export function purchaseOrderReviewLink(token) {
  return appUrl(`/#/po-approval/review?token=${encodeURIComponent(token)}`);
}

export function supplierPricingLink(token) {
  return appUrl(`/#/supplier-pricing/quote?token=${encodeURIComponent(token)}`);
}

// This invitation deliberately contains no administrative prices or financial
// totals. The supplier creates every figure on the private response page.
export function buildSupplierPricingEmail({
  supplierName, recipientEmail, reference, purchaseOrderReference,
  items = [], deliveryDate, submissionDeadline, message = '',
  rawToken, currency = 'RWF'
}) {
  const link = supplierPricingLink(rawToken);
  const itemLines = (Array.isArray(items) ? items : []).map((item) => (
    `${item.itemNo ? `${item.itemNo}. ` : ''}${item.description || item.itemName || 'Purchase order item'} — ${item.quantity} ${item.unit || 'unit'}`
  ));
  const lines = [
    `Dear ${supplierName || 'Supplier'},`,
    `Hope Haven invites you to submit prices for purchase order ${purchaseOrderReference}${reference ? ` (pricing request ${reference})` : ''}.`,
    'Requested items:',
    ...itemLines,
    deliveryDate ? `Expected delivery date: ${deliveryDate}.` : '',
    submissionDeadline ? `Submission deadline: ${submissionDeadline}.` : '',
    currency ? `Quotation currency: ${currency}.` : '',
    message ? `Message from Procurement: ${message}` : '',
    'Use the secure link below to open the purchase order and submit your prices.'
  ].filter(Boolean);
  return {
    to: recipientEmail,
    subject: `Submit supplier prices for purchase order ${purchaseOrderReference} · Hope Haven`,
    text: `${lines.join('\n\n')}\n\nOpen Purchase Order / Submit Prices:\n${link}\n`,
    html: wrapHtml(`Supplier pricing request · ${purchaseOrderReference}`, lines,
      { label: 'Open Purchase Order / Submit Prices', url: link })
  };
}

// The supplier receives the actual official purchase order, not the RFQ or the
// pricing form. The PDF is attached by the caller; this builder only formats
// the message body.
export function buildPurchaseOrderEmail({
  supplierName, recipientEmail, reference, purchaseOrderReference,
  total, deliveryDate, message = ''
}) {
  const lines = [
    `Dear ${supplierName || 'Supplier'},`,
    `Please find the official purchase order ${purchaseOrderReference}${reference && reference !== purchaseOrderReference ? ` (${reference})` : ''} attached.`,
    deliveryDate ? `Expected delivery date: ${deliveryDate}.` : '',
    total ? `Purchase order total: ${total}.` : '',
    message ? `Message from Procurement: ${message}` : '',
    'The attached signed document is the authoritative purchase order. Please keep it for your records.'
  ].filter(Boolean);
  return {
    to: recipientEmail,
    subject: `Official purchase order ${purchaseOrderReference} · Hope Haven`,
    text: `${lines.join('\n\n')}\n`,
    html: wrapHtml(`Official purchase order ${purchaseOrderReference}`, lines, null,
      'This purchase order was sent to the registered supplier contact. Please keep the attached signed document for your records.')
  };
}

// Sent to the registered supplier after Procurement allows a GRN. The caller
// attaches the generated PDF; the message never exposes internal addresses.
export function buildGoodReceivedNoteEmail({
  supplierName, recipientEmail, reference, purchaseOrderReference,
  lines = [], message = ''
}) {
  const itemLines = (Array.isArray(lines) ? lines : []).map((line) =>
    `${line.itemName || 'Received item'} — ${line.quantity} ${line.unit || 'unit'}${line.comment ? ` (${line.comment})` : ''}`
  );
  const body = [
    `Dear ${supplierName || 'Supplier'},`,
    `Please find good received note ${reference} for purchase order ${purchaseOrderReference} attached.`,
    ...(itemLines.length ? ['Received items:', ...itemLines] : []),
    message ? `Message from Procurement: ${message}` : '',
    'The attached document is the authoritative record of the goods received. Please keep it for your records.'
  ].filter(Boolean);
  return {
    to: recipientEmail,
    subject: `Good received note ${reference} · Hope Haven`,
    text: `${body.join('\n\n')}\n`,
    html: wrapHtml(`Good received note ${reference}`, body, null,
      'This good received note was sent only to the registered supplier contact for the purchase order.')
  };
}

export function procurementWorkspaceLink() {
  return appUrl('/#/admin/Procurement%20Processing');
}

function wrapHtml(title, lines, action = null, footer = null, extraHtml = '') {
  return `<!doctype html><html><body style="margin:0;background:${EMAIL_THEME.surface};padding:24px;font-family:Arial,sans-serif;color:${EMAIL_THEME.ink}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:auto;background:${EMAIL_THEME.surface};border-radius:12px;overflow:hidden">
      <tr><td style="background:${EMAIL_THEME.surface};border-bottom:1px solid ${EMAIL_THEME.border};padding:20px 28px;color:${EMAIL_THEME.ink};font-size:16px;font-weight:bold">Hope Haven · Procurement &amp; Stores</td></tr>
      <tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 18px">${escapeHtml(title)}</h1>
        ${htmlParagraphs(lines)}
        ${extraHtml}
        ${action ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:${EMAIL_THEME.surface};border:1px solid ${EMAIL_THEME.border};color:${EMAIL_THEME.ink};padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:${EMAIL_THEME.ink};word-break:break-all">${escapeHtml(action.url)}</p>` : ''}
        <p style="margin-top:24px;font-size:12px;color:${EMAIL_THEME.ink}">${escapeHtml(footer || 'This message was sent only to the Supplier named above. Do not forward the link; it is unique to your organization.')}</p>
      </td></tr>
    </table></body></html>`;
}

export function buildRfqEmail({
  supplierName, reference, requisitionReference, title, dueDate, requiredBy,
  items = [], instructions = '', terms = '', notes = '', rawToken,
  senderName = '', senderSignature = ''
}) {
  const link = supplierLink(rawToken);
  const sender = String(senderName || '').trim();
  const inlineImages = inlineSignatureImage(senderSignature, RFQ_SIGNATURE_CID, 'rfq-sender-signature');
  const itemLines = (Array.isArray(items) ? items : []).map((item) =>
    `${item.itemName || 'Requested item'} — ${item.quantity} ${item.unit || 'unit'}${item.description ? ` (${item.description})` : ''}`
  );
  const lines = [
    `Dear ${supplierName || 'Supplier'},`,
    `Hope Haven invites you to submit a quotation for ${reference}${requisitionReference ? ` (requisition ${requisitionReference})` : ''}.`,
    sender ? `Sent by: ${sender}` : '',
    title ? `Request: ${title}` : '',
    itemLines.length ? 'Requested items:' : '',
    ...itemLines,
    dueDate ? `Quotation deadline: ${dueDate}.` : 'Quotation deadline: as stated in the quotation document.',
    requiredBy ? `Required by: ${requiredBy}.` : '',
    instructions ? `Instructions to suppliers: ${instructions}` : '',
    terms ? `Terms and conditions: ${terms}` : '',
    notes ? `Additional information: ${notes}` : '',
    'Use the secure link below to view the full request and submit your quotation.'
  ].filter(Boolean);
  const signatureHtml = (sender || inlineImages.length) ? `<div style="margin:18px 0 0;padding:14px;border:1px solid ${EMAIL_THEME.border};border-radius:8px">
      <p style="margin:0 0 4px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:${EMAIL_THEME.ink}">Sent by</p>
      <p style="margin:0;font-size:13px;font-weight:bold;color:${EMAIL_THEME.ink}">${escapeHtml(sender || '—')}</p>
      ${inlineImages.length ? `<img src="cid:${RFQ_SIGNATURE_CID}" alt="Procurement signature" style="display:block;max-width:240px;max-height:80px;margin-top:8px" />` : ''}
    </div>` : '';
  return {
    subject: `Request for Quotation ${reference} · Hope Haven`,
    text: `${lines.join('\n\n')}\n\nView RFQ & Submit Quotation:\n${link}\n`,
    html: wrapHtml(`Request for Quotation ${reference}`, lines,
      { label: 'View RFQ & Submit Quotation', url: link }, null, signatureHtml),
    inlineImages
  };
}

export function buildPurchaseOrderReviewEmail({
  recipientName, recipientEmail, reference, supplier, totalAmount, deliveryDate, message = '', rawToken
}) {
  const link = purchaseOrderReviewLink(rawToken);
  const lines = [
    `Dear ${recipientName || 'Reviewer'},`,
    `You have been asked to review purchase order ${reference}.`,
    supplier ? `Supplier: ${supplier}.` : '',
    totalAmount ? `Total amount: ${totalAmount}.` : '',
    deliveryDate ? `Expected delivery date: ${deliveryDate}.` : '',
    message ? `Message from the sender: ${message}` : '',
    'Sign in with your registered account to open the secure review page and record your approval or rejection.'
  ].filter(Boolean);
  return {
    to: recipientEmail,
    subject: `Purchase order ${reference} awaiting your review · Hope Haven`,
    text: `${lines.join('\n\n')}\n\nView Purchase Order:\n${link}\n`,
    html: wrapHtml(`Purchase order ${reference} awaiting your review`, lines,
      { label: 'View Purchase Order', url: link },
      'This secure link is reserved for the named reviewer. Sign in with your registered account; do not forward the link.')
  };
}

export function buildPurchaseOrderDecisionEmail({
  recipientName, recipientEmail, reference, decision, comment = '', poNumber = reference, reviewerName = 'the designated reviewer'
}) {
  const link = procurementWorkspaceLink();
  const lines = [
    `Dear ${recipientName || 'Sender'},`,
    `Purchase order ${poNumber} (${reference}) has been ${String(decision).toLowerCase()} by ${reviewerName}.`,
    comment ? `Decision comment: ${comment}` : '',
    'Open the Procurement Processing workspace to see the updated approval status and full history.'
  ].filter(Boolean);
  return {
    to: recipientEmail,
    subject: `Purchase order ${poNumber} ${String(decision).toLowerCase()} · Hope Haven`,
    text: `${lines.join('\n\n')}\n\nOpen Procurement Processing:\n${link}\n`,
    html: wrapHtml(`Purchase order ${poNumber} ${String(decision).toLowerCase()}`, lines,
      { label: 'Open Procurement Processing', url: link },
      'This notification was sent to the registered sender of the purchase order.')
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
  const smtpFailure = {
    ok: false,
    status: 'Failed',
    reason: 'not_configured',
    error: {
      code: 'EMAIL_NOT_CONFIGURED',
      message: `Email delivery is not configured. Missing environment variable(s): ${config.missing.join(', ')}.`
    }
  };
  if (!config.configured && !override) {
    // The connected Google mailbox is a fallback, not a hidden replacement for
    // an explicitly unconfigured provider. If it is not configured and connected
    // with Gmail send permission, report the missing SMTP variables to the UI.
    const googleStatus = await googleConnectionStatus();
    if (!googleStatus.configured || !googleStatus.connected || !googleStatus.googleSendEnabled) {
      return smtpFailure;
    }
    try {
      return await sendGoogleEmail(message);
    } catch (error) {
      if (error.code === 'INVALID_EMAIL_MESSAGE') {
        return { ok: false, status: 'Failed', reason: 'invalid_message', error: { code: 'INVALID_EMAIL_MESSAGE', message: error.message } };
      }
      if (error.status === 409 || error.status === 503) return smtpFailure;
      const sanitized = sanitizeEmailError(error);
      log('ERROR', `Google email failed (${sanitized.code}): ${sanitized.message}`);
      return { ok: false, status: 'Failed', reason: 'provider_error', error: sanitized };
    }
  }

  try {
    const transporter = getTransporter(override);
    const attachments = (Array.isArray(message.attachments) ? message.attachments : [])
      .filter((attachment) => Buffer.isBuffer(attachment?.content) && attachment.content.length)
      .map((attachment) => ({
        filename: String(attachment.filename || 'document').replace(/[\r\n]/g, '_'),
        contentType: String(attachment.contentType || 'application/octet-stream').replace(/[\r\n]/g, ''),
        content: attachment.content
      }));
    const inlineImages = (Array.isArray(message.inlineImages) ? message.inlineImages : [])
      .filter((image) => Buffer.isBuffer(image?.content) && image.content.length && image.cid)
      .map((image) => ({
        filename: String(image.filename || `${image.cid}.image`).replace(/[\r\n]/g, '_'),
        contentType: String(image.contentType || 'application/octet-stream').replace(/[\r\n]/g, ''),
        cid: String(image.cid).replace(/[^A-Za-z0-9@.-]/g, ''),
        content: image.content,
        inline: true
      }));
    const allAttachments = [...attachments, ...inlineImages];
    const info = await transporter.sendMail({
      from: { name: config.fromName, address: config.from },
      to: recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(allAttachments.length ? { attachments: allAttachments } : {})
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

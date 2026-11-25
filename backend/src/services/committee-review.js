import pool from '../config/db.js';
import { escapeHtml, formatRwf } from '../utils/email-reply.js';

// Shared by the preview endpoint and the send endpoint so that what Procurement
// sees in the preview is exactly what is stored and emailed to the Committee.
export function parseRfqIds(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const ids = [...new Set(raw.map((value) => Number(String(value).trim())).filter(Boolean))];
  if (!ids.length) {
    throw Object.assign(new Error('Select at least one RFQ to send to the Procurement Committee.'), { status: 400 });
  }
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw Object.assign(new Error('One or more selected RFQ identifiers are invalid.'), { status: 400 });
  }
  return ids;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function readableDate(value, settings = {}) {
  if (!value) return 'Not recorded';
  const raw = String(value).trim();
  let iso = raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) iso += 'Z';
  const instant = value instanceof Date ? value : new Date(iso);
  if (Number.isNaN(instant.getTime())) return raw || 'Not recorded';

  try {
    const parts = {};
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'
    });
    for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
    const dateFormat = settings.date_format || 'DD/MM/YYYY';
    const dateText = dateFormat === 'MM/DD/YYYY'
      ? `${parts.month}/${parts.day}/${parts.year}`
      : dateFormat === 'YYYY-MM-DD'
        ? `${parts.year}-${parts.month}-${parts.day}`
        : `${parts.day}/${parts.month}/${parts.year}`;
    const hour = Number(parts.hour);
    const time = settings.time_format === '12'
      ? `${hour % 12 || 12}:${parts.minute} ${hour >= 12 ? 'PM' : 'AM'}`
      : `${parts.hour}:${parts.minute}`;
    return `${dateText} ${time}${parts.timeZoneName ? ` ${parts.timeZoneName}` : ''}`;
  } catch {
    return `${instant.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row[key])) result.set(row[key], []);
    result.get(row[key]).push(row);
  }
  return result;
}

export async function buildCommitteeReport(rfqIds) {
  const ids = parseRfqIds(rfqIds);
  const [rfqs] = await pool.execute(
    `SELECT f.id, f.reference, f.issued_at AS issuedAt, f.due_date AS dueDate, f.message,
        r.id AS requisitionId, r.reference AS requisitionReference, r.title,
        d.name AS department
       FROM rfqs f
       JOIN requisitions r ON r.id = f.requisition_id
       LEFT JOIN departments d ON d.id = r.department_id
      WHERE f.id IN (${placeholders(ids)})
      ORDER BY f.id DESC`,
    ids
  );
  if (rfqs.length !== ids.length) {
    throw Object.assign(new Error('One or more selected RFQs could not be found.'), { status: 404 });
  }

  const [requestedItems] = await pool.execute(
    `SELECT requisition_id AS requisitionId, item_name AS itemName, description, quantity, unit,
        estimated_unit_cost AS estimatedUnitCost
       FROM requisition_items
      WHERE requisition_id IN (${placeholders([...new Set(rfqs.map((rfq) => rfq.requisitionId))])})
      ORDER BY requisition_id, id`,
    [...new Set(rfqs.map((rfq) => rfq.requisitionId))]
  );
  const requestedByRequisition = groupBy(requestedItems, 'requisitionId');

  const [invitations] = await pool.execute(
    `SELECT fs.rfq_id AS rfqId, s.id AS supplierId, s.name AS supplier, s.email,
        s.contact_name AS contactName, s.phone
       FROM rfq_suppliers fs
       JOIN suppliers s ON s.id = fs.supplier_id
      WHERE fs.rfq_id IN (${placeholders(ids)})
      ORDER BY s.name, s.id`,
    ids
  );
  const invitedByRfq = groupBy(invitations, 'rfqId');

  // The latest delivery attempt is the one that reflects the current invitation.
  const [deliveries] = await pool.execute(
    `SELECT rfq_id AS rfqId, supplier_id AS supplierId, recipient_email AS recipientEmail,
        status, attempts, sent_at AS sentAt, accepted_at AS acceptedAt,
        delivered_at AS deliveredAt, opened_at AS openedAt
       FROM rfq_email_deliveries
      WHERE rfq_id IN (${placeholders(ids)})
      ORDER BY rfq_id, supplier_id, id DESC`,
    ids
  );
  const latestDelivery = new Map();
  for (const delivery of deliveries) {
    const key = `${delivery.rfqId}:${delivery.supplierId}`;
    if (!latestDelivery.has(key)) latestDelivery.set(key, delivery);
  }

  const [quotations] = await pool.execute(
    `SELECT q.id AS quotationId, q.rfq_id AS rfqId, q.supplier_id AS supplierId,
        q.amount, q.delivery_days AS deliveryDays, q.quality_score AS qualityScore,
        q.rating_score AS ratingScore, q.notes,
        q.submitted_at AS submittedAt, q.created_at AS createdAt,
        s.name AS supplier, s.email AS supplierEmail
       FROM quotations q
       JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.rfq_id IN (${placeholders(ids)})
      ORDER BY q.rfq_id, s.name, q.id`,
    ids
  );
  const quotesByRfq = groupBy(quotations, 'rfqId');

  const [quoteItems] = await pool.execute(
    `SELECT qi.quotation_id AS quotationId, qi.item_name AS itemName, qi.description,
        qi.quantity, qi.unit, qi.unit_price AS unitPrice,
        qi.line_total AS lineTotal, qi.comment
       FROM quotation_items qi
       JOIN quotations q ON q.id = qi.quotation_id
      WHERE q.rfq_id IN (${placeholders(ids)})
      ORDER BY qi.quotation_id, qi.id`,
    ids
  );
  const itemsByQuotation = groupBy(quoteItems, 'quotationId');

  const sections = rfqs.map((rfq) => {
    const quotes = quotesByRfq.get(rfq.id) || [];
    const suppliers = (invitedByRfq.get(rfq.id) || []).map((invitation) => {
      const delivery = latestDelivery.get(`${rfq.id}:${invitation.supplierId}`);
      const quote = quotes.find((entry) => entry.supplierId === invitation.supplierId);
      return {
        rfqId: rfq.id,
        supplierId: invitation.supplierId,
        name: invitation.supplier,
        email: invitation.email || null,
        contactName: invitation.contactName || null,
        phone: invitation.phone || null,
        // When the quotation was requested and when the invitation email was sent.
        quotationRequestedAt: rfq.issuedAt,
        emailSentAt: delivery?.sentAt || rfq.issuedAt || null,
        emailStatus: delivery?.status || 'Not recorded',
        recipientEmail: delivery?.recipientEmail || invitation.email || null,
        openedAt: delivery?.openedAt || null,
        // When that Supplier responded, with the full quotation details.
        responseAt: quote ? (quote.submittedAt || quote.createdAt) : null,
        quotationId: quote?.quotationId || null,
        amount: quote ? Number(quote.amount) : null,
        deliveryDays: quote && Number(quote.deliveryDays) > 0 ? Number(quote.deliveryDays) : null,
        qualityScore: quote ? Number(quote.qualityScore) : null,
        ratingScore: quote ? Number(quote.ratingScore) : null,
        notes: quote?.notes || '',
        items: quote ? (itemsByQuotation.get(quote.quotationId) || []).map((item) => ({
          ...item,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal)
        })) : []
      };
    });
    return {
      id: rfq.id,
      reference: rfq.reference,
      requisitionReference: rfq.requisitionReference,
      title: rfq.title,
      department: rfq.department || null,
      issuedAt: rfq.issuedAt || null,
      dueDate: rfq.dueDate || null,
      message: rfq.message || '',
      requestedItems: (requestedByRequisition.get(rfq.requisitionId) || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        estimatedUnitCost: Number(item.estimatedUnitCost)
      })),
      suppliers
    };
  });

  const withoutResponse = sections.filter((section) => !section.suppliers.some((supplier) => supplier.responseAt));
  if (withoutResponse.length) {
    throw Object.assign(new Error(
      `Supplier responses are required before sending these RFQs: ${withoutResponse.map((section) => section.reference).join(', ')}.`
    ), { status: 409 });
  }
  return sections;
}

export function committeeReportText(section, settings = {}) {
  const lines = [
    `RFQ: ${section.reference}`,
    `Requisition: ${section.requisitionReference}`,
    `Request: ${section.title}`,
    `Department: ${section.department || 'Not specified'}`,
    `Send date and time: ${readableDate(section.issuedAt, settings)}`,
    `Response deadline: ${readableDate(section.dueDate, settings)}`
  ];
  if (section.message) lines.push('', `Message from Procurement: ${section.message}`);

  lines.push('', 'Requested items:');
  for (const item of section.requestedItems) {
    lines.push(`- ${item.itemName}: ${item.quantity} ${item.unit} | Estimated unit price ${formatRwf(item.estimatedUnitCost)} | Total ${formatRwf(Number(item.quantity) * Number(item.estimatedUnitCost || 0))}`);
    if (item.description) lines.push(`  Description: ${item.description}`);
  }

  lines.push('', 'Supplier responses:');
  for (const supplier of section.suppliers.filter((entry) => entry.responseAt || entry.amount !== null || (entry.items || []).length)) {
    lines.push(
      '',
      `Supplier: ${supplier.name}`,
      `Invitation email sent: ${readableDate(supplier.emailSentAt, settings)} (${supplier.emailStatus})`,
      `Response received: ${readableDate(supplier.responseAt, settings)}`,
      `Supplier response total: ${formatRwf(supplier.amount)}`,
      `Delivery: ${supplier.deliveryDays === null || supplier.deliveryDays === undefined ? 'Not specified' : `${supplier.deliveryDays} days`}`
    );
    if (supplier.notes) lines.push(`Overall supplier comment: ${supplier.notes}`);
    for (const item of supplier.items) {
      lines.push(`- ${item.itemName}: ${item.quantity} ${item.unit} at ${formatRwf(item.unitPrice)} each; total ${formatRwf(item.lineTotal)}`);
      if (item.comment) lines.push(`  Supplier item comment: ${item.comment}`);
    }
  }

  lines.push('', 'Decision required: open the decision link, choose Accept or Deny for every supplier response, and give a reason for each Deny. Only one decision set is accepted per link.');
  return lines.join('\n');
}

function itemRows(items, { priced = true } = {}) {
  if (!(items || []).length) return '<tr><td colspan="4" style="padding:10px;color:#64748b">No item lines were supplied.</td></tr>';
  return items.map((item) => {
    const unitPrice = priced ? (item.unitPrice ?? 0) : (item.estimatedUnitCost ?? 0);
    const lineTotal = item.lineTotal ?? Number(item.quantity) * Number(unitPrice);
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(item.itemName || 'Item')}</strong>${item.description ? `<br><span style="color:#64748b;font-size:11px">${escapeHtml(item.description)}</span>` : ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(`${item.quantity ?? 0} ${item.unit || 'unit'}`)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(formatRwf(unitPrice))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;text-align:right"><strong>${escapeHtml(formatRwf(lineTotal))}</strong></td>
    </tr>${item.comment ? `<tr><td colspan="4" style="padding:2px 10px 10px;color:#64748b;font-size:11px">Supplier item comment: ${escapeHtml(item.comment)}</td></tr>` : ''}`;
  }).join('');
}

function tableHead() {
  return '<thead><tr style="background:#f1f5f9;text-align:left;color:#475569"><th style="padding:8px 10px">Item</th><th style="padding:8px 10px">Quantity</th><th style="padding:8px 10px">Unit price</th><th style="padding:8px 10px;text-align:right">Total</th></tr></thead>';
}

export function committeeReviewEmailHtml({ recipientName, sections, links, recommendations = {}, generatedAt, settings = {} }) {
  const linkList = (links || []).filter((link) => link && String(link.url || '').trim());
  const linkByReference = new Map();
  for (const link of linkList) {
    for (const key of [link.reference, link.id, link.rfqId]) {
      if (key !== undefined && key !== null) linkByReference.set(String(key), link.url);
    }
  }
  const responseCount = sections.reduce((total, section) => total + section.suppliers.filter((supplier) => supplier.responseAt || supplier.amount !== null || (supplier.items || []).length).length, 0);
  const references = sections.map((section) => section.reference).join(', ');
  const linkHtml = linkList.map((link) =>
    `<p style="margin:10px 0"><a href="${escapeHtml(link.url)}" style="background:#123d3a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">OPEN DECISION FORM · ${escapeHtml(link.reference || link.id || 'RFQ')}</a></p>`
  ).join('');

  const sectionHtml = sections.map((section) => {
    // Never emit an empty href: a button that looks clickable but has no target
    // is exactly how a recipient ends up unable to open the decision form.
    const link = linkByReference.get(String(section.reference))
      || linkByReference.get(String(section.id))
      || (linkList.length === 1 ? linkList[0] : null);
    const url = String(link?.url || '').trim();
    const responses = section.suppliers.filter((supplier) => supplier.responseAt || supplier.amount !== null || (supplier.items || []).length);
    return `<section style="margin-top:26px;border:1px solid #e2e8f0;border-radius:10px;padding:18px">
      <h2 style="margin:0 0 12px;font-size:16px;color:#123d3a">RFQ ${escapeHtml(section.reference)}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        <tr><td style="padding:3px 0;color:#64748b">Requisition</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(section.requisitionReference || '—')}</td></tr>
        <tr><td style="padding:3px 0;color:#64748b">Request</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(section.title || '—')}</td></tr>
        <tr><td style="padding:3px 0;color:#64748b">Department</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(section.department || 'Not specified')}</td></tr>
        <tr><td style="padding:3px 0;color:#64748b">Send date and time</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(readableDate(section.issuedAt, settings))}</td></tr>
        <tr><td style="padding:3px 0;color:#64748b">Response deadline</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(readableDate(section.dueDate, settings))}</td></tr>
      </table>
      ${section.message ? `<p style="margin:14px 0;padding:12px;background:#ecfdf5;border-left:4px solid #123d3a;font-size:13px"><strong>Message from Procurement</strong><br>${escapeHtml(section.message).replace(/\n/g, '<br>')}</p>` : ''}
      <h3 style="margin:18px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569">Requested items</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">${tableHead()}<tbody>${itemRows(section.requestedItems, { priced: false })}</tbody></table>
      ${recommendations[String(section.id)] ? `<div style="margin:16px 0;padding:12px;border-left:4px solid #123d3a;background:#ecfdf5;font-size:12px"><strong>Procurement recommendation: ${escapeHtml(recommendations[String(section.id)].supplierName)}</strong><br><span style="color:#475569">${escapeHtml(recommendations[String(section.id)].reason).replace(/\n/g, '<br>')}</span></div>` : ''}
      <h3 style="margin:20px 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569">Supplier responses</h3>
      ${responses.map((supplier) => `<div style="margin-top:12px;border:1px solid #dbe4ea;border-radius:8px;padding:14px">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px">
          <strong style="font-size:13px">${escapeHtml(supplier.name)}</strong>
          <strong style="font-size:13px;color:#123d3a">${escapeHtml(formatRwf(supplier.amount))}</strong>
        </div>
        <p style="margin:6px 0;font-size:11px;color:#64748b">Email sent ${escapeHtml(readableDate(supplier.emailSentAt, settings))} · Response received ${escapeHtml(readableDate(supplier.responseAt, settings))} · Delivery ${escapeHtml(supplier.deliveryDays ?? 'Not specified')}</p>
        ${supplier.notes ? `<p style="margin:10px 0;padding:10px;background:#f8fafc;font-size:12px"><strong>Overall supplier comment:</strong> ${escapeHtml(supplier.notes)}</p>` : ''}
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">${tableHead()}<tbody>${itemRows(supplier.items)}</tbody></table>
      </div>`).join('')}
      ${url ? `<p style="margin:18px 0 0"><a href="${escapeHtml(url)}" style="background:#123d3a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">OPEN DECISION FORM · ${escapeHtml(section.reference)}</a></p><p style="font-size:11px;color:#475569;word-break:break-all">${escapeHtml(url)}</p>` : ''}
    </section>`;
  }).join('');

  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;padding:24px;font-family:Arial,sans-serif;color:#172a39">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:900px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#123d3a;padding:18px 26px;color:#fff;font-size:16px;font-weight:bold">Hope Haven · Procurement Committee Decision</td></tr>
      <tr><td style="padding:26px">
        <h1 style="margin:0 0 6px;font-size:20px">Supplier responses for review</h1>
        <p style="margin:0;color:#475569;font-size:13px">Hello ${escapeHtml(recipientName)}, Procurement has sent ${escapeHtml(responseCount)} supplier response(s) across ${escapeHtml(sections.length)} RFQ(s). Prepared ${escapeHtml(generatedAt)}.</p>
        <p style="margin:16px 0;padding:12px;background:#eff6ff;border-left:4px solid #2563eb;font-size:12px">Open each decision link below, choose <strong>Accept</strong> or <strong>Deny</strong> for every supplier response, and give a reason for each Deny. No staff login is needed. Only one decision set is accepted per link.</p>
        ${linkHtml}
        ${sectionHtml}
      </td></tr>
      <tr><td style="padding:16px 26px;background:#f8fafc;color:#64748b;font-size:11px">RFQs: ${escapeHtml(references)} · All amounts in RWF.</td></tr>
    </table></body></html>`;
}

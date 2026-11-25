const REPLY_TAG_PATTERN = /\[REQ:(\d+):([a-f0-9]{32})\]/i;

const QUOTE_MARKERS = [
  /^On .+ wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^_{2,}\s*Original Message\s*_{2,}\s*$/i,
  /^Sent from my (iPhone|iPad|Android)/i
];

const NOISE_PATTERNS = [
  /^\[REQ:/i,
  /^to add a comment/i,
  /^keep the subject line/i,
  /^reply (above|below) this line/i,
  /^message from procurement:\s*$/i,
  /^request:\s/i,
  /^title:\s/i,
  /^department:\s/i,
  /^requester:\s/i,
  /^recipient phone:\s/i,
  /^requested items:?\s*$/i,
  /^item\s*\|/i,
  /^grand total:\s/i,
  /^total:\s/i,
  /^reply tag:\s/i
];

export function replyTag(requisitionId, token) {
  return `[REQ:${requisitionId}:${token}]`;
}

export function findRequisitionReplyTag(...sources) {
  for (const source of sources) {
    const match = REPLY_TAG_PATTERN.exec(String(source || ''));
    if (match) {
      return { requisitionId: Number(match[1]), token: match[2].toLowerCase() };
    }
  }
  return null;
}

function isQuoteMarker(line) {
  return QUOTE_MARKERS.some((pattern) => pattern.test(line)) || /^>\s?/.test(line);
}

function isNoise(line) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function cleanLines(lines) {
  return lines
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() && !isNoise(line) && !isQuoteMarker(line))
    .join('\n')
    .trim();
}

export function extractReplyComment(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const quoteIndex = lines.findIndex((line) => isQuoteMarker(line));
  const top = cleanLines(lines.slice(0, quoteIndex < 0 ? lines.length : quoteIndex));
  if (top) return top.slice(0, 5000);

  // Bottom-posted replies still count: ignore the quoted lines and use the
  // recipient's own text that was typed underneath the original message.
  const bottom = cleanLines(lines.slice(quoteIndex + 1));
  return bottom.slice(0, 5000);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function formatRwf(value) {
  const amount = Number(value) || 0;
  return `RWF ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function lineTotal(item) {
  if (item.lineTotal !== undefined && item.lineTotal !== null) return Number(item.lineTotal);
  return Number(item.quantity) * Number(item.estimatedUnitCost);
}

export function buildRequestedItemsEmail({
  requisitionId, reference, title, department, requester, recipientPhone,
  items = [], token, message = '', responseUrl = '',
  subject = null, greeting = '', details = null, noteLabel = 'Message from Procurement:',
  responseLabel = 'Add a comment / respond online',
  responseIntro = 'Open this link, write your comment and submit it',
  responseHelp = 'Your comment is saved directly in Procurement.',
  instructionsTitle = 'To add a comment',
  instructionsText = 'Click the response link above and submit your comment, or reply to this email with your comment above the quoted message. If you reply, keep the subject line unchanged.',
  includeReplyTag = true,
  includeDescription = true,
  includeGrandTotal = true
}) {
  const tag = replyTag(requisitionId, token);
  const subjectLine = subject || `Requested items - ${reference} ${tag}`;
  const detailRows = details || [
    ['Department', department || '—'],
    ['Requester', requester || '—'],
    ['Recipient phone', recipientPhone || 'Not provided']
  ];
  const rows = items.map((item) => ({
    name: item.itemName || item.name || 'Item',
    description: includeDescription ? (item.description || '—') : '',
    quantity: `${item.quantity ?? 0} ${item.unit || 'unit'}`,
    unitCost: formatRwf(item.estimatedUnitCost),
    total: formatRwf(lineTotal(item))
  }));
  const total = rows.reduce((sum, row) => {
    const value = Number(row.total.replace(/[^0-9.]/g, ''));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const note = String(message || '').trim();

  const itemHeader = includeDescription
    ? 'Item | Description | Quantity | Unit price | Total'
    : 'Item | Quantity | Unit price | Total';
  const textLines = [
    greeting || null,
    `Request: ${reference}`,
    `Title: ${title || '—'}`,
    ...detailRows.map(([label, value]) => `${label}: ${value || '—'}`),
    '',
    note ? [noteLabel, note, ''] : null,
    'REQUESTED ITEMS',
    itemHeader,
    ...rows.map((row) => [
      row.name,
      ...(includeDescription ? [row.description] : []),
      row.quantity,
      row.unitCost,
      row.total
    ].join(' | ')),
    '',
    includeGrandTotal ? `GRAND TOTAL: ${formatRwf(total)}` : null,
    '',
    responseUrl ? [
      String(responseLabel).toUpperCase(),
      `${responseIntro}: ${responseUrl}`,
      responseHelp,
      ''
    ] : null,
    String(instructionsTitle).toUpperCase(),
    instructionsText,
    '',
    includeReplyTag ? tag : null
  ].flat().filter((line) => line !== null).join('\n');

  const htmlRows = rows.map((row) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:bold">${escapeHtml(row.name)}</td>
      ${includeDescription ? `<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(row.description)}</td>` : ''}
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(row.quantity)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(row.unitCost)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap;text-align:right;font-weight:bold">${escapeHtml(row.total)}</td>
    </tr>`).join('');
  const itemHeaderCells = [
    '<th style="padding:10px 12px">Item</th>',
    ...(includeDescription ? ['<th style="padding:10px 12px">Description</th>'] : []),
    '<th style="padding:10px 12px">Quantity</th>',
    '<th style="padding:10px 12px">Unit price</th>',
    '<th style="padding:10px 12px;text-align:right">Total</th>'
  ].join('');
  const itemColumnCount = includeDescription ? 5 : 4;
  const totalLabelColumns = includeDescription ? 4 : 3;
  const totalFooterHtml = includeGrandTotal
    ? `<tfoot><tr><td colspan="${totalLabelColumns}" style="padding:12px;text-align:right;font-weight:bold">Grand total</td>
        <td style="padding:12px;text-align:right;font-weight:bold;color:#123d3a">${escapeHtml(formatRwf(total))}</td></tr></tfoot>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;padding:24px;font-family:Arial,sans-serif;color:#172a39">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#123d3a;padding:18px 26px;color:#fff;font-size:16px;font-weight:bold">Hope Haven · Procurement &amp; Stores</td></tr>
      <tr><td style="padding:26px">
        <h1 style="font-size:20px;margin:0 0 6px">Requested items · ${escapeHtml(reference)}</h1>
        <p style="margin:0 0 18px;color:#475569;font-size:13px">${escapeHtml(title || 'Purchase request')}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
          ${detailRows.map(([label, value]) => `<tr><td style="padding:4px 0;color:#64748b">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(value || '—')}</td></tr>`).join('')}
        </table>
        ${note ? `<p style="margin:18px 0;padding:12px;background:#f8fafc;border-left:3px solid #123d3a;font-size:13px"><strong>${escapeHtml(noteLabel)}</strong><br>${escapeHtml(note).replace(/\n/g, '<br>')}</p>` : ''}
        <h2 style="font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em">Requested items</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f1f5f9;text-align:left;color:#475569">${itemHeaderCells}</tr></thead>
          <tbody>${htmlRows || `<tr><td colspan="${itemColumnCount}" style="padding:14px;color:#64748b">No items recorded.</td></tr>`}</tbody>
          ${totalFooterHtml}
        </table>
        ${responseUrl ? `<p style="margin:24px 0 8px">
          <a href="${escapeHtml(responseUrl)}" style="background:#123d3a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(responseLabel)}</a>
        </p>
        <p style="font-size:11px;color:#475569;word-break:break-all">${escapeHtml(responseUrl)}</p>` : ''}
        <div style="margin-top:20px;padding:14px;background:#ecfdf5;border-left:4px solid #123d3a">
          <strong style="font-size:13px">${escapeHtml(instructionsTitle)}</strong>
          <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#334155">${escapeHtml(instructionsText)}</p>
        </div>
        ${includeReplyTag ? `<p style="margin-top:18px;font-size:10px;color:#94a3b8">${escapeHtml(tag)}</p>` : ''}
      </td></tr>
    </table></body></html>`;

  return { subject: subjectLine, text: textLines, html };
}

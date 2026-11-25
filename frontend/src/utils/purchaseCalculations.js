// Frontend mirror of the backend purchase calculations. The backend remains
// authoritative: these helpers are used for validation and document previews
// only, and must use the same rounding rules as backend/src/utils/money.js.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

const SCALES = [
  [1_000_000_000_000, 'Trillion'],
  [1_000_000_000, 'Billion'],
  [1_000_000, 'Million'],
  [1_000, 'Thousand']
];

export const PURCHASE_ORDER_TYPES = ['Standard', 'Urgent', 'Replacement', 'Additional'];

// The admin settings screen stores the configured tax rate for local previews.
// The backend stays authoritative and recalculates the final VAT on save.
export function configuredVatRate() {
  if (typeof localStorage === 'undefined') return 0;
  const rate = Number(localStorage.getItem('pims-tax-rate'));
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function belowThousand(value) {
  const words = [];
  const hundreds = Math.floor(value / 100);
  if (hundreds) words.push(`${ONES[hundreds]} Hundred`);
  const rest = value % 100;
  if (rest) {
    if (rest < 20) words.push(ONES[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      words.push(ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens]);
    }
  }
  return words.join(' ');
}

function wholeNumberWords(value) {
  if (!value) return 'Zero';
  let remaining = value;
  const groups = [];
  for (const [scale, name] of SCALES) {
    const count = Math.floor(remaining / scale);
    if (count) {
      groups.push(`${belowThousand(count)} ${name}`);
      remaining %= scale;
    }
  }
  if (remaining) groups.push(belowThousand(remaining));
  return groups.join(' and ');
}

export function amountInWords(value, { currency = 'Rwandan Francs' } = {}) {
  const amount = roundMoney(value);
  const sign = amount < 0 ? 'Negative ' : '';
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute);
  const cents = Math.round((absolute - whole) * 100);
  let words = wholeNumberWords(whole);
  if (cents) words += ` and ${belowThousand(cents)} Cents`;
  return `${sign}${words} ${currency}`.trim();
}

export function calculatePurchaseTotals(lines = [], vatRate = 0) {
  const rows = Array.isArray(lines) ? lines : [];
  const subtotal = roundMoney(rows.reduce((sum, line) => {
    const quantity = Number(line?.quantity) || 0;
    const unitPrice = Number(line?.unitPrice) || 0;
    return sum + quantity * unitPrice;
  }, 0));
  const numericRate = Number(vatRate);
  const rate = Number.isFinite(numericRate) ? numericRate : 0;
  const vatAmount = roundMoney(subtotal * rate / 100);
  const total = roundMoney(subtotal + vatAmount);
  return {
    subtotal,
    vatRate: rate,
    vatAmount,
    total,
    amountInWords: amountInWords(total)
  };
}

// Suppliers quote their own unit prices against the requested quantities. The
// Administrator's prices are never available here; these totals are a live
// preview of the Supplier's own response and the backend recalculates them.
export function calculateSupplierTotals(lines = [], vatRate = 0, otherCharges = 0) {
  const rows = Array.isArray(lines) ? lines : [];
  const chargesInput = otherCharges && typeof otherCharges === 'object'
    ? otherCharges.otherCharges : otherCharges;
  const quotedLines = rows.map((item) => {
    const quantity = Number(item?.quantity ?? 1) || 0;
    const unitPrice = Number(item?.unitPrice) || 0;
    return { ...item, quantity, unitPrice, lineTotal: roundMoney(quantity * unitPrice) };
  });
  const subtotal = roundMoney(quotedLines.reduce((sum, item) => sum + item.lineTotal, 0));
  const numericRate = Number(vatRate);
  const rate = Number.isFinite(numericRate) ? numericRate : 0;
  const vatAmount = roundMoney(subtotal * rate / 100);
  const charges = roundMoney(Number(chargesInput) || 0);
  const total = roundMoney(subtotal + vatAmount + charges);
  return {
    lines: quotedLines,
    items: quotedLines,
    subtotal,
    vatRate: rate,
    vatAmount,
    otherCharges: charges,
    total,
    amountInWords: amountInWords(total)
  };
}

// Only procurement and administrators may edit a purchase order, and only
// while it is still awaiting approval. The backend enforces the same policy.
export function canEditPurchaseOrder(order, user) {
  return ['admin', 'procurement'].includes(user?.role)
    && order?.status === 'Pending approval'
    && !['Collecting', 'Awarded'].includes(order?.supplierPricingStatus);
}

// PO documents are always denominated in Rwandan Francs, regardless of the
// display currency preference used elsewhere in the app.
export function formatRwf(value) {
  const amount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundMoney(value));
  return `${amount} RWF`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
  'Eighty', 'Ninety'
];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'];

/**
 * Round any finite numeric input to two decimal places. Invalid values become
 * zero so documents never render NaN or Infinity.
 */
export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function underHundred(value) {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function underThousand(value) {
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (!hundreds) return underHundred(remainder);
  return remainder
    ? `${ONES[hundreds]} Hundred ${underHundred(remainder)}`
    : `${ONES[hundreds]} Hundred`;
}

function integerInWords(value) {
  if (value === 0) return 'Zero';
  const groups = [];
  let remaining = value;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const parts = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const scale = SCALES[index] ?? `10^${index}`;
    parts.push(`${underThousand(group)} ${scale}`.trim());
  }
  return parts.join(' and ');
}

/**
 * English amount words for official documents. Fractions are rendered as
 * "... and Twenty Five Cents" and are omitted when zero.
 */
export function amountInWords(value, { currency = 'Rwandan Francs' } = {}) {
  const rounded = roundMoney(value);
  const sign = rounded < 0 ? 'Negative ' : '';
  const absolute = Math.abs(rounded);
  const whole = Math.floor(absolute);
  const cents = Math.round((absolute - whole) * 100);
  const main = `${integerInWords(whole)} ${currency}`.trim();
  return `${sign}${cents ? `${main} and ${underHundred(cents)} Cents` : main}`;
}

/**
 * Calculate official purchase-order figures. Client-supplied totals are never
 * trusted; everything is derived from the line quantities and unit prices and
 * the configured VAT percentage.
 */
export function calculatePurchaseTotals(lines, vatRate) {
  const subtotal = roundMoney((Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    const quantity = Number(line?.quantity) || 0;
    const unitPrice = Number(line?.unitPrice) || 0;
    return sum + roundMoney(quantity * unitPrice);
  }, 0));
  const rate = Math.max(0, roundMoney(vatRate));
  const vatAmount = roundMoney(subtotal * rate / 100);
  const total = roundMoney(subtotal + vatAmount);
  return { subtotal, vatRate: rate, vatAmount, total, amountInWords: amountInWords(total) };
}

import { formatDate, formatDateTime } from './dates.js';

export const currency = (value) => {
  const code = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('pims-currency') || 'USD') : 'USD';
  const precision = typeof localStorage !== 'undefined'
    ? Number(localStorage.getItem('pims-currency-precision') ?? 2) : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(Number(value) || 0);
};

// Existing call sites use these names. They now render DD/MM/YYYY in the
// configured display timezone instead of the previous en-US/local behavior.
export const dateLabel = formatDate;
export const dateTimeLabel = formatDateTime;
export { formatDate, formatDateTime, formatLongDate } from './dates.js';

export const currency = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
}).format(Number(value) || 0);

export const dateLabel = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  value ? new Date(value).toLocaleDateString('en-US', options) : '—';

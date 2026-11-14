/** Presentation only: no payment arithmetic or rounding of stored amounts. */
export function formatMoney(value, currency = 'INR', locale = 'en-IN') {
  if (value === null || value === undefined) return '—';
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (typeof value === 'number')
    return Number.isFinite(value) ? formatter.format(value) : '—';
  if (value.length > 128 || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return '—';
  const [whole, fraction = ''] = value.split('.');
  const integer = BigInt(whole);
  const signed = whole.startsWith('-') && integer === 0n ? -0 : integer;
  const digits = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: 2,
  }).format(BigInt(fraction.padEnd(2, '0')));
  return formatter
    .formatToParts(signed)
    .map((part) => (part.type === 'fraction' ? digits : part.value))
    .join('');
}

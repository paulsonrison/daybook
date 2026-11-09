export function pageWindow(total: number, page: number, pageSize: number) {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const size = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : 1;
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(
    pages,
    Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1),
  );
  return {
    current,
    pages,
    start: count === 0 ? 0 : (current - 1) * size + 1,
    end: Math.min(count, current * size),
    total: count,
  };
}
function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validateDateRange(
  from: string,
  to: string,
  latestAllowedDate?: string,
): string | undefined {
  if (!from || !to) return 'Choose a start and end date.';
  if (!isDate(from) || !isDate(to)) return 'Enter valid dates.';
  if (from > to) return 'Start date must be on or before end date.';
  if (latestAllowedDate && isDate(latestAllowedDate) && to > latestAllowedDate)
    return 'Future deliveries cannot be billed as completed.';
  return undefined;
}
/** Presentation only: no payment arithmetic or rounding of stored amounts. */
export function formatMoney(
  value: number | string | null | undefined,
  currency = 'INR',
  locale = 'en-IN',
) {
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
export function validReadingSize(value: number) {
  return Number.isFinite(value) && value >= 12 && value <= 24;
}

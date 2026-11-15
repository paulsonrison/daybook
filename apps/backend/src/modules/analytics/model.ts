import { fail } from '../context.js';
/** Half-up rounded basis points; arrears recovery can legitimately exceed 100%. */
export function ratioBasisPoints(
  receipts: bigint,
  sales: bigint,
): string | null {
  if (sales <= 0n || receipts < 0n) return null;
  return ((receipts * 10000n + sales / 2n) / sales).toString();
}
export function reportMonth(value: unknown, today: string) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  )
    return fail('Choose a valid report month (YYYY-MM).');
  if (value > today.slice(0, 7))
    return fail('Reports cannot include future months.');
  const startDate = `${value}-01`;
  const next = new Date(`${startDate}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return {
    month: value,
    startDate,
    endDate: new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
    nextDate: next.toISOString().slice(0, 10),
  };
}

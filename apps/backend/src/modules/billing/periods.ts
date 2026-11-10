export interface BillingPeriod {
  from: string;
  to: string;
}
import { cleanText, fail } from '../context.js';
import { calendarDate } from '../scheduling/calendar.js';
import { parseMoney, moneyString } from '../money.js';
export function normalizePeriods(
  periods: BillingPeriod[],
  today: string,
): BillingPeriod[] {
  calendarDate(today);
  if (!Array.isArray(periods) || periods.length < 1 || periods.length > 120)
    return fail('Choose one to 120 billing periods.');
  const sorted = periods
    .map((p) => {
      calendarDate(p.from);
      calendarDate(p.to);
      if (p.from > p.to) return fail('Billing period ends before its start.');
      if (p.to > today) return fail('Future deliveries cannot be billed.');
      return { ...p };
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const merged: BillingPeriod[] = [];
  for (const period of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      calendarDate(period.from).valueOf() <=
        calendarDate(last.to).valueOf() + 86400000
    ) {
      if (period.to > last.to) last.to = period.to;
    } else merged.push(period);
  }
  return merged;
}
export function monthPeriod(month: string, today: string): BillingPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return fail('Choose a valid billing month.');
  const first = calendarDate(`${month}-01`),
    last = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);
  return normalizePeriods(
    [{ from: `${month}-01`, to: last > today ? today : last }],
    today,
  )[0];
}
export function weeklyPeriod(from: string, today: string): BillingPeriod {
  const start = calendarDate(from),
    end = new Date(start.valueOf() + 6 * 86400000);
  if (end.valueOf() > calendarDate(today).valueOf())
    return fail('A weekly period cannot include future deliveries.');
  return normalizePeriods(
    [{ from, to: end.toISOString().slice(0, 10) }],
    today,
  )[0];
}
export function correctedLine(
  baseQuantity: number,
  baseRate: bigint,
  input: {
    quantity?: number | null;
    rate?: string | null;
    reason?: string | null;
  },
): {
  quantity: number;
  ratePaise: bigint;
  amountPaise: bigint;
  reason: string | null;
} {
  const quantity = input.quantity ?? baseQuantity,
    ratePaise = input.rate == null ? baseRate : parseMoney(input.rate);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647)
    return fail('Enter a nonnegative whole-copy quantity.');
  const changed = quantity !== baseQuantity || ratePaise !== baseRate,
    reason = input.reason
      ? cleanText(input.reason, 'bill correction reason', 1000)
      : null;
  if (changed && !reason) return fail('Explain each changed quantity or rate.');
  const amountPaise = ratePaise * BigInt(quantity);
  parseMoney(moneyString(amountPaise));
  return { quantity, ratePaise, amountPaise, reason };
}

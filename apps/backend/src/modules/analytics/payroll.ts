import type { PoolClient } from 'pg';
import type { reportMonth } from './model.js';
import { moneyString } from '../money.js';
import { calendarDate } from '../scheduling/calendar.js';
import { GraphQLError } from 'graphql';
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function records(value: unknown): value is RecordValue[] {
  return Array.isArray(value) && value.every(record);
}
function amount(value: unknown): bigint | null {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^(-?)(0|[1-9]\d*)\.\d{2}$/.test(value)
  )
    return null;
  return BigInt(value.replace('.', ''));
}
function minor(value: unknown): bigint | null {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^(0|[1-9]\d*)$/.test(value)
    ? BigInt(value)
    : null;
}
function date(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    calendarDate(value);
    return true;
  } catch (error) {
    if (
      error instanceof GraphQLError &&
      error.extensions.code === 'BAD_USER_INPUT'
    )
      return false;
    throw error;
  }
}
/** Reconstruct only attributable accrual from immutable posted evidence and reconcile every component. */
export function allocatePostedPayroll(value: unknown) {
  if (
    !record(value) ||
    !records(value.rules) ||
    !records(value.deliveries) ||
    !records(value.attendance) ||
    !Array.isArray(value.claimedDeliveries)
  )
    return null;
  const salary = amount(value.salary),
    commission = amount(value.commission),
    allowance = amount(value.routeAllowance),
    adjustment = amount(value.adjustment),
    reimbursement = amount(value.reimbursement),
    advance = amount(value.advance),
    net = amount(value.net);
  if (
    salary === null ||
    commission === null ||
    allowance === null ||
    adjustment === null ||
    reimbursement === null ||
    advance === null ||
    net === null ||
    salary < 0n ||
    commission < 0n ||
    allowance < 0n ||
    reimbursement < 0n ||
    advance < 0n ||
    net < 0n
  )
    return null;
  if (
    salary + commission + allowance + adjustment + reimbursement !==
    net + advance
  )
    return null;
  for (const rule of value.rules)
    if (
      !date(rule.start) ||
      !date(rule.employmentStart) ||
      (rule.end !== null && !date(rule.end)) ||
      (rule.employmentEnd !== null && !date(rule.employmentEnd)) ||
      minor(rule.copy) === null ||
      minor(rule.route) === null ||
      (rule.end !== null && rule.end < rule.start) ||
      (rule.employmentEnd !== null && rule.employmentEnd < rule.employmentStart)
    )
      return null;
  if (
    value.attendance.some(
      (item) =>
        !date(item.date) ||
        !['PRESENT', 'PAID_LEAVE', 'UNPAID_LEAVE', 'ABSENT'].includes(
          item.status as string,
        ),
    )
  )
    return null;
  const ids = new Set<string>(),
    worked = new Set<string>(),
    routes = new Map<string, bigint>();
  let foundCommission = 0n,
    foundAllowance = 0n;
  for (const delivery of value.deliveries) {
    if (
      typeof delivery.id !== 'string' ||
      ids.has(delivery.id) ||
      !date(delivery.date) ||
      typeof delivery.route !== 'string' ||
      !delivery.route ||
      typeof delivery.quantity !== 'number' ||
      !Number.isSafeInteger(delivery.quantity) ||
      delivery.quantity <= 0
    )
      return null;
    ids.add(delivery.id);
    const day = delivery.date;
    const matches = value.rules.filter(
      (rule) =>
        day >= (rule.start as string) &&
        day >= (rule.employmentStart as string) &&
        (rule.end === null || day <= (rule.end as string)) &&
        (rule.employmentEnd === null || day <= (rule.employmentEnd as string)),
    );
    if (matches.length !== 1) return null;
    const rule = matches[0];
    let cost = minor(rule.copy)! * BigInt(delivery.quantity);
    foundCommission += cost;
    const key = day + ':' + delivery.route;
    const present = value.attendance.filter((item) => item.date === day);
    if (present.length > 1) return null;
    if (present[0]?.status === 'PRESENT' && !worked.has(key)) {
      worked.add(key);
      const routeCost = minor(rule.route)!;
      cost += routeCost;
      foundAllowance += routeCost;
    }
    routes.set(delivery.route, (routes.get(delivery.route) ?? 0n) + cost);
  }
  const claims = value.claimedDeliveries;
  if (
    claims.length !== ids.size ||
    new Set(claims).size !== claims.length ||
    claims.some((id) => typeof id !== 'string' || !ids.has(id)) ||
    foundCommission !== commission ||
    foundAllowance !== allowance
  )
    return null;
  return {
    routes,
    unallocated: salary + adjustment + reimbursement,
    expense: net + advance,
  };
}

export async function readAnalyticsPayroll(
  c: PoolClient,
  period: ReturnType<typeof reportMonth>,
) {
  const posted = (
    await c.query<{ snapshot: unknown; net: string; id: string }>(
      'SELECT id,snapshot,net_paise::text AS net FROM daybook.payslips WHERE month=$1::date ORDER BY id',
      [period.startDate],
    )
  ).rows;
  const routes = new Map<string, bigint>();
  const supportedPayslips: string[] = [];
  let expense = 0n,
    unallocated = 0n,
    unsupported = 0;
  for (const row of posted) {
    const allocation = allocatePostedPayroll(row.snapshot);
    if (
      !allocation ||
      !record(row.snapshot) ||
      amount(row.snapshot.net) !== BigInt(row.net)
    ) {
      unsupported++;
      continue;
    }
    supportedPayslips.push(row.id);
    expense += allocation.expense;
    unallocated += allocation.unallocated;
    for (const [route, cost] of allocation.routes)
      routes.set(route, (routes.get(route) ?? 0n) + cost);
  }
  const payouts = (
    await c.query<{ amount: string }>(
      'SELECT coalesce(sum(amount_paise),0)::text AS amount FROM daybook.payroll_payouts WHERE posting_date>=$1::date AND posting_date<$2::date',
      [period.startDate, period.nextDate],
    )
  ).rows[0];
  return {
    routes,
    supportedPayslips,
    summary: {
      postedExpense: unsupported ? null : moneyString(expense),
      unallocatedExpense: unsupported ? null : moneyString(unallocated),
      knownPostedExpense: moneyString(expense),
      attributableRouteExpense: moneyString(
        [...routes.values()].reduce((n, v) => n + v, 0n),
      ),
      actualPayouts: moneyString(BigInt(payouts.amount)),
      postedPayslips: posted.length.toString(),
      unsupportedPayslips: unsupported.toString(),
      coverage: !posted.length
        ? 'UNAVAILABLE'
        : unsupported
          ? 'PARTIAL'
          : 'COMPLETE',
    },
  };
}

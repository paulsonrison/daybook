import type { PoolClient } from 'pg';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { moneyString, parseMoney } from '../money.js';
import { agencyToday } from '../delivery/repository.js';
import { financialRead } from '../billing/transactions.js';
import { financialResidents } from '../reports/financial-residents.js';
import { queueCreditHoldNotice } from '../communications/account-notices.js';
interface Policy {
  maxOverdueAmount: string | null;
  maxOverdueDays: number | null;
  enabled: boolean;
  version: number;
}
export async function readCreditPolicy(c: PoolClient): Promise<Policy> {
  const row = (
    await c.query<{
      amount: string | null;
      maxOverdueDays: number | null;
      enabled: boolean;
      version: number;
    }>(
      'SELECT max_overdue_paise::text AS amount,max_overdue_days AS "maxOverdueDays",enabled,version FROM daybook.credit_policies',
    )
  ).rows[0];
  return row
    ? {
        maxOverdueAmount:
          row.amount === null ? null : moneyString(BigInt(row.amount)),
        maxOverdueDays: row.maxOverdueDays,
        enabled: row.enabled,
        version: row.version,
      }
    : { maxOverdueAmount: null, maxOverdueDays: 60, enabled: true, version: 0 };
}
export const creditPolicy = (ctx: RequestContext) =>
  financialRead(ctx, readCreditPolicy);
export function saveCreditPolicy(
  ctx: RequestContext,
  input: {
    maxOverdueAmount?: string | null;
    maxOverdueDays?: number | null;
    enabled?: boolean;
    version?: number;
  },
) {
  return configMutation(ctx, async (c) => {
    const old = await readCreditPolicy(c);
    if (old.version) versionMatches(old.version, input.version);
    const amount =
        input.maxOverdueAmount === undefined
          ? old.maxOverdueAmount
          : input.maxOverdueAmount,
      days =
        input.maxOverdueDays === undefined
          ? old.maxOverdueDays
          : input.maxOverdueDays,
      enabled = input.enabled ?? old.enabled,
      paise = amount === null ? null : parseMoney(amount);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
      return fail('Choose overdue days between one and 3650.');
    if (enabled && paise === null && days === null)
      return fail('Choose at least one enabled credit threshold.');
    await c.query(
      'INSERT INTO daybook.credit_policies(agency_id,max_overdue_paise,max_overdue_days,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET max_overdue_paise=excluded.max_overdue_paise,max_overdue_days=excluded.max_overdue_days,enabled=excluded.enabled,version=credit_policies.version+1',
      [ctx.agent!.agencyId, paise?.toString() ?? null, days, enabled],
    );
    const result = await readCreditPolicy(c);
    await audit(
      c,
      ctx,
      'CREDIT_POLICY',
      ctx.agent!.agencyId,
      'UPDATED',
      result,
    );
    return result;
  });
}
async function riskState(c: PoolClient) {
  const today = await agencyToday(c),
    policy = await readCreditPolicy(c),
    residents = await financialResidents(c, today),
    limit =
      policy.maxOverdueAmount === null
        ? null
        : parseMoney(policy.maxOverdueAmount);
  const accounts = residents
    .filter((r) => ['ACTIVE', 'SUSPENDED'].includes(r.status))
    .map((r) => {
      const exceedsAmount = limit !== null && r.overduePaise > limit,
        exceedsDays =
          policy.maxOverdueDays !== null &&
          r.overduePaise > 0n &&
          r.overdueDays >= policy.maxOverdueDays;
      return {
        residentId: r.residentId,
        name: r.name,
        code: r.code,
        phone: r.phone,
        status: r.status,
        version: r.version,
        routeId: r.routeId,
        routeName: r.routeName,
        sequence: r.sequence,
        balance: moneyString(r.balancePaise),
        overdueAmount: moneyString(r.overduePaise),
        oldestDueDate: r.oldestDueDate,
        overdueDays: r.overdueDays,
        exceedsAmount,
        exceedsDays,
        highRisk:
          policy.enabled &&
          r.balancePaise > 0n &&
          (exceedsAmount || exceedsDays),
      };
    });
  return {
    today,
    policy,
    accounts,
    highRiskCount: accounts.filter((r) => r.highRisk).length,
  };
}
export const creditRiskSummary = (ctx: RequestContext) =>
  financialRead(ctx, riskState);
export function suspendForCredit(
  ctx: RequestContext,
  input: {
    requestId: string;
    residentId: string;
    version: number;
    reason: string;
  },
) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'CREDIT_SUSPENSION',
      input,
      async () => {
        const state = await riskState(c),
          resident = state.accounts.find(
            (r) => r.residentId === idValue(input.residentId),
          );
        if (!resident) return fail('Resident not found.', 'NOT_FOUND');
        versionMatches(resident.version, input.version);
        if (resident.status !== 'ACTIVE')
          return fail(
            'This resident service is already suspended.',
            'CONFLICT',
          );
        if (!resident.highRisk)
          return fail(
            'This account does not exceed the configured overdue credit limits.',
          );
        const reason = cleanText(input.reason, 'suspension reason', 1000);
        await c.query(
          "UPDATE daybook.residents SET status='SUSPENDED',version=version+1 WHERE id=$1",
          [resident.residentId],
        );
        const notification = await queueCreditHoldNotice(
          c,
          ctx,
          resident.residentId,
          input.requestId,
          reason,
        );
        const notificationId = notification.id;
        await audit(c, ctx, 'RESIDENT', resident.residentId, 'CREDIT_HOLD', {
          reason,
          notificationId,
          notificationStatus: notification.status,
          policy: state.policy,
        });
        return {
          residentId: resident.residentId,
          notificationId,
        };
      },
    );
    const current = (
      await c.query<{
        residentId: string;
        status: string;
        notificationStatus: string;
      }>(
        'SELECT r.id AS "residentId",r.status,n.status AS "notificationStatus" FROM daybook.residents r JOIN daybook.notification_intents n ON n.resident_id=r.id WHERE r.id=$1 AND n.dedupe_key=$2',
        [saved.residentId, `CREDIT_HOLD:${input.requestId}`],
      )
    ).rows[0];
    if (!current)
      return fail(
        'The original service hold record is unavailable.',
        'NOT_FOUND',
      );
    return current;
  });
}

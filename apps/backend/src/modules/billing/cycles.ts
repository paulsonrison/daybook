import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { configMutation, fail, type RequestContext } from '../context.js';
import { onceRequest } from '../requests.js';
import { agencyToday } from '../delivery/repository.js';
import { financialRead } from './transactions.js';
import { monthPeriod } from './periods.js';
import { missingPreparation, readPolicy } from './repository.js';
import { queueCycleInvoices } from './automatic.js';
interface CycleInput {
  requestId: string;
  month: string;
  acknowledgeUnmarkedDays?: boolean;
}
export function billingCycles(ctx: RequestContext) {
  return financialRead(ctx, async (c) =>
    (
      await c.query<{
        id: string;
        month: string;
        summary: { autoIssueQueued: number };
      }>(
        "SELECT id,to_char(cycle_month,'YYYY-MM') AS month,summary FROM daybook.billing_cycles ORDER BY cycle_month",
      )
    ).rows.map((r) => ({
      id: r.id,
      month: r.month,
      autoIssueQueued: r.summary.autoIssueQueued,
    })),
  );
}
export function closeCycle(ctx: RequestContext, input: CycleInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'CLOSE_CYCLE',
      input,
      () =>
        closeMonth(
          c,
          ctx.agent!.agencyId,
          input.month,
          input.acknowledgeUnmarkedDays === true,
          ctx.agent!.id,
        ),
    ),
  );
}
export async function closeMonth(
  c: PoolClient,
  agencyId: string,
  month: string,
  acknowledged: boolean,
  actorId: string | null,
  now = new Date(),
) {
  const today = await agencyToday(c, now),
    period = monthPeriod(month, today);
  if (month >= today.slice(0, 7))
    return fail('Close a completed calendar month.');
  const previous = (
    await c.query<{ id: string; summary: { autoIssueQueued: number } }>(
      'SELECT id,summary FROM daybook.billing_cycles WHERE cycle_month=$1',
      [period.from],
    )
  ).rows[0];
  if (previous)
    return {
      id: previous.id,
      month,
      autoIssueQueued: previous.summary.autoIssueQueued,
    };
  const createdDate = (
    await c.query<{ date: string }>(
      "SELECT to_char(created_at AT TIME ZONE timezone,'YYYY-MM-DD') AS date FROM daybook.agencies WHERE id=daybook.current_agency()",
    )
  ).rows[0].date;
  const missing = await missingPreparation(
    c,
    [period],
    actorId ? undefined : createdDate,
  );
  if (missing.count && !acknowledged)
    return fail(
      'Prepare every delivery date or acknowledge unprepared dates before closing this cycle.',
    );
  const policy = await readPolicy(c);
  if (policy.autoIssue && missing.count)
    return fail(
      'Prepare every delivery date before automatic invoice issuing.',
    );
  const autoIssueQueued = policy.autoIssue
    ? await queueCycleInvoices(c, agencyId, month)
    : 0;
  const balances = (
    await c.query<{ residentId: string; balancePaise: string }>(
      'SELECT resident_id AS "residentId",sum(amount_paise)::text AS "balancePaise" FROM daybook.ledger_entries WHERE entry_date<=$1 GROUP BY resident_id ORDER BY resident_id',
      [period.to],
    )
  ).rows;
  const counts = (
    await c.query<{ deliveries: number; copies: string }>(
      'SELECT count(*)::integer AS deliveries,coalesce(sum(chargeable_quantity),0)::text AS copies FROM daybook.delivery_logs WHERE delivery_date BETWEEN $1 AND $2',
      [period.from, period.to],
    )
  ).rows[0];
  const summary = {
      autoIssueQueued,
      missingDayCount: missing.count,
      acknowledgeUnmarkedDays: acknowledged,
      balances,
      ...counts,
    },
    id = randomUUID();
  await c.query(
    'INSERT INTO daybook.billing_cycles(id,agency_id,cycle_month,summary,closed_by) VALUES($1,$2,$3,$4,$5)',
    [id, agencyId, period.from, JSON.stringify(summary), actorId],
  );
  await c.query(
    "INSERT INTO daybook.audit_events(id,agency_id,actor_id,actor_kind,entity_type,entity_id,action,details) VALUES(gen_random_uuid(),$1,$2,$3,'BILLING_CYCLE',$4,'CLOSED',$5)",
    [
      agencyId,
      actorId,
      actorId ? 'AGENT' : 'SYSTEM',
      id,
      JSON.stringify({ month, ...summary }),
    ],
  );
  return { id, month, autoIssueQueued };
}
export const cycleTypeDefs = `type BillingCycle {id:ID!,month:String!,autoIssueQueued:Int!}
input CycleCloseInput {requestId:ID!,month:String!,acknowledgeUnmarkedDays:Boolean}
extend type Query {billingCycles:[BillingCycle!]!}
extend type Mutation {closeCycle(input:CycleCloseInput!):BillingCycle!}`;
export const cycleResolvers = {
  Query: {
    billingCycles: (_r: unknown, _a: unknown, c: RequestContext) =>
      billingCycles(c),
  },
  Mutation: {
    closeCycle: (_r: unknown, a: { input: CycleInput }, c: RequestContext) =>
      closeCycle(c, a.input),
  },
};

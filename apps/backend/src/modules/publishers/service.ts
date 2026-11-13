import { randomUUID } from 'node:crypto';
import {
  agencyRead,
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { calendarDate } from '../scheduling/calendar.js';
import { localClock } from '../scheduling/time.js';
import { listPublications } from '../publications/repository.js';
import { moneyString, parseMoney } from '../money.js';
import { procurementCost, type CostInput } from './cost.js';
import {
  findPublisher,
  findSupply,
  insertReturn,
  insertSupply,
  publisherTimezone,
  readPublishers,
  readReturns,
  readSupply,
  returnDeadline,
  statementReturns,
  statementSupply,
  writePublisher,
} from './repository.js';
export interface PublisherInput {
  id?: string;
  version?: number;
  name: string;
  phone: string;
  returnCutoff: string;
  returnWindowDays: number;
  active?: boolean;
}
export const publishers = (ctx: RequestContext) =>
  agencyRead(ctx, readPublishers);
export function savePublisher(ctx: RequestContext, input: PublisherInput) {
  return configMutation(ctx, async (c) => {
    const id = input.id ? idValue(input.id) : randomUUID(),
      name = cleanText(input.name, 'publisher name'),
      phone = cleanText(input.phone, 'publisher phone', 30);
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.returnCutoff) ||
      !Number.isInteger(input.returnWindowDays) ||
      input.returnWindowDays < 0 ||
      input.returnWindowDays > 31
    )
      return fail(
        'Choose a valid local cutoff and a return window of zero to 31 days.',
      );
    const old = input.id ? await findPublisher(c, id) : undefined;
    if (input.id) {
      if (!old) return fail('Publisher not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const result = await writePublisher(
      c,
      ctx.agent!.agencyId,
      {
        id,
        name,
        phone,
        returnCutoff: input.returnCutoff,
        returnWindowDays: input.returnWindowDays,
        active: input.active ?? old?.active ?? true,
      },
      Boolean(old),
    );
    await audit(
      c,
      ctx,
      'publisher',
      id,
      old ? 'publisher.updated' : 'publisher.created',
      { version: result.version },
    );
    return result;
  });
}
export interface SupplyInput extends CostInput {
  requestId: string;
  publisherId: string;
  publicationId: string;
  date: string;
  quantity: number;
}
function quantity(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 1000000)
    return fail('Enter one to one million copies.');
  return value;
}
export const supplyLots = (ctx: RequestContext) => agencyRead(ctx, readSupply);
export const supplyReturns = (ctx: RequestContext) =>
  agencyRead(ctx, readReturns);
export function receiveSupply(ctx: RequestContext, input: SupplyInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'supply.receive',
      input,
      async () => {
        const publisherId = idValue(input.publisherId),
          publicationId = idValue(input.publicationId);
        calendarDate(input.date);
        quantity(input.quantity);
        const publisher = await findPublisher(c, publisherId),
          publication = (await listPublications(c)).find(
            (p) => p.id === publicationId,
          );
        if (!publisher || !publication)
          return fail('Publisher or publication not found.', 'NOT_FOUND');
        if (!publisher.active || !publication.active)
          return fail('Choose an active publisher and publication.');
        const timezone = await publisherTimezone(c);
        if (input.date > localClock(new Date(), timezone).date)
          return fail('Record supply only after it is received.');
        const cost = procurementCost(input, publication.procurementNetCost),
          totalPaise = cost.netPaise * BigInt(input.quantity);
        parseMoney(moneyString(totalPaise));
        const id = randomUUID();
        const received = await insertSupply(c, ctx.agent!.agencyId, {
          id,
          publisherId,
          publicationId,
          date: input.date,
          quantity: input.quantity,
          publicationName: `${publication.name} · ${publication.edition}`,
          dispatch: publication.dispatch,
          ...cost,
          totalPaise,
          deadline: await returnDeadline(c, input.date, publisher, timezone),
        });
        await audit(c, ctx, 'supply', id, 'supply.received', {
          publisherId,
          publicationId,
          quantity: input.quantity,
          netCost: received.netCost,
        });
        const { netPaise: _, ...result } = received;
        return result;
      },
    ),
  );
}
export interface ReturnInput {
  requestId: string;
  supplyId: string;
  quantity: number;
  reason: string;
}
export async function recordReturnInTransaction(
  c: import('pg').PoolClient,
  ctx: RequestContext,
  input: ReturnInput,
) {
  return onceRequest(
    c,
    ctx.agent!.agencyId,
    input.requestId,
    'supply.return',
    input,
    async () => {
      const supply = await findSupply(c, idValue(input.supplyId));
      if (!supply) return fail('Supply lot not found.', 'NOT_FOUND');
      quantity(input.quantity);
      if (new Date() >= new Date(supply.returnDeadline))
        return fail(
          'This supply lot passed its snapshotted publisher return cutoff.',
        );
      if (input.quantity > supply.quantity - supply.returned)
        return fail('Return quantity exceeds the remaining eligible supply.');
      const reason = cleanText(input.reason, 'return reason', 500),
        creditPaise = supply.netPaise * BigInt(input.quantity),
        id = randomUUID();
      const result = await insertReturn(c, ctx.agent!.agencyId, {
        id,
        supplyId: supply.id,
        quantity: input.quantity,
        reason,
        creditPaise,
        date: localClock(new Date(), await publisherTimezone(c)).date,
      });
      await audit(c, ctx, 'supply_return', id, 'supply.returned', {
        supplyId: supply.id,
        quantity: input.quantity,
        credit: result.credit,
      });
      return result;
    },
  );
}
export function recordReturn(ctx: RequestContext, input: ReturnInput) {
  return configMutation(ctx, (c) => recordReturnInTransaction(c, ctx, input));
}

export function publisherStatement(
  ctx: RequestContext,
  publisherId: string,
  month: string,
) {
  return agencyRead(ctx, async (c) => {
    idValue(publisherId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      return fail('Choose a valid reconciliation month.');
    calendarDate(`${month}-01`);
    if (!(await findPublisher(c, publisherId)))
      return fail('Publisher not found.', 'NOT_FOUND');
    const supplies = await statementSupply(c, publisherId, month),
      returns = await statementReturns(c, publisherId, month);
    const grouped = new Map<
      string,
      {
        publicationId: string;
        name: string;
        dispatch: string;
        supplied: number;
        returned: number;
        cost: bigint;
        credit: bigint;
      }
    >();
    for (const row of [...supplies, ...returns]) {
      const key = `${row.publicationId}:${row.dispatch}`;
      let group = grouped.get(key);
      if (!group) {
        group = {
          publicationId: row.publicationId,
          name: row.name,
          dispatch: row.dispatch,
          supplied: 0,
          returned: 0,
          cost: 0n,
          credit: 0n,
        };
        grouped.set(key, group);
      }
      if ('cost' in row) {
        group.supplied += row.quantity;
        group.cost += BigInt(row.cost);
      } else {
        group.returned += row.quantity;
        group.credit += BigInt(row.credit);
      }
    }
    const rows = [...grouped.values()].map((r) => ({
      publicationId: r.publicationId,
      name: r.name,
      dispatch: r.dispatch,
      supplied: r.supplied,
      returned: r.returned,
      supplyCost: moneyString(r.cost),
      returnCredit: moneyString(r.credit),
      netPayable: moneyString(r.cost - r.credit),
    }));
    const cost = supplies.reduce((sum, r) => sum + BigInt(r.cost), 0n),
      credit = returns.reduce((sum, r) => sum + BigInt(r.credit), 0n);
    return {
      publisherId,
      month,
      supplied: supplies.reduce((sum, r) => sum + r.quantity, 0),
      returned: returns.reduce((sum, r) => sum + r.quantity, 0),
      supplyCost: moneyString(cost),
      returnCredit: moneyString(credit),
      netPayable: moneyString(cost - credit),
      rows,
    };
  });
}

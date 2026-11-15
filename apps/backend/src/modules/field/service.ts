import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  requireAgent,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { readResidents } from '../residents/repository.js';
import { readRoutes } from '../routes/repository.js';
import { readDeliveries } from '../delivery/repository.js';
import { overrideDeliveryInTransaction } from '../delivery/service.js';
import { recordPaymentInTransaction } from '../payments/service.js';
import { readLedger } from '../ledger/repository.js';
import { moneyString } from '../money.js';
import { onceRequest } from '../requests.js';
import { calendarDate } from '../scheduling/calendar.js';

async function cashState(c: PoolClient, residentId: string) {
  const resident = (await readResidents(c, residentId))[0];
  if (!resident) return fail('Resident not found.', 'NOT_FOUND');
  const ledger = await readLedger(c, residentId);
  const payments = (
    await c.query(
      'SELECT id,version FROM daybook.payments WHERE resident_id=$1 ORDER BY id',
      [residentId],
    )
  ).rows;
  const balance = moneyString(
    ledger.reduce((sum, row) => sum + row.amountPaise, 0n),
  );
  const cashVersion = createHash('sha256')
    .update(
      JSON.stringify([
        resident.version,
        resident.status,
        ledger.map((row) => [
          row.id,
          row.amountPaise.toString(),
          row.settledPaise.toString(),
        ]),
        payments,
      ]),
    )
    .digest('hex');
  return {
    id: resident.id,
    name: resident.name,
    address: resident.address,
    balance,
    cashVersion,
  };
}
export function fieldSnapshot(
  ctx: RequestContext,
  date: string,
  routeId: string,
) {
  return financialRead(ctx, async (c) => {
    calendarDate(date);
    idValue(routeId);
    const route = (await readRoutes(c, routeId))[0];
    if (!route?.active) return fail('Route not found.', 'NOT_FOUND');
    const people = (await readResidents(c)).filter(
      (r) => r.routeId === routeId && r.status !== 'CLOSED',
    );
    const deliveries = await readDeliveries(c, date, routeId);
    if (people.length > 500 || deliveries.length > 2000)
      return fail(
        'This route is too large for offline use. Split it into smaller routes.',
      );
    const residents = [];
    for (const person of people) residents.push(await cashState(c, person.id));
    return {
      agencyId: ctx.agent!.agencyId,
      agentId: ctx.agent!.id,
      date,
      routeName: route.name,
      downloadedAt: new Date().toISOString(),
      residents,
      deliveries,
    };
  });
}
export interface FieldActionInput {
  requestId: string;
  agencyId: string;
  agentId: string;
  kind: string;
  recordId: string;
  expectedVersion: string;
  occurredAt: string;
  reason: string;
  status?: string | null;
  amount?: string | null;
  date?: string | null;
}
export function syncFieldAction(ctx: RequestContext, input: FieldActionInput) {
  const { agent } = requireAgent(ctx);
  if (input.agencyId !== agent.agencyId || input.agentId !== agent.id)
    return fail('This pending entry belongs to another account.', 'FORBIDDEN');
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      agent.agencyId,
      input.requestId,
      'field.sync',
      input,
      async () => {
        idValue(input.recordId);
        const occurred = Date.parse(input.occurredAt);
        if (!Number.isFinite(occurred) || occurred > Date.now() + 300000)
          return fail('The entry time is invalid.');
        const reason = cleanText(input.reason, 'field evidence', 500);
        // A distinct deterministic child request preserves existing domain retry rules.
        const hex = createHash('sha256')
          .update(`field-domain:${input.requestId}`)
          .digest('hex');
        const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
        let status: string,
          receiptCode: string | null = null;
        if (input.kind === 'DELIVERY') {
          if (!/^[1-9]\d{0,9}$/.test(input.expectedVersion))
            return fail('Invalid delivery version.');
          const result = await overrideDeliveryInTransaction(c, ctx, {
            id: input.recordId,
            version: Number(input.expectedVersion),
            status: input.status ?? '',
            reason,
            requestId,
          });
          status = result.status;
        } else if (input.kind === 'CASH') {
          const state = await cashState(c, input.recordId);
          if (state.cashVersion !== input.expectedVersion)
            return fail(
              'The account changed since download. Review the pending cash against a fresh balance.',
              'CONFLICT',
            );
          if (!input.date) return fail('Enter the date cash was received.');
          // Domain confirmation posts on the server agency date, never a client clock.
          const payment = await recordPaymentInTransaction(c, ctx, {
            requestId,
            residentId: input.recordId,
            purpose: 'ACCOUNT',
            method: 'CASH',
            amount: input.amount ?? '',
            date: input.date,
            confirmReceived: true,
            confirmationNote: reason,
          });
          status = payment.status;
          receiptCode = payment.receiptCode;
        } else
          return fail(
            'Only delivery updates and cash receipts can be synchronized.',
          );
        await audit(c, ctx, 'FIELD_ACTION', input.recordId, 'FIELD_SYNCED', {
          requestId: input.requestId,
          kind: input.kind,
          occurredAt: input.occurredAt,
          expectedVersion: input.expectedVersion,
        });
        return {
          requestId: input.requestId,
          kind: input.kind,
          status,
          receiptCode,
        };
      },
    ),
  );
}

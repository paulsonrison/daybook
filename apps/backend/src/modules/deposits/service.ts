import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { parseMoney, moneyString } from '../money.js';
import { nextCode } from '../counter.js';
import { lockResident } from '../residents/repository.js';
import {
  depositBalance,
  depositByRequest,
  depositReceipt,
  insertDeposit,
} from './repository.js';
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function receiveDeposit(
  client: PoolClient,
  ctx: RequestContext,
  residentId: string,
  requestId: string,
  amount: bigint,
  origin: 'opening' | 'recorded',
) {
  const hash = fingerprint({ residentId, amount: amount.toString(), origin });
  const existing = await depositByRequest(client, requestId);
  if (existing) {
    if (existing.fingerprint !== hash)
      return fail(
        'This request identifier was already used for a different deposit.',
        'CONFLICT',
      );
    return depositReceipt(existing);
  }
  if (amount <= 0n) return fail('Enter a deposit greater than zero.');
  const balance = (await depositBalance(client, residentId)) + amount;
  parseMoney(moneyString(balance));
  const row = await insertDeposit(client, {
    id: randomUUID(),
    agencyId: ctx.agent!.agencyId,
    residentId,
    requestId,
    fingerprint: hash,
    receiptCode: await nextCode(client, ctx.agent!.agencyId, 'deposit', 'DEP-'),
    amount,
    balance,
    actorId: ctx.agent!.id,
  });
  await audit(client, ctx, 'deposit', row.id, 'deposit.received', {
    residentId,
    amount: moneyString(amount),
    origin,
  });
  return depositReceipt(row);
}
export function recordDeposit(
  ctx: RequestContext,
  input: { residentId: string; requestId: string; amount: string },
) {
  return configMutation(ctx, async (client) => {
    const id = idValue(input.residentId),
      requestId = idValue(input.requestId),
      person = await lockResident(client, id);
    if (!person) return fail('Resident not found.', 'NOT_FOUND');
    if (person.status === 'CLOSED')
      return fail('This resident account is closed.');
    return receiveDeposit(
      client,
      ctx,
      id,
      requestId,
      parseMoney(input.amount),
      'recorded',
    );
  });
}

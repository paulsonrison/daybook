import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { nextCode } from '../counter.js';
import { calendarDate } from '../scheduling/calendar.js';
import { agencyToday } from '../delivery/repository.js';
import { moneyString, parseMoney } from '../money.js';
import { depositBalance } from '../deposits/repository.js';
import { readLedger } from '../ledger/repository.js';
import { postEntry, settleResident } from '../ledger/service.js';
import { buildBill } from '../billing/engine.js';
import { persistInvoice } from '../billing/service.js';
import { financialRead } from '../billing/transactions.js';
import { readResidents } from '../residents/repository.js';
import { listSubscriptions } from '../subscriptions/repository.js';
import {
  readOrders,
  moveStock,
  orderStatus,
} from '../merchandise/repository.js';
interface PreviewInput {
  residentId: string;
  terminationDate: string;
}
interface ClearanceInput extends PreviewInput {
  requestId: string;
  previewFingerprint: string;
  acknowledgeUnmarkedDays?: boolean;
}
interface RefundInput {
  requestId: string;
  clearanceId: string;
  amount: string;
  method: string;
  reference?: string | null;
  confirmationNote: string;
}
async function balances(c: PoolClient, residentId: string) {
  const rows = await readLedger(c, residentId),
    balance = rows.reduce((sum, r) => sum + r.amountPaise, 0n),
    deposit = await depositBalance(c, residentId),
    offset = balance > 0n ? (balance < deposit ? balance : deposit) : 0n,
    remaining = balance - offset,
    refund = deposit - offset + (remaining < 0n ? -remaining : 0n);
  return {
    balance,
    deposit,
    offset,
    remaining,
    refund,
    collection: remaining > 0n ? remaining : 0n,
  };
}
async function prepare(c: PoolClient, input: PreviewInput) {
  const residentId = idValue(input.residentId),
    date = input.terminationDate,
    today = await agencyToday(c);
  calendarDate(date);
  if (date > today)
    return fail('Confirm clearance on or after the termination date.');
  const resident = (await readResidents(c, residentId))[0];
  if (!resident) return fail('Resident not found.', 'NOT_FOUND');
  if (resident.status === 'CLOSED')
    return fail('This account is already archived.', 'CONFLICT');
  const later = (
    await c.query(
      'SELECT 1 FROM daybook.delivery_logs WHERE resident_id=$1 AND delivery_date>$2 AND chargeable_quantity>0 UNION ALL SELECT 1 FROM daybook.merchandise_charges WHERE resident_id=$1 AND charge_date>$2 LIMIT 1',
      [residentId, date],
    )
  ).rowCount;
  if (later)
    return fail(
      'Recorded deliveries or fulfilled items exist after this termination date. Review the effective date.',
      'CONFLICT',
    );
  const subscriptions = await listSubscriptions(c, residentId),
    orders = (await readOrders(c)).filter(
      (o) =>
        o.residentId === residentId &&
        ['PREORDER', 'RESERVED'].includes(o.status),
    ),
    pending = (
      await c.query<{ id: string; version: number }>(
        "SELECT id,version FROM daybook.payments WHERE resident_id=$1 AND status='PENDING' ORDER BY id",
        [residentId],
      )
    ).rows;
  const earliest =
    (
      await c.query<{ date: string | null }>(
        "SELECT to_char(min(date),'YYYY-MM-DD') AS date FROM(SELECT start_date AS date FROM daybook.subscriptions WHERE resident_id=$1 UNION ALL SELECT delivery_date FROM daybook.delivery_logs WHERE resident_id=$1 UNION ALL SELECT charge_date FROM daybook.merchandise_charges WHERE resident_id=$1 AND settlement='INVOICE') dates WHERE date<=$2",
        [residentId, date],
      )
    ).rows[0].date ?? date;
  const built = await buildBill(c, {
      residentId,
      periodMode: 'CUSTOM',
      periods: [{ from: earliest, to: date }],
      corrections: [],
      adjustments: [],
      note: 'Final bill on resident account clearance',
    }),
    account = await balances(c, residentId),
    balance = account.balance + built.invoiceTotal,
    offset =
      balance > 0n
        ? balance < account.deposit
          ? balance
          : account.deposit
        : 0n,
    remaining = balance - offset,
    refund = account.deposit - offset + (remaining < 0n ? -remaining : 0n);
  const deposits = (
    await c.query(
      'SELECT id,kind,amount_paise::text FROM daybook.deposit_entries WHERE resident_id=$1 ORDER BY id',
      [residentId],
    )
  ).rows;
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        input: { residentId, terminationDate: date },
        resident,
        subscriptions,
        orders,
        pending,
        deposits,
        bill: built.preview.fingerprint,
      }),
    )
    .digest('hex');
  return {
    built,
    resident,
    orders,
    pending,
    preview: {
      fingerprint,
      residentId,
      terminationDate: date,
      finalCharges: moneyString(built.invoiceTotal),
      balanceBeforeOffset: moneyString(balance),
      depositBalance: moneyString(account.deposit),
      depositOffset: moneyString(offset),
      refundDue: moneyString(refund),
      collectionDue: moneyString(remaining > 0n ? remaining : 0n),
      missingDayCount: built.preview.missingDayCount,
      missingDays: built.preview.missingDays,
      unresolvedPayments: pending.length,
      cancelledOrders: orders.length,
    },
    offset,
  };
}
export const previewClearance = (ctx: RequestContext, input: PreviewInput) =>
  financialRead(ctx, async (c) => (await prepare(c, input)).preview);
async function depositMovement(
  c: PoolClient,
  ctx: RequestContext,
  residentId: string,
  kind: 'OFFSET' | 'REFUNDED',
  amount: bigint,
  requestId: string,
  receiptCode: string,
) {
  if (amount === 0n) return null;
  const balance = await depositBalance(c, residentId);
  if (amount > balance)
    return fail(
      'The available deposit changed. Review clearance again.',
      'CONFLICT',
    );
  const id = randomUUID();
  await c.query(
    'INSERT INTO daybook.deposit_entries(id,agency_id,resident_id,request_id,fingerprint,receipt_code,kind,amount_paise,balance_after_paise,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      id,
      ctx.agent!.agencyId,
      residentId,
      requestId,
      createHash('sha256')
        .update(`${kind}:${residentId}:${amount}`)
        .digest('hex'),
      receiptCode,
      kind,
      amount.toString(),
      (balance - amount).toString(),
      ctx.agent!.id,
    ],
  );
  return id;
}
async function offsetDeposit(
  c: PoolClient,
  ctx: RequestContext,
  residentId: string,
  amount: bigint,
  sourceId: string,
) {
  if (amount === 0n) return;
  const today = await agencyToday(c);
  await depositMovement(
    c,
    ctx,
    residentId,
    'OFFSET',
    amount,
    sourceId,
    await nextCode(c, ctx.agent!.agencyId, 'deposit_offset', 'OFF-'),
  );
  await postEntry(c, {
    agencyId: ctx.agent!.agencyId,
    residentId,
    kind: 'DEPOSIT_OFFSET',
    sourceKey: `deposit-offset:${sourceId}`,
    amountPaise: -amount,
    date: today,
    dueDate: today,
    description: 'Caution deposit applied to outstanding balance',
    actorId: ctx.agent!.id,
  });
  await settleResident(c, residentId);
}
interface ClearanceRow {
  id: string;
  residentId: string;
  code: string;
  terminationDate: string;
  snapshot: Awaited<ReturnType<typeof prepare>>['preview'];
  finalInvoiceId: string | null;
}
async function findClearance(c: PoolClient, id: string) {
  return (
    await c.query<ClearanceRow>(
      'SELECT id,resident_id AS "residentId",code,to_char(termination_date,\'YYYY-MM-DD\') AS "terminationDate",snapshot,final_invoice_id AS "finalInvoiceId" FROM daybook.clearances WHERE id=$1',
      [idValue(id)],
    )
  ).rows[0];
}
async function view(c: PoolClient, id: string) {
  const row = await findClearance(c, id);
  if (!row) return fail('Clearance not found.', 'NOT_FOUND');
  const account = await balances(c, row.residentId);
  return {
    id: row.id,
    residentId: row.residentId,
    code: row.code,
    terminationDate: row.terminationDate,
    finalInvoiceId: row.finalInvoiceId,
    depositOffset: row.snapshot.depositOffset,
    refundDue: moneyString(account.refund),
    collectionDue: moneyString(account.collection),
    status:
      account.collection > 0n
        ? 'COLLECTION_DUE'
        : account.refund > 0n
          ? 'REFUND_DUE'
          : 'CLEARED',
    snapshot: row.snapshot,
  };
}
export const clearance = (ctx: RequestContext, id: string) =>
  financialRead(ctx, (c) => view(c, id));
export const clearanceForResident = (ctx: RequestContext, residentId: string) =>
  financialRead(ctx, async (c) => {
    const row = (
      await c.query<{ id: string }>(
        'SELECT id FROM daybook.clearances WHERE resident_id=$1',
        [idValue(residentId)],
      )
    ).rows[0];
    return row ? view(c, row.id) : null;
  });
export function clearResident(ctx: RequestContext, input: ClearanceInput) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'CLEAR_RESIDENT',
      input,
      async () => {
        const state = await prepare(c, input);
        if (state.pending.length)
          return fail(
            'Resolve unconfirmed payments before clearing this account.',
            'CONFLICT',
          );
        if (state.preview.fingerprint !== input.previewFingerprint)
          return fail(
            'The clearance balance or deliveries changed. Review the calculation again.',
            'CONFLICT',
          );
        if (state.preview.missingDayCount && !input.acknowledgeUnmarkedDays)
          return fail(
            'Review and acknowledge unprepared final delivery dates.',
          );
        let finalInvoiceId: string | null = null;
        if (state.built.hasActivity) {
          if (!state.built.preview.canIssue)
            return fail(
              'Confirm the billing tax treatment before issuing a final bill.',
            );
          finalInvoiceId = (
            await persistInvoice(
              c,
              { acknowledgeUnmarkedDays: input.acknowledgeUnmarkedDays },
              state.built,
              ctx.agent!.agencyId,
              ctx.agent!.id,
            )
          ).id;
        }
        const id = randomUUID(),
          residentId = state.resident.id;
        await offsetDeposit(c, ctx, residentId, state.offset, id);
        for (const order of state.orders) {
          if (order.status === 'RESERVED')
            await moveStock(c, order.itemId, 0, -order.quantity);
          await orderStatus(c, order.id, 'CANCELLED');
          await audit(
            c,
            ctx,
            'MERCHANDISE_ORDER',
            order.id,
            'CANCELLED_ON_CLEARANCE',
            { clearanceId: id },
          );
        }
        await c.query(
          "UPDATE daybook.subscriptions SET status='CANCELLED',end_date=CASE WHEN end_date IS NULL OR end_date>$2 THEN greatest(start_date,$2::date) ELSE end_date END,version=version+1 WHERE resident_id=$1 AND status<>'CANCELLED'",
          [residentId, input.terminationDate],
        );
        await c.query(
          "UPDATE daybook.residents SET status='CLOSED',version=version+1 WHERE id=$1",
          [residentId],
        );
        const code = await nextCode(
          c,
          ctx.agent!.agencyId,
          'clearance',
          'CLR-',
        );
        await c.query(
          'INSERT INTO daybook.clearances(id,agency_id,resident_id,code,termination_date,snapshot,final_invoice_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            ctx.agent!.agencyId,
            residentId,
            code,
            input.terminationDate,
            JSON.stringify(state.preview),
            finalInvoiceId,
            ctx.agent!.id,
          ],
        );
        await audit(c, ctx, 'CLEARANCE', id, 'ACCOUNT_ARCHIVED', state.preview);
        return { id };
      },
    );
    return view(c, saved.id);
  });
}
export function confirmClearanceRefund(
  ctx: RequestContext,
  input: RefundInput,
) {
  return configMutation(ctx, async (c) => {
    const result = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'CLEARANCE_REFUND',
      input,
      async () => {
        const record = await findClearance(c, input.clearanceId);
        if (!record) return fail('Clearance not found.', 'NOT_FOUND');
        if (!['CASH', 'UPI', 'BANK'].includes(input.method))
          return fail('Choose cash, UPI or bank for a confirmed refund.');
        const evidence = cleanText(
            input.confirmationNote,
            'refund confirmation evidence',
            1000,
          ),
          reference = input.reference
            ? cleanText(input.reference, 'refund reference', 120).toUpperCase()
            : null;
        if (input.method !== 'CASH' && !reference)
          return fail('Record the refund transaction reference.');
        const account = await balances(c, record.residentId),
          amount = parseMoney(input.amount);
        if (amount === 0n || amount !== account.refund)
          return fail(
            'Confirm the exact current refundable amount. Review clearance if the balance changed.',
            'CONFLICT',
          );
        const id = randomUUID(),
          receiptCode = await nextCode(
            c,
            ctx.agent!.agencyId,
            'refund',
            'RFD-',
          ),
          today = await agencyToday(c);
        await offsetDeposit(c, ctx, record.residentId, account.offset, id);
        const deposit = account.deposit - account.offset,
          credit = account.remaining < 0n ? -account.remaining : 0n;
        await depositMovement(
          c,
          ctx,
          record.residentId,
          'REFUNDED',
          deposit,
          randomUUID(),
          receiptCode,
        );
        await postEntry(c, {
          agencyId: ctx.agent!.agencyId,
          residentId: record.residentId,
          kind: 'REFUND',
          sourceKey: `clearance-refund:${id}`,
          amountPaise: credit,
          date: today,
          dueDate: today,
          description: `Confirmed account credit refund ${receiptCode}`,
          actorId: ctx.agent!.id,
        });
        await settleResident(c, record.residentId);
        await c.query(
          'INSERT INTO daybook.clearance_refunds(id,agency_id,clearance_id,resident_id,request_id,receipt_code,amount_paise,deposit_paise,account_credit_paise,method,reference,confirmation_evidence,posting_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [
            id,
            ctx.agent!.agencyId,
            record.id,
            record.residentId,
            input.requestId,
            receiptCode,
            amount.toString(),
            deposit.toString(),
            credit.toString(),
            input.method,
            reference,
            evidence,
            today,
            ctx.agent!.id,
          ],
        );
        await audit(c, ctx, 'CLEARANCE_REFUND', id, 'FUNDS_RETURNED', {
          clearanceId: record.id,
          amount: moneyString(amount),
          receiptCode,
          method: input.method,
          reference,
          evidence,
        });
        return {
          id,
          receiptCode,
          amount: moneyString(amount),
          status: 'CONFIRMED',
        };
      },
    );
    return result;
  });
}

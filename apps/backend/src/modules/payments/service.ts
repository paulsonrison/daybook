import { randomUUID } from 'node:crypto';
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
import { calendarDate } from '../scheduling/calendar.js';
import { agencyToday } from '../delivery/repository.js';
import { moneyString, parseMoney } from '../money.js';
import { nextCode } from '../counter.js';
import {
  postEntry,
  residentLedger,
  settleResident,
} from '../ledger/service.js';
import { receiveDeposit } from '../deposits/service.js';
import { billingResident, findInvoice } from '../billing/repository.js';
import { financialRead } from '../billing/transactions.js';
import { readLedger } from '../ledger/repository.js';
import {
  findPayment,
  finishPayment,
  insertPayment,
  paymentForRequest,
  readPayments,
  type PaymentRow,
} from './repository.js';
export interface PaymentInput {
  requestId: string;
  residentId: string;
  purpose: string;
  method: string;
  amount: string;
  date: string;
  reference?: string | null;
  targetInvoiceId?: string | null;
  confirmReceived: boolean;
  confirmationNote?: string | null;
}
export interface ReconciliationInput {
  requestId: string;
  paymentId: string;
  version: number;
  outcome: string;
  reference?: string | null;
  evidence: string;
}
async function paymentView(c: PoolClient, payment: PaymentRow) {
  const balance =
    payment.balanceAfterPaise === null
      ? (await residentLedger(c, payment.residentId)).balance
      : moneyString(payment.balanceAfterPaise);
  const { amountPaise: _, balanceAfterPaise: __, ...view } = payment;
  return {
    ...view,
    balance,
    confirmationSource:
      payment.status === 'CONFIRMED' ? 'AGENT_ATTESTATION' : null,
  };
}
const referenceValue = (value: unknown) =>
  value == null || value === ''
    ? null
    : cleanText(value, 'payment reference', 120).toUpperCase();
async function confirm(
  c: PoolClient,
  ctx: RequestContext,
  payment: PaymentRow,
  reference: string | null,
  evidence: string,
) {
  if (payment.method !== 'CASH' && !reference)
    return fail(
      'Record the bank, UPI or cheque reference before confirming funds.',
    );
  const today = await agencyToday(c);
  let receiptCode: string,
    depositEntryId: string | null = null;
  if (payment.purpose === 'DEPOSIT') {
    const receipt = await receiveDeposit(
      c,
      ctx,
      payment.residentId,
      payment.id,
      payment.amountPaise,
      'recorded',
    );
    receiptCode = receipt.receiptCode;
    depositEntryId = receipt.id;
  } else {
    receiptCode = await nextCode(c, ctx.agent!.agencyId, 'receipt', 'RCP-');
    await postEntry(c, {
      agencyId: ctx.agent!.agencyId,
      residentId: payment.residentId,
      kind: 'PAYMENT',
      sourceKey: `payment:${payment.id}`,
      amountPaise: -payment.amountPaise,
      date: today,
      dueDate: today,
      description: `${payment.method} receipt ${receiptCode}`,
      referenceInvoiceId: payment.targetInvoiceId,
      actorId: ctx.agent!.id,
    });
    await settleResident(c, payment.residentId, {
      targetInvoiceId: payment.targetInvoiceId ?? undefined,
    });
  }
  await finishPayment(c, {
    id: payment.id,
    status: 'CONFIRMED',
    reference,
    receiptCode,
    evidence,
    actorId: ctx.agent!.id,
    postingDate: today,
    depositEntryId,
    balanceAfterPaise: (await readLedger(c, payment.residentId)).reduce(
      (sum, r) => sum + r.amountPaise,
      0n,
    ),
  });
  await audit(c, ctx, 'PAYMENT', payment.id, 'FUNDS_CONFIRMED', {
    amount: payment.amount,
    method: payment.method,
    purpose: payment.purpose,
    receiptCode,
    reference,
    evidence,
    confirmationSource: 'AGENT_ATTESTATION',
  });
}
export function recordPayment(ctx: RequestContext, input: PaymentInput) {
  return configMutation(ctx, async (c) => {
    const result = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'RECORD_PAYMENT',
      input,
      async () => {
        const residentId = idValue(input.residentId),
          resident = await billingResident(c, residentId);
        if (!resident) return fail('Resident not found.', 'NOT_FOUND');
        if (resident.status === 'CLOSED' && input.purpose === 'DEPOSIT')
          return fail('This account is closed.');
        if (
          !['ACCOUNT', 'DEPOSIT'].includes(input.purpose) ||
          !['CASH', 'UPI', 'BANK', 'CHEQUE'].includes(input.method)
        )
          return fail('Choose a valid receipt purpose and payment method.');
        const amountPaise = parseMoney(input.amount);
        if (amountPaise === 0n)
          return fail('Enter a payment greater than zero.');
        calendarDate(input.date);
        if (input.date > (await agencyToday(c)))
          return fail('A payment cannot be received in the future.');
        const unresolved = (
          await c.query(
            "SELECT id FROM daybook.payments WHERE resident_id=$1 AND purpose=$2 AND status='PENDING'",
            [residentId, input.purpose],
          )
        ).rowCount;
        if (unresolved)
          return fail(
            'Resolve the original unconfirmed payment before recording another operation for this account.',
            'CONFLICT',
          );
        const reference = referenceValue(input.reference),
          targetInvoiceId = input.targetInvoiceId
            ? idValue(input.targetInvoiceId)
            : null;
        if (targetInvoiceId) {
          const target = await findInvoice(c, targetInvoiceId);
          if (
            !target ||
            target.residentId !== residentId ||
            target.state !== 'ISSUED'
          )
            return fail('Invoice not found for this resident.', 'NOT_FOUND');
          if (input.purpose !== 'ACCOUNT')
            return fail('Deposits cannot target an invoice.');
        }
        if (input.method === 'CHEQUE' && input.confirmReceived)
          return fail(
            'Cheques remain pending until a separate clearing confirmation.',
          );
        if (input.method === 'CHEQUE' && !reference)
          return fail('Record the cheque number before saving it.');
        const payment = await insertPayment(
          c,
          ctx.agent!.agencyId,
          ctx.agent!.id,
          {
            id: randomUUID(),
            residentId,
            requestId: idValue(input.requestId),
            purpose: input.purpose,
            method: input.method,
            amountPaise,
            date: input.date,
            reference,
            targetInvoiceId,
          },
        );
        if (input.confirmReceived)
          await confirm(
            c,
            ctx,
            payment,
            reference,
            cleanText(input.confirmationNote, 'confirmation evidence', 1000),
          );
        else
          await audit(c, ctx, 'PAYMENT', payment.id, 'FUNDS_PENDING', {
            purpose: input.purpose,
            method: input.method,
            amount: moneyString(amountPaise),
          });
        return { id: payment.id };
      },
    );
    return paymentView(c, (await findPayment(c, result.id))!);
  });
}
export function reconcilePayment(
  ctx: RequestContext,
  input: ReconciliationInput,
) {
  return configMutation(ctx, async (c) => {
    const result = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'RECONCILE_PAYMENT',
      input,
      async () => {
        const payment = await findPayment(c, idValue(input.paymentId));
        if (!payment) return fail('Payment not found.', 'NOT_FOUND');
        versionMatches(payment.version, input.version);
        if (payment.status !== 'PENDING')
          return fail('This payment already has a final outcome.', 'CONFLICT');
        if (!['CONFIRMED', 'FAILED'].includes(input.outcome))
          return fail('Choose confirmed funds or a failed payment.');
        const evidence = cleanText(
            input.evidence,
            'reconciliation evidence',
            1000,
          ),
          reference =
            input.reference === undefined
              ? payment.reference
              : referenceValue(input.reference);
        if (input.outcome === 'CONFIRMED')
          await confirm(c, ctx, payment, reference, evidence);
        else {
          await finishPayment(c, {
            id: payment.id,
            status: 'FAILED',
            reference,
            receiptCode: null,
            evidence,
            actorId: ctx.agent!.id,
            postingDate: null,
            depositEntryId: null,
            balanceAfterPaise: null,
          });
          await audit(c, ctx, 'PAYMENT', payment.id, 'FUNDS_FAILED', {
            evidence,
          });
        }
        return { id: payment.id };
      },
    );
    return paymentView(c, (await findPayment(c, result.id))!);
  });
}
export const payments = (ctx: RequestContext, residentId?: string) =>
  financialRead(ctx, async (c) => {
    const rows = await readPayments(
      c,
      residentId ? idValue(residentId) : undefined,
    );
    const views: Awaited<ReturnType<typeof paymentView>>[] = [];
    for (const payment of rows) views.push(await paymentView(c, payment));
    return views;
  });
export const paymentByRequest = (ctx: RequestContext, requestId: string) =>
  financialRead(ctx, async (c) => {
    const payment = await paymentForRequest(c, idValue(requestId));
    return payment ? paymentView(c, payment) : null;
  });

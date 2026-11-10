import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { cleanText, fail, idValue } from '../context.js';
import { calendarDate } from '../scheduling/calendar.js';
import { agencyToday } from '../delivery/repository.js';
import { moneyString, parseMoney } from '../money.js';
import {
  entryBySource,
  insertEntry,
  insertSettlement,
  readLedger,
} from './repository.js';
export interface LedgerPost {
  agencyId: string;
  residentId: string;
  kind: string;
  sourceKey: string;
  amountPaise: bigint;
  date: string;
  dueDate: string;
  description: string;
  invoiceId?: string | null;
  referenceInvoiceId?: string | null;
  actorId?: string | null;
}
async function lockLedger(c: PoolClient) {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('ledger:'||daybook.current_agency()::text,0))",
  );
}
export async function postEntry(c: PoolClient, input: LedgerPost) {
  idValue(input.agencyId);
  idValue(input.residentId);
  calendarDate(input.date);
  calendarDate(input.dueDate);
  if (input.date > (await agencyToday(c)))
    return fail('Financial postings cannot be dated in the future.');
  parseMoney(
    moneyString(
      input.amountPaise < 0n ? -input.amountPaise : input.amountPaise,
    ),
  );
  if (
    ![
      'INVOICE',
      'INVOICE_REVISION',
      'PAYMENT',
      'REFUND',
      'ADJUSTMENT',
      'OPENING',
      'DEPOSIT_OFFSET',
      'MERCHANDISE_CASH',
      'MERCHANDISE_CASH_PAYMENT',
    ].includes(input.kind)
  )
    return fail('Unsupported ledger posting.');
  const row = {
    ...input,
    sourceKey: cleanText(input.sourceKey, 'posting reference', 240),
    description: cleanText(input.description, 'posting description', 1000),
    invoiceId: input.invoiceId ?? null,
    referenceInvoiceId: input.referenceInvoiceId ?? null,
    actorId: input.actorId ?? null,
  };
  await lockLedger(c);
  const previous = await entryBySource(c, row.sourceKey);
  if (previous) {
    if (
      [
        'agencyId',
        'residentId',
        'kind',
        'sourceKey',
        'amountPaise',
        'date',
        'dueDate',
        'description',
        'invoiceId',
        'referenceInvoiceId',
        'actorId',
      ].some(
        (key) =>
          previous[key as keyof typeof previous] !==
          row[key as keyof typeof row],
      )
    )
      return fail(
        'This posting reference was already used for different financial data.',
        'CONFLICT',
      );
    return previous;
  }
  if (row.amountPaise === 0n) return null;
  return insertEntry(c, { ...row, id: randomUUID() });
}
export async function settleResident(
  c: PoolClient,
  residentId: string,
  options: { creditEntryId?: string; targetInvoiceId?: string } = {},
): Promise<void> {
  idValue(residentId);
  await lockLedger(c);
  const entries = await readLedger(c, residentId),
    debits = entries
      .filter((e) => e.amountPaise > e.settledPaise)
      .sort(
        (a, b) =>
          Number(
            Boolean(
              options.targetInvoiceId &&
              b.invoiceId === options.targetInvoiceId,
            ),
          ) -
            Number(
              Boolean(
                options.targetInvoiceId &&
                a.invoiceId === options.targetInvoiceId,
              ),
            ) ||
          a.dueDate.localeCompare(b.dueDate) ||
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      ),
    credits = entries.filter(
      (e) =>
        e.amountPaise < 0n &&
        -e.amountPaise > e.settledPaise &&
        (!options.creditEntryId || e.id === options.creditEntryId),
    );
  for (const credit of credits)
    for (const debit of debits) {
      const available = -credit.amountPaise - credit.settledPaise,
        open = debit.amountPaise - debit.settledPaise;
      if (available === 0n) break;
      if (open <= 0n) continue;
      const amount = available < open ? available : open;
      await insertSettlement(c, credit.agencyId, debit.id, credit.id, amount);
      credit.settledPaise += amount;
      debit.settledPaise += amount;
    }
}
export async function residentLedger(c: PoolClient, residentId: string) {
  const rows = await readLedger(c, idValue(residentId)),
    balance = rows.reduce((sum, e) => sum + e.amountPaise, 0n);
  return {
    balance: moneyString(balance),
    credit: moneyString(balance < 0n ? -balance : 0n),
    entries: rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      sourceKey: e.sourceKey,
      amount: moneyString(e.amountPaise),
      openAmount: moneyString(
        (e.amountPaise < 0n ? -e.amountPaise : e.amountPaise) - e.settledPaise,
      ),
      date: e.date,
      dueDate: e.dueDate,
      description: e.description,
      invoiceId: e.invoiceId,
      referenceInvoiceId: e.referenceInvoiceId,
      createdAt: e.createdAt,
    })),
  };
}

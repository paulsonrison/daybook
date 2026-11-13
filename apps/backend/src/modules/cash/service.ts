import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { agencyToday } from '../delivery/repository.js';
import { calendarDate } from '../scheduling/calendar.js';
import { moneyString, parseMoney } from '../money.js';
import { onceRequest } from '../requests.js';
import { requireStaff } from '../payroll/service.js';
import {
  recordReturnInTransaction,
  type ReturnInput,
} from '../publishers/service.js';
export interface CustodyInput {
  requestId: string;
  paymentId?: string;
  sourceKind?: string;
  sourceId?: string;
  custody: string;
  staffId?: string;
  routeId?: string;
  reason: string;
}
export interface HandoverInput {
  requestId: string;
  staffId: string;
  routeId: string;
  date: string;
  paymentIds: string[];
  custodyIds?: string[];
  actualCash: string;
  returns: ReturnInput[];
  signoff: string;
}
export interface ExpenseInput {
  requestId: string;
  amount: string;
  kind: string;
  handoverId?: string;
  reason: string;
}
export interface CloseInput {
  requestId: string;
  date: string;
  opening: string;
  counted: string;
  bankDeposit: string;
  reason: string;
  signoff: string;
}
function mutation<T>(
  ctx: RequestContext,
  input: { requestId: string },
  name: string,
  work: (c: PoolClient) => Promise<T>,
) {
  return configMutation(ctx, (c) =>
    onceRequest(c, ctx.agent!.agencyId, input.requestId, name, input, () =>
      work(c),
    ),
  );
}
export async function requireOpenCashDay(c: PoolClient, date: string) {
  if (
    (
      await c.query(
        'SELECT 1 FROM daybook.cash_day_closes WHERE close_date=$1',
        [date],
      )
    ).rowCount
  )
    fail(
      'This cash day is signed and closed. Record the movement on the next open day.',
      'CONFLICT',
    );
}
export async function classifyInTransaction(
  c: PoolClient,
  ctx: RequestContext,
  i: CustodyInput,
) {
  const kind = i.paymentId ? 'PAYMENT' : i.sourceKind,
    id = idValue(i.paymentId ?? i.sourceId);
  if (!['PAYMENT', 'MERCHANDISE', 'DEPOSIT'].includes(kind ?? ''))
    fail('Choose a valid collection source.');
  const source = (
    await c.query(
      "SELECT method,to_char(source_date,'YYYY-MM-DD') AS date FROM daybook.collection_sources WHERE kind=$1 AND id=$2",
      [kind, id],
    )
  ).rows[0];
  if (!source) fail('Confirmed collection not found.', 'NOT_FOUND');
  if (!['AGENCY', 'STAFF', 'DIGITAL'].includes(i.custody))
    fail('Choose collection custody.');
  if (
    (source.method === 'CASH' && i.custody === 'DIGITAL') ||
    (!['CASH', 'UNKNOWN'].includes(source.method) && i.custody !== 'DIGITAL')
  )
    fail('Custody must match the recorded payment method.');
  if (i.custody === 'STAFF') {
    await requireStaff(c, idValue(i.staffId));
    idValue(i.routeId);
    if (
      !(await c.query('SELECT 1 FROM daybook.routes WHERE id=$1', [i.routeId]))
        .rowCount
    )
      fail('Route not found.');
  } else if (i.staffId || i.routeId)
    fail('Only staff custody can have a collector or route.');
  await requireOpenCashDay(c, source.date);
  const classificationId = randomUUID();
  await c.query(
    'INSERT INTO daybook.collection_custody(id,agency_id,source_kind,source_id,custody,staff_id,route_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      classificationId,
      ctx.agent!.agencyId,
      kind,
      id,
      i.custody,
      i.staffId ?? null,
      i.routeId ?? null,
      cleanText(i.reason, 'custody reason', 500),
      ctx.agent!.id,
    ],
  );
  await audit(c, ctx, 'collection_custody', classificationId, 'CLASSIFIED', i);
  return { id: classificationId };
}
export const classifyCollection = (ctx: RequestContext, i: CustodyInput) =>
  mutation(ctx, i, 'cash.classify', (c) => classifyInTransaction(c, ctx, i));
export async function daySummary(c: PoolClient, date: string) {
  calendarDate(date);
  const sources = (
    await c.query(
      `SELECT s.kind,s.id,s.receipt_code AS "receiptCode",s.amount_paise::text AS amount,s.method,to_char(s.source_date,'YYYY-MM-DD') AS date,k.id AS "custodyId",k.custody,k.staff_id AS "staffId",k.route_id AS "routeId",EXISTS(SELECT 1 FROM daybook.handover_claims h WHERE h.custody_id=k.id) AS claimed FROM daybook.collection_sources s LEFT JOIN daybook.collection_custody k ON(k.source_kind,k.source_id)=(s.kind,s.id) WHERE s.source_date=$1 ORDER BY s.kind,s.id`,
      [date],
    )
  ).rows;
  const totals = (
    await c.query(
      `SELECT
 coalesce((SELECT sum(actual_paise) FROM daybook.cash_handovers WHERE posting_date=$1),0)::text AS handover,
 coalesce((SELECT sum(amount_paise) FROM daybook.cash_expenses WHERE posting_date=$1 AND kind='LATE_REMITTANCE'),0)::text AS late,
 (coalesce((SELECT sum(amount_paise) FROM daybook.cash_expenses WHERE posting_date=$1 AND kind IN('PETTY','BANK_DEPOSIT')),0)+coalesce((SELECT sum(amount_paise) FROM daybook.staff_funds WHERE posting_date=$1 AND kind='ADVANCE' AND method='CASH'),0)+coalesce((SELECT sum(amount_paise) FROM daybook.payroll_payouts WHERE posting_date=$1 AND method='CASH'),0)+coalesce((SELECT sum(amount_paise) FROM daybook.clearance_refunds WHERE posting_date=$1 AND method='CASH'),0))::text AS outflow,
 coalesce((SELECT sum(h.actual_paise-h.expected_paise+coalesce((SELECT sum(e.amount_paise) FROM daybook.cash_expenses e WHERE e.handover_id=h.id AND e.posting_date<=$1 AND kind='LATE_REMITTANCE'),0)) FROM daybook.cash_handovers h WHERE h.posting_date<=$1 AND NOT EXISTS(SELECT 1 FROM daybook.cash_expenses e WHERE e.handover_id=h.id AND e.posting_date<=$1 AND e.kind='SUSPENSE_RESOLUTION')),0)::text AS suspense`,
      [date],
    )
  ).rows[0];
  const direct = sources
      .filter((s) => s.custody === 'AGENCY')
      .reduce((n, s) => n + BigInt(s.amount), 0n),
    handover = BigInt(totals.handover) + BigInt(totals.late),
    outflow = BigInt(totals.outflow);
  const unclassified = sources.filter(
    (s) => !s.custody && ['CASH', 'UNKNOWN'].includes(s.method),
  ).length;
  const unhanded = sources.filter(
    (s) => s.custody === 'STAFF' && !s.claimed,
  ).length;
  const closed = (
    await c.query(
      'SELECT id,snapshot FROM daybook.cash_day_closes WHERE close_date=$1',
      [date],
    )
  ).rows[0];
  const summary = {
    date,
    directCash: moneyString(direct),
    handoverCash: moneyString(handover),
    outflow: moneyString(outflow),
    expectedMovement: moneyString(direct + handover - outflow),
    suspense: moneyString(BigInt(totals.suspense)),
    unclassified,
    unhanded,
    sources: sources.map((s) => ({
      ...s,
      amount: moneyString(BigInt(s.amount)),
    })),
    closedId: closed?.id ?? null,
  };
  return {
    ...summary,
    ...((closed?.snapshot?.day as Partial<typeof summary>) ?? {}),
    closedId: closed?.id ?? null,
  };
}
export const cashDay = (ctx: RequestContext, date: string) =>
  financialRead(ctx, (c) => daySummary(c, date));
export function recordHandover(ctx: RequestContext, i: HandoverInput) {
  return mutation(ctx, i, 'cash.handover', async (c) => {
    await requireStaff(c, i.staffId);
    idValue(i.routeId);
    calendarDate(i.date);
    const today = await agencyToday(c);
    if (i.date > today) fail('Handover date cannot be in the future.');
    await requireOpenCashDay(c, today);
    const day = await daySummary(c, i.date),
      paymentIds = new Set(i.paymentIds.map(idValue)),
      custodyIds = new Set((i.custodyIds ?? []).map(idValue));
    if (
      paymentIds.size !== i.paymentIds.length ||
      custodyIds.size !== (i.custodyIds ?? []).length
    )
      fail('Duplicate collection selection.');
    const selected = day.sources.filter(
      (s) =>
        (s.kind === 'PAYMENT' && paymentIds.has(s.id)) ||
        custodyIds.has(s.custodyId),
    );
    if (
      selected.length !== paymentIds.size + custodyIds.size ||
      selected.some(
        (s) =>
          s.custody !== 'STAFF' ||
          s.staffId !== i.staffId ||
          s.routeId !== i.routeId ||
          s.claimed,
      )
    )
      fail('Select unhanded cash held by this staff member and route.');
    if (!selected.length && !i.returns.length)
      fail('Select a collection or eligible return.');
    const expected = selected.reduce((n, s) => n + parseMoney(s.amount), 0n),
      actual = parseMoney(i.actualCash),
      signoff = cleanText(i.signoff, 'owner sign-off', 500),
      returns = [];
    for (const r of i.returns)
      returns.push(await recordReturnInTransaction(c, ctx, r));
    const id = randomUUID();
    await c.query(
      'INSERT INTO daybook.cash_handovers(id,agency_id,staff_id,route_id,collection_date,posting_date,expected_paise,actual_paise,snapshot,signoff,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        id,
        ctx.agent!.agencyId,
        i.staffId,
        i.routeId,
        i.date,
        today,
        expected.toString(),
        actual.toString(),
        JSON.stringify({ sources: selected, returns }),
        signoff,
        ctx.agent!.id,
      ],
    );
    for (const s of selected)
      await c.query(
        'INSERT INTO daybook.handover_claims(agency_id,custody_id,handover_id) VALUES($1,$2,$3)',
        [ctx.agent!.agencyId, s.custodyId, id],
      );
    for (const r of returns)
      await c.query(
        'INSERT INTO daybook.handover_return_claims(agency_id,return_id,handover_id) VALUES($1,$2,$3)',
        [ctx.agent!.agencyId, r.id, id],
      );
    await audit(c, ctx, 'cash_handover', id, 'SIGNED', {
      expected: moneyString(expected),
      actual: i.actualCash,
      signoff,
    });
    return {
      id,
      expected: moneyString(expected),
      actual: moneyString(actual),
      discrepancy: moneyString(actual - expected),
    };
  });
}
export function recordCashExpense(ctx: RequestContext, i: ExpenseInput) {
  return mutation(ctx, i, 'cash.expense', async (c) => {
    const today = await agencyToday(c);
    await requireOpenCashDay(c, today);
    const amount = parseMoney(i.amount),
      reason = cleanText(i.reason, 'expense or resolution reason', 500);
    if (
      ![
        'PETTY',
        'BANK_DEPOSIT',
        'LATE_REMITTANCE',
        'SUSPENSE_RESOLUTION',
      ].includes(i.kind)
    )
      fail('Choose a cash movement type.');
    if (i.kind === 'LATE_REMITTANCE' || i.kind === 'SUSPENSE_RESOLUTION') {
      idValue(i.handoverId);
      const h = (
        await c.query(
          'SELECT expected_paise::text,actual_paise::text FROM daybook.cash_handovers WHERE id=$1',
          [i.handoverId],
        )
      ).rows[0];
      if (!h) fail('Handover not found.');
      const old = (
        await c.query(
          'SELECT kind,amount_paise::text FROM daybook.cash_expenses WHERE handover_id=$1',
          [i.handoverId],
        )
      ).rows;
      if (old.some((e) => e.kind === 'SUSPENSE_RESOLUTION'))
        fail('This suspense memo is resolved.');
      const shortage =
        BigInt(h.expected_paise) -
        BigInt(h.actual_paise) -
        old
          .filter((e) => e.kind === 'LATE_REMITTANCE')
          .reduce((n, e) => n + BigInt(e.amount_paise), 0n);
      if (i.kind === 'LATE_REMITTANCE' && (amount === 0n || amount > shortage))
        fail('Late cash exceeds the outstanding handover shortage.');
      if (i.kind === 'SUSPENSE_RESOLUTION' && amount !== 0n)
        fail(
          'Memo classification does not move cash. Use late remittance for received money.',
        );
    } else if (i.handoverId || amount === 0n)
      fail('Enter a positive cash outflow.');
    const id = randomUUID();
    await c.query(
      'INSERT INTO daybook.cash_expenses(id,agency_id,posting_date,kind,amount_paise,handover_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        ctx.agent!.agencyId,
        today,
        i.kind,
        amount.toString(),
        i.handoverId ?? null,
        reason,
        ctx.agent!.id,
      ],
    );
    await audit(c, ctx, 'cash_expense', id, 'RECORDED', i);
    return { id };
  });
}
export function closeCashDay(ctx: RequestContext, i: CloseInput) {
  return mutation(ctx, i, 'cash.close', async (c) => {
    calendarDate(i.date);
    const today = await agencyToday(c);
    if (i.date !== today)
      fail(
        'Sign off the current cash day; historical signed days cannot be reopened.',
      );
    await requireOpenCashDay(c, i.date);
    const day = await daySummary(c, i.date);
    if (day.unclassified || day.unhanded)
      fail(
        'Classify collections and record their handover outcomes before closing.',
      );
    const opening = parseMoney(i.opening),
      counted = parseMoney(i.counted),
      bank = parseMoney(i.bankDeposit),
      expected = opening + BigInt(parseSigned(day.expectedMovement)) - bank,
      variance = counted - expected,
      reason = cleanText(i.reason, 'closing reason', 500),
      signoff = cleanText(i.signoff, 'closing sign-off', 500),
      id = randomUUID();
    const prior = (
      await c.query(
        'SELECT counted_paise::text FROM daybook.cash_day_closes WHERE close_date<$1 ORDER BY close_date DESC LIMIT 1',
        [i.date],
      )
    ).rows[0];
    await c.query(
      'INSERT INTO daybook.cash_day_closes(id,agency_id,close_date,opening_paise,counted_paise,bank_paise,expected_paise,variance_paise,snapshot,reason,signoff,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        id,
        ctx.agent!.agencyId,
        i.date,
        opening.toString(),
        counted.toString(),
        bank.toString(),
        expected.toString(),
        variance.toString(),
        JSON.stringify({
          day,
          priorClosing: prior ? moneyString(BigInt(prior.counted_paise)) : null,
        }),
        reason,
        signoff,
        ctx.agent!.id,
      ],
    );
    await audit(c, ctx, 'cash_day_close', id, 'SIGNED', {
      ...i,
      expected: moneyString(expected),
      variance: moneyString(variance),
    });
    return {
      id,
      expected: moneyString(expected),
      counted: moneyString(counted),
      variance: moneyString(variance),
    };
  });
}
function parseSigned(value: string) {
  return value.startsWith('-')
    ? -parseMoney(value.slice(1))
    : parseMoney(value);
}
export const cashHistory = (ctx: RequestContext) =>
  financialRead(ctx, async (c) => {
    const handovers = (
      await c.query(
        `SELECT h.id,h.staff_id AS "staffId",h.route_id AS "routeId",to_char(h.collection_date,'YYYY-MM-DD') AS date,to_char(h.posting_date,'YYYY-MM-DD') AS "postingDate",h.expected_paise::text AS expected,h.actual_paise::text AS actual,(h.actual_paise-h.expected_paise)::text AS discrepancy,(h.actual_paise-h.expected_paise+coalesce((SELECT sum(e.amount_paise) FROM daybook.cash_expenses e WHERE e.handover_id=h.id AND kind='LATE_REMITTANCE'),0))::text AS outstanding,h.snapshot,h.signoff FROM daybook.cash_handovers h ORDER BY h.posting_date DESC,h.id LIMIT 200`,
      )
    ).rows.map((r) => ({
      ...r,
      expected: moneyString(BigInt(r.expected)),
      actual: moneyString(BigInt(r.actual)),
      discrepancy: moneyString(BigInt(r.discrepancy)),
      outstanding: moneyString(BigInt(r.outstanding)),
      returnedCopies: (r.snapshot.returns ?? []).reduce(
        (n: number, v: { quantity: number }) => n + v.quantity,
        0,
      ),
    }));
    const closes = (
      await c.query(
        `SELECT id,to_char(close_date,'YYYY-MM-DD') AS date,opening_paise::text AS opening,expected_paise::text AS expected,counted_paise::text AS counted,bank_paise::text AS "bankDeposit",variance_paise::text AS variance,reason,signoff FROM daybook.cash_day_closes ORDER BY close_date DESC LIMIT 200`,
      )
    ).rows.map((r) => ({
      ...r,
      opening: moneyString(BigInt(r.opening)),
      expected: moneyString(BigInt(r.expected)),
      counted: moneyString(BigInt(r.counted)),
      bankDeposit: moneyString(BigInt(r.bankDeposit)),
      variance: moneyString(BigInt(r.variance)),
    }));
    const movements = (
      await c.query(
        `SELECT id,to_char(posting_date,'YYYY-MM-DD') AS date,kind,amount_paise::text AS amount,handover_id AS "handoverId",reason FROM daybook.cash_expenses ORDER BY posting_date DESC,id LIMIT 200`,
      )
    ).rows.map((r) => ({ ...r, amount: moneyString(BigInt(r.amount)) }));
    return { handovers, closes, movements };
  });

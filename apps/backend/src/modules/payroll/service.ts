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
import { financialRead } from '../billing/transactions.js';
import { calendarDate } from '../scheduling/calendar.js';
import { agencyToday } from '../delivery/repository.js';
import { moneyString, parseMoney } from '../money.js';
import { onceRequest } from '../requests.js';
import { nextCode } from '../counter.js';

export interface PayRuleInput {
  requestId: string;
  staffId: string;
  startDate: string;
  endDate?: string;
  employmentStart: string;
  employmentEnd?: string;
  mode: string;
  monthlySalary: string;
  copyRate: string;
  routeAllowance: string;
  proration: string;
}
export interface AttendanceInput {
  requestId: string;
  staffId: string;
  date: string;
  status: string;
  note: string;
}
export interface StaffFundsInput {
  requestId: string;
  staffId: string;
  date: string;
  kind: string;
  amount: string;
  method: string;
  reference?: string;
  confirmReceived: boolean;
  approveExpense?: boolean;
  evidence: string;
}
export interface PayslipInput {
  requestId: string;
  staffId: string;
  month: string;
  fingerprint: string;
  acknowledgeMissing: boolean;
}
export interface PayoutInput {
  requestId: string;
  payslipId: string;
  method: string;
  reference?: string;
  confirmReceived: boolean;
  evidence: string;
}
export interface PayrollAdjustmentInput {
  requestId: string;
  staffId: string;
  direction: string;
  amount: string;
  reason: string;
}
export function recordPayrollAdjustment(
  ctx: RequestContext,
  i: PayrollAdjustmentInput,
) {
  return mutation(ctx, i, 'payroll.adjustment', async (c) => {
    await requireStaff(c, i.staffId);
    const today = await agencyToday(c),
      amount = parseMoney(i.amount),
      reason = cleanText(i.reason, 'approved payroll correction reason', 500);
    if (!['CREDIT', 'DEBIT'].includes(i.direction) || amount === 0n)
      fail(
        'Choose an explicit earnings credit or deduction and positive amount.',
      );
    if (
      (
        await c.query(
          "SELECT 1 FROM daybook.payslips WHERE staff_id=$1 AND month=date_trunc('month',$2::date)::date",
          [i.staffId, today],
        )
      ).rowCount
    )
      fail(
        'The current payroll month is already posted. A correction requires an open payroll month.',
      );
    const id = randomUUID();
    await c.query(
      'INSERT INTO daybook.payroll_adjustments(id,agency_id,staff_id,posting_date,amount_paise,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        ctx.agent!.agencyId,
        i.staffId,
        today,
        (i.direction === 'CREDIT' ? amount : -amount).toString(),
        reason,
        ctx.agent!.id,
      ],
    );
    await audit(c, ctx, 'payroll_adjustment', id, 'APPROVED', i);
    return { id };
  });
}
export async function requireStaff(c: PoolClient, id: string) {
  idValue(id);
  if (
    !(await c.query('SELECT 1 FROM daybook.staff WHERE id=$1', [id])).rowCount
  )
    fail('Staff member not found.', 'NOT_FOUND');
}
function monthDates(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) fail('Choose a valid payroll month.');
  const first = month + '-01',
    start = calendarDate(first),
    end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1))
    dates.push(d.toISOString().slice(0, 10));
  return { first, last: end.toISOString().slice(0, 10), dates };
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
export function savePayRule(ctx: RequestContext, i: PayRuleInput) {
  return mutation(ctx, i, 'payroll.rule', async (c) => {
    await requireStaff(c, i.staffId);
    calendarDate(i.startDate);
    calendarDate(i.employmentStart);
    if (i.endDate) calendarDate(i.endDate);
    if (i.employmentEnd) calendarDate(i.employmentEnd);
    const knownFinal = (
      await c.query<{ end: string }>(
        "SELECT to_char(employment_end,'YYYY-MM-DD') AS end FROM daybook.pay_rules WHERE staff_id=$1 AND employment_start=$2 AND employment_end IS NOT NULL ORDER BY employment_end LIMIT 1",
        [i.staffId, i.employmentStart],
      )
    ).rows[0];
    if (
      knownFinal &&
      ((i.employmentEnd && i.employmentEnd !== knownFinal.end) ||
        i.startDate > knownFinal.end)
    )
      fail(
        'This employment period already has a confirmed final date. Keep that boundary or use a new employment start for a rehire.',
      );
    if (
      (i.endDate && i.endDate < i.startDate) ||
      (i.employmentEnd && i.employmentEnd < i.employmentStart)
    )
      fail('End date precedes start date.');
    if (
      !['SALARY', 'PER_COPY', 'BLENDED'].includes(i.mode) ||
      !['CALENDAR_DAYS', 'UNPRORATED'].includes(i.proration)
    )
      fail('Choose a valid pay mode and proration.');
    const salary = parseMoney(i.monthlySalary),
      copy = parseMoney(i.copyRate),
      route = parseMoney(i.routeAllowance);
    if (
      (i.mode === 'SALARY' && copy !== 0n) ||
      (i.mode === 'PER_COPY' && salary !== 0n)
    )
      fail('The amounts must match the selected pay mode.');
    if (
      i.proration === 'UNPRORATED' &&
      (i.startDate.slice(8) !== '01' ||
        (i.endDate &&
          monthDates(i.endDate.slice(0, 7)).last !== i.endDate &&
          i.employmentEnd !== i.endDate))
    )
      fail('Fixed monthly rules must start and end on month boundaries.');
    if (
      (
        await c.query(
          "SELECT 1 FROM daybook.pay_rules WHERE staff_id=$1 AND start_date<=coalesce($3::date,'9999-12-31'::date) AND coalesce(end_date,'9999-12-31'::date)>=$2::date",
          [i.staffId, i.startDate, i.endDate ?? null],
        )
      ).rowCount
    )
      fail(
        'Pay rules overlap. End the existing rule explicitly before adding another.',
      );
    if (
      (
        await c.query(
          "SELECT 1 FROM daybook.payslips WHERE staff_id=$1 AND month<=coalesce($3::date,'9999-12-31'::date) AND (month+interval '1 month - 1 day')::date>=$2::date",
          [i.staffId, i.startDate, i.endDate ?? null],
        )
      ).rowCount
    )
      fail('A posted payslip locks this rule period.');
    const id = randomUUID();
    await c.query(
      'INSERT INTO daybook.pay_rules(id,agency_id,staff_id,start_date,end_date,employment_start,employment_end,mode,monthly_paise,copy_paise,route_paise,proration) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        id,
        ctx.agent!.agencyId,
        i.staffId,
        i.startDate,
        i.endDate ?? null,
        i.employmentStart,
        i.employmentEnd ?? knownFinal?.end ?? null,
        i.mode,
        salary.toString(),
        copy.toString(),
        route.toString(),
        i.proration,
      ],
    );
    await audit(c, ctx, 'pay_rule', id, 'CREATED', i);
    return { id };
  });
}
export function recordAttendance(ctx: RequestContext, i: AttendanceInput) {
  return mutation(ctx, i, 'payroll.attendance', async (c) => {
    await requireStaff(c, i.staffId);
    calendarDate(i.date);
    if (i.date > (await agencyToday(c)))
      fail('Attendance cannot be recorded in the future.');
    if (!['PRESENT', 'PAID_LEAVE', 'UNPAID_LEAVE', 'ABSENT'].includes(i.status))
      fail('Choose an attendance status.');
    if (
      (
        await c.query(
          "SELECT 1 FROM daybook.payslips WHERE staff_id=$1 AND month=date_trunc('month',$2::date)::date",
          [i.staffId, i.date],
        )
      ).rowCount
    )
      fail(
        'Posted attendance is immutable. Record a current-period correction.',
      );
    const id = randomUUID(),
      note = cleanText(i.note, 'attendance note', 500);
    const r = await c.query(
      'INSERT INTO daybook.staff_attendance(id,agency_id,staff_id,work_date,status,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,staff_id,work_date) DO UPDATE SET status=excluded.status,note=excluded.note RETURNING id',
      [id, ctx.agent!.agencyId, i.staffId, i.date, i.status, note],
    );
    await audit(c, ctx, 'staff_attendance', r.rows[0].id, 'RECORDED', i);
    return r.rows[0];
  });
}
export function paymentEvidence(i: {
  method: string;
  reference?: string;
  confirmReceived: boolean;
  evidence: string;
}) {
  if (!['CASH', 'UPI', 'BANK'].includes(i.method) || i.confirmReceived !== true)
    fail('Explicitly confirm the actual funds movement and payment method.');
  const evidence = cleanText(i.evidence, 'confirmation evidence', 500),
    reference = i.reference
      ? cleanText(i.reference, 'payment reference', 120).toUpperCase()
      : null;
  if (i.method !== 'CASH' && !reference)
    fail('A digital payment reference is required.');
  return { evidence, reference };
}
export function recordStaffFunds(ctx: RequestContext, i: StaffFundsInput) {
  return mutation(ctx, i, 'payroll.funds', async (c) => {
    await requireStaff(c, i.staffId);
    calendarDate(i.date);
    if (i.date > (await agencyToday(c)))
      fail('Funds date cannot be in the future.');
    if (!['ADVANCE', 'REIMBURSEMENT'].includes(i.kind))
      fail('Choose advance or approved reimbursement.');
    if (
      i.kind === 'REIMBURSEMENT' &&
      (i.approveExpense !== true || i.confirmReceived)
    )
      fail(
        'Approve the unpaid expense claim; do not mark it as funds already disbursed.',
      );
    const { evidence, reference } =
        i.kind === 'ADVANCE'
          ? paymentEvidence(i)
          : {
              evidence: cleanText(i.evidence, 'expense approval evidence', 500),
              reference: null,
            },
      amount = parseMoney(i.amount);
    if (amount === 0n) fail('Enter a positive amount.');
    const id = randomUUID();
    await c.query(
      'INSERT INTO daybook.staff_funds(id,agency_id,staff_id,funds_date,kind,amount_paise,method,reference,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        ctx.agent!.agencyId,
        i.staffId,
        i.date,
        i.kind,
        amount.toString(),
        i.kind === 'REIMBURSEMENT' ? 'UNPAID' : i.method,
        reference,
        evidence,
        ctx.agent!.id,
      ],
    );
    await audit(c, ctx, 'staff_funds', id, 'RECORDED', i);
    return { id };
  });
}
type Rule = {
  id: string;
  start: string;
  end: string | null;
  employmentStart: string;
  employmentEnd: string | null;
  mode: string;
  salary: string;
  copy: string;
  route: string;
  proration: string;
};
export function endPayRule(
  ctx: RequestContext,
  i: {
    requestId: string;
    ruleId: string;
    endDate: string;
    reason: string;
    endEmployment?: boolean;
  },
) {
  return mutation(ctx, i, 'payroll.end-rule', async (c) => {
    calendarDate(i.endDate);
    idValue(i.ruleId);
    const reason = cleanText(i.reason, 'pay change reason', 500);
    const rule = (
      await c.query(
        "SELECT staff_id,to_char(employment_start,'YYYY-MM-DD') AS employment_start,to_char(start_date,'YYYY-MM-DD') AS start,to_char(end_date,'YYYY-MM-DD') AS end,to_char(employment_end,'YYYY-MM-DD') AS employment_end,proration FROM daybook.pay_rules WHERE id=$1",
        [i.ruleId],
      )
    ).rows[0];
    if (!rule) fail('Pay rule not found.');
    const knownFinal = (
      await c.query<{ end: string }>(
        "SELECT to_char(employment_end,'YYYY-MM-DD') AS end FROM daybook.pay_rules WHERE staff_id=$1 AND employment_start=$2 AND employment_end IS NOT NULL ORDER BY employment_end LIMIT 1",
        [rule.staff_id, rule.employment_start],
      )
    ).rows[0];
    if (i.endEmployment && knownFinal && knownFinal.end !== i.endDate)
      fail(
        'The recorded final employment date applies to every pay segment and cannot be contradicted.',
      );
    if (
      rule.end &&
      (i.endDate > rule.end || (i.endDate === rule.end && !i.endEmployment))
    )
      fail(
        'A bounded pay rule can only be shortened or explicitly marked as final employment.',
      );
    if (
      i.endEmployment &&
      rule.employment_end &&
      rule.employment_end !== i.endDate
    )
      fail('The recorded final employment date is immutable.');
    if (
      i.endDate < rule.start ||
      (rule.proration === 'UNPRORATED' &&
        !i.endEmployment &&
        monthDates(i.endDate.slice(0, 7)).last !== i.endDate)
    )
      fail('Choose a valid pay-rule end date.');
    if (
      (
        await c.query(
          "SELECT 1 FROM daybook.payslips WHERE staff_id=$1 AND (month+interval '1 month - 1 day')::date>$2::date",
          [rule.staff_id, i.endDate],
        )
      ).rowCount
    )
      fail('A posted payslip covers dates after this end date.');
    await c.query(
      'UPDATE daybook.pay_rules SET end_date=$2,employment_end=CASE WHEN $3 THEN $2::date ELSE employment_end END WHERE id=$1',
      [i.ruleId, i.endDate, i.endEmployment === true],
    );
    await audit(c, ctx, 'pay_rule', i.ruleId, 'ENDED', {
      endDate: i.endDate,
      reason,
      endEmployment: i.endEmployment === true,
    });
    return { id: i.ruleId };
  });
}
export async function calculatePayroll(
  c: PoolClient,
  staffId: string,
  month: string,
) {
  await requireStaff(c, staffId);
  const { first, last, dates } = monthDates(month);
  const rules = (
    await c.query<Rule>(
      `SELECT id,to_char(start_date,'YYYY-MM-DD') AS start,to_char(end_date,'YYYY-MM-DD') AS end,to_char(employment_start,'YYYY-MM-DD') AS "employmentStart",to_char(employment_end,'YYYY-MM-DD') AS "employmentEnd",mode,monthly_paise::text AS salary,copy_paise::text AS copy,route_paise::text AS route,proration FROM daybook.pay_rules WHERE staff_id=$1 AND ((start_date<=$3 AND coalesce(end_date,'9999-12-31')>=$2) OR employment_end<$2) ORDER BY start_date,id`,
      [staffId, first, last],
    )
  ).rows;
  if (!rules.length)
    fail('Configure staff employment and pay rules before calculating pay.');
  const finalDates = (
    await c.query<{ start: string; end: string }>(
      "SELECT to_char(employment_start,'YYYY-MM-DD') AS start,to_char(employment_end,'YYYY-MM-DD') AS end FROM daybook.pay_rules WHERE staff_id=$1 AND employment_end IS NOT NULL ORDER BY employment_end",
      [staffId],
    )
  ).rows;
  const endByTenure = new Map<string, string>();
  for (const final of finalDates) {
    const previous = endByTenure.get(final.start);
    if (previous && previous !== final.end)
      fail(
        'This employment period has conflicting final dates. Resolve the recorded boundaries explicitly before calculating pay.',
      );
    endByTenure.set(final.start, final.end);
  }
  for (const r of rules) {
    const final = endByTenure.get(r.employmentStart);
    if (final) r.employmentEnd = final;
  }
  if (
    dates.some(
      (d) =>
        rules.some(
          (r) =>
            d >= r.employmentStart &&
            (!r.employmentEnd || d <= r.employmentEnd),
        ) &&
        !rules.some(
          (r) =>
            d >= r.start &&
            (!r.end || d <= r.end) &&
            d >= r.employmentStart &&
            (!r.employmentEnd || d <= r.employmentEnd),
        ),
    )
  )
    fail(
      'Some employed dates have no configured pay rule. Pay is unknown until those gaps are configured.',
    );
  const attendance = (
    await c.query<{ date: string; status: string }>(
      "SELECT to_char(work_date,'YYYY-MM-DD') AS date,status FROM daybook.staff_attendance WHERE staff_id=$1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date",
      [staffId, first, last],
    )
  ).rows;
  const prepared = new Set(
    (
      await c.query<{ date: string }>(
        "SELECT to_char(delivery_date,'YYYY-MM-DD') AS date FROM daybook.delivery_days WHERE delivery_date BETWEEN $1 AND $2",
        [first, last],
      )
    ).rows.map((r) => r.date),
  );
  const employedDates = dates.filter((d) =>
    rules.some(
      (r) =>
        d >= r.start &&
        (!r.end || d <= r.end) &&
        d >= r.employmentStart &&
        (!r.employmentEnd || d <= r.employmentEnd),
    ),
  );
  const missingPreparedDays = employedDates.filter(
    (d) => !prepared.has(d),
  ).length;
  const deliveries = (
    await c.query<{
      id: string;
      date: string;
      quantity: number;
      route: string;
      version: number;
    }>(
      "SELECT d.id,to_char(d.delivery_date,'YYYY-MM-DD') AS date,d.quantity,d.route_id AS route,d.version FROM daybook.delivery_logs d WHERE d.staff_id=$1 AND d.delivery_date BETWEEN $2 AND $3 AND d.status IN('DELIVERED','REPLACED') AND NOT EXISTS(SELECT 1 FROM daybook.payroll_delivery_claims p WHERE p.delivery_id=d.id) ORDER BY d.delivery_date,d.id",
      [staffId, first, last],
    )
  ).rows;
  const funds = (
    await c.query<{ id: string; kind: string; available: string }>(
      'SELECT f.id,f.kind,(f.amount_paise-coalesce((SELECT sum(p.amount_paise) FROM daybook.payroll_fund_claims p WHERE p.fund_id=f.id),0))::text AS available FROM daybook.staff_funds f WHERE f.staff_id=$1 AND funds_date<=$2 ORDER BY funds_date,id',
      [staffId, last],
    )
  ).rows;
  const adjustments = (
    await c.query<{ id: string; amount: string; reason: string }>(
      'SELECT a.id,a.amount_paise::text AS amount,a.reason FROM daybook.payroll_adjustments a WHERE a.staff_id=$1 AND a.posting_date<=$2 AND NOT EXISTS(SELECT 1 FROM daybook.payroll_adjustment_claims p WHERE p.adjustment_id=a.id) ORDER BY a.posting_date,a.id',
      [staffId, last],
    )
  ).rows;
  const adjustment = adjustments.reduce((n, a) => n + BigInt(a.amount), 0n);
  let salary = 0n,
    commission = 0n,
    routeAllowance = 0n,
    missingDays = 0;
  const segments: unknown[] = [],
    claimedDeliveries: string[] = [];
  for (const r of rules) {
    const employed = dates.filter(
      (d) =>
        d >= r.start &&
        (!r.end || d <= r.end) &&
        d >= r.employmentStart &&
        (!r.employmentEnd || d <= r.employmentEnd),
    );
    let paidDays = 0;
    const worked = new Set<string>();
    for (const date of employed) {
      const a = attendance.find((a) => a.date === date);
      if (!a) missingDays++;
      if (!a || !['UNPAID_LEAVE', 'ABSENT'].includes(a.status)) paidDays++;
      if (a?.status === 'PRESENT')
        for (const d of deliveries.filter((d) => d.date === date))
          worked.add(date + ':' + d.route);
    }
    const segmentSalary =
      r.proration === 'UNPRORATED' && employed.length
        ? BigInt(r.salary)
        : (BigInt(r.salary) * BigInt(paidDays) +
            BigInt(Math.floor(dates.length / 2))) /
          BigInt(dates.length);
    salary += segmentSalary;
    routeAllowance += BigInt(r.route) * BigInt(worked.size);
    let copies = 0;
    for (const d of deliveries.filter((d) => employed.includes(d.date))) {
      copies += d.quantity;
      claimedDeliveries.push(d.id);
    }
    commission += BigInt(r.copy) * BigInt(copies);
    segments.push({
      ruleId: r.id,
      employedDays: employed.length,
      paidDays,
      salary: moneyString(segmentSalary),
      copies,
      workedRoutes: worked.size,
      proration: r.proration,
    });
  }
  let advance = 0n,
    reimbursement = 0n;
  const claims: { fundId: string; amount: string }[] = [];
  const compensation = salary + commission + routeAllowance + adjustment;
  if (compensation < 0n)
    fail(
      'Approved deductions exceed earnings. Review the correction before posting.',
    );
  for (const f of funds) {
    let amount = BigInt(f.available);
    if (amount <= 0n) continue;
    if (f.kind === 'ADVANCE') {
      if (amount > compensation - advance) amount = compensation - advance;
      advance += amount;
    } else reimbursement += amount;
    if (amount > 0n) claims.push({ fundId: f.id, amount: amount.toString() });
  }
  const net = compensation - advance + reimbursement;
  const snapshot = {
    staffId,
    month,
    first,
    last,
    rules,
    attendance,
    deliveries,
    funds,
    adjustments,
    adjustment: moneyString(adjustment),
    segments,
    claims,
    claimedDeliveries,
    salary: moneyString(salary),
    commission: moneyString(commission),
    routeAllowance: moneyString(routeAllowance),
    advance: moneyString(advance),
    reimbursement: moneyString(reimbursement),
    net: moneyString(net),
    missingDays,
    missingPreparedDays,
  };
  return { ...snapshot, fingerprint: hash(snapshot) };
}
export const payrollPreview = (
  ctx: RequestContext,
  staffId: string,
  month: string,
) => financialRead(ctx, (c) => calculatePayroll(c, staffId, month));
export async function postPayslip(ctx: RequestContext, i: PayslipInput) {
  const saved = await mutation(ctx, i, 'payroll.post', async (c) => {
    const p = await calculatePayroll(c, i.staffId, i.month);
    if (p.fingerprint !== i.fingerprint)
      fail('Payroll inputs changed. Refresh the preview.', 'CONFLICT');
    const today = await agencyToday(c);
    if (
      p.first > today ||
      (p.last >= today &&
        !p.rules.every((r) => r.employmentEnd && r.employmentEnd <= today))
    )
      fail(
        'Only completed months or confirmed final employment may be posted.',
      );
    if ((p.missingDays || p.missingPreparedDays) && !i.acknowledgeMissing)
      fail(
        'Acknowledge missing attendance and delivery preparation before posting.',
      );
    const id = randomUUID(),
      code = await nextCode(c, ctx.agent!.agencyId, 'payslip', 'PAY-');
    await c.query(
      'INSERT INTO daybook.payslips(id,agency_id,staff_id,month,code,snapshot,net_paise,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        ctx.agent!.agencyId,
        i.staffId,
        p.first,
        code,
        JSON.stringify(p),
        parseMoney(p.net).toString(),
        ctx.agent!.id,
      ],
    );
    for (const f of p.claims)
      await c.query(
        'INSERT INTO daybook.payroll_fund_claims(agency_id,fund_id,payslip_id,amount_paise) VALUES($1,$2,$3,$4)',
        [ctx.agent!.agencyId, f.fundId, id, f.amount],
      );
    for (const delivery of p.claimedDeliveries)
      await c.query(
        'INSERT INTO daybook.payroll_delivery_claims(agency_id,delivery_id,payslip_id) VALUES($1,$2,$3)',
        [ctx.agent!.agencyId, delivery, id],
      );
    for (const a of p.adjustments)
      await c.query(
        'INSERT INTO daybook.payroll_adjustment_claims(agency_id,adjustment_id,payslip_id) VALUES($1,$2,$3)',
        [ctx.agent!.agencyId, a.id, id],
      );
    await audit(c, ctx, 'payslip', id, 'POSTED', {
      fingerprint: p.fingerprint,
    });
    return {
      id,
      code,
      staffId: i.staffId,
      month: i.month,
      net: p.net,
      paid: false,
      snapshot: JSON.stringify(p),
    };
  });
  const paid = await financialRead(ctx, async (c) =>
    Boolean(
      (
        await c.query(
          'SELECT 1 FROM daybook.payroll_payouts WHERE payslip_id=$1',
          [saved.id],
        )
      ).rowCount,
    ),
  );
  return { ...saved, paid };
}
export const payslips = (ctx: RequestContext, staffId: string) =>
  financialRead(ctx, async (c) => {
    idValue(staffId);
    return (
      await c.query(
        'SELECT p.id,p.code,p.staff_id AS "staffId",to_char(p.month,\'YYYY-MM\') AS month,p.net_paise::text AS net,p.snapshot,EXISTS(SELECT 1 FROM daybook.payroll_payouts q WHERE q.payslip_id=p.id) AS paid FROM daybook.payslips p WHERE p.staff_id=$1 ORDER BY p.month DESC',
        [staffId],
      )
    ).rows.map((r) => ({
      ...r,
      net: moneyString(BigInt(r.net)),
      snapshot: JSON.stringify(r.snapshot),
    }));
  });
export function recordPayrollPayout(ctx: RequestContext, i: PayoutInput) {
  return mutation(ctx, i, 'payroll.payout', async (c) => {
    const { evidence, reference } = paymentEvidence(i);
    idValue(i.payslipId);
    const p = (
      await c.query(
        'SELECT staff_id,net_paise::text FROM daybook.payslips WHERE id=$1',
        [i.payslipId],
      )
    ).rows[0];
    if (!p) fail('Payslip not found.', 'NOT_FOUND');
    if (BigInt(p.net_paise) === 0n)
      fail('This payslip has no funds to disburse.');
    const id = randomUUID(),
      today = await agencyToday(c);
    await c.query(
      'INSERT INTO daybook.payroll_payouts(id,agency_id,payslip_id,staff_id,amount_paise,posting_date,method,reference,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        ctx.agent!.agencyId,
        i.payslipId,
        p.staff_id,
        p.net_paise,
        today,
        i.method,
        reference,
        evidence,
        ctx.agent!.id,
      ],
    );
    await audit(c, ctx, 'payroll_payout', id, 'CONFIRMED', i);
    return { id };
  });
}
export const payrollRecords = (ctx: RequestContext, staffId: string) =>
  financialRead(ctx, async (c) => {
    await requireStaff(c, staffId);
    const rules = (
      await c.query(
        `SELECT id,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",to_char(employment_start,'YYYY-MM-DD') AS "employmentStart",to_char(employment_end,'YYYY-MM-DD') AS "employmentEnd",mode,monthly_paise::text AS "monthlySalary",copy_paise::text AS "copyRate",route_paise::text AS "routeAllowance",proration FROM daybook.pay_rules WHERE staff_id=$1 ORDER BY start_date DESC LIMIT 200`,
        [staffId],
      )
    ).rows.map((r) => ({
      ...r,
      monthlySalary: moneyString(BigInt(r.monthlySalary)),
      copyRate: moneyString(BigInt(r.copyRate)),
      routeAllowance: moneyString(BigInt(r.routeAllowance)),
    }));
    const attendance = (
      await c.query(
        `SELECT id,to_char(work_date,'YYYY-MM-DD') AS date,status,note FROM daybook.staff_attendance WHERE staff_id=$1 ORDER BY work_date DESC LIMIT 200`,
        [staffId],
      )
    ).rows;
    const funds = (
      await c.query(
        `SELECT f.id,to_char(f.funds_date,'YYYY-MM-DD') AS date,f.kind,f.amount_paise::text AS amount,f.method,f.evidence,(f.amount_paise-coalesce((SELECT sum(p.amount_paise) FROM daybook.payroll_fund_claims p WHERE p.fund_id=f.id),0))::text AS remaining FROM daybook.staff_funds f WHERE staff_id=$1 ORDER BY funds_date DESC,id LIMIT 200`,
        [staffId],
      )
    ).rows.map((r) => ({
      ...r,
      amount: moneyString(BigInt(r.amount)),
      remaining: moneyString(BigInt(r.remaining)),
    }));
    const adjustments = (
      await c.query(
        `SELECT id,to_char(posting_date,'YYYY-MM-DD') AS date,amount_paise::text AS amount,reason FROM daybook.payroll_adjustments WHERE staff_id=$1 ORDER BY posting_date DESC,id LIMIT 200`,
        [staffId],
      )
    ).rows.map((r) => ({ ...r, amount: moneyString(BigInt(r.amount)) }));
    return { rules, attendance, funds, adjustments };
  });

import type { PoolClient } from 'pg';
import { fail, idValue } from '../context.js';
import { monthPeriod } from './periods.js';
import { agencyToday } from '../delivery/repository.js';
import { buildBill } from './engine.js';
import { persistInvoice } from './service.js';
import { readPolicy } from './repository.js';
export async function queueCycleInvoices(
  c: PoolClient,
  agencyId: string,
  month: string,
) {
  const residents = (
    await c.query<{ id: string }>(
      "SELECT DISTINCT resident_id AS id FROM daybook.delivery_logs WHERE delivery_date BETWEEN $1::date AND ($1::date+interval '1 month'-interval '1 day') UNION SELECT DISTINCT resident_id AS id FROM daybook.merchandise_charges WHERE settlement='INVOICE' AND charge_date BETWEEN $1::date AND ($1::date+interval '1 month'-interval '1 day')",
      [`${month}-01`],
    )
  ).rows;
  for (const resident of residents)
    await c.query(
      "INSERT INTO daybook.job_runs(id,agency_id,job_key,kind,run_date,status,payload) VALUES(gen_random_uuid(),$1,$2,'AUTO_INVOICE',current_date,'PENDING',$3) ON CONFLICT(agency_id,job_key) DO NOTHING",
      [
        agencyId,
        `AUTO_INVOICE:${month}:${resident.id}`,
        JSON.stringify({ residentId: resident.id, month }),
      ],
    );
  return residents.length;
}
export async function issueAutomaticInvoice(
  c: PoolClient,
  agencyId: string,
  payload: Record<string, unknown>,
) {
  const policy = await readPolicy(c);
  if (!policy.autoIssue) return;
  if (policy.taxTreatment !== 'NO_TAX')
    return fail('Automatic billing requires configured tax treatment.');
  const residentId = idValue(payload.residentId),
    month = String(payload.month),
    today = await agencyToday(c);
  if (month >= today.slice(0, 7))
    return fail('Automatic billing requires a completed month.');
  const createdDate = (
    await c.query<{ date: string }>(
      "SELECT to_char(created_at AT TIME ZONE timezone,'YYYY-MM-DD') AS date FROM daybook.agencies WHERE id=daybook.current_agency()",
    )
  ).rows[0].date;
  const built = await buildBill(
    c,
    {
      residentId,
      periodMode: 'MONTHLY',
      periods: [monthPeriod(month, today)],
    },
    new Date(),
    createdDate,
  );
  if (built.preview.missingDayCount)
    return fail('Automatic invoice is blocked by unprepared delivery dates.');
  if (!built.hasActivity) return;
  await persistInvoice(
    c,
    { acknowledgeUnmarkedDays: false },
    built,
    agencyId,
    null,
  );
}

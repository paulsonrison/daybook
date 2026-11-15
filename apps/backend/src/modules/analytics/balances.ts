import type { PoolClient } from 'pg';
import { fail } from '../context.js';
import { financialResidents } from '../reports/financial-residents.js';
import { moneyString } from '../money.js';
const buckets = [
  'NOT_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_91_PLUS',
] as const;

export async function readAnalyticsBalances(c: PoolClient, today: string) {
  const residents = await financialResidents(c, today);
  let outstanding = 0n,
    credit = 0n,
    overdue = 0n;
  for (const resident of residents) {
    if (resident.balancePaise > 0n) outstanding += resident.balancePaise;
    else credit -= resident.balancePaise;
    overdue += resident.overduePaise;
  }
  const rows = (
    await c.query<{ bucket: string; amount: string }>(
      `
    WITH used AS(SELECT agency_id,debit_entry_id,sum(amount_paise) AS amount FROM daybook.ledger_settlements GROUP BY agency_id,debit_entry_id),
    remaining AS(SELECT e.due_date,greatest(e.amount_paise::numeric-coalesce(s.amount,0),0) AS amount
      FROM daybook.ledger_entries e LEFT JOIN used s ON(s.agency_id,s.debit_entry_id)=(e.agency_id,e.id) WHERE e.amount_paise>0),
    aged AS(SELECT amount,CASE WHEN due_date>=$1::date THEN 'NOT_DUE' WHEN $1::date-due_date<=30 THEN 'DAYS_1_30' WHEN $1::date-due_date<=60 THEN 'DAYS_31_60' WHEN $1::date-due_date<=90 THEN 'DAYS_61_90' ELSE 'DAYS_91_PLUS' END AS bucket FROM remaining WHERE amount>0)
    SELECT bucket,sum(amount)::text AS amount FROM aged GROUP BY bucket
  `,
      [today],
    )
  ).rows;
  const gross = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n),
    unallocated = gross - outstanding;
  if (unallocated < 0n)
    return fail(
      'Recorded balances and aging do not reconcile. Reload the report.',
      'CONFLICT',
    );
  return {
    asOfDate: today,
    outstanding: moneyString(outstanding),
    credit: moneyString(credit),
    overdue: unallocated > 0n && overdue > 0n ? null : moneyString(overdue),
    unsettledOverdue: moneyString(overdue),
    agingState: unallocated === 0n ? 'COMPLETE' : 'PARTIAL',
    agingGrossUnsettled: moneyString(gross),
    agingUnallocatedCredit: moneyString(unallocated),
    aging: buckets.map((bucket) => ({
      bucket,
      amount: moneyString(
        BigInt(rows.find((row) => row.bucket === bucket)?.amount ?? '0'),
      ),
    })),
  };
}

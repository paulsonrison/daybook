import type { PoolClient } from 'pg';
import type { reportMonth } from './model.js';
import { ratioBasisPoints } from './model.js';

/** Recorded registrations/clearances support an open-account cohort, not inferred active-status history. */
export async function readAnalyticsChurn(
  c: PoolClient,
  period: ReturnType<typeof reportMonth>,
  today: string,
) {
  const row = (
    await c.query<{
      closed: string;
      registrations: string;
      base: string;
      lost: string;
      missing: string;
    }>(
      `
    WITH births AS(
      SELECT a.agency_id,a.entity_id AS resident_id,min((a.created_at AT TIME ZONE g.timezone)::date) AS registered
      FROM daybook.audit_events a JOIN daybook.agencies g ON g.id=a.agency_id
      WHERE a.entity_type='resident' AND a.action='resident.created' GROUP BY a.agency_id,a.entity_id
    ),activity AS(
      SELECT agency_id,resident_id,min(dated) AS first_date FROM(
        SELECT agency_id,resident_id,entry_date AS dated FROM daybook.ledger_entries
        UNION ALL SELECT agency_id,resident_id,delivery_date FROM daybook.delivery_logs
        UNION ALL SELECT agency_id,resident_id,start_date FROM daybook.subscriptions
        UNION ALL SELECT agency_id,resident_id,termination_date FROM daybook.clearances
      ) evidence GROUP BY agency_id,resident_id
    )
    SELECT
      count(*) FILTER(WHERE cl.termination_date>=$1::date AND cl.termination_date<$2::date AND cl.termination_date<=$3::date)::text AS closed,
      count(*) FILTER(WHERE b.registered>=$1::date AND b.registered<$2::date AND b.registered<=$3::date)::text AS registrations,
      count(*) FILTER(WHERE b.registered<$1::date AND (cl.termination_date IS NULL OR cl.termination_date>=$1::date))::text AS base,
      count(*) FILTER(WHERE b.registered<$1::date AND cl.termination_date>=$1::date AND cl.termination_date<$2::date AND cl.termination_date<=$3::date)::text AS lost,
      count(*) FILTER(WHERE b.registered IS NULL OR (r.status='CLOSED' AND cl.id IS NULL) OR (r.status<>'CLOSED' AND cl.id IS NOT NULL) OR a.first_date<b.registered)::text AS missing
    FROM daybook.residents r LEFT JOIN births b ON(b.agency_id,b.resident_id)=(r.agency_id,r.id)
      LEFT JOIN daybook.clearances cl ON(cl.agency_id,cl.resident_id)=(r.agency_id,r.id)
      LEFT JOIN activity a ON(a.agency_id,a.resident_id)=(r.agency_id,r.id)
  `,
      [period.startDate, period.nextDate, today],
    )
  ).rows[0];
  const complete = BigInt(row.missing) === 0n;
  return {
    closedAccounts: row.closed,
    registrations: complete ? row.registrations : null,
    openAtStart: complete ? row.base : null,
    cohortClosures: complete ? row.lost : null,
    rateBasisPoints: complete
      ? ratioBasisPoints(BigInt(row.lost), BigInt(row.base))
      : null,
    coverage: complete ? 'COMPLETE' : 'PARTIAL',
    missingHistoryCount: row.missing,
    basis: 'RECORDED_OPEN_ACCOUNT_COHORT',
  };
}

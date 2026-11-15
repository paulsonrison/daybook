import type { PoolClient } from 'pg';
import { GraphQLError } from 'graphql';
import { plannedRows } from '../delivery/service.js';
import type { reportMonth } from './model.js';
type Period = ReturnType<typeof reportMonth>;
type CoverageRow = { records: string; prepared: string; elapsed: string };
function coverage(row: CoverageRow) {
  const known = BigInt(row.records) > 0n || BigInt(row.prepared) > 0n;
  const remaining = BigInt(row.elapsed) - BigInt(row.prepared);
  const missing = remaining > 0n ? remaining : 0n;
  return {
    known,
    missingDays: missing.toString(),
    coverage: !known ? 'UNAVAILABLE' : missing > 0n ? 'PARTIAL' : 'COMPLETE',
  };
}

export async function readAnalyticsCirculation(
  c: PoolClient,
  period: Period,
  today: string,
) {
  const args = [period.startDate, period.nextDate, today];
  const totals = (
    await c.query<
      CoverageRow & {
        fulfilled: string;
        chargeable: string;
        readers: string;
        subscriptions: string;
        replacements: string;
      }
    >(
      `
    SELECT count(*)::text AS records,
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('DELIVERED','REPLACED')),0)::text AS fulfilled,
      coalesce(sum(d.chargeable_quantity::numeric),0)::text AS chargeable,
      count(DISTINCT d.resident_id) FILTER(WHERE d.status IN('DELIVERED','REPLACED'))::text AS readers,
      count(DISTINCT d.subscription_id) FILTER(WHERE d.status IN('DELIVERED','REPLACED'))::text AS subscriptions,
      (SELECT count(*)::text FROM daybook.delivery_days WHERE delivery_date>=$1::date AND delivery_date<$2::date AND delivery_date<=$3::date) AS prepared,
      coalesce((SELECT sum(q.replacement_copies::numeric) FROM daybook.complaints q JOIN daybook.delivery_logs source ON(source.agency_id,source.id)=(q.agency_id,q.delivery_id) WHERE q.status='REPLACEMENT' AND source.delivery_date>=$1::date AND source.delivery_date<$2::date AND source.delivery_date<=$3::date),0)::text AS replacements,
      greatest(0,least($2::date-1,$3::date)-$1::date+1)::text AS elapsed
    FROM daybook.delivery_logs d WHERE d.delivery_date>=$1::date AND d.delivery_date<$2::date AND d.delivery_date<=$3::date AND d.status<>'SKIPPED'
  `,
      args,
    )
  ).rows[0];
  const state = coverage(totals);
  const byPublication = (
    await c.query<{
      publicationId: string;
      name: string;
      snapshotNames: string[];
      fulfilledCopies: string;
      readers: string;
    }>(
      `
    SELECT p.id AS "publicationId",p.name||' · '||p.edition AS name,
      array_agg(DISTINCT d.publication_name ORDER BY d.publication_name) AS "snapshotNames",
      coalesce(sum(d.quantity::numeric) FILTER(WHERE d.status IN('DELIVERED','REPLACED')),0)::text AS "fulfilledCopies",
      count(DISTINCT d.resident_id) FILTER(WHERE d.status IN('DELIVERED','REPLACED'))::text AS readers
    FROM daybook.delivery_logs d JOIN daybook.publications p ON(p.agency_id,p.id)=(d.agency_id,d.publication_id)
    WHERE d.delivery_date>=$1::date AND d.delivery_date<$2::date AND d.delivery_date<=$3::date AND d.status<>'SKIPPED'
    GROUP BY p.id,p.name,p.edition ORDER BY p.name,p.edition,p.id
  `,
      args,
    )
  ).rows;
  const months = (
    await c.query<CoverageRow & { month: string; fulfilled: string }>(
      `
    WITH months AS(SELECT value::date AS month FROM generate_series(greatest(timestamp '0001-01-01',$1::date-interval '11 months'),$1::date,interval '1 month') AS series(value)),
    totals AS(SELECT date_trunc('month',delivery_date)::date AS month,count(*) AS records,coalesce(sum(quantity::numeric) FILTER(WHERE status IN('DELIVERED','REPLACED')),0) AS fulfilled
      FROM daybook.delivery_logs WHERE delivery_date>=(SELECT min(month) FROM months) AND delivery_date<$2::date AND delivery_date<=$3::date AND status<>'SKIPPED' GROUP BY date_trunc('month',delivery_date)::date),
    prepared AS(SELECT date_trunc('month',delivery_date)::date AS month,count(*) AS days FROM daybook.delivery_days WHERE delivery_date>=(SELECT min(month) FROM months) AND delivery_date<$2::date AND delivery_date<=$3::date GROUP BY date_trunc('month',delivery_date)::date)
    SELECT to_char(m.month,'YYYY-MM') AS month,coalesce(t.records,0)::text AS records,coalesce(t.fulfilled,0)::text AS fulfilled,coalesce(p.days,0)::text AS prepared,
      greatest(0,least((m.month+interval '1 month')::date-1,$3::date)-m.month+1)::text AS elapsed
    FROM months m LEFT JOIN totals t USING(month) LEFT JOIN prepared p USING(month) ORDER BY m.month
  `,
      args,
    )
  ).rows;
  let currentScheduled: {
    asOfDate: string;
    copies: string | null;
    state: string;
    reason: string | null;
  };
  try {
    const planned = await plannedRows(c, today);
    currentScheduled = {
      asOfDate: today,
      copies: planned
        .reduce((sum, row) => sum + BigInt(row.quantity), 0n)
        .toString(),
      state: 'COMPLETE',
      reason: null,
    };
  } catch (error) {
    if (
      !(error instanceof GraphQLError) ||
      error.extensions.code !== 'BAD_USER_INPUT'
    )
      throw error;
    currentScheduled = {
      asOfDate: today,
      copies: null,
      state: 'UNAVAILABLE',
      reason: 'SCHEDULE_CONFIGURATION',
    };
  }
  return {
    fulfilledCopies: state.known ? totals.fulfilled : null,
    chargeableCopies: state.known ? totals.chargeable : null,
    replacementCopies: state.known ? totals.replacements : null,
    readers: state.known ? totals.readers : null,
    subscriptions: state.known ? totals.subscriptions : null,
    preparedDays: totals.prepared,
    elapsedDays: totals.elapsed,
    missingDays: state.missingDays,
    coverage: state.coverage,
    currentScheduled,
    byPublication,
    trend: months.map((row) => {
      const status = coverage(row);
      return {
        month: row.month,
        fulfilledCopies: status.known ? row.fulfilled : null,
        preparedDays: row.prepared,
        elapsedDays: row.elapsed,
        missingDays: status.missingDays,
        coverage: status.coverage,
      };
    }),
  };
}

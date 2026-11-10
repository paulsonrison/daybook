import type { PoolClient } from 'pg';
import { localClock } from '../scheduling/time.js';
export async function readDeliveryMetrics(client: PoolClient) {
  const summary = (
    await client.query<{
      openComplaints: number;
      resolvedComplaints: number;
      totalComplaints: number;
      satisfactionAverage: number | null;
    }>(
      `SELECT count(*) FILTER(WHERE status='OPEN')::integer AS "openComplaints",count(*) FILTER(WHERE status<>'OPEN')::integer AS "resolvedComplaints",count(*)::integer AS "totalComplaints",avg(satisfaction_rating)::float8 AS "satisfactionAverage" FROM daybook.complaints`,
    )
  ).rows[0];
  const staffErrors = (
    await client.query<{
      staffId: string | null;
      name: string;
      errors: number;
      deliveries: number;
    }>(
      `SELECT d.staff_id AS "staffId",coalesce(s.name,'Unassigned') AS name,count(DISTINCT d.id) FILTER(WHERE c.status IN('REPLACEMENT','CREDIT'))::integer AS errors,count(DISTINCT d.id)::integer AS deliveries FROM daybook.delivery_logs d LEFT JOIN daybook.complaints c ON(c.agency_id,c.delivery_id)=(d.agency_id,d.id) LEFT JOIN daybook.staff s ON(s.agency_id,s.id)=(d.agency_id,d.staff_id) WHERE d.status<>'SKIPPED' GROUP BY d.staff_id,s.name ORDER BY name`,
    )
  ).rows;
  const jobs = (
    await client.query<{ failedJobs: number; lastAutomaticRun: Date | null }>(
      `SELECT count(*) FILTER(WHERE status='FAILED')::integer AS "failedJobs",max(completed_at) FILTER(WHERE status='SUCCEEDED') AS "lastAutomaticRun" FROM daybook.job_runs`,
    )
  ).rows[0];
  const timezone = (
    await client.query<{ timezone: string }>(
      'SELECT timezone FROM daybook.agencies WHERE id=daybook.current_agency()',
    )
  ).rows[0].timezone;
  return {
    ...summary,
    ...jobs,
    lastAutomaticRun: jobs.lastAutomaticRun?.toISOString() ?? null,
    staffErrors,
    today: localClock(new Date(), timezone).date,
    timezone,
  };
}

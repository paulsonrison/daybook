import { localClock } from '../scheduling/time.js';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { calendarDate } from '../scheduling/calendar.js';
import { markForDate } from '../delivery/service.js';
import { buildForDate } from '../manifests/service.js';
import {
  claimJob,
  enqueueJob,
  failJob,
  finishJob,
  latestJobDate,
  lockClaim,
} from './repository.js';
export interface WorkerTenant {
  id: string;
  timezone: string;
  createdAt: string;
}
export async function runAgencyJobs(
  pool: Pool,
  tenant: WorkerTenant,
  now: Date,
): Promise<void> {
  const started = performance.now(),
    currentTime = () => new Date(now.getTime() + performance.now() - started);
  const clock = localClock(now, tenant.timezone);
  await withTenant(pool, tenant.id, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('scheduler:' || $1,0))",
      [tenant.id],
    );
    const latest = await latestJobDate(client),
      start = calendarDate(
        latest ?? localClock(new Date(tenant.createdAt), tenant.timezone).date,
      ),
      end = calendarDate(clock.date);
    let processed = 0;
    for (
      let stamp = start.valueOf();
      stamp <= end.valueOf() && processed < 31;
      stamp += 86400000, processed++
    ) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      await enqueueJob(client, tenant.id, date, 'MARK', now);
      if (date < clock.date || clock.hour >= 4) {
        await enqueueJob(client, tenant.id, date, 'MANIFEST_MORNING', now);
        await enqueueJob(client, tenant.id, date, 'MANIFEST_EVENING', now);
      }
    }
  });
  for (let count = 0; count < 100; count++) {
    const job = await withTenant(pool, tenant.id, (c) =>
      claimJob(c, currentTime()),
    );
    if (!job) break;
    try {
      await withTenant(pool, tenant.id, async (client) => {
        await client.query("SET LOCAL statement_timeout='30s'");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
          [tenant.id],
        );
        if (!(await lockClaim(client, job, currentTime()))) return;
        if (job.kind === 'MARK')
          await markForDate(client, tenant.id, job.date, now);
        else if (
          job.kind === 'MANIFEST_MORNING' ||
          job.kind === 'MANIFEST_EVENING'
        )
          await buildForDate(
            client,
            tenant.id,
            job.date,
            job.kind === 'MANIFEST_MORNING' ? 'MORNING' : 'EVENING',
            now,
          );
        else throw new Error('Unsupported job kind');
        await finishJob(client, job.id, currentTime(), job.attempts);
      });
    } catch {
      await withTenant(pool, tenant.id, (c) => failJob(c, job, currentTime()));
    }
  }
}
export async function workerTenants(pool: Pool): Promise<WorkerTenant[]> {
  return (
    await pool.query<{ id: string; timezone: string; created_at: Date }>(
      'SELECT * FROM daybook.worker_tenants()',
    )
  ).rows.map((row) => ({
    id: row.id,
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
  }));
}

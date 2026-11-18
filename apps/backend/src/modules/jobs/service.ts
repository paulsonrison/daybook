import { closeMonth } from '../billing/cycles.js';
import { localClock } from '../scheduling/time.js';
import { issueAutomaticInvoice } from '../billing/automatic.js';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { calendarDate } from '../scheduling/calendar.js';
import { markForDate } from '../delivery/service.js';
import { buildForDate } from '../manifests/service.js';
import {
  claimJobWithOutcome,
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
  options: {
    maxJobs?: number;
    maxCatchupDays?: number;
    catchupStatementTimeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ completed: number; failed: number; hasDeferredWork: boolean }> {
  const maxJobs = options.maxJobs ?? 100;
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100)
    throw new Error('Invalid scheduled job limit.');
  const maxCatchupDays = options.maxCatchupDays ?? 31;
  if (
    !Number.isInteger(maxCatchupDays) ||
    maxCatchupDays < 1 ||
    maxCatchupDays > 31
  )
    throw new Error('Invalid scheduled catch-up limit.');
  if (
    options.catchupStatementTimeoutMs !== undefined &&
    (!Number.isInteger(options.catchupStatementTimeoutMs) ||
      options.catchupStatementTimeoutMs < 1000 ||
      options.catchupStatementTimeoutMs > 30000)
  )
    throw new Error('Invalid scheduled query limit.');
  if (options.signal?.aborted)
    return { completed: 0, failed: 0, hasDeferredWork: true };
  const started = performance.now(),
    currentTime = () => new Date(now.getTime() + performance.now() - started);
  const clock = localClock(now, tenant.timezone);
  let catchupDeferred = 0;
  await withTenant(pool, tenant.id, async (client) => {
    if (options.catchupStatementTimeoutMs)
      await client.query(
        `SET LOCAL statement_timeout='${options.catchupStatementTimeoutMs}ms'`,
      );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('scheduler:' || $1,0))",
      [tenant.id],
    );
    const latest = await latestJobDate(client),
      start = calendarDate(
        latest ?? localClock(new Date(tenant.createdAt), tenant.timezone).date,
      ),
      end = calendarDate(clock.date);
    let processed = 0,
      stamp = start.valueOf();
    for (
      ;
      stamp <= end.valueOf() &&
      processed < maxCatchupDays &&
      !options.signal?.aborted;
      stamp += 86400000, processed++
    ) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      await enqueueJob(client, tenant.id, date, 'MARK', now);
      if (date.endsWith('-01')) {
        const month = new Date(stamp - 86400000).toISOString().slice(0, 7);
        if (
          month >=
          localClock(new Date(tenant.createdAt), tenant.timezone).date.slice(
            0,
            7,
          )
        )
          await enqueueJob(client, tenant.id, date, 'MONTH_CLOSE', now, {
            month,
          });
      }
      if (date < clock.date || clock.hour >= 4) {
        await enqueueJob(client, tenant.id, date, 'MANIFEST_MORNING', now);
        await enqueueJob(client, tenant.id, date, 'MANIFEST_EVENING', now);
      }
    }
    if (stamp <= end.valueOf()) catchupDeferred = 1;
  });
  let completed = 0,
    failed = 0,
    hasDeferredWork = catchupDeferred > 0;
  for (let count = 0; count < maxJobs; count++) {
    if (options.signal?.aborted) {
      hasDeferredWork = true;
      break;
    }
    const claim = await withTenant(pool, tenant.id, (c) =>
      claimJobWithOutcome(c, currentTime()),
    );
    failed += claim.exhausted;
    const job = claim.job;
    if (!job) break;
    if (options.signal?.aborted) {
      hasDeferredWork = true;
      break;
    }
    try {
      const ran = await withTenant(pool, tenant.id, async (client) => {
        await client.query("SET LOCAL statement_timeout='30s'");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
          [tenant.id],
        );
        if (
          !(await lockClaim(client, job, currentTime())) ||
          options.signal?.aborted
        )
          return false;
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
        else if (job.kind === 'MONTH_CLOSE')
          await closeMonth(
            client,
            tenant.id,
            String(job.payload.month),
            false,
            null,
            now,
          );
        else if (job.kind === 'AUTO_INVOICE')
          await issueAutomaticInvoice(client, tenant.id, job.payload);
        else throw new Error('Unsupported job kind');
        await finishJob(client, job.id, currentTime(), job.attempts);
        return true;
      });
      if (ran) completed++;
      else if (options.signal?.aborted) {
        hasDeferredWork = true;
        break;
      }
    } catch {
      await withTenant(pool, tenant.id, (c) => failJob(c, job, currentTime()));
      failed++;
    }
  }
  if (options.signal?.aborted) hasDeferredWork = true;
  const ready = await withTenant(
    pool,
    tenant.id,
    async (client) =>
      (
        await client.query(
          "SELECT EXISTS(SELECT 1 FROM daybook.job_runs WHERE attempts<5 AND ((status IN('PENDING','FAILED') AND available_at<=$1) OR (status='RUNNING' AND lease_until<=$1))) AS ready",
          [currentTime().toISOString()],
        )
      ).rows[0].ready,
  );
  if (ready) hasDeferredWork = true;
  return { completed, failed, hasDeferredWork };
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

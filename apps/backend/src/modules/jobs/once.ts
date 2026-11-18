import type { WorkerTenant } from './service.js';
import { runAgencyJobs, workerTenants } from './service.js';
import type { Pool } from 'pg';

const DEFAULT_TENANT_LIMIT = 5;
const MAX_TENANTS = 1000;

/** Select one deterministic, rotating tenant slice for a bounded hourly tick. */
export function scheduledTenants(
  tenants: WorkerTenant[],
  now: Date,
  limit = DEFAULT_TENANT_LIMIT,
): WorkerTenant[] {
  if (!Number.isFinite(now.getTime()))
    throw new Error('Invalid schedule time.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid scheduled tenant limit.');
  if (tenants.length > MAX_TENANTS)
    throw new Error('Scheduled tenant inventory exceeds its limit.');

  const ordered = [...tenants].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (
    ordered.some(
      (tenant, index) =>
        !tenant.id || (index > 0 && tenant.id === ordered[index - 1].id),
    )
  )
    throw new Error('Scheduled tenant inventory is invalid.');
  if (ordered.length === 0) return ordered;

  const hour = Math.floor(now.getTime() / 3_600_000);
  const start =
    (((hour * limit) % ordered.length) + ordered.length) % ordered.length;
  return Array.from(
    { length: Math.min(limit, ordered.length) },
    (_, index) => ordered[(start + index) % ordered.length],
  );
}

export async function runScheduledOnce(
  pool: Pool,
  now: Date,
  options: {
    maxTenants?: number;
    maxJobsPerTenant?: number;
    timeBudgetMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  tenantsVisited: number;
  jobsCompleted: number;
  jobsFailed: number;
  hasDeferredWork: boolean;
  cancelled: boolean;
}> {
  const maxTenants = options.maxTenants ?? DEFAULT_TENANT_LIMIT;
  const maxJobsPerTenant = options.maxJobsPerTenant ?? 1;
  const timeBudgetMs = options.timeBudgetMs ?? 240_000;
  if (
    !Number.isInteger(timeBudgetMs) ||
    timeBudgetMs < 1000 ||
    timeBudgetMs > 300_000
  )
    throw new Error('Invalid scheduled time budget.');
  const deadline = AbortSignal.timeout(timeBudgetMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  if (signal.aborted)
    return {
      tenantsVisited: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      hasDeferredWork: true,
      cancelled: true,
    };
  const tenants = scheduledTenants(await workerTenants(pool), now, maxTenants);
  let tenantsVisited = 0,
    jobsCompleted = 0,
    jobsFailed = 0,
    hasDeferredWork = false;
  for (const tenant of tenants) {
    if (signal.aborted) {
      hasDeferredWork = true;
      break;
    }
    const result = await runAgencyJobs(pool, tenant, now, {
      maxJobs: maxJobsPerTenant,
      maxCatchupDays: 2,
      catchupStatementTimeoutMs: 10_000,
      signal,
    });
    tenantsVisited++;
    jobsCompleted += result.completed;
    jobsFailed += result.failed;
    hasDeferredWork ||= result.hasDeferredWork;
  }
  return {
    tenantsVisited,
    jobsCompleted,
    jobsFailed,
    hasDeferredWork,
    cancelled: signal.aborted,
  };
}

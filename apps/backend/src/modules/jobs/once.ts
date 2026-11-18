import type { WorkerTenant } from './service.js';

const DEFAULT_TENANT_LIMIT = 5;
const MAX_TENANTS = 1000;

/** Select one deterministic, rotating tenant slice for a bounded hourly tick. */
export function scheduledTenants(
  tenants: WorkerTenant[],
  now: Date,
  limit = DEFAULT_TENANT_LIMIT,
): WorkerTenant[] {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid schedule time.');
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
  const start = ((hour * limit) % ordered.length + ordered.length) % ordered.length;
  return Array.from(
    { length: Math.min(limit, ordered.length) },
    (_, index) => ordered[(start + index) % ordered.length],
  );
}

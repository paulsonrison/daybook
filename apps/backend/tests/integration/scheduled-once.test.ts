import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import type { Pool, PoolClient } from 'pg';
import {
  runAgencyJobs,
  workerTenants,
} from '../../src/modules/jobs/service.js';
import {
  runScheduledOnce,
  scheduledTenants,
} from '../../src/modules/jobs/once.js';
const api = testApi();
after(() => api.pool.end());
test('scheduled agency slices cap claimed jobs and leave cancelled work untouched for later recovery', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const now = new Date('2026-11-18T04:30:00Z');
  const tenant = {
    id: agencyId,
    timezone: 'Asia/Kolkata',
    createdAt: '2026-11-18T00:00:00Z',
  };
  const counts = () =>
    withTenant(
      api.pool,
      agencyId,
      async (client) =>
        (
          await client.query(
            "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='SUCCEEDED')::int AS done FROM daybook.job_runs",
          )
        ).rows[0],
    );
  await runAgencyJobs(api.pool, tenant, now, { maxJobs: 1 });
  assert.deepEqual(await counts(), { total: 3, done: 1 });
  const stop = new AbortController();
  stop.abort();
  await runAgencyJobs(api.pool, tenant, now, {
    maxJobs: 1,
    signal: stop.signal,
  });
  assert.deepEqual(await counts(), { total: 3, done: 1 });
  await runAgencyJobs(api.pool, tenant, now, { maxJobs: 1 });
  assert.deepEqual(await counts(), { total: 3, done: 2 });
  await runAgencyJobs(api.pool, tenant, now, { maxJobs: 1 });
  assert.deepEqual(await counts(), { total: 3, done: 3 });
});
test('a cancellation immediately after a durable claim prevents the job from starting', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const now = new Date('2026-11-18T04:30:00Z'),
    stop = new AbortController();
  const tenant = {
    id: agencyId,
    timezone: 'Asia/Kolkata',
    createdAt: '2026-11-18T00:00:00Z',
  };
  const pool = new Proxy(api.pool, {
    get(target, key, receiver) {
      if (key !== 'connect') return Reflect.get(target, key, receiver);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, property) {
            if (property !== 'query') {
              const value = Reflect.get(connection, property, connection);
              return typeof value === 'function'
                ? value.bind(connection)
                : value;
            }
            return async (...args: Parameters<PoolClient['query']>) => {
              const result = await connection.query(...args);
              if (
                typeof args[0] === 'string' &&
                args[0].includes(
                  "UPDATE daybook.job_runs j SET status='RUNNING'",
                )
              )
                stop.abort();
              return result;
            };
          },
        });
      };
    },
  }) as Pool;
  await runAgencyJobs(pool, tenant, now, { maxJobs: 1, signal: stop.signal });
  const counts = await withTenant(
    api.pool,
    agencyId,
    async (client) =>
      (
        await client.query(
          "SELECT count(*) FILTER(WHERE status='SUCCEEDED')::int AS done,count(*) FILTER(WHERE status='RUNNING')::int AS running FROM daybook.job_runs",
        )
      ).rows[0],
  );
  assert.deepEqual(counts, { done: 0, running: 1 });
});
test('one-shot scheduling processes only the deterministic bounded tenant slice', async () => {
  const now = new Date('2026-11-18T05:00:00Z');
  for (let i = 0; i < 6; i++) await api.agency();
  const tenants = await workerTenants(api.pool),
    selected = scheduledTenants(tenants, now, 2);
  const before = new Map(
    await Promise.all(
      tenants.map(
        async (tenant) =>
          [
            tenant.id,
            await withTenant(
              api.pool,
              tenant.id,
              async (client) =>
                (
                  await client.query(
                    "SELECT count(*) FILTER(WHERE status='SUCCEEDED')::int AS done FROM daybook.job_runs",
                  )
                ).rows[0].done,
            ),
          ] as const,
      ),
    ),
  );
  const result = await runScheduledOnce(api.pool, now, {
    maxTenants: 2,
    maxJobsPerTenant: 1,
  });
  assert.equal(result.tenantsVisited, 2);
  assert.equal(result.cancelled, false);
  assert.ok(
    result.jobsCompleted >= 0 &&
      result.jobsFailed === 0 &&
      typeof result.hasDeferredWork === 'boolean',
  );
  for (const tenant of tenants) {
    const done = await withTenant(
      api.pool,
      tenant.id,
      async (client) =>
        (
          await client.query(
            "SELECT count(*) FILTER(WHERE status='SUCCEEDED')::int AS done FROM daybook.job_runs",
          )
        ).rows[0].done,
    );
    if (!selected.some((item) => item.id === tenant.id))
      assert.equal(done, before.get(tenant.id));
  }
});
test('scheduled worker surfaces failed durable jobs rather than reporting them as completed', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const now = new Date('2026-11-18T06:00:00Z'),
    tenant = {
      id: agencyId,
      timezone: 'Asia/Kolkata',
      createdAt: '2026-11-18T00:00:00Z',
    };
  await withTenant(api.pool, agencyId, (client) =>
    client.query(
      "INSERT INTO daybook.job_runs(id,agency_id,job_key,kind,run_date,status,available_at,payload) VALUES($1,$2,$3,'BOGUS','2026-11-18','PENDING',$4,'{}')",
      [
        randomUUID(),
        agencyId,
        `test-failed:${randomUUID()}`,
        now.toISOString(),
      ],
    ),
  );
  const result = await runAgencyJobs(api.pool, tenant, now, { maxJobs: 1 });
  assert.deepEqual(result, { completed: 0, failed: 1, hasDeferredWork: true });
  const scheduled = await runScheduledOnce(
    api.pool,
    new Date(now.valueOf() + 3000),
    { maxTenants: 100, maxJobsPerTenant: 1, timeBudgetMs: 60000 },
  );
  assert.ok(scheduled.jobsFailed >= 1);
  assert.equal(scheduled.hasDeferredWork, true);
});
test('scheduled worker reports expired jobs already at the retry limit', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const now = new Date('2026-11-18T07:00:00Z');
  await withTenant(api.pool, agencyId, (client) =>
    client.query(
      "INSERT INTO daybook.job_runs(id,agency_id,job_key,kind,run_date,status,attempts,lease_until,available_at,payload) VALUES($1,$2,$3,'BOGUS','2026-11-17','RUNNING',5,$4,$5,'{}')",
      [
        randomUUID(),
        agencyId,
        `expired:${randomUUID()}`,
        new Date(now.valueOf() - 1000).toISOString(),
        now.toISOString(),
      ],
    ),
  );
  const tenant = {
    id: agencyId,
    timezone: 'Asia/Kolkata',
    createdAt: '2026-11-18T00:00:00Z',
  };
  const result = await runAgencyJobs(api.pool, tenant, now, { maxJobs: 1 });
  assert.equal(result.failed, 1);
  const status = await withTenant(
    api.pool,
    agencyId,
    async (client) =>
      (
        await client.query(
          "SELECT status FROM daybook.job_runs WHERE kind='BOGUS'",
        )
      ).rows[0].status,
  );
  assert.equal(status, 'FAILED');
});

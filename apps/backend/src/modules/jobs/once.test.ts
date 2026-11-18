import assert from 'node:assert/strict';
import test from 'node:test';
test('hourly tenant selection is bounded, stable and rotates rather than starving later agencies', async () => {
  const { scheduledTenants } = await import('./once.js');
  const tenants = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    timezone: 'UTC',
    createdAt: '1970-01-01T00:00:00Z',
  }));
  assert.deepEqual(
    scheduledTenants(tenants, new Date(0)).map((t) => t.id),
    ['0', '1', '2', '3', '4'],
  );
  assert.deepEqual(
    scheduledTenants([...tenants].reverse(), new Date(3600000)).map(
      (t) => t.id,
    ),
    ['5', '6', '0', '1', '2'],
  );
  assert.deepEqual(
    scheduledTenants(tenants.slice(0, 2), new Date(3600000)).map((t) => t.id),
    ['1', '0'],
  );
  assert.deepEqual(scheduledTenants([], new Date(0)), []);
  assert.throws(() => scheduledTenants(tenants, new Date(NaN)));
  assert.throws(() =>
    scheduledTenants(Array(1001).fill(tenants[0]), new Date(0)),
  );
});
test('a cancelled one-shot stops before tenant discovery', async () => {
  const { runScheduledOnce } = await import('./once.js');
  const stop = new AbortController();
  stop.abort();
  const pool = {
    query() {
      throw new Error('database discovery must not start');
    },
  } as never;
  assert.deepEqual(
    await runScheduledOnce(pool, new Date(0), { signal: stop.signal }),
    {
      tenantsVisited: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      hasDeferredWork: true,
      cancelled: true,
    },
  );
});

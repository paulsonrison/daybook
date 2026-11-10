import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { withTenant } from '../../src/db/tenant.js';
import {
  enqueueJob,
  claimJob,
  finishJob,
  failJob,
  lockClaim,
} from '../../src/modules/jobs/repository.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
test('an expired job claimant cannot finish or fail a newer leased attempt', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const at = new Date('2024-02-01T00:00:00Z'),
    later = new Date('2024-02-01T00:01:01Z');
  await withTenant(api.pool, agencyId, (c) =>
    enqueueJob(c, agencyId, '2024-02-01', 'MARK', at),
  );
  const first = (await withTenant(api.pool, agencyId, (c) => claimJob(c, at)))!,
    second = (await withTenant(api.pool, agencyId, (c) => claimJob(c, later)))!;
  assert.equal(
    await withTenant(api.pool, agencyId, (c) => lockClaim(c, first, later)),
    false,
  );
  assert.equal(
    await withTenant(api.pool, agencyId, (c) => lockClaim(c, second, later)),
    true,
  );
  assert.equal(second.attempts, 2);
  await withTenant(api.pool, agencyId, (c) =>
    finishJob(c, first.id, later, first.attempts),
  );
  async function status() {
    return withTenant(
      api.pool,
      agencyId,
      async (c) =>
        (
          await c.query<{ status: string }>(
            'SELECT status FROM daybook.job_runs WHERE id=$1',
            [first.id],
          )
        ).rows[0].status,
    );
  }
  assert.equal(await status(), 'RUNNING');
  await withTenant(api.pool, agencyId, (c) => failJob(c, first, later));
  assert.equal(await status(), 'RUNNING');
  await withTenant(api.pool, agencyId, (c) =>
    finishJob(c, second.id, later, second.attempts),
  );
  await withTenant(api.pool, agencyId, (c) => failJob(c, first, later));
  assert.equal(await status(), 'SUCCEEDED');
});

test('durable job failures stop after five attempts and can recover an expired lease', async () => {
  const cookie = await api.agency(),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  let now = new Date('2024-02-01T00:00:00Z');
  await withTenant(api.pool, agencyId, (c) =>
    enqueueJob(c, agencyId, '2024-02-01', 'MARK', now),
  );
  for (let attempt = 1; attempt <= 5; attempt++) {
    const job = (await withTenant(api.pool, agencyId, (c) =>
      claimJob(c, now),
    ))!;
    assert.equal(job.attempts, attempt);
    await withTenant(api.pool, agencyId, (c) => failJob(c, job, now));
    now = new Date(now.getTime() + 301000);
  }
  assert.equal(
    await withTenant(api.pool, agencyId, (c) => claimJob(c, now)),
    undefined,
  );
  const row = await withTenant(
    api.pool,
    agencyId,
    async (c) =>
      (await c.query('SELECT status,attempts FROM daybook.job_runs')).rows[0],
  );
  assert.deepEqual(row, { status: 'FAILED', attempts: 5 });
});

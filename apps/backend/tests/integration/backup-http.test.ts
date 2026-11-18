import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test, after } from 'node:test';
import { testApi } from './support.js';
import { createApp } from '../../src/app.js';
import { createServer } from 'node:http';
const api = testApi();
after(() => api.pool.end());
test('backup status requires a valid agency session and scheduler only accepts fresh body-free signed fixed commands', async () => {
  const secret = 'b'.repeat(64);
  let scheduledState = 'COMPLETED';
  const app = createApp({
    pool: api.pool,
    databaseReady: async () => true,
    backupRequest: async (operation) => ({
      state: operation === 'status' ? 'NOT_CONFIGURED' : 'SKIPPED',
      ...(operation === 'tick'
        ? {
            scheduled: {
              state: scheduledState,
              tenantsVisited: 2,
              jobsCompleted: 1,
              jobsFailed: 0,
              hasDeferredWork: false,
            },
          }
        : {}),
    }),
    schedulerSecret: secret,
  });
  const status = () => new Request('http://localhost/operations/backups');
  assert.equal((await app.fetch(status())).status, 401);
  const cookie = await api.agency();
  const signedIn = await app.fetch(
    new Request(status(), { headers: { cookie } }),
  );
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await signedIn.json(), { state: 'NOT_CONFIGURED' });
  const path = '/internal/jobs/tick';
  function tick(timestamp = Date.now(), body?: string, signature?: string) {
    const stamp = String(timestamp);
    return new Request('http://localhost' + path, {
      method: 'POST',
      headers: {
        'x-daybook-timestamp': stamp,
        'x-daybook-signature':
          signature ??
          createHmac('sha256', secret)
            .update(stamp + '\nPOST\n' + path)
            .digest('hex'),
      },
      body,
    });
  }
  assert.equal(
    (await app.fetch(tick(Date.now(), undefined, '0'.repeat(64)))).status,
    401,
  );
  assert.equal((await app.fetch(tick(Date.now() - 6 * 60000))).status, 401);
  assert.equal((await app.fetch(tick(Date.now() + 6 * 60000))).status, 401);
  assert.equal((await app.fetch(tick(Date.now(), '{}'))).status, 400);
  assert.equal(
    (await app.fetch(new Request('http://localhost' + path))).status,
    405,
  );
  const result = await app.fetch(tick());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    state: 'SKIPPED',
    scheduled: {
      state: 'COMPLETED',
      tenantsVisited: 2,
      jobsCompleted: 1,
      jobsFailed: 0,
      hasDeferredWork: false,
    },
  });
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const signed = tick();
    const overHttp = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: signed.headers,
    });
    assert.equal(
      overHttp.status,
      200,
      'Actual Node adapter must accept an authenticated zero-byte POST',
    );
    assert.deepEqual(await overHttp.json(), {
      state: 'SKIPPED',
      scheduled: {
        state: 'COMPLETED',
        tenantsVisited: 2,
        jobsCompleted: 1,
        jobsFailed: 0,
        hasDeferredWork: false,
      },
    });
    scheduledState = 'UNAVAILABLE';
    const incomplete = await app.fetch(tick());
    assert.equal(incomplete.status, 503);
    assert.deepEqual(await incomplete.json(), {
      state: 'SKIPPED',
      scheduled: {
        state: 'UNAVAILABLE',
        tenantsVisited: 2,
        jobsCompleted: 1,
        jobsFailed: 0,
        hasDeferredWork: false,
      },
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
  const offline = createApp({ databaseReady: async () => true });
  assert.equal((await offline.fetch(tick())).status, 503);
});

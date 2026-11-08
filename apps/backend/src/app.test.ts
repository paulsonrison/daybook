import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';

test('GraphQL health query returns service status', async () => {
  const app = createApp({ databaseReady: async () => true });
  const response = await app.fetch(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ health { status service } }' }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: { health: { status: 'ok', service: 'daybook-api' } },
  });
});

test('liveness does not depend on the database', async () => {
  const app = createApp({ databaseReady: async () => false });
  assert.equal(
    (await app.fetch(new Request('http://localhost/health'))).status,
    200,
  );
});

test('readiness reports unavailable database with 503', async () => {
  const app = createApp({ databaseReady: async () => false });
  assert.equal(
    (await app.fetch(new Request('http://localhost/ready'))).status,
    503,
  );
});

test('readiness reports reachable database', async () => {
  const app = createApp({ databaseReady: async () => true });
  assert.equal(
    (await app.fetch(new Request('http://localhost/ready'))).status,
    200,
  );
});

test('GraphQL rejects fields outside the schema', async () => {
  const app = createApp({ databaseReady: async () => true });
  const response = await app.fetch(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ missingField }' }),
    }),
  );
  const body = (await response.json()) as { errors?: unknown[] };
  assert.ok(body.errors?.length);
});

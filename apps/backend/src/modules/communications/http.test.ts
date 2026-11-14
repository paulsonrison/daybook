import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { handleProviderRequest } from './http.js';
import { providerRegistry } from './config.js';

test('malformed verification tokens and oversized input fail before database access', async () => {
  const agency = '00000000-0000-4000-8000-000000000001';
  const registry = providerRegistry({
    TOKEN: 'synthetic',
    APP: 'synthetic-app',
    VERIFY: 'synthetic-verify',
    DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
      [agency]: {
        whatsapp: {
          phoneNumberId: '123',
          apiVersion: 'v27.0',
          accessTokenEnv: 'TOKEN',
          appSecretEnv: 'APP',
          verifyTokenEnv: 'VERIFY',
        },
      },
    }),
  });
  const pool = {
    connect() {
      throw new Error('Invalid input must not reach database');
    },
  } as unknown as Pool;
  const path = `http://backend/webhooks/whatsapp/${agency}`;
  const token = encodeURIComponent('ന'.repeat('synthetic-verify'.length));
  const invalid = await handleProviderRequest(
    new Request(
      `${path}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
    ),
    pool,
    registry,
  );
  assert.equal(invalid.status, 403);
  const oversized = await handleProviderRequest(
    new Request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(65537),
    }),
    pool,
    registry,
  );
  assert.equal(oversized.status, 413);
});

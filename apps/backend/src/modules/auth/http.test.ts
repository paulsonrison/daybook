import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { handleAuth } from './http.js';

test('authentication validation localizes controlled field labels without reaching the database', async () => {
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      throw new Error('Unexpected database access');
    },
  } as unknown as Pool;
  const responses = await Promise.all(
    ['hi', 'ml', 'en'].map((locale) =>
      handleAuth(
        new Request('http://localhost/auth/login', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
            'accept-language': locale,
          },
          body: JSON.stringify({ email: '', password: 'example password' }),
        }),
        pool,
        'http://localhost:3000',
      ),
    ),
  );
  const expected = [
    'यह फ़ील्ड सही भरें: ईमेल पता।',
    'ഈ ഫീൽഡ് ശരിയായി നൽകുക: ഇമെയിൽ വിലാസം.',
    'Enter a valid email address.',
  ];
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: expected[index] });
  }
  assert.equal(calls, 0);
});

test('authentication protocol errors keep their status when localized', async () => {
  const response = await handleAuth(
    new Request('http://localhost/auth/login', {
      headers: { 'accept-language': 'hi' },
    }),
    {} as Pool,
    'http://localhost:3000',
  );
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {
    error: 'इस तरीके की अनुमति नहीं है।',
  });
});

test('oversized streamed authentication input is cancelled before being fully read', async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks++ < 100) controller.enqueue(new Uint8Array(1024).fill(65));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://localhost/auth/register', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const response = await handleAuth(
    request,
    {} as Pool,
    'http://localhost:3000',
  );
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks < 100);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { handleAuth } from './http.js';

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

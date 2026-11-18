import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
test('scheduled tick signs only the approved empty request and does not retry provider failures', async () => {
  const { runScheduledTick } = await import('./scheduler.mjs');
  const env = {
    DAYBOOK_ORIGIN: 'https://daybook-paulson-preview-o1c8.onrender.com',
    DAYBOOK_SCHEDULER_SECRET: 'a'.repeat(64),
  };
  const timestamp = 1794969900000;
  let calls = 0;
  const transport = async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      'https://daybook-paulson-preview-o1c8.onrender.com/internal/jobs/tick',
    );
    assert.equal(options.method, 'POST');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-daybook-timestamp'], '1794969900000');
    assert.equal(
      options.headers['x-daybook-signature'],
      createHmac('sha256', env.DAYBOOK_SCHEDULER_SECRET)
        .update('1794969900000\nPOST\n/internal/jobs/tick')
        .digest('hex'),
    );
    return new Response('', { status: calls === 1 ? 200 : 503 });
  };
  await runScheduledTick(env, transport, timestamp);
  await assert.rejects(
    runScheduledTick(env, transport, timestamp),
    /unavailable/i,
  );
  assert.equal(calls, 2);
  for (const invalid of [
    { ...env, DAYBOOK_SCHEDULER_SECRET: '' },
    { ...env, DAYBOOK_ORIGIN: 'https://example.com' },
    { ...env, DAYBOOK_ORIGIN: env.DAYBOOK_ORIGIN + '/?secret=bad' },
  ])
    await assert.rejects(
      runScheduledTick(invalid, transport, timestamp),
      /configuration/i,
    );
  assert.equal(calls, 2);
});

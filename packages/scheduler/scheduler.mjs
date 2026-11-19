const ORIGIN = 'https://daybook-paulson-preview-o1c8.onrender.com';
/** One signed invocation, no database credentials, polling loop or automatic retry. */
export async function runScheduledTick(
  env,
  transport = fetch,
  now = Date.now(),
) {
  if (
    env.DAYBOOK_ORIGIN !== ORIGIN ||
    !/^[a-f0-9]{64}$/i.test(env.DAYBOOK_SCHEDULER_SECRET ?? '') ||
    !Number.isSafeInteger(now)
  )
    throw new Error('Scheduler configuration is incomplete.');
  const timestamp = String(now),
    encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.DAYBOOK_SCHEDULER_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(timestamp + '\nPOST\n/internal/jobs/tick'),
  );
  const hex = Array.from(new Uint8Array(signature), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  const response = await transport(ORIGIN + '/internal/jobs/tick', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(480000),
    headers: { 'x-daybook-timestamp': timestamp, 'x-daybook-signature': hex },
  });
  await response.body?.cancel();
  if (response.status !== 200)
    throw new Error(
      `Scheduled jobs are unavailable (HTTP ${response.status}); durable state remains for the next scheduled invocation.`,
    );
}
export default {
  scheduled(_event, env, context) {
    context.waitUntil(runScheduledTick(env));
  },
};

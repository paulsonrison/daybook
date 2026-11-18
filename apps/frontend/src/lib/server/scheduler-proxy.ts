import 'server-only';
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
/** Only the fixed zero-byte scheduler request crosses this public boundary. */
export async function schedulerProxy(request: Request) {
  const reply = (status: number) =>
    Response.json(
      { state: status === 200 ? 'COMPLETED' : 'UNAVAILABLE' },
      { status, headers },
    );
  if (request.method !== 'POST') return reply(405);
  const timestamp = request.headers.get('x-daybook-timestamp') ?? '',
    signature = request.headers.get('x-daybook-signature') ?? '';
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature))
    return reply(401);
  if (
    request.headers.get('content-length') &&
    request.headers.get('content-length') !== '0'
  )
    return reply(400);
  const reader = request.body?.getReader();
  if (reader) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((done) => {
      timer = setTimeout(() => done(false), 2000);
    });
    try {
      const empty = await Promise.race([
        timeout,
        (async () => {
          for (let i = 0; i < 8; i++) {
            const next = await reader.read();
            if (next.done) return true;
            if (next.value?.byteLength) return false;
          }
          return false;
        })(),
      ]);
      if (!empty) return reply(400);
    } finally {
      if (timer) clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  try {
    const response = await fetch(
      new URL(
        '/internal/jobs/tick',
        process.env.GRAPHQL_SERVER_URL || 'http://127.0.0.1:4000',
      ),
      {
        method: 'POST',
        headers: {
          'x-daybook-timestamp': timestamp,
          'x-daybook-signature': signature,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(400000)]),
      },
    );
    await response.body?.cancel();
    return reply(
      [200, 400, 401, 405, 429, 503].includes(response.status)
        ? response.status
        : 503,
    );
  } catch {
    return reply(503);
  }
}

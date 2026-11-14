import 'server-only';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function limitedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('TIMEOUT'));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    if (signal.aborted) throw new Error('TIMEOUT');
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('TOO_LARGE');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
    void reader.cancel().catch(() => undefined);
  }
}
export async function providerProxy(request: Request, parts: string[]) {
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
  const reply = (status: number, body = '') =>
    new Response(body, { status, headers });
  if (
    parts.length !== 2 ||
    !['whatsapp', 'sms'].includes(parts[0]) ||
    !uuid.test(parts[1]) ||
    !['GET', 'POST'].includes(request.method)
  )
    return reply(404);
  const path = `/webhooks/${parts[0]}/${parts[1]}`;
  const incoming = new URL(request.url);
  if (incoming.pathname !== path) return reply(404);
  try {
    const upstreamUrl = new URL(
      path + incoming.search,
      process.env.GRAPHQL_SERVER_URL || 'http://127.0.0.1:4000',
    );
    if (
      !['http:', 'https:'].includes(upstreamUrl.protocol) ||
      upstreamUrl.username ||
      upstreamUrl.password
    )
      return reply(503);
    const forwarded = new Headers();
    for (const name of [
      'content-type',
      'x-hub-signature-256',
      'x-twilio-signature',
      'x-twilio-webhooks-signature-settings',
    ]) {
      const value = request.headers.get(name);
      if (value !== null) forwarded.set(name, value);
    }
    let body: Uint8Array | undefined;
    try {
      if (request.method === 'POST')
        body = await limitedBody(
          request.body,
          65536,
          AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        );
    } catch (error) {
      return reply(
        error instanceof Error && error.message === 'TOO_LARGE' ? 413 : 408,
      );
    }
    const deadline = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(10000),
    ]);
    const result = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwarded,
      ...(body ? { body: new Uint8Array(body) } : {}),
      redirect: 'error',
      cache: 'no-store',
      signal: deadline,
    });
    if (result.status !== 200) {
      void result.body?.cancel().catch(() => undefined);
      return reply(
        [400, 403, 404, 405, 408, 413, 415, 429, 503].includes(result.status)
          ? result.status
          : 502,
      );
    }
    const bytes = await limitedBody(result.body, 4096, deadline);
    return reply(200, new TextDecoder().decode(bytes));
  } catch {
    return reply(503);
  }
}

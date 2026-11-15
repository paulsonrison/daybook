import { upstreamTimeout } from '../graphql/assistant-operation';
import 'server-only';

export async function backendProxy(
  request: Request,
  path: string,
): Promise<Response> {
  const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
  if (request.method !== 'GET' && request.headers.get('origin') !== origin)
    return Response.json(
      { error: 'Request origin is not allowed.' },
      { status: 403 },
    );
  try {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (request.headers.has('cookie'))
      headers.set('cookie', request.headers.get('cookie')!);
    if (request.headers.has('origin'))
      headers.set('origin', request.headers.get('origin')!);
    let body: string | undefined;
    const reader =
      request.method === 'GET' ? undefined : request.body?.getReader();
    if (reader) {
      const limit = path.startsWith('/auth/') ? 8192 : 65536;
      const chunks: Uint8Array[] = [];
      let size = 0,
        timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => {});
      }, 10000);
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (timedOut)
            return Response.json(
              { error: 'Request body timed out.' },
              { status: 408 },
            );
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            await reader.cancel().catch(() => {});
            return Response.json(
              { error: 'Request is too large.' },
              { status: 413 },
            );
          }
          chunks.push(value);
        }
        body = Buffer.concat(chunks).toString('utf8');
      } finally {
        clearTimeout(deadline);
        reader.releaseLock();
      }
    }
    const upstream = await fetch(
      new URL(path, process.env.GRAPHQL_SERVER_URL || 'http://127.0.0.1:4000'),
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(upstreamTimeout(path, body)),
        ]),
      },
    );
    const responseHeaders = new Headers({
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    const cookie = upstream.headers.get('set-cookie');
    if (cookie) responseHeaders.set('set-cookie', cookie);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: 'The service is unavailable. Your form has been preserved.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}

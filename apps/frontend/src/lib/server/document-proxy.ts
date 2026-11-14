import 'server-only';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const allowed = new RegExp(
  `^/documents/(?:owner/${uuid}|public/${uuid}/[a-f0-9]{64}(?:/qr\\.png)?)$`,
);
export async function documentProxy(request: Request, path: string) {
  const headers = new Headers({
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (!['GET', 'HEAD'].includes(request.method) || !allowed.test(path))
    return new Response('Not found', { status: 404, headers });
  try {
    const upstream = await fetch(
      new URL(path, process.env.GRAPHQL_SERVER_URL || 'http://127.0.0.1:4000'),
      {
        method: request.method,
        headers:
          path.startsWith('/documents/owner/') && request.headers.has('cookie')
            ? { cookie: request.headers.get('cookie')! }
            : {},
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      },
    );
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return new Response(
        request.method === 'HEAD'
          ? null
          : upstream.status === 401
            ? 'Sign in to download this document.'
            : 'Document unavailable.',
        {
          status: [401, 404, 503].includes(upstream.status)
            ? upstream.status
            : 502,
          headers,
        },
      );
    }
    const mime = path.endsWith('/qr.png') ? 'image/png' : 'application/pdf',
      length = upstream.headers.get('content-length');
    if (
      !upstream.headers.get('content-type')?.startsWith(mime) ||
      (length && (!/^\d+$/.test(length) || Number(length) > 10485760))
    ) {
      await upstream.body?.cancel();
      return new Response('Invalid document response', {
        status: 502,
        headers,
      });
    }
    headers.set('content-type', mime);
    if (length) headers.set('content-length', length);
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) headers.set('content-disposition', disposition);
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers,
    });
  } catch {
    return new Response('Document service unavailable.', {
      status: 503,
      headers,
    });
  }
}

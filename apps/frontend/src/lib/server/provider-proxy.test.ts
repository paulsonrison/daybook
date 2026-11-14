import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
test('public webhook forwarding preserves exact signed bytes and drops owner cookies', async () => {
  const path = './provider-proxy.js';
  const feature = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(feature?.providerProxy, 'Public provider forwarding must exist');
  const requests: {
    path: string;
    body: Buffer;
    cookie?: string;
    signature?: string;
  }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      path: request.url!,
      body: Buffer.concat(chunks),
      cookie: request.headers.cookie,
      signature: request.headers['x-hub-signature-256'] as string | undefined,
    });
    response.writeHead(200, {
      'content-type': 'text/plain',
      'set-cookie': 'unexpected=must-not-forward',
    });
    response.end('12345');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.GRAPHQL_SERVER_URL;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.GRAPHQL_SERVER_URL = `http://127.0.0.1:${address.port}/graphql`;
    const agency = '00000000-0000-4000-8000-000000000001';
    const body = '{\n"message":"നമസ്കാരം हिन्दी"\n}';
    const request = new Request(
      `https://daybook.example/webhooks/whatsapp/${agency}?challenge=12345`,
      {
        method: 'POST',
        headers: {
          cookie: 'daybook_session=synthetic',
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=synthetic',
        },
        body,
      },
    );
    const forwarded = await feature.providerProxy(request, [
      'whatsapp',
      agency,
    ]);
    assert.equal(forwarded.status, 200);
    assert.equal(await forwarded.text(), '12345');
    assert.equal(forwarded.headers.get('set-cookie'), null);
    assert.equal(forwarded.headers.get('cache-control'), 'no-store');
    assert.deepEqual(requests[0].body, Buffer.from(body));
    assert.equal(
      requests[0].path,
      `/webhooks/whatsapp/${agency}?challenge=12345`,
    );
    assert.equal(requests[0].cookie, undefined);
    assert.equal(requests[0].signature, 'sha256=synthetic');
    const invalid = await feature.providerProxy(
      new Request('https://daybook.example/webhooks/../../auth/register'),
      ['..', 'auth'],
    );
    assert.equal(invalid.status, 404);
    assert.equal(requests.length, 1);
    const tooLarge = await feature.providerProxy(
      new Request(`https://daybook.example/webhooks/whatsapp/${agency}`, {
        method: 'POST',
        body: 'x'.repeat(65537),
      }),
      ['whatsapp', agency],
    );
    assert.equal(tooLarge.status, 413);
    assert.equal(requests.length, 1);
  } finally {
    if (previous === undefined) delete process.env.GRAPHQL_SERVER_URL;
    else process.env.GRAPHQL_SERVER_URL = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

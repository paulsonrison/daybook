import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
test('scheduler forwarding preserves only signature headers, sends zero bytes and refuses extra body data', async () => {
  const { schedulerProxy } = await import('./scheduler-proxy.js');
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls++;
    let bytes = 0;
    for await (const chunk of request) bytes += chunk.length;
    assert.equal(request.url, '/internal/jobs/tick');
    assert.equal(bytes, 0);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers['x-daybook-signature'], 'a'.repeat(64));
    response.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'bad=1',
    });
    response.end('{"state":"SKIPPED"}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const previous = process.env.GRAPHQL_SERVER_URL;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.GRAPHQL_SERVER_URL = `http://127.0.0.1:${address.port}/graphql`;
    const input = (body?: string) =>
      new Request('https://daybook.example/internal/jobs/tick', {
        method: 'POST',
        headers: {
          cookie: 'private=1',
          'x-daybook-timestamp': '1794969900000',
          'x-daybook-signature': 'a'.repeat(64),
        },
        body,
      });
    const response = await schedulerProxy(input());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await schedulerProxy(input('{}'))).status, 400);
    assert.equal(
      (
        await schedulerProxy(
          new Request('https://daybook.example/internal/jobs/tick'),
        )
      ).status,
      405,
    );
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.GRAPHQL_SERVER_URL;
    else process.env.GRAPHQL_SERVER_URL = previous;
    await new Promise<void>((done) => server.close(() => done()));
  }
});

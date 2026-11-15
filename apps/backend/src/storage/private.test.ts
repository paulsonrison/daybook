import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
async function feature() {
  const mod = await import('./private.js').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw e;
  });
  assert.ok(mod?.PrivateObjectStore, 'Private storage adapter must exist');
  return mod;
}
const config = {
  endpoint: 'https://storage.example.test',
  region: 'ap-southeast-1',
  bucket: 'daybook-private',
  accessKeyId: 'synthetic',
  secretAccessKey: 'synthetic',
};
test('private storage derives tenant keys and streams only the declared bounded object', async () => {
  const { PrivateObjectStore } = await feature();
  const calls: any[] = [],
    client = new S3Client({ region: 'test' });
  client.send = (async (command: any) => {
    calls.push(command.input);
    if (command.input.Body) {
      let text = '';
      for await (const chunk of command.input.Body) text += chunk.toString();
      assert.equal(text, 'private');
      return {};
    }
    return { Body: Readable.from([Buffer.from('private')]), ContentLength: 7 };
  }) as typeof client.send;
  const store = new PrivateObjectStore(config, client),
    agencyId = randomUUID(),
    objectId = randomUUID();
  await store.put(
    { agencyId, objectId, kind: 'backup' },
    Readable.from([Buffer.from('private')]),
    7,
  );
  assert.equal(calls[0].Key, `agencies/${agencyId}/backups/${objectId}`);
  assert.equal(calls[0].CacheControl, 'no-store');
  const chunks = [];
  for await (const chunk of store.get(
    { agencyId, objectId, kind: 'backup' },
    7,
  ))
    chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'private');
  assert.equal(calls[1].Key, calls[0].Key);
  await store.put(
    { agencyId: randomUUID(), objectId, kind: 'source' },
    Readable.from([Buffer.from('private')]),
    7,
  );
  assert.notEqual(calls[2].Key, calls[0].Key);
  assert.ok(calls[2].Key.includes('/sources/'));
});
test('private storage refuses traversal, invalid kinds, missing configuration and unsafe endpoints before requests', async () => {
  const { PrivateObjectStore } = await feature();
  for (const override of [
    { secretAccessKey: '' },
    { bucket: '../other' },
    { endpoint: 'http://storage.example.test' },
    { endpoint: 'https://secret@storage.example.test' },
    { endpoint: 'https://storage.example.test/?secret=x' },
  ])
    assert.throws(() => new PrivateObjectStore({ ...config, ...override }));
  const client = new S3Client({ region: 'test' });
  let calls = 0;
  client.send = (async () => {
    calls++;
    return {};
  }) as typeof client.send;
  const store = new PrivateObjectStore(config, client);
  for (const scope of [
    { agencyId: '../other', objectId: randomUUID(), kind: 'backup' },
    { agencyId: randomUUID(), objectId: '../private', kind: 'source' },
    { agencyId: randomUUID(), objectId: randomUUID(), kind: '../other' },
  ])
    await assert.rejects(
      store.put(scope as any, Readable.from([Buffer.from('x')]), 1),
    );
  assert.equal(calls, 0);
});
test('storage catches actual upload size mismatch and remote downloads exceeding declared or configured bounds', async () => {
  const { PrivateObjectStore } = await feature();
  const client = new S3Client({ region: 'test' }),
    scope = {
      agencyId: randomUUID(),
      objectId: randomUUID(),
      kind: 'backup' as const,
    };
  client.send = (async (command: any) => {
    if (command.input.Body) {
      for await (const _ of command.input.Body) {
      }
      return {};
    }
    return { Body: Readable.from([Buffer.alloc(8)]), ContentLength: 8 };
  }) as typeof client.send;
  const store = new PrivateObjectStore(config, client);
  await assert.rejects(
    store.put(scope, Readable.from([Buffer.alloc(8)]), 7),
    /storage|size|limit/i,
  );
  await assert.rejects(
    store.put(scope, Readable.from([Buffer.alloc(6)]), 7),
    /storage|size|limit/i,
  );
  await assert.rejects(async () => {
    for await (const _ of store.get(scope, 7)) {
    }
  }, /storage|size|limit/i);
  client.send = (async () => ({
    Body: Readable.from([Buffer.alloc(8)]),
    ContentLength: 7,
  })) as typeof client.send;
  await assert.rejects(async () => {
    for await (const _ of store.get(scope, 7)) {
    }
  }, /storage|size|limit/i);
});
test('early storage acknowledgement cannot hide a later source failure or extra bytes', async () => {
  const { PrivateObjectStore } = await feature();
  const client = new S3Client({ region: 'test' });
  client.send = (async (command: any) => {
    const iterator = command.input.Body[Symbol.asyncIterator]();
    await iterator.next();
    return {};
  }) as typeof client.send;
  const store = new PrivateObjectStore(config, client),
    scope = {
      agencyId: randomUUID(),
      objectId: randomUUID(),
      kind: 'backup' as const,
    };
  for (const fail of [true, false]) {
    async function* lateSource() {
      yield Buffer.alloc(7);
      await new Promise((done) => setTimeout(done, 20));
      if (fail) throw new Error('late read failure');
      yield Buffer.alloc(1);
    }
    await assert.rejects(store.put(scope, lateSource(), 7));
  }
});

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
test('download deadline also aborts the response body after headers arrive', async () => {
  const { PrivateObjectStore } = await feature();
  const client = new S3Client({ region: 'test' }),
    scope = {
      agencyId: randomUUID(),
      objectId: randomUUID(),
      kind: 'backup' as const,
    };
  const body = new Readable({ read() {} });
  client.send = (async (_command: any, options: any) => {
    setTimeout(() => options.abortSignal.dispatchEvent(new Event('abort')), 10);
    return { Body: body, ContentLength: 1 };
  }) as typeof client.send;
  const store = new PrivateObjectStore(config, client);
  try {
    const result = await Promise.race([
      (async () => {
        for await (const _ of store.get(scope, 1)) {
        }
        return 'completed';
      })().catch(() => 'aborted'),
      new Promise<string>((done) =>
        setTimeout(() => done('still waiting'), 100),
      ),
    ]);
    assert.equal(
      result,
      'aborted',
      'A timeout after response headers must stop body consumption',
    );
  } finally {
    body.destroy();
    store.close();
  }
});
test('retention purges exact Backblaze versions and delete markers, then verifies absence', async () => {
  const { PrivateObjectStore } = await feature();
  const client = new S3Client({ region: 'test' }),
    agencyId = randomUUID(),
    objectId = randomUUID(),
    key = `agencies/${agencyId}/backups/${objectId}`;
  const removed: string[] = [];
  let listing = 0;
  client.send = (async (command: any) => {
    if (command.constructor.name === 'ListObjectVersionsCommand') {
      listing++;
      return listing === 1
        ? {
            Versions: [
              { Key: key, VersionId: 'v1' },
              { Key: key + '-foreign', VersionId: 'foreign' },
            ],
            DeleteMarkers: [{ Key: key, VersionId: 'marker' }],
            IsTruncated: false,
          }
        : { Versions: [], DeleteMarkers: [], IsTruncated: false };
    }
    if (command.constructor.name === 'DeleteObjectCommand') {
      assert.equal(command.input.Key, key);
      removed.push(command.input.VersionId);
      return {};
    }
    if (command.constructor.name === 'HeadObjectCommand')
      throw Object.assign(new Error('missing'), {
        $metadata: { httpStatusCode: 404 },
      });
    throw new Error('Unexpected operation');
  }) as typeof client.send;
  const store = new PrivateObjectStore(
    { ...config, endpoint: 'https://s3.us-east-005.backblazeb2.com' },
    client,
  );
  await store.purge({ agencyId, objectId, kind: 'backup' });
  assert.deepEqual(removed, ['v1', 'marker']);
  assert.equal(listing, 2);
});
test('retention never reports deletion after access denial, malformed pagination or a surviving version', async () => {
  const { PrivateObjectStore } = await feature();
  const scope = {
    agencyId: randomUUID(),
    objectId: randomUUID(),
    kind: 'backup' as const,
  };
  const client = new S3Client({ region: 'test' });
  for (const response of [
    { IsTruncated: true },
    {
      Versions: [
        {
          Key: `agencies/${scope.agencyId}/backups/${scope.objectId}`,
          VersionId: 'v1',
        },
      ],
      IsTruncated: false,
    },
  ]) {
    client.send = (async (command: any) => {
      if (command.constructor.name === 'ListObjectVersionsCommand')
        return response;
      if (command.constructor.name === 'DeleteObjectCommand') return {};
      throw Object.assign(new Error('denied'), {
        $metadata: { httpStatusCode: 403 },
      });
    }) as typeof client.send;
    await assert.rejects(
      new PrivateObjectStore(
        { ...config, endpoint: 'https://s3.us-east-005.backblazeb2.com' },
        client,
      ).purge(scope),
    );
  }
  client.send = (async () => {
    throw Object.assign(new Error('denied'), {
      $metadata: { httpStatusCode: 403 },
    });
  }) as typeof client.send;
  await assert.rejects(
    new PrivateObjectStore(
      { ...config, endpoint: 'https://br-test.storage.c-2.aws.neon.tech' },
      client,
    ).purge(scope),
  );
});

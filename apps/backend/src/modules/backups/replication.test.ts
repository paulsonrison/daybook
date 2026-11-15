import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
async function feature() {
  const mod = await import('./replication.js').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw e;
    },
  );
  assert.ok(mod?.replicateBackup, 'Verified backup replication must exist');
  return mod;
}
function fixture() {
  const bytes = Buffer.from(
    'Synthetic native ledger മലയാളം हिन्दी 9007199254740993.93',
  );
  return {
    identity: { agencyId: randomUUID(), backupId: randomUUID() },
    key: randomBytes(32),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: () => Readable.from([bytes]),
  };
}
function destination(name: 'neon' | 'b2', fail = false) {
  const saved = new Map<string, Buffer>();
  return {
    name,
    budget: { used: 0, otherReserved: 0, limit: 1000000 },
    store: {
      async put(
        scope: { objectId: string },
        source: AsyncIterable<Uint8Array>,
      ) {
        if (fail) throw new Error('private provider error');
        const chunks = [];
        for await (const c of source) chunks.push(Buffer.from(c));
        saved.set(scope.objectId, Buffer.concat(chunks));
      },
      async *get(scope: { objectId: string }) {
        yield saved.get(scope.objectId)!;
      },
    },
  };
}
test('two-destination backup is protected only after independent authenticated downloads match the snapshot', async () => {
  const { replicateBackup } = await feature();
  const result = await replicateBackup(fixture(), [
    destination('neon'),
    destination('b2'),
  ]);
  assert.equal(result.protected, true);
  assert.equal(
    result.destinations.filter((d) => d.state === 'VERIFIED').length,
    2,
  );
});
test('missing, failed, corrupt and quota-limited replicas never produce full protection or prevent a healthy first copy', async () => {
  const { replicateBackup } = await feature();
  for (const second of [
    undefined,
    destination('b2', true),
    {
      ...destination('b2'),
      budget: { used: 999999, otherReserved: 0, limit: 1000000 },
    },
  ]) {
    const result = await replicateBackup(fixture(), [
      destination('neon'),
      ...(second ? [second] : []),
    ]);
    assert.equal(result.protected, false);
    assert.equal(result.destinations[0].state, 'VERIFIED');
    assert.notEqual(result.destinations[1].state, 'VERIFIED');
    assert.equal(
      JSON.stringify(result).includes('private provider error'),
      false,
    );
  }
  const corrupt = destination('b2');
  corrupt.store.get = async function* () {
    yield Buffer.from('corrupt');
  };
  const result = await replicateBackup(fixture(), [
    destination('neon'),
    corrupt,
  ]);
  assert.equal(result.protected, false);
  assert.equal(result.destinations[1].state, 'FAILED');
});
test('wrong source checksum, absent key and duplicate destination configuration cannot verify copies', async () => {
  const { replicateBackup } = await feature();
  const source = fixture();
  const result = await replicateBackup({ ...source, sha256: '0'.repeat(64) }, [
    destination('neon'),
    destination('b2'),
  ]);
  assert.equal(result.protected, false);
  assert.ok(result.destinations.every((d) => d.state === 'FAILED'));
  await assert.rejects(
    replicateBackup({ ...source, key: Buffer.alloc(0) }, [destination('neon')]),
  );
  await assert.rejects(
    replicateBackup(source, [destination('neon'), destination('neon')]),
  );
});

test('a held exact-fit reservation is not counted twice with other reservations', async () => {
  const { replicateBackup } = await feature();
  const snapshot = fixture();
  const neon = destination('neon');
  neon.budget = { used: 0, otherReserved: 10, limit: snapshot.bytes + 36 + 10 };
  const result = await replicateBackup(snapshot, [neon]);
  assert.equal(result.destinations[0].state, 'VERIFIED');
});

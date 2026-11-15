import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
async function feature() {
  const mod = await import('./encryption.js').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw e;
    },
  );
  assert.ok(mod?.encryptBackup, 'Authenticated backup encryption must exist');
  return mod;
}
const identity = () => ({ agencyId: randomUUID(), backupId: randomUUID() });
async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function* parts(bytes: Uint8Array, size = 7) {
  for (let i = 0; i < bytes.length; i += size)
    yield bytes.subarray(i, i + size);
}
test('streamed encrypted backups preserve native text, exact money and binary without plaintext exposure', async () => {
  const { encryptBackup, decryptBackup } = await feature();
  const key = randomBytes(32),
    scope = identity();
  const input = Buffer.concat([
    Buffer.from('അനിത हिन्दी 9007199254740993.93\n'),
    randomBytes(8000),
  ]);
  const first = await collect(encryptBackup(parts(input), key, scope));
  const second = await collect(encryptBackup(parts(input), key, scope));
  assert.notDeepEqual(first, second, 'Each backup needs a fresh random nonce');
  assert.equal(first.includes(Buffer.from('9007199254740993.93')), false);
  assert.deepEqual(await decryptBackup(parts(first), key, scope), input);
});
test('backup authentication rejects changed bytes, truncation, appended data, wrong tenant, ID and key', async () => {
  const { encryptBackup, decryptBackup } = await feature();
  const key = randomBytes(32),
    scope = identity();
  const sealed = await collect(
    encryptBackup(parts(Buffer.from('private snapshot')), key, scope),
  );
  for (const offset of [0, 8, 20, sealed.length - 17, sealed.length - 1]) {
    const tampered = Buffer.from(sealed);
    tampered[offset] ^= 1;
    await assert.rejects(decryptBackup(parts(tampered), key, scope));
  }
  for (const bytes of [
    sealed.subarray(0, sealed.length - 1),
    sealed.subarray(0, 20),
    Buffer.concat([sealed, Buffer.from('x')]),
  ])
    await assert.rejects(decryptBackup(parts(bytes), key, scope));
  await assert.rejects(decryptBackup(parts(sealed), randomBytes(32), scope));
  await assert.rejects(
    decryptBackup(parts(sealed), key, { ...scope, agencyId: randomUUID() }),
  );
  await assert.rejects(
    decryptBackup(parts(sealed), key, { ...scope, backupId: randomUUID() }),
  );
});
test('backup limits stop actual streamed bytes and reject missing keys or malformed scope', async () => {
  const { encryptBackup, decryptBackup } = await feature();
  const key = randomBytes(32),
    scope = identity();
  await assert.rejects(
    collect(encryptBackup(parts(Buffer.alloc(65)), key, scope, 64)),
    /limit/i,
  );
  const sealed = await collect(
    encryptBackup(parts(Buffer.alloc(65)), key, scope),
  );
  await assert.rejects(decryptBackup(parts(sealed), key, scope, 64), /limit/i);
  for (const badKey of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33)])
    await assert.rejects(
      collect(encryptBackup(parts(Buffer.from('x')), badKey, scope)),
      /key/i,
    );
  await assert.rejects(
    collect(
      encryptBackup(parts(Buffer.from('x')), key, {
        ...scope,
        agencyId: '../other',
      }),
    ),
    /identity/i,
  );
  for (const limit of [0, -1, Infinity, 1.5])
    await assert.rejects(
      collect(encryptBackup(parts(Buffer.from('x')), key, scope, limit)),
      /limit/i,
    );
});
test('upstream read failures cannot produce an authenticated completed backup', async () => {
  const { encryptBackup, decryptBackup } = await feature();
  const key = randomBytes(32),
    scope = identity(),
    captured: Buffer[] = [];
  async function* broken() {
    yield Buffer.from('partial');
    throw new Error('source unavailable');
  }
  await assert.rejects(async () => {
    for await (const chunk of encryptBackup(broken(), key, scope))
      captured.push(Buffer.from(chunk));
  }, /source unavailable/);
  await assert.rejects(
    decryptBackup(parts(Buffer.concat(captured)), key, scope),
  );
});

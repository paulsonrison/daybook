import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
async function feature() {
  const module = await import('./office-zip.js').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw e;
    },
  );
  assert.ok(module?.readBoundedOfficeZip);
  return module;
}
test('bounded Office ZIP reading preserves original native XML and checks source integrity', async () => {
  const { readBoundedOfficeZip } = await feature();
  const xml = '<root>അനിത हिन्दी 9007199254740993.93</root>';
  const zip = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(xml),
  });
  assert.equal(
    readBoundedOfficeZip(zip).get('word/document.xml')?.toString('utf8'),
    xml,
  );
  const truncated = zip.subarray(0, zip.length - 8);
  assert.throws(() => readBoundedOfficeZip(truncated));
  const damaged = zip.slice();
  const central = Buffer.from(damaged).indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  damaged[central + 16] ^= 1;
  assert.throws(() => readBoundedOfficeZip(damaged));
});
test('Office archives cannot escape paths, hide a decompression bomb, or exceed entry limits', async () => {
  const { readBoundedOfficeZip } = await feature();
  for (const name of [
    '../escape.xml',
    '/root.xml',
    'word/../../escape.xml',
    'C:secret.xml',
  ])
    assert.throws(() =>
      readBoundedOfficeZip(zipSync({ [name]: strToU8('text') })),
    );
  const bomb = zipSync({ 'word/document.xml': new Uint8Array(8388609) });
  assert.throws(() => readBoundedOfficeZip(bomb));
  const forged = bomb.slice(),
    view = Buffer.from(forged.buffer, forged.byteOffset, forged.byteLength);
  view.writeUInt32LE(0, 22);
  const directory = view.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  view.writeUInt32LE(0, directory + 24);
  assert.throws(
    () => readBoundedOfficeZip(forged),
    'Actual expansion must be checked even when both declared sizes lie',
  );

  const files = Object.fromEntries(
    Array.from({ length: 513 }, (_, i) => ['entry' + i, strToU8('x')]),
  );
  assert.throws(() => readBoundedOfficeZip(zipSync(files)));
});

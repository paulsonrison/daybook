import assert from 'node:assert/strict';
import { test } from 'node:test';
async function feature() {
  const module = await import('./csv.js').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw e;
  });
  assert.ok(module?.decodeCsv, 'Native bounded CSV decoding must exist');
  return module;
}
test('CSV preserves native text, quoted fields, leading zeros and exact amounts with cell evidence', async () => {
  const { decodeCsv } = await feature();
  const result = decodeCsv(
    Buffer.from(
      '\ufeffName,Phone,Amount\r\n"Original, Name",0012345678,9007199254740993.93\r\nഅനിത,9876543210,12.05',
    ),
  );
  assert.deepEqual(result.columns, ['Name', 'Phone', 'Amount']);
  assert.deepEqual(result.rows[0], [
    'Original, Name',
    '0012345678',
    '9007199254740993.93',
  ]);
  assert.equal(result.rows[1][0], 'അനിത');
  assert.deepEqual(result.evidence[0], {
    reference: 'CSV!A2',
    text: 'Original, Name',
  });
});
test('CSV refuses malformed or oversized records without silently dropping rows', async () => {
  const { decodeCsv } = await feature();
  for (const value of [
    'a,b\n1,2,3',
    'a,b\n"unclosed,2',
    'a,b\n' + 'x'.repeat(32769) + ',2',
    'a\n' + 'value\n'.repeat(2001),
  ])
    assert.throws(() => decodeCsv(Buffer.from(value)));
  assert.throws(() => decodeCsv(new Uint8Array([0xff, 0xfe, 0x61])));
  assert.throws(() => decodeCsv(Buffer.alloc(1048577)));
});

test('wide CSV evidence retains column coordinates and never evaluates formula-like text', async () => {
  const { decodeCsv } = await feature();
  const columns = Array.from({ length: 30 }, (_, i) => 'Field ' + i),
    values = Array.from({ length: 30 }, () => '=1+1');
  const result = decodeCsv(
    Buffer.from(columns.join(',') + '\n' + values.join(',')),
  );
  assert.equal(result.evidence[26].reference, 'CSV!AA2');
  assert.equal(result.evidence[29].reference, 'CSV!AD2');
  assert.equal(result.evidence[29].text, '=1+1');
});

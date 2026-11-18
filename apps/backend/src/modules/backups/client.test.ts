import assert from 'node:assert/strict';
import test from 'node:test';
test('client capability probe rejects unavailable commands and non-PostgreSQL version output', async () => {
  const { backupClientMajor } = await import('./client.js');
  assert.equal(await backupClientMajor('__daybook_missing_pg_dump__'), null);
  assert.equal(await backupClientMajor(process.execPath), null);
});

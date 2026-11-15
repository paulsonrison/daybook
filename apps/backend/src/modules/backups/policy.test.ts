import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
async function feature() {
  const mod = await import('./policy.js').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw e;
  });
  assert.ok(mod?.backupRetention, 'Safe backup retention policy must exist');
  return mod;
}
test('retention keeps daily, weekly and monthly recovery points and never deletes unverified or foreign objects', async () => {
  const { backupRetention } = await feature();
  const agencyId = randomUUID(),
    now = new Date('2026-11-15T02:00:00Z');
  const records = Array.from({ length: 120 }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      agencyId,
      key: `agencies/${agencyId}/backups/${id}`,
      createdAt: new Date(now.valueOf() - i * 86400000).toISOString(),
      verified: true,
      bytes: 1024,
    };
  });
  const unverified = { ...records[119], id: randomUUID(), verified: false };
  unverified.key = `agencies/${agencyId}/backups/${unverified.id}`;
  const foreign = { ...records[118], agencyId: randomUUID() };
  const otherPrefix = { ...records[117], key: 'unrelated/object' };
  const plan = backupRetention(
    [...records, unverified, foreign, otherPrefix],
    agencyId,
    now,
  );
  for (const record of records.slice(0, 7))
    assert.ok(!plan.deleteIds.includes(record.id));
  assert.ok(
    !plan.deleteIds.includes(records[14].id),
    'Keep weekly recovery point',
  );
  assert.ok(
    !plan.deleteIds.includes(records[46].id),
    'Keep October recovery point',
  );
  assert.ok(
    plan.deleteIds.length > 70,
    'Expire redundant old verified snapshots',
  );
  assert.ok(!plan.deleteIds.includes(unverified.id));
  assert.ok(!plan.deleteIds.includes(foreign.id));
  assert.ok(!plan.deleteIds.includes(otherPrefix.id));
  assert.deepEqual(plan.deleteIds, [...new Set(plan.deleteIds)]);
});
test('quota uses integer-safe actual and reserved usage; failed or missing replica stays unhealthy', async () => {
  const { canReserveBackup, backupHealth } = await feature();
  assert.equal(
    canReserveBackup({ used: 40, reserved: 10, requested: 50, limit: 100 }),
    true,
  );
  assert.equal(
    canReserveBackup({ used: 40, reserved: 10, requested: 51, limit: 100 }),
    false,
  );
  for (const used of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      canReserveBackup({ used, reserved: 1, requested: 1, limit: 100 }),
    );
  const now = new Date('2026-11-15T02:00:00Z');
  const first = {
    name: 'neon',
    configured: true,
    verifiedAt: '2026-11-15T01:00:00Z',
    lastAttemptAt: '2026-11-15T01:00:00Z',
    error: null,
  };
  assert.equal(backupHealth([first], now).protected, false);
  assert.equal(
    backupHealth([first, { ...first, name: 'b2', configured: false }], now)
      .protected,
    false,
  );
  assert.equal(
    backupHealth([first, { ...first, name: 'b2', error: 'upload_failed' }], now)
      .protected,
    false,
  );
  assert.equal(
    backupHealth([first, { ...first, name: 'b2' }], now).protected,
    true,
  );
  assert.equal(
    backupHealth([first, { ...first, name: 'neon' }], now).protected,
    false,
  );
  assert.equal(
    backupHealth(
      [first, { ...first, name: 'b2', verifiedAt: '2026-11-12T01:00:00Z' }],
      now,
    ).protected,
    false,
  );
});
test('retention never deletes a recovery object represented by UUID case aliases', async () => {
  const { backupRetention } = await feature();
  const agencyId = randomUUID(),
    id = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
  const key = `agencies/${agencyId}/backups/${id}`;
  const result = backupRetention(
    [
      {
        id,
        agencyId,
        key,
        createdAt: '2026-11-15T01:00:00Z',
        verified: true,
        bytes: 100,
      },
      {
        id: id.toUpperCase(),
        agencyId,
        key,
        createdAt: '2026-07-15T01:00:00Z',
        verified: true,
        bytes: 100,
      },
    ],
    agencyId,
    new Date('2026-11-15T02:00:00Z'),
  );
  assert.deepEqual(result.deleteIds, []);
});

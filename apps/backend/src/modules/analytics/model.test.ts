import assert from 'node:assert/strict';
import { test } from 'node:test';

test('receipt comparison uses exact basis points, permits arrears recovery over 100 percent and has no zero-denominator rate', async () => {
  const feature = await import('./model.js');
  assert.ok(
    feature.ratioBasisPoints,
    'An exact and explicitly defined receipt comparison must exist',
  );
  assert.equal(feature.ratioBasisPoints(5n, 7n), '7143');
  assert.equal(feature.ratioBasisPoints(1000n, 100n), '100000');
  assert.equal(
    feature.ratioBasisPoints(9007199254740993n, 3n),
    '30023997515803310000',
  );
  assert.equal(feature.ratioBasisPoints(0n, 100n), '0');
  assert.equal(feature.ratioBasisPoints(100n, 0n), null);
  assert.equal(feature.ratioBasisPoints(100n, -1n), null);
});

test('report month boundaries handle leap years, year changes and invalid or future selections', async () => {
  const feature = await import('./model.js').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    },
  );
  assert.ok(
    feature?.reportMonth,
    'Strict date-only report month boundaries must exist',
  );
  assert.deepEqual(feature.reportMonth('2024-02', '2024-02-20'), {
    month: '2024-02',
    startDate: '2024-02-01',
    endDate: '2024-02-29',
    nextDate: '2024-03-01',
  });
  assert.deepEqual(feature.reportMonth('2024-12', '2025-01-02'), {
    month: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    nextDate: '2025-01-01',
  });
  for (const value of [
    '2024-13',
    '2024-00',
    '2024-2',
    '2024-02-01',
    '2024-02;SELECT',
    null,
  ])
    assert.throws(
      () => feature.reportMonth(value, '2024-02-20'),
      /valid report month/,
    );
  assert.throws(
    () => feature.reportMonth('2024-03', '2024-02-20'),
    /future months/,
  );
});

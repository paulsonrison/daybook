import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePeriods,
  monthPeriod,
  weeklyPeriod,
  correctedLine,
} from './periods.js';
test('billing periods merge overlaps without counting any date twice', () => {
  assert.deepEqual(
    normalizePeriods(
      [
        { from: '2024-02-01', to: '2024-02-20' },
        { from: '2024-02-15', to: '2024-02-29' },
        { from: '2024-01-01', to: '2024-01-31' },
      ],
      '2024-03-01',
    ),
    [{ from: '2024-01-01', to: '2024-02-29' }],
  );
  assert.deepEqual(monthPeriod('2024-02', '2024-03-01'), {
    from: '2024-02-01',
    to: '2024-02-29',
  });
  assert.deepEqual(monthPeriod('2024-03', '2024-03-15'), {
    from: '2024-03-01',
    to: '2024-03-15',
  });
  assert.deepEqual(weeklyPeriod('2024-02-26', '2024-03-05'), {
    from: '2024-02-26',
    to: '2024-03-03',
  });
  for (const periods of [
    [],
    [{ from: '2024-02-30', to: '2024-03-01' }],
    [{ from: '2024-02-02', to: '2024-02-01' }],
    [{ from: '2024-03-01', to: '2024-03-02' }],
  ])
    assert.throws(() => normalizePeriods(periods, '2024-03-01'));
  assert.throws(() => monthPeriod('2024-04', '2024-03-15'));
});
test('bill corrections preserve source amounts and require an audit reason for changed quantity or rate', () => {
  assert.deepEqual(correctedLine(9, 800n, {}), {
    quantity: 9,
    ratePaise: 800n,
    amountPaise: 7200n,
    reason: null,
  });
  assert.deepEqual(
    correctedLine(9, 800n, {
      quantity: 8,
      rate: '11.00',
      reason: 'Resident agreement and recorded skipped copy',
    }),
    {
      quantity: 8,
      ratePaise: 1100n,
      amountPaise: 8800n,
      reason: 'Resident agreement and recorded skipped copy',
    },
  );
  assert.throws(() => correctedLine(9, 800n, { quantity: 8 }));
  assert.throws(() =>
    correctedLine(9, 800n, { rate: '8.001', reason: 'Invalid' }),
  );
  assert.throws(() =>
    correctedLine(9, 800n, { quantity: -1, reason: 'Invalid' }),
  );
});

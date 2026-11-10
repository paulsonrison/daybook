import { test } from 'node:test';
import assert from 'node:assert/strict';
import { procurementCost } from './cost.js';
test('net procurement cost applies a supplied trade margin exactly once with paisa rounding', () => {
  assert.deepEqual(procurementCost({ netCost: '5.05' }), {
    netPaise: 505n,
    listPaise: null,
    marginBps: null,
  });
  assert.deepEqual(
    procurementCost({ listPrice: '8.15', marginPercent: '20.00' }),
    { netPaise: 652n, listPaise: 815n, marginBps: 2000 },
  );
  assert.equal(
    procurementCost({ listPrice: '10.01', marginPercent: '12.50' }).netPaise,
    876n,
  );
  assert.equal(procurementCost({}, '5.05').netPaise, 505n);
  assert.throws(() =>
    procurementCost({ netCost: '5', listPrice: '8', marginPercent: '20' }),
  );
  assert.throws(() => procurementCost({ marginPercent: '20' }, '5'));
  assert.throws(() =>
    procurementCost({ listPrice: '8', marginPercent: '100.01' }),
  );
  assert.throws(() => procurementCost({}));
});

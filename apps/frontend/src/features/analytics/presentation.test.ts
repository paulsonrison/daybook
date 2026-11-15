import assert from 'node:assert/strict';
import test from 'node:test';
test('analytics chart normalization keeps monetary and copy labels exact beyond floating point precision', async () => {
  const feature = await import('./presentation.js').catch(() => null);
  assert.ok(feature?.chartPoints);
  const money = feature.chartPoints(
    [
      { label: 'Large', amount: '90071992547409.93' },
      { label: 'Missing', amount: null },
      { label: 'Zero', amount: '0.00' },
    ],
    'money',
    'en-IN',
  );
  assert.equal(money[0].value, 10000);
  assert.match(money[0].displayValue!, /9,00,71,99,25,47,409.93/);
  assert.equal(money[1].value, null);
  assert.equal(money[2].value, 0);
  const copies = feature.chartPoints(
    [{ label: 'Original publication', amount: '9007199254740993' }],
    'count',
    'en-IN',
  );
  assert.equal(copies[0].displayValue, '9,00,71,99,25,47,40,993');
  assert.equal(feature.basisPointsPercent('7143', 'en-IN'), '71.43%');
  assert.equal(feature.basisPointsPercent(null, 'en-IN'), null);
});

test('tiny nonzero amounts retain their sign and visible scale beside very large values', async () => {
  const { chartPoints } = await import('./presentation.js');
  const points = chartPoints(
    [
      { label: 'Large', amount: '1000000.00' },
      { label: 'Loss', amount: '-0.01' },
      { label: 'Small', amount: '0.01' },
    ],
    'money',
    'en-IN',
  );
  assert.equal(points[1].value, -1);
  assert.equal(points[2].value, 1);
  const counts = chartPoints(
    [
      { label: 'Large', amount: '1000000' },
      { label: 'One', amount: '1' },
    ],
    'count',
    'en-IN',
  );
  assert.equal(counts[1].value, 1);
});

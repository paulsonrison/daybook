import assert from 'node:assert/strict';
import { test } from 'node:test';
test('advertiser attribution derives exact uniform unit value from issued subtotal and immutable packed quantities', async () => {
  const feature = await import('./advertiser.js').catch(() => null);
  assert.ok(
    feature?.allocateAdvertiserSubtotal,
    'Issued packed-route attribution must exist',
  );
  const packed = [
    { kind: 'INSERT', routeId: 'A', routeName: 'Original A', quantity: 2 },
    { kind: 'INSERT', routeId: 'B', routeName: 'Original B', quantity: 1 },
  ];
  assert.deepEqual(
    feature.allocateAdvertiserSubtotal('9007199254740993', packed),
    new Map([
      ['A', { amount: 6004799503160662n, names: ['Original A'] }],
      ['B', { amount: 3002399751580331n, names: ['Original B'] }],
    ]),
  );
  assert.equal(
    feature.allocateAdvertiserSubtotal('100', packed),
    null,
    'Never round an unsupported historical unit price',
  );
  assert.equal(feature.allocateAdvertiserSubtotal('0', []), null);
  assert.equal(
    feature.allocateAdvertiserSubtotal('100', [
      { kind: 'INSERT', routeId: 'A', quantity: -1 },
    ]),
    null,
  );
  assert.equal(feature.allocateAdvertiserSubtotal('100', {}), null);
});

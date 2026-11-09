import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, moneyString } from './money.js';
test('money keeps exact paise beyond floating-point integer precision', () => {
  assert.equal(parseMoney('0.01'), 1n);
  assert.equal(parseMoney('90071992547409.93'), 9007199254740993n);
  assert.equal(moneyString(9007199254740993n), '90071992547409.93');
  assert.equal(moneyString(-105n), '-1.05');
});
test('money rejects fractions of a paisa, negatives and database overflow', () => {
  for (const value of ['1.005', '-1', 'NaN', '1e3', '', '92233720368547758.08'])
    assert.throws(() => parseMoney(value));
  assert.equal(parseMoney('0'), 0n);
  assert.equal(parseMoney('92233720368547758.07'), 9223372036854775807n);
});

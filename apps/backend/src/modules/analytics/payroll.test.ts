import assert from 'node:assert/strict';
import { test } from 'node:test';
const snapshot = () => ({
  rules: [
    {
      start: '2026-10-01',
      end: null,
      employmentStart: '2026-10-01',
      employmentEnd: null,
      copy: '25',
      route: '100',
    },
  ],
  attendance: [{ date: '2026-10-02', status: 'PRESENT' }],
  deliveries: [
    { id: 'one', date: '2026-10-02', quantity: 2, route: 'A' },
    { id: 'two', date: '2026-10-02', quantity: 1, route: 'A' },
    { id: 'three', date: '2026-10-02', quantity: 1, route: 'B' },
  ],
  claimedDeliveries: ['one', 'two', 'three'],
  salary: '100.00',
  commission: '1.00',
  routeAllowance: '2.00',
  adjustment: '-1.00',
  reimbursement: '5.00',
  advance: '10.00',
  net: '97.00',
});
test('posted payroll attribution uses immutable delivery/rule evidence, deduplicates route days and keeps shared pay separate from advances', async () => {
  const feature = await import('./payroll.js').catch(() => null);
  assert.ok(
    feature?.allocatePostedPayroll,
    'An exact posted-payroll allocation must exist',
  );
  const result = feature.allocatePostedPayroll(snapshot());
  assert.ok(result);
  assert.deepEqual(
    [...result.routes],
    [
      ['A', 175n],
      ['B', 125n],
    ],
  );
  assert.equal(result.unallocated, 10400n);
  assert.equal(result.expense, 10700n);
  const large = snapshot();
  large.salary = '9007199254740993.00';
  large.net = '9007199254740990.00';
  assert.equal(
    feature.allocatePostedPayroll(large)?.expense,
    900719925474100000n,
  );
});
test('incomplete or inconsistent posted payroll never becomes a zero route expense', async () => {
  const feature = await import('./payroll.js').catch(() => null);
  assert.ok(feature?.allocatePostedPayroll);
  assert.equal(feature.allocatePostedPayroll({}), null);
  const inconsistent = snapshot();
  inconsistent.commission = '9.00';
  assert.equal(feature.allocatePostedPayroll(inconsistent), null);
  const duplicated = snapshot();
  duplicated.deliveries.push({ ...duplicated.deliveries[0] });
  assert.equal(feature.allocatePostedPayroll(duplicated), null);
  const gaps = snapshot();
  gaps.rules = [];
  assert.equal(feature.allocatePostedPayroll(gaps), null);
});

test('impossible dates, unknown attendance and reversed rule boundaries make posted allocation unavailable', async () => {
  const feature = await import('./payroll.js');
  const impossible = snapshot();
  impossible.rules[0].start = '2026-10-00';
  assert.equal(feature.allocatePostedPayroll(impossible), null);
  const attendance = snapshot();
  attendance.attendance[0].status = 'UNKNOWN';
  assert.equal(feature.allocatePostedPayroll(attendance), null);
  const invalidDate = snapshot();
  invalidDate.attendance[0].date = '2026-02-31';
  assert.equal(feature.allocatePostedPayroll(invalidDate), null);
  const reversed = {
    ...snapshot(),
    rules: [{ ...snapshot().rules[0], end: '2026-09-30' }],
  };
  assert.equal(feature.allocatePostedPayroll(reversed), null);
});

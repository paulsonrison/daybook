import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isScheduled,
  validateSchedule,
  priceForDate,
  type Schedule,
  type PriceRule,
  deliveryDue,
} from './calendar.js';
const base: Schedule = {
  cadence: 'DAILY',
  startDate: '2024-01-31',
  endDate: null,
  weekdays: [],
};
test('delivery holds include start, exclude resume and respect cancellation and publication calendar', () => {
  const input = {
    schedule: base,
    date: '2024-02-01',
    subscriptionActive: true,
    residentActive: true,
    publicationActive: true,
    publicationSchedule: base,
    holds: [{ startDate: '2024-02-01', resumeDate: '2024-02-03' }],
  };
  assert.equal(deliveryDue(input), false);
  assert.equal(deliveryDue({ ...input, date: '2024-02-02' }), false);
  assert.equal(deliveryDue({ ...input, date: '2024-02-03' }), true);
  assert.equal(
    deliveryDue({
      ...input,
      holds: [{ startDate: '2024-02-01', resumeDate: null }],
      date: '2025-02-01',
    }),
    false,
  );
  assert.equal(
    deliveryDue({ ...input, holds: [], subscriptionActive: false }),
    false,
  );
  assert.equal(
    deliveryDue({ ...input, holds: [], residentActive: false }),
    false,
  );
  assert.equal(
    deliveryDue({
      ...input,
      holds: [],
      publicationSchedule: { ...base, cadence: 'SUNDAY' },
    }),
    false,
  );
});
test('all eight cadences use date-only boundaries and anchored recurrence', () => {
  assert.equal(isScheduled(base, '2024-02-01'), true);
  assert.equal(isScheduled(base, '2024-01-30'), false);
  assert.equal(
    isScheduled({ ...base, endDate: '2024-02-01' }, '2024-02-02'),
    false,
  );
  assert.equal(
    isScheduled(
      { ...base, cadence: 'WEEKDAYS', weekdays: [1, 3, 5] },
      '2024-02-02',
    ),
    true,
  );
  assert.equal(
    isScheduled(
      { ...base, cadence: 'WEEKDAYS', weekdays: [1, 3, 5] },
      '2024-02-03',
    ),
    false,
  );
  assert.equal(isScheduled({ ...base, cadence: 'SUNDAY' }, '2024-02-04'), true);
  assert.equal(isScheduled({ ...base, cadence: 'ONCE' }, '2024-02-01'), false);
  assert.equal(isScheduled({ ...base, cadence: 'ONCE' }, '2024-01-31'), true);
  assert.equal(isScheduled({ ...base, cadence: 'WEEKLY' }, '2024-02-07'), true);
  assert.equal(
    isScheduled({ ...base, cadence: 'FORTNIGHTLY' }, '2024-02-07'),
    false,
  );
  assert.equal(
    isScheduled({ ...base, cadence: 'FORTNIGHTLY' }, '2024-02-14'),
    true,
  );
  assert.equal(
    isScheduled({ ...base, cadence: 'MONTHLY' }, '2024-02-29'),
    true,
  );
  assert.equal(
    isScheduled({ ...base, cadence: 'MONTHLY' }, '2024-03-31'),
    true,
  );
  assert.equal(
    isScheduled({ ...base, cadence: 'MONTHLY' }, '2024-03-29'),
    false,
  );
  assert.equal(
    isScheduled(
      { ...base, cadence: 'YEARLY', startDate: '2024-02-29' },
      '2025-02-28',
    ),
    true,
  );
});
test('invalid schedules and impossible calendar dates are rejected', () => {
  for (const schedule of [
    { ...base, startDate: '2024-02-30' },
    { ...base, endDate: '2023-12-31' },
    { ...base, cadence: 'WEEKDAYS', weekdays: [] },
    { ...base, cadence: 'WEEKDAYS', weekdays: [7] },
  ])
    assert.throws(() => validateSchedule(schedule as Schedule));
  assert.throws(() => isScheduled(base, '2025-02-29'));
});
test('price rules prefer explicit date, bounded weekday, permanent weekday, then base', () => {
  const rules: PriceRule[] = [
    {
      id: 'permanent',
      startDate: '2024-01-01',
      endDate: null,
      weekdays: [0],
      pricePaise: 1200n,
    },
    {
      id: 'bounded',
      startDate: '2024-02-01',
      endDate: '2024-02-29',
      weekdays: [0],
      pricePaise: 1500n,
    },
    {
      id: 'date',
      startDate: '2024-02-04',
      endDate: '2024-02-04',
      weekdays: [],
      pricePaise: 2000n,
    },
  ];
  assert.equal(
    priceForDate('2024-02-04', 800n, 1000n, rules).pricePaise,
    2000n,
  );
  assert.equal(
    priceForDate('2024-02-11', 800n, 1000n, rules).pricePaise,
    1500n,
  );
  assert.equal(
    priceForDate('2024-03-03', 800n, 1000n, rules).pricePaise,
    1200n,
  );
  assert.equal(
    priceForDate('2024-03-02', 800n, 1000n, rules).pricePaise,
    1000n,
  );
  assert.equal(priceForDate('2024-03-01', 800n, 1000n, rules).pricePaise, 800n);
  assert.equal(priceForDate('2024-02-04', 800n, 1000n, rules).ruleId, 'date');
});

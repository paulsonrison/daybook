export interface Schedule {
  cadence:
    | 'DAILY'
    | 'WEEKDAYS'
    | 'SUNDAY'
    | 'ONCE'
    | 'WEEKLY'
    | 'FORTNIGHTLY'
    | 'MONTHLY'
    | 'YEARLY';
  startDate: string;
  endDate: string | null;
  weekdays: number[];
}
export interface PriceRule {
  id: string;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  pricePaise: bigint;
}
import { fail } from '../context.js';
export interface HoldWindow {
  startDate: string;
  resumeDate: string | null;
}
export interface DeliveryCalendar {
  schedule: Schedule;
  date: string;
  subscriptionActive: boolean;
  residentActive: boolean;
  publicationActive: boolean;
  publicationSchedule: Schedule;
  holds: HoldWindow[];
}
export function deliveryDue(input: DeliveryCalendar) {
  calendarDate(input.date);
  return (
    input.subscriptionActive &&
    input.residentActive &&
    input.publicationActive &&
    isScheduled(input.schedule, input.date) &&
    isScheduled(input.publicationSchedule, input.date) &&
    !input.holds.some(
      (hold) =>
        input.date >= hold.startDate &&
        (!hold.resumeDate || input.date < hold.resumeDate),
    )
  );
}
const DAY = 86400000;
// UTC is only an arithmetic coordinate for a validated calendar date, never an agency instant.
export function calendarDate(value: string): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31'
  )
    return fail('Enter a valid calendar date.');
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return fail('Enter a valid calendar date.');
  return date;
}
export function validateSchedule(schedule: Schedule): void {
  calendarDate(schedule.startDate);
  if (schedule.endDate) {
    calendarDate(schedule.endDate);
    if (schedule.endDate < schedule.startDate)
      fail('End date must be on or after start date.');
  }
  if (
    ![
      'DAILY',
      'WEEKDAYS',
      'SUNDAY',
      'ONCE',
      'WEEKLY',
      'FORTNIGHTLY',
      'MONTHLY',
      'YEARLY',
    ].includes(schedule.cadence)
  )
    fail('Choose a supported delivery cadence.');
  if (
    !Array.isArray(schedule.weekdays) ||
    schedule.weekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    ) ||
    new Set(schedule.weekdays).size !== schedule.weekdays.length ||
    (schedule.cadence === 'WEEKDAYS' && !schedule.weekdays.length)
  )
    fail('Choose valid distinct delivery weekdays.');
}
function clampedDay(year: number, month: number, day: number) {
  return Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
}
export function isScheduled(schedule: Schedule, value: string): boolean {
  return scheduleMatcher(schedule)(calendarDate(value));
}
export function scheduleMatcher(schedule: Schedule): (date: Date) => boolean {
  validateSchedule(schedule);
  const start = calendarDate(schedule.startDate),
    end = schedule.endDate
      ? calendarDate(schedule.endDate).valueOf()
      : Infinity;
  return (date: Date) => {
    if (date.valueOf() < start.valueOf() || date.valueOf() > end) return false;
    const elapsed = (date.valueOf() - start.valueOf()) / DAY;
    switch (schedule.cadence) {
      case 'DAILY':
        return true;
      case 'WEEKDAYS':
        return schedule.weekdays.includes(date.getUTCDay());
      case 'SUNDAY':
        return date.getUTCDay() === 0;
      case 'ONCE':
        return date.valueOf() === start.valueOf();
      case 'WEEKLY':
        return elapsed % 7 === 0;
      case 'FORTNIGHTLY':
        return elapsed % 14 === 0;
      case 'MONTHLY':
        return (
          date.getUTCDate() ===
          clampedDay(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            start.getUTCDate(),
          )
        );
      case 'YEARLY':
        return (
          date.getUTCMonth() === start.getUTCMonth() &&
          date.getUTCDate() ===
            clampedDay(
              date.getUTCFullYear(),
              date.getUTCMonth(),
              start.getUTCDate(),
            )
        );
    }
  };
}
export function priceForDate(
  value: string,
  weekday: bigint,
  weekend: bigint,
  rules: PriceRule[],
): { pricePaise: bigint; ruleId: string | null } {
  const day = calendarDate(value).getUTCDay();
  const matches = rules.filter(
    (rule) =>
      value >= rule.startDate &&
      (!rule.endDate || value <= rule.endDate) &&
      (!rule.weekdays.length || rule.weekdays.includes(day)),
  );
  const rank = (rule: PriceRule) =>
    !rule.weekdays.length ? 3 : rule.endDate ? 2 : 1;
  matches.sort((a, b) => rank(b) - rank(a));
  if (matches.length > 1 && rank(matches[0]) === rank(matches[1]))
    return fail('Conflicting price rules require correction.', 'CONFLICT');
  return matches.length
    ? { pricePaise: matches[0].pricePaise, ruleId: matches[0].id }
    : { pricePaise: day === 0 || day === 6 ? weekend : weekday, ruleId: null };
}

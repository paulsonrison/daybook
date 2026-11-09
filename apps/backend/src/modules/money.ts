import { fail } from './context.js';
const maximum = 9223372036854775807n;
/** Decimal rupees at the API boundary; integer paise everywhere in the ledger. */
export function parseMoney(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 24 ||
    !/^\d+(?:\.\d{1,2})?$/.test(value)
  )
    return fail(
      'Enter a non-negative amount with no more than two decimal places.',
    );
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise > maximum) return fail('This amount is too large.');
  return paise;
}
export function moneyString(value: bigint): string {
  const amount = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

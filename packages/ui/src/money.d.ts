/** Formats exact decimal strings without converting stored money to floating point. */
export function formatMoney(
  value: number | string | null | undefined,
  currency?: string,
  locale?: string,
): string;

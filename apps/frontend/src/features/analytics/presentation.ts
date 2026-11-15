import { formatMoney } from '@daybook/ui/money';
export function chartPoints(
  points: readonly { label: string; amount: string | null }[],
  kind: 'money' | 'count',
  locale: string,
) {
  const source = points.map((point) => {
    const valid =
      point.amount !== null &&
      (kind === 'money' ? /^-?\d+\.\d{2}$/ : /^\d+$/).test(point.amount);
    return {
      ...point,
      minor: valid ? BigInt(point.amount!.replace('.', '')) : null,
    };
  });
  const max = source.reduce((n, point) => {
    const value = point.minor ?? 0n;
    const magnitude = value < 0n ? -value : value;
    return magnitude > n ? magnitude : n;
  }, 1n);
  return source.map((point) => {
    const scaled = point.minor === null ? null : (point.minor * 10000n) / max;
    return {
      label: point.label,
      value:
        scaled === null
          ? null
          : Number(
              scaled === 0n && point.minor !== 0n
                ? point.minor! < 0n
                  ? -1n
                  : 1n
                : scaled,
            ),
      displayValue:
        point.minor === null
          ? undefined
          : kind === 'money'
            ? formatMoney(point.amount, 'INR', locale)
            : new Intl.NumberFormat(locale).format(point.minor),
    };
  });
}
export function basisPointsPercent(value: string | null, locale: string) {
  if (value === null) return null;
  const basis = BigInt(value),
    whole = new Intl.NumberFormat(locale).format(basis / 100n);
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(0.1)
    .find((part) => part.type === 'decimal')!.value;
  const fraction = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(basis % 100n);
  return `${whole}${decimal}${fraction}%`;
}

export interface CostInput {
  netCost?: string | null;
  listPrice?: string | null;
  marginPercent?: string | null;
}
import { fail } from '../context.js';
import { parseMoney } from '../money.js';
export function procurementCost(
  input: CostInput,
  defaultNet?: string | null,
): { netPaise: bigint; listPaise: bigint | null; marginBps: number | null } {
  const hasNet = input.netCost != null,
    hasList = input.listPrice != null,
    hasMargin = input.marginPercent != null;
  if (hasNet && (hasList || hasMargin))
    return fail(
      'Enter either net cost or list price with trade margin, not both.',
    );
  if (hasList || hasMargin) {
    if (!hasList || !hasMargin)
      return fail('List price and margin must be supplied together.');
    const listPaise = parseMoney(input.listPrice),
      margin = parseMoney(input.marginPercent);
    if (margin > 10000n)
      return fail('Trade margin must be between zero and 100 percent.');
    return {
      netPaise: (listPaise * (10000n - margin) + 5000n) / 10000n,
      listPaise,
      marginBps: Number(margin),
    };
  }
  if (!hasNet && defaultNet == null)
    return fail('Enter a known procurement cost before receiving this supply.');
  return {
    netPaise: parseMoney(hasNet ? input.netCost : defaultNet),
    listPaise: null,
    marginBps: null,
  };
}

import type { PoolClient } from 'pg';
import type { reportMonth } from './model.js';
import { moneyString } from '../money.js';
/** Issued insertion invoices use a uniform integer-paise price; unsupported older evidence stays unallocated. */
export function allocateAdvertiserSubtotal(subtotal: string, packed: unknown) {
  if (
    !/^\d+$/.test(subtotal) ||
    subtotal.length > 128 ||
    !Array.isArray(packed) ||
    !packed.length
  )
    return null;
  const quantities = new Map<
    string,
    { quantity: bigint; names: Set<string> }
  >();
  let total = 0n;
  for (const item of packed) {
    if (
      !item ||
      typeof item !== 'object' ||
      item.kind !== 'INSERT' ||
      typeof item.routeId !== 'string' ||
      !item.routeId ||
      typeof item.routeName !== 'string' ||
      !item.routeName ||
      typeof item.quantity !== 'number' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    )
      return null;
    const count = BigInt(item.quantity),
      route = quantities.get(item.routeId) ?? {
        quantity: 0n,
        names: new Set<string>(),
      };
    route.quantity += count;
    route.names.add(item.routeName);
    quantities.set(item.routeId, route);
    total += count;
  }
  const amount = BigInt(subtotal);
  if (amount % total !== 0n) return null;
  const unit = amount / total;
  return new Map(
    [...quantities].map(([route, source]) => [
      route,
      { amount: unit * source.quantity, names: [...source.names].sort() },
    ]),
  );
}

export async function readAnalyticsAdvertiser(
  c: PoolClient,
  period: ReturnType<typeof reportMonth>,
) {
  const invoices = (
    await c.query<{ subtotal: string; packed: unknown }>(
      'SELECT subtotal_paise::text AS subtotal,packed_items AS packed FROM daybook.advertiser_invoices WHERE issued_date>=$1::date AND issued_date<$2::date ORDER BY id',
      [period.startDate, period.nextDate],
    )
  ).rows;
  const routes = new Map<string, { amount: bigint; names: Set<string> }>();
  let allocated = 0n,
    unallocated = 0n,
    unsupported = 0;
  for (const invoice of invoices) {
    const allocation = allocateAdvertiserSubtotal(
      invoice.subtotal,
      invoice.packed,
    );
    if (!allocation) {
      unallocated += BigInt(invoice.subtotal);
      unsupported++;
      continue;
    }
    allocated += BigInt(invoice.subtotal);
    for (const [id, source] of allocation) {
      const route = routes.get(id) ?? { amount: 0n, names: new Set<string>() };
      route.amount += source.amount;
      source.names.forEach((name) => route.names.add(name));
      routes.set(id, route);
    }
  }
  return {
    routes,
    summary: {
      allocatedSubtotal: moneyString(allocated),
      unallocatedSubtotal: moneyString(unallocated),
      unsupportedInvoices: unsupported.toString(),
      coverage: !invoices.length
        ? 'UNAVAILABLE'
        : unsupported
          ? 'PARTIAL'
          : 'COMPLETE',
    },
  };
}

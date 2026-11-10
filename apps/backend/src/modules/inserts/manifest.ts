import type { PoolClient } from 'pg';
import type { ManifestExtraItem } from '../manifests/repository.js';
import { plannedRows } from '../delivery/service.js';
import { readInsertOrders, readAdvertiserInvoices } from './repository.js';
export async function insertExtras(
  c: PoolClient,
  date: string,
  dispatch: string,
) {
  const orders = (await readInsertOrders(c)).filter(
      (o) =>
        o.date === date && o.dispatch === dispatch && o.status !== 'CANCELLED',
    ),
    planned = (await plannedRows(c, date)).filter(
      (r) => r.dispatch === dispatch,
    );
  const items: ManifestExtraItem[] = [],
    warnings: string[] = [];
  const invoices = await readAdvertiserInvoices(c);
  for (const order of orders) {
    if (order.status === 'COMPLETED') {
      const invoice = invoices.find((i) => i.orderId === order.id);
      if (invoice) items.push(...invoice.packedItems);
      else
        warnings.push(
          `${order.title}: completed allocation evidence is unavailable.`,
        );
      continue;
    }
    for (const allocation of order.allocations) {
      const homes = [
        ...new Map(
          planned
            .filter((r) => r.routeId === allocation.routeId)
            .map((r) => [r.residentId, r]),
        ).values(),
      ].sort(
        (a, b) =>
          a.dropOrder - b.dropOrder || a.residentId.localeCompare(b.residentId),
      );
      if (homes.length < allocation.quantity)
        warnings.push(
          `${order.title}: only ${homes.length} of ${allocation.quantity} target doors are available on this route.`,
        );
      for (const row of homes.slice(0, allocation.quantity))
        items.push({
          kind: 'INSERT',
          sourceOrderId: order.id,
          residentId: row.residentId,
          name: order.title,
          residentName: row.residentName,
          address: row.address,
          routeId: row.routeId,
          routeName: row.routeName,
          staffId: row.staffId,
          staffName: row.staffName,
          dropOrder: row.dropOrder,
          quantity: 1,
        });
    }
  }
  return { items, warnings };
}

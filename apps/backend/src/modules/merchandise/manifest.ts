import type { PoolClient } from 'pg';
import type { ManifestExtraItem } from '../manifests/repository.js';
import { readOrders } from './repository.js';
import { readResidents } from '../residents/repository.js';
import { readRoutes } from '../routes/repository.js';
import { listStaff } from '../staff/repository.js';
import { readAssignments } from '../substitutions/repository.js';
import { readHolds } from '../subscriptions/holds-repository.js';
export async function merchandiseExtras(
  c: PoolClient,
  date: string,
  dispatch: string,
  fulfillingOrderId?: string,
) {
  const orders = (await readOrders(c)).filter(
      (o) =>
        o.date === date && o.dispatch === dispatch && o.status !== 'CANCELLED',
    ),
    residents = await readResidents(c),
    routes = await readRoutes(c),
    staff = await listStaff(c),
    assignments = await readAssignments(c),
    holds = await readHolds(c);
  const items: ManifestExtraItem[] = [],
    warnings: string[] = [];
  for (const order of orders) {
    if (order.status === 'FULFILLED' && order.packingSnapshot) {
      items.push(...order.packingSnapshot);
      continue;
    }
    if (order.status === 'PREORDER') {
      warnings.push(
        `${order.name}: ${order.quantity} items still need stock reservation.`,
      );
      continue;
    }
    const resident = residents.find((r) => r.id === order.residentId),
      route = routes.find((r) => r.id === resident?.routeId);
    if (!resident || !route) {
      warnings.push(`${order.name}: delivery address is unavailable.`);
      continue;
    }
    if (
      order.id !== fulfillingOrderId &&
      order.status !== 'FULFILLED' &&
      (resident.status !== 'ACTIVE' ||
        !route.active ||
        holds.some(
          (h) =>
            h.active &&
            h.residentId === resident.id &&
            !h.subscriptionId &&
            date >= h.startDate &&
            (!h.resumeDate || date < h.resumeDate),
        ))
    ) {
      warnings.push(
        `${order.name}: reschedule the held or inactive resident's delivery.`,
      );
      continue;
    }
    const assignment = assignments.find(
        (a) =>
          a.active &&
          a.routeId === route.id &&
          date >= a.startDate &&
          date <= a.endDate,
      ),
      allocation = assignment?.allocations.find(
        (a) =>
          resident.dropOrder >= a.fromDrop && resident.dropOrder <= a.toDrop,
      ),
      staffId = allocation?.staffId ?? route.staffId;
    items.push({
      kind: 'MERCHANDISE',
      sourceOrderId: order.id,
      residentId: resident.id,
      name: order.name,
      residentName: resident.name,
      address: resident.address,
      routeId: route.id,
      routeName: route.name,
      staffId: staffId ?? null,
      staffName: staff.find((s) => s.id === staffId)?.name ?? null,
      dropOrder: resident.dropOrder,
      quantity: order.quantity,
    });
  }
  return { items, warnings };
}

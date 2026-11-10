import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  agencyRead,
  configMutation,
  fail,
  type RequestContext,
} from '../context.js';
import { calendarDate } from '../scheduling/calendar.js';
import { markForDate, plannedRows } from '../delivery/service.js';
import { readDeliveries, agencyToday } from '../delivery/repository.js';
import {
  previousTotals,
  readManifests,
  storeManifest,
  type ManifestRow,
} from './repository.js';
export async function buildForDate(
  client: PoolClient,
  agencyId: string,
  date: string,
  dispatch: string,
  now = new Date(),
) {
  calendarDate(date);
  if (!['MORNING', 'EVENING'].includes(dispatch))
    return fail('Choose a valid dispatch.');
  const historical = date < (await agencyToday(client, now));
  if (historical) {
    const existing = (await readManifests(client, date)).find(
      (m) => m.dispatch === dispatch,
    );
    if (existing) return existing;
  }
  await markForDate(client, agencyId, date, now);
  const logs = await readDeliveries(client, date);
  const planned = (
    historical
      ? logs.filter((r) => r.status !== 'SKIPPED')
      : await plannedRows(client, date)
  ).filter((r) => r.dispatch === dispatch);
  const rows: ManifestRow[] = planned
    .map((row) => {
      const log = logs.find((l) => l.subscriptionId === row.subscriptionId);
      return {
        residentId: row.residentId,
        publicationId: row.publicationId,
        subscriptionId: row.subscriptionId,
        routeId: row.routeId,
        staffId: row.staffId,
        residentName: row.residentName,
        address: row.address,
        publicationName: row.publicationName,
        routeName: row.routeName,
        staffName: row.staffName,
        dropOrder: row.dropOrder,
        quantity: log?.quantity ?? row.quantity,
        price: log?.price ?? row.price,
      };
    })
    .sort(
      (a, b) =>
        a.routeName.localeCompare(b.routeName) ||
        a.dropOrder - b.dropOrder ||
        a.publicationName.localeCompare(b.publicationName),
    );
  const publications = [...new Set(rows.map((r) => r.publicationId))].map(
    (publicationId) => ({
      publicationId,
      name: rows.find((r) => r.publicationId === publicationId)!
        .publicationName,
      copies: rows
        .filter((r) => r.publicationId === publicationId)
        .reduce((sum, r) => sum + r.quantity, 0),
    }),
  );
  const totalCopies = rows.reduce((sum, r) => sum + r.quantity, 0),
    history = await previousTotals(client, date, dispatch),
    averageCopies =
      history.length >= 3
        ? history.reduce((a, b) => a + b, 0) / history.length
        : null,
    deviation =
      averageCopies === null
        ? false
        : averageCopies === 0
          ? totalCopies > 0
          : Math.abs(totalCopies - averageCopies) / averageCopies >= 0.3;
  return storeManifest(client, agencyId, {
    id: randomUUID(),
    date,
    dispatch,
    rows,
    publications,
    totalCopies,
    averageCopies,
    deviation,
  });
}
export const buildManifest = (
  ctx: RequestContext,
  date: string,
  dispatch: string,
) =>
  configMutation(ctx, (c) =>
    buildForDate(c, ctx.agent!.agencyId, date, dispatch),
  );
export const manifests = (ctx: RequestContext, date?: string) =>
  agencyRead(ctx, (c) => {
    if (date) calendarDate(date);
    return readManifests(c, date);
  });

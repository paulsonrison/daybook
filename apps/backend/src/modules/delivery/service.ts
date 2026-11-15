import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  agencyRead,
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { calendarDate } from '../scheduling/calendar.js';
import { scheduledForDate } from '../scheduling/service.js';
import { readRoutes } from '../routes/repository.js';
import { listStaff } from '../staff/repository.js';
import { readResidents } from '../residents/repository.js';
import {
  listPublications,
  findPublication,
} from '../publications/repository.js';
import { readAssignments } from '../substitutions/repository.js';
import { onceRequest } from '../requests.js';
import {
  findDelivery,
  insertDelivery,
  readDeliveries,
  readHolidays,
  reconcileAutomatic,
  updateDelivery,
  updateAssignedStaff,
  writeHoliday,
  agencyToday,
  wasMarked,
  markDay,
} from './repository.js';
export async function plannedRows(client: PoolClient, date: string) {
  calendarDate(date);
  const scheduled = await scheduledForDate(client, date),
    holidays = await readHolidays(client),
    routes = await readRoutes(client),
    staff = await listStaff(client),
    residents = await readResidents(client),
    publications = await listPublications(client),
    assignments = await readAssignments(client);
  return scheduled
    .filter(
      (row) =>
        !holidays.some(
          (h) =>
            h.active &&
            h.date === date &&
            h.publicationId === row.publicationId,
        ),
    )
    .flatMap((row) => {
      const route = routes.find((r) => r.id === row.routeId),
        resident = residents.find((r) => r.id === row.residentId),
        publication = publications.find((p) => p.id === row.publicationId);
      if (!route?.active || !resident || !publication) return [];
      const assignment = assignments.find(
          (a) =>
            a.active &&
            a.routeId === route.id &&
            date >= a.startDate &&
            date <= a.endDate,
        ),
        allocation = assignment?.allocations.find(
          (a) => row.dropOrder >= a.fromDrop && row.dropOrder <= a.toDrop,
        );
      if (assignment && !allocation)
        return fail(
          'A temporary route allocation does not cover this delivery point.',
        );
      const staffId = allocation?.staffId ?? route.staffId,
        person = staff.find((s) => s.id === staffId);
      return [
        {
          ...row,
          date,
          residentName: resident.name,
          address: resident.address,
          publicationName: `${publication.name} · ${publication.edition}`,
          routeName: route.name,
          staffId: staffId ?? null,
          staffName: person?.name ?? null,
          permanentStaffId: route.staffId ?? null,
          permanentStaffName:
            staff.find((s) => s.id === route.staffId)?.name ?? null,
        },
      ];
    });
}
export async function markForDate(
  client: PoolClient,
  agencyId: string,
  date: string,
  now = new Date(),
) {
  calendarDate(date);
  const today = await agencyToday(client, now);
  if (date > today)
    return fail('Deliveries can only be marked for today or past dates.');
  if (date < today && (await wasMarked(client, date))) {
    const all = await readDeliveries(client, date);
    return {
      created: 0,
      total: all.filter((r) => r.status !== 'SKIPPED').length,
    };
  }
  const planned = await plannedRows(client, date);
  let created = 0;
  for (const row of planned) {
    if (
      await insertDelivery(
        client,
        agencyId,
        { ...row, id: randomUUID() },
        date === today,
      )
    )
      created++;
    if (date === today)
      await updateAssignedStaff(
        client,
        date,
        row.subscriptionId,
        row.routeId,
        row.staffId,
        row.staffName,
      );
  }
  await reconcileAutomatic(
    client,
    date,
    planned.map((r) => r.subscriptionId),
  );
  await markDay(client, agencyId, date);
  const all = await readDeliveries(client, date);
  return { created, total: all.filter((r) => r.status !== 'SKIPPED').length };
}
export const markScheduledDeliveries = (ctx: RequestContext, date: string) =>
  configMutation(ctx, (c) => markForDate(c, ctx.agent!.agencyId, date));
export const deliveryLogs = (
  ctx: RequestContext,
  date: string,
  routeId?: string,
) =>
  agencyRead(ctx, (c) => {
    calendarDate(date);
    return readDeliveries(c, date, routeId ? idValue(routeId) : undefined);
  });
export interface DeliveryOverrideInput {
  id: string;
  version: number;
  status: string;
  reason: string;
  requestId: string;
}
export function overrideDelivery(
  ctx: RequestContext,
  input: DeliveryOverrideInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'delivery.override',
      input,
      async () => {
        const row = await findDelivery(c, idValue(input.id));
        if (!row) return fail('Delivery not found.', 'NOT_FOUND');
        versionMatches(row.version, input.version);
        if (!['DELIVERED', 'MISSED', 'DAMAGED'].includes(input.status))
          return fail('Choose delivered, missed or damaged.');
        const reason = cleanText(input.reason, 'override reason', 500);
        const updated = await updateDelivery(
          c,
          row.id,
          input.status,
          'AGENT',
          reason,
          input.status === 'DELIVERED' ? row.quantity : 0,
        );
        await audit(c, ctx, 'delivery', row.id, 'delivery.overridden', {
          before: row.status,
          after: input.status,
          reason,
        });
        const { pricePaise: _, ...result } = updated;
        return result;
      },
    ),
  );
}
export const pressHolidays = (ctx: RequestContext) =>
  agencyRead(ctx, readHolidays);
export interface PressHolidayInput {
  id?: string;
  version?: number;
  publicationId: string;
  date: string;
  reason: string;
  active?: boolean;
}
export function savePressHoliday(
  ctx: RequestContext,
  input: PressHolidayInput,
) {
  return configMutation(ctx, async (client) => {
    calendarDate(input.date);
    const publicationId = idValue(input.publicationId),
      id = input.id ? idValue(input.id) : randomUUID(),
      reason = cleanText(input.reason, 'press holiday reason', 500);
    if (!(await findPublication(client, publicationId)))
      return fail('Publication not found.', 'NOT_FOUND');
    const old = input.id
      ? (await readHolidays(client)).find((h) => h.id === id)
      : undefined;
    if (input.id) {
      if (!old) return fail('Press holiday not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const result = await writeHoliday(
      client,
      ctx.agent!.agencyId,
      {
        id,
        publicationId,
        date: input.date,
        reason,
        active: input.active ?? old?.active ?? true,
      },
      Boolean(old),
    );
    await audit(
      client,
      ctx,
      'press_holiday',
      id,
      old ? 'holiday.updated' : 'holiday.created',
      { date: input.date },
    );
    return result;
  });
}

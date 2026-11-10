import { randomUUID } from 'node:crypto';
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
import { onceRequest } from '../requests.js';
import { nextCode } from '../counter.js';
import { parseMoney, moneyString } from '../money.js';
import { calendarDate } from '../scheduling/calendar.js';
import { agencyToday } from '../delivery/repository.js';
import { plannedRows } from '../delivery/service.js';
import { readRoutes } from '../routes/repository.js';
import { buildForDate } from '../manifests/service.js';
import {
  findAdvertiser,
  findInsertOrder,
  insertAdvertiserInvoice,
  readAdvertisers,
  readAdvertiserInvoices,
  readInsertOrders,
  setInsertStatus,
  writeAdvertiser,
  writeInsertOrder,
  type InsertAllocation,
  type InsertOrder,
} from './repository.js';
const publicOrder = ({ unitPaise: _, totalPaise: __, ...r }: InsertOrder) => r;
export const advertisers = (ctx: RequestContext) =>
  agencyRead(ctx, readAdvertisers);
export const insertOrders = (ctx: RequestContext) =>
  agencyRead(ctx, readInsertOrders);
export const advertiserInvoices = (ctx: RequestContext) =>
  agencyRead(ctx, readAdvertiserInvoices);
export interface AdvertiserInput {
  id?: string;
  version?: number;
  name: string;
  phone: string;
  email?: string | null;
  billingAddress: string;
  active?: boolean;
}
export function saveAdvertiser(ctx: RequestContext, input: AdvertiserInput) {
  return configMutation(ctx, async (c) => {
    const id = input.id ? idValue(input.id) : randomUUID(),
      name = cleanText(input.name, 'advertiser name'),
      phone = cleanText(input.phone, 'advertiser phone', 30),
      billingAddress = cleanText(input.billingAddress, 'billing address', 500),
      email = input.email
        ? cleanText(input.email, 'email', 254).toLowerCase()
        : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return fail('Enter a valid advertiser email.');
    const old = input.id ? await findAdvertiser(c, id) : undefined;
    if (input.id) {
      if (!old) return fail('Advertiser not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const result = await writeAdvertiser(
      c,
      ctx.agent!.agencyId,
      {
        id,
        name,
        phone,
        email,
        billingAddress,
        active: input.active ?? old?.active ?? true,
      },
      Boolean(old),
    );
    await audit(
      c,
      ctx,
      'advertiser',
      id,
      old ? 'advertiser.updated' : 'advertiser.created',
    );
    return result;
  });
}
export interface InsertOrderInput {
  requestId: string;
  id?: string;
  version?: number;
  advertiserId: string;
  title: string;
  quantity: number;
  date: string;
  dispatch: string;
  unitPrice: string;
  allocations: InsertAllocation[];
}
export function saveInsertOrder(ctx: RequestContext, input: InsertOrderInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'insert.save',
      input,
      async () => {
        calendarDate(input.date);
        if (input.date < (await agencyToday(c)))
          return fail(
            'Schedule new or revised insert drops for today or a future date.',
          );
        if (
          !Number.isInteger(input.quantity) ||
          input.quantity < 1 ||
          input.quantity > 1000000 ||
          !['MORNING', 'EVENING'].includes(input.dispatch)
        )
          return fail('Choose a valid dispatch and quantity.');
        const id = input.id ? idValue(input.id) : randomUUID(),
          advertiserId = idValue(input.advertiserId),
          advertiser = await findAdvertiser(c, advertiserId);
        if (!advertiser) return fail('Advertiser not found.', 'NOT_FOUND');
        if (!advertiser.active) return fail('Choose an active advertiser.');
        const old = input.id ? await findInsertOrder(c, id) : undefined;
        if (input.id) {
          if (!old) return fail('Insert order not found.', 'NOT_FOUND');
          versionMatches(old.version, input.version);
          if (old.status !== 'SCHEDULED')
            return fail('Only an uncompleted scheduled order can be edited.');
        }
        if (
          !Array.isArray(input.allocations) ||
          !input.allocations.length ||
          input.allocations.length > 100
        )
          return fail('Choose one to 100 target routes.');
        const seen = new Set<string>(),
          routes = await readRoutes(c),
          planned = (await plannedRows(c, input.date)).filter(
            (r) => r.dispatch === input.dispatch,
          );
        let total = 0;
        const allocations = input.allocations.map((a) => {
          const routeId = idValue(a.routeId),
            route = routes.find((r) => r.id === routeId);
          if (!route) return fail('Target route not found.', 'NOT_FOUND');
          if (
            !route.active ||
            seen.has(routeId) ||
            !Number.isInteger(a.quantity) ||
            a.quantity < 1
          )
            return fail(
              'Use distinct active routes with positive insert quantities.',
            );
          seen.add(routeId);
          total += a.quantity;
          const doors = new Set(
            planned
              .filter((r) => r.routeId === routeId)
              .map((r) => r.residentId),
          ).size;
          if (a.quantity > doors)
            return fail(
              'Insert quantity exceeds the scheduled household capacity for a target route.',
            );
          return { routeId, quantity: a.quantity };
        });
        if (total !== input.quantity)
          return fail(
            'Target route quantities must equal the total insertion order.',
          );
        const unitPaise = parseMoney(input.unitPrice),
          totalPaise = unitPaise * BigInt(input.quantity);
        parseMoney(moneyString(totalPaise));
        const result = await writeInsertOrder(
          c,
          ctx.agent!.agencyId,
          {
            id,
            advertiserId,
            title: cleanText(input.title, 'insert title', 160),
            quantity: input.quantity,
            date: input.date,
            dispatch: input.dispatch,
            unitPaise,
            totalPaise,
            allocations,
          },
          Boolean(old),
        );
        await audit(
          c,
          ctx,
          'insert_order',
          id,
          old ? 'insert.updated' : 'insert.scheduled',
          { quantity: input.quantity, total: result.total },
        );
        return publicOrder(result);
      },
    ),
  );
}
export interface InsertActionInput {
  requestId: string;
  orderId: string;
  version: number;
}
export function cancelInsertOrder(
  ctx: RequestContext,
  input: InsertActionInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'insert.cancel',
      input,
      async () => {
        const order = await findInsertOrder(c, idValue(input.orderId));
        if (!order) return fail('Insert order not found.', 'NOT_FOUND');
        versionMatches(order.version, input.version);
        if (order.status !== 'SCHEDULED')
          return fail(
            'Only a scheduled uncompleted campaign can be cancelled.',
          );
        const result = await setInsertStatus(c, order.id, 'CANCELLED');
        await audit(c, ctx, 'insert_order', order.id, 'insert.cancelled');
        return publicOrder(result);
      },
    ),
  );
}
export interface InsertCompleteInput extends InsertActionInput {
  proofReference: string;
  noTaxConfirmed: boolean;
}
export function completeInsertOrder(
  ctx: RequestContext,
  input: InsertCompleteInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'insert.complete',
      input,
      async () => {
        const order = await findInsertOrder(c, idValue(input.orderId));
        if (!order) return fail('Insert order not found.', 'NOT_FOUND');
        versionMatches(order.version, input.version);
        if (order.status !== 'SCHEDULED')
          return fail(
            'This campaign has already been completed or cancelled.',
            'CONFLICT',
          );
        const proofReference = cleanText(
          input.proofReference,
          'completion proof reference',
          1000,
        );
        if (!input.noTaxConfirmed)
          return fail(
            'Confirm that no tax applies, or configure applicable tax treatment before issuing a taxed invoice.',
          );
        const today = await agencyToday(c);
        if (order.date > today)
          return fail('Record completion on or after the scheduled drop date.');
        const manifest = await buildForDate(
            c,
            ctx.agent!.agencyId,
            order.date,
            order.dispatch,
          ),
          packedItems = manifest.extraItems.filter(
            (r) => r.kind === 'INSERT' && r.sourceOrderId === order.id,
          ),
          packed = packedItems.reduce((sum, r) => sum + r.quantity, 0);
        if (packed !== order.quantity)
          return fail(
            'The packing manifest does not cover the complete insertion order. Resolve unavailable or held target doors first.',
          );
        const routeCounts = new Map<string, number>();
        for (const row of packedItems)
          routeCounts.set(
            row.routeId,
            (routeCounts.get(row.routeId) ?? 0) + row.quantity,
          );
        if (
          packedItems.some((row) => row.name !== order.title) ||
          new Set(packedItems.map((row) => row.residentId)).size !==
            order.quantity ||
          routeCounts.size !== order.allocations.length ||
          order.allocations.some(
            (a) => routeCounts.get(a.routeId) !== a.quantity,
          )
        )
          return fail(
            'The packing sheet belongs to an obsolete campaign allocation. Reschedule and prepare the revised campaign before recording completion.',
            'CONFLICT',
          );
        const advertiser = await findAdvertiser(c, order.advertiserId);
        if (!advertiser) return fail('Advertiser not found.', 'NOT_FOUND');
        const invoice = await insertAdvertiserInvoice(c, ctx.agent!.agencyId, {
          id: randomUUID(),
          orderId: order.id,
          advertiserId: advertiser.id,
          code: await nextCode(
            c,
            ctx.agent!.agencyId,
            'advertiser_invoice',
            'ADV-',
          ),
          advertiserName: advertiser.name,
          billingAddress: advertiser.billingAddress,
          packedItems,
          subtotalPaise: order.totalPaise,
          proofReference,
          date: today,
        });
        await setInsertStatus(c, order.id, 'COMPLETED');
        await audit(c, ctx, 'insert_order', order.id, 'insert.completed', {
          invoiceId: invoice.id,
          proofReference,
          total: invoice.total,
        });
        return invoice;
      },
    ),
  );
}

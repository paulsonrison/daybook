import { merchandiseExtras } from './manifest.js';
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
import { lockResident } from '../residents/repository.js';
import { findRoute } from '../routes/repository.js';
import {
  findItem,
  findOrder,
  insertCharge,
  insertOrder,
  moveStock,
  orderStatus,
  readCharges,
  readItems,
  readOrders,
  receiveStock,
  writeItem,
  type MerchandiseItem,
  type MerchandiseOrder,
} from './repository.js';
const itemResult = ({ pricePaise: _, ...r }: MerchandiseItem) => r;
const orderResult = ({
  unitPaise: _,
  totalPaise: __,
  ...r
}: MerchandiseOrder) => r;
const quantity = (n: number) => {
  if (!Number.isInteger(n) || n < 1 || n > 1000000)
    return fail('Enter one to one million items.');
  return n;
};
export const merchandiseItems = (ctx: RequestContext) =>
  agencyRead(ctx, readItems);
export const merchandiseOrders = (ctx: RequestContext) =>
  agencyRead(ctx, readOrders);
export const merchandiseCharges = (ctx: RequestContext) =>
  agencyRead(ctx, readCharges);
export interface MerchandiseInput {
  id?: string;
  version?: number;
  name: string;
  sku: string;
  kind: string;
  price: string;
  active?: boolean;
}
export function saveMerchandise(ctx: RequestContext, input: MerchandiseInput) {
  return configMutation(ctx, async (c) => {
    const id = input.id ? idValue(input.id) : randomUUID(),
      name = cleanText(input.name, 'item name'),
      sku = cleanText(input.sku, 'stock code', 40).toUpperCase();
    if (!['CALENDAR', 'DIARY', 'FESTIVAL', 'OTHER'].includes(input.kind))
      return fail('Choose a valid seasonal item type.');
    const old = input.id ? await findItem(c, id) : undefined;
    if (input.id) {
      if (!old) return fail('Item not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const result = await writeItem(
      c,
      ctx.agent!.agencyId,
      {
        id,
        name,
        sku,
        kind: input.kind,
        pricePaise: parseMoney(input.price),
        active: input.active ?? old?.active ?? true,
      },
      Boolean(old),
    );
    await audit(
      c,
      ctx,
      'merchandise',
      id,
      old ? 'merchandise.updated' : 'merchandise.created',
      { version: result.version },
    );
    return result;
  });
}
export interface MerchandiseStockInput {
  requestId: string;
  itemId: string;
  quantity: number;
  note: string;
}
export function receiveMerchandiseStock(
  ctx: RequestContext,
  input: MerchandiseStockInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'merchandise.stock',
      input,
      async () => {
        const item = await findItem(c, idValue(input.itemId));
        if (!item) return fail('Item not found.', 'NOT_FOUND');
        quantity(input.quantity);
        if (item.onHand + input.quantity > 2147483647)
          return fail('This stock receipt exceeds supported storage capacity.');
        const note = cleanText(input.note, 'stock receipt note', 500),
          result = await receiveStock(
            c,
            ctx.agent!.agencyId,
            item.id,
            input.quantity,
            note,
          );
        await audit(c, ctx, 'merchandise', item.id, 'merchandise.received', {
          quantity: input.quantity,
          note,
        });
        return itemResult(result);
      },
    ),
  );
}
export interface MerchandiseOrderInput {
  requestId: string;
  residentId: string;
  itemId: string;
  quantity: number;
  date: string;
  dispatch?: string;
  settlement: string;
}
export function saveMerchandiseOrder(
  ctx: RequestContext,
  input: MerchandiseOrderInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'merchandise.preorder',
      input,
      async () => {
        calendarDate(input.date);
        quantity(input.quantity);
        const residentId = idValue(input.residentId),
          itemId = idValue(input.itemId),
          resident = await lockResident(c, residentId),
          item = await findItem(c, itemId);
        if (!resident || !item)
          return fail('Resident or item not found.', 'NOT_FOUND');
        if (
          resident.status !== 'ACTIVE' ||
          !item.active ||
          !(await findRoute(c, resident.routeId))?.active
        )
          return fail('Choose an active resident, route and item.');
        const dispatch = input.dispatch ?? 'MORNING';
        if (
          !['MORNING', 'EVENING'].includes(dispatch) ||
          !['INVOICE', 'CASH'].includes(input.settlement)
        )
          return fail('Choose a valid dispatch and settlement method.');
        const totalPaise = item.pricePaise * BigInt(input.quantity);
        parseMoney(moneyString(totalPaise));
        const id = randomUUID(),
          result = await insertOrder(c, ctx.agent!.agencyId, {
            id,
            residentId,
            itemId,
            name: item.name,
            quantity: input.quantity,
            date: input.date,
            dispatch,
            unitPaise: item.pricePaise,
            totalPaise,
            settlement: input.settlement,
          });
        await audit(c, ctx, 'merchandise_order', id, 'merchandise.preordered', {
          quantity: input.quantity,
          total: result.total,
        });
        return orderResult(result);
      },
    ),
  );
}
export interface MerchandiseReserveInput {
  requestId: string;
  orderId: string;
  version: number;
}
export function reserveMerchandise(
  ctx: RequestContext,
  input: MerchandiseReserveInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'merchandise.reserve',
      input,
      async () => {
        const order = await findOrder(c, idValue(input.orderId));
        if (!order) return fail('Preorder not found.', 'NOT_FOUND');
        versionMatches(order.version, input.version);
        if (order.status !== 'PREORDER')
          return fail('Only an open preorder can reserve stock.');
        const item = await findItem(c, order.itemId);
        if (!item?.active) return fail('The seasonal item is unavailable.');
        if (item.available < order.quantity)
          return fail('There is not enough unreserved stock.');
        await moveStock(c, item.id, 0, order.quantity);
        const result = await orderStatus(c, order.id, 'RESERVED');
        await audit(
          c,
          ctx,
          'merchandise_order',
          order.id,
          'merchandise.reserved',
          { quantity: order.quantity },
        );
        return orderResult(result);
      },
    ),
  );
}
export function cancelMerchandiseOrder(
  ctx: RequestContext,
  input: MerchandiseReserveInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'merchandise.cancel',
      input,
      async () => {
        const order = await findOrder(c, idValue(input.orderId));
        if (!order) return fail('Preorder not found.', 'NOT_FOUND');
        versionMatches(order.version, input.version);
        if (!['PREORDER', 'RESERVED'].includes(order.status))
          return fail('Only an unfulfilled order can be cancelled.');
        if (order.status === 'RESERVED')
          await moveStock(c, order.itemId, 0, -order.quantity);
        const result = await orderStatus(c, order.id, 'CANCELLED');
        await audit(
          c,
          ctx,
          'merchandise_order',
          order.id,
          'merchandise.cancelled',
        );
        return orderResult(result);
      },
    ),
  );
}
export interface MerchandiseFulfilInput extends MerchandiseReserveInput {
  cashReceived?: string;
}
export function fulfilOrder(
  ctx: RequestContext,
  input: MerchandiseFulfilInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'merchandise.fulfil',
      input,
      async () => {
        const order = await findOrder(c, idValue(input.orderId));
        if (!order) return fail('Order not found.', 'NOT_FOUND');
        versionMatches(order.version, input.version);
        if (order.status !== 'RESERVED')
          return fail('Reserve stock before confirming delivery.');
        const today = await agencyToday(c);
        if (order.date > today)
          return fail(
            'Confirm fulfilment on or after the scheduled drop date.',
          );
        if (
          order.settlement === 'CASH' &&
          parseMoney(input.cashReceived) !== order.totalPaise
        )
          return fail('Confirm the exact cash amount received for this order.');
        if (order.settlement === 'INVOICE' && input.cashReceived !== undefined)
          return fail('This order is payable on the resident invoice.');
        const packingSnapshot = (
          await merchandiseExtras(c, order.date, order.dispatch, order.id)
        ).items.filter((row) => row.sourceOrderId === order.id);
        if (packingSnapshot.length !== 1)
          return fail(
            'The delivery address is unavailable for this fulfilment.',
          );
        await moveStock(c, order.itemId, -order.quantity, -order.quantity);
        const receiptCode =
          order.settlement === 'CASH'
            ? await nextCode(c, ctx.agent!.agencyId, 'merchandise_cash', 'MRC-')
            : null;
        await insertCharge(c, ctx.agent!.agencyId, {
          id: randomUUID(),
          orderId: order.id,
          residentId: order.residentId,
          amountPaise: order.totalPaise,
          settlement: order.settlement,
          receiptCode,
          date: today,
        });
        const result = await orderStatus(
          c,
          order.id,
          'FULFILLED',
          packingSnapshot,
        );
        await audit(
          c,
          ctx,
          'merchandise_order',
          order.id,
          'merchandise.fulfilled',
          { amount: order.total, settlement: order.settlement, receiptCode },
        );
        return orderResult(result);
      },
    ),
  );
}

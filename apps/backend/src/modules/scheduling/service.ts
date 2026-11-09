import type { PoolClient } from 'pg';
import { agencyRead, idValue, type RequestContext } from '../context.js';
import { listSubscriptions } from '../subscriptions/repository.js';
import { readResidents } from '../residents/repository.js';
import { listPublications } from '../publications/repository.js';
import { readHolds } from '../subscriptions/holds-repository.js';
import { readPrices } from '../pricing/repository.js';
import { publicationSchedule } from '../subscriptions/service.js';
import { calendarDate, deliveryDue, priceForDate } from './calendar.js';
import { moneyString, parseMoney } from '../money.js';
export async function scheduledForDate(
  client: PoolClient,
  date: string,
  residentId?: string,
) {
  calendarDate(date);
  const subscriptions = await listSubscriptions(client, residentId),
    residents = await readResidents(client, residentId),
    publications = await listPublications(client),
    holds = await readHolds(client, residentId),
    prices = await readPrices(client);
  return subscriptions.flatMap((subscription) => {
    const resident = residents.find((r) => r.id === subscription.residentId),
      publication = publications.find(
        (p) => p.id === subscription.publicationId,
      );
    if (
      !resident ||
      !publication ||
      !publication.publishingDays.includes(calendarDate(date).getUTCDay()) ||
      !deliveryDue({
        date,
        schedule: subscription,
        publicationSchedule: publicationSchedule(publication),
        subscriptionActive: subscription.status === 'ACTIVE',
        residentActive: resident.status === 'ACTIVE',
        publicationActive: publication.active,
        holds: holds.filter(
          (h) =>
            h.active &&
            h.residentId === resident.id &&
            (!h.subscriptionId || h.subscriptionId === subscription.id),
        ),
      })
    )
      return [];
    const price = priceForDate(
      date,
      parseMoney(publication.weekdayPrice),
      parseMoney(publication.weekendPrice),
      prices.filter((p) => p.active && p.publicationId === publication.id),
    );
    return [
      {
        subscriptionId: subscription.id,
        residentId: resident.id,
        publicationId: publication.id,
        routeId: resident.routeId,
        dropOrder: resident.dropOrder,
        dispatch: publication.dispatch,
        quantity: subscription.quantity,
        price: moneyString(price.pricePaise),
        pricePaise: price.pricePaise,
        ruleId: price.ruleId,
      },
    ];
  });
}
export const scheduledCopies = (
  ctx: RequestContext,
  date: string,
  residentId?: string,
) =>
  agencyRead(ctx, (c) =>
    scheduledForDate(c, date, residentId ? idValue(residentId) : undefined),
  );

import { randomUUID, createHash } from 'node:crypto';
import {
  agencyRead,
  audit,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { lockResident } from '../residents/repository.js';
import { listPublications } from '../publications/repository.js';
import {
  scheduleMatcher,
  calendarDate,
  validateSchedule,
  type Schedule,
} from '../scheduling/calendar.js';
import {
  findSubscription,
  listSubscriptions,
  writeSubscription,
  subscriptionRequest,
} from './repository.js';
export interface SubscriptionInput extends Schedule {
  requestId?: string;
  id?: string;
  version?: number;
  residentId: string;
  publicationId: string;
  quantity: number;
  status?: string;
}
export const subscriptions = (ctx: RequestContext, residentId?: string) =>
  agencyRead(ctx, (c) =>
    listSubscriptions(c, residentId ? idValue(residentId) : undefined),
  );
export function publicationSchedule(publication: {
  frequency: string;
  publishingDays: number[];
  anchorDate: string | null;
}): Schedule {
  return {
    cadence:
      publication.frequency === 'DAILY' || publication.frequency === 'WEEKLY'
        ? 'WEEKDAYS'
        : (publication.frequency as Schedule['cadence']),
    weekdays: publication.publishingDays,
    startDate: publication.anchorDate ?? '1900-01-01',
    endDate: null,
  };
}
export function saveSubscription(
  ctx: RequestContext,
  input: SubscriptionInput,
) {
  return configMutation(ctx, async (client) => {
    const schedule = {
      cadence: input.cadence,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      weekdays: input.weekdays,
    };
    validateSchedule(schedule);
    const residentId = idValue(input.residentId),
      publicationId = idValue(input.publicationId),
      id = input.id ? idValue(input.id) : randomUUID();
    const old = input.id ? await findSubscription(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Subscription not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      if (old.residentId !== residentId || old.publicationId !== publicationId)
        return fail(
          'Cancel this subscription and create a separate assignment to change its resident or publication.',
        );
    }
    const resident = await lockResident(client, residentId),
      publication = (await listPublications(client)).find(
        (p) => p.id === publicationId,
      );
    if (!resident || !publication)
      return fail('Resident or publication not found.', 'NOT_FOUND');
    const status = input.status ?? old?.status ?? 'ACTIVE';
    if (!['ACTIVE', 'PAUSED', 'CANCELLED'].includes(status))
      return fail('Choose a valid subscription status.');
    if (
      status === 'ACTIVE' &&
      (resident.status !== 'ACTIVE' || !publication.active)
    )
      return fail('Choose an active resident and publication.');
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1000
    )
      return fail('Enter one to 1000 copies.');
    const requestId = old ? '' : idValue(input.requestId),
      fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            residentId,
            publicationId,
            ...schedule,
            weekdays: [...schedule.weekdays].sort(),
            quantity: input.quantity,
            status,
          }),
        )
        .digest('hex');
    if (!old) {
      const previous = await subscriptionRequest(client, requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return fail(
            'This request identifier was used for different subscription details.',
            'CONFLICT',
          );
        return previous;
      }
    }
    const publishing = publicationSchedule(publication);
    // Gregorian dates and fortnight parity repeat in 800 years; check the entire cycle or the bounded term.
    if (status === 'ACTIVE') {
      const start = calendarDate(schedule.startDate),
        end = calendarDate(
          schedule.endDate ??
            `${String(Math.min(9999, start.getUTCFullYear() + 800)).padStart(4, '0')}-12-31`,
        );
      let found = false;
      const subscriptionMatches = scheduleMatcher(schedule),
        publicationMatches = scheduleMatcher(publishing);
      for (
        let stamp = start.valueOf();
        stamp <= end.valueOf();
        stamp += 86400000
      ) {
        const date = new Date(stamp);
        if (subscriptionMatches(date)) {
          found = true;
          if (
            !publicationMatches(date) ||
            !publication.publishingDays.includes(date.getUTCDay())
          )
            return fail(
              'Selected delivery dates must match the publication issue calendar.',
            );
        }
        if (schedule.cadence === 'ONCE') break;
      }
      if (!found) return fail('This schedule has no delivery dates.');
    }
    const result = await writeSubscription(
      client,
      ctx.agent!.agencyId,
      {
        ...schedule,
        id,
        residentId,
        publicationId,
        quantity: input.quantity,
        status,
      },
      Boolean(old),
      { id: requestId, fingerprint },
    );
    await audit(
      client,
      ctx,
      'subscription',
      id,
      old ? 'subscription.updated' : 'subscription.created',
      { status, version: result.version },
    );
    return result;
  });
}

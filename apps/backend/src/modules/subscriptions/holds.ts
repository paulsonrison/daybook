import { readHolds, findHold, writeHold } from './holds-repository.js';
import { randomUUID } from 'node:crypto';
import {
  agencyRead,
  audit,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { calendarDate } from '../scheduling/calendar.js';
import { lockResident } from '../residents/repository.js';
import { findSubscription } from './repository.js';
export interface HoldInput {
  id?: string;
  version?: number;
  residentId: string;
  subscriptionId?: string | null;
  startDate: string;
  resumeDate?: string | null;
  active?: boolean;
}
export const holds = (ctx: RequestContext, residentId?: string) =>
  agencyRead(ctx, (c) =>
    readHolds(c, residentId ? idValue(residentId) : undefined),
  );
export function setHold(ctx: RequestContext, input: HoldInput) {
  return configMutation(ctx, async (client) => {
    const residentId = idValue(input.residentId),
      subscriptionId = input.subscriptionId
        ? idValue(input.subscriptionId)
        : null,
      id = input.id ? idValue(input.id) : randomUUID();
    calendarDate(input.startDate);
    if (input.resumeDate) {
      calendarDate(input.resumeDate);
      if (input.resumeDate <= input.startDate)
        return fail('Resume date must be after the pause start.');
    }
    if (!(await lockResident(client, residentId)))
      return fail('Resident not found.', 'NOT_FOUND');
    if (subscriptionId) {
      const subscription = await findSubscription(client, subscriptionId);
      if (!subscription || subscription.residentId !== residentId)
        return fail('Subscription not found for this resident.', 'NOT_FOUND');
    }
    const old = input.id ? await findHold(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Hold not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      if (old.residentId !== residentId)
        return fail('A hold cannot move between resident accounts.');
    }
    const result = await writeHold(
      client,
      ctx.agent!.agencyId,
      {
        id,
        residentId,
        subscriptionId,
        startDate: input.startDate,
        resumeDate: input.resumeDate ?? null,
        active: input.active ?? old?.active ?? true,
      },
      Boolean(old),
    );
    await audit(
      client,
      ctx,
      'hold',
      id,
      old ? 'hold.updated' : 'hold.created',
      {
        residentId,
        subscriptionId,
        startDate: input.startDate,
        resumeDate: input.resumeDate ?? null,
      },
    );
    return result;
  });
}

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
import { calendarDate } from '../scheduling/calendar.js';
import { findRoute } from '../routes/repository.js';
import { findStaff } from '../staff/repository.js';
import {
  readAssignments,
  writeAssignment,
  reconcileDatedAssignments,
  type Allocation,
} from './repository.js';
export interface SubstituteInput {
  id?: string;
  version?: number;
  routeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  allocations: Allocation[];
  active?: boolean;
}
export const substituteAssignments = (ctx: RequestContext) =>
  agencyRead(ctx, readAssignments);
export function assignSubstitutes(ctx: RequestContext, input: SubstituteInput) {
  return configMutation(ctx, async (client) => {
    const id = input.id ? idValue(input.id) : randomUUID(),
      routeId = idValue(input.routeId),
      reason = cleanText(input.reason, 'absence reason', 500);
    calendarDate(input.startDate);
    calendarDate(input.endDate);
    if (input.endDate < input.startDate)
      return fail('The absence end date must follow its start.');
    const route = await findRoute(client, routeId);
    if (!route) return fail('Route not found.', 'NOT_FOUND');
    const all = await readAssignments(client),
      old = input.id ? all.find((a) => a.id === id) : undefined;
    if (input.id) {
      if (!old) return fail('Temporary assignment not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const active = input.active ?? old?.active ?? true;
    if (active && !route.active) return fail('Choose an active route.');
    if (
      !Array.isArray(input.allocations) ||
      !input.allocations.length ||
      input.allocations.length > 100
    )
      return fail('Choose one to 100 substitute allocations.');
    const allocations = input.allocations
      .map((a) => ({ ...a, staffId: idValue(a.staffId) }))
      .sort((a, b) => a.fromDrop - b.fromDrop);
    let next = 1;
    for (const allocation of allocations) {
      if (
        !Number.isInteger(allocation.fromDrop) ||
        !Number.isInteger(allocation.toDrop) ||
        allocation.fromDrop !== next ||
        allocation.toDrop < allocation.fromDrop ||
        allocation.toDrop > 99999
      )
        return fail(
          'Split ranges must cover every drop from 1 to 99999 exactly once.',
        );
      next = allocation.toDrop + 1;
      const person = await findStaff(client, allocation.staffId);
      if (!person) return fail('Staff member not found.', 'NOT_FOUND');
      if (active && person.status !== 'ACTIVE')
        return fail('Choose available active substitute staff.');
    }
    if (next !== 100000)
      return fail(
        'Split ranges must include the final delivery range through 99999.',
      );
    if (
      active &&
      all.some(
        (a) =>
          a.id !== id &&
          a.active &&
          a.routeId === routeId &&
          a.startDate <= input.endDate &&
          a.endDate >= input.startDate,
      )
    )
      return fail(
        'A temporary assignment already covers these dates.',
        'CONFLICT',
      );
    const result = await writeAssignment(
      client,
      ctx.agent!.agencyId,
      {
        id,
        routeId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason,
        allocations,
        active,
      },
      Boolean(old),
    );
    if (old)
      await reconcileDatedAssignments(
        client,
        old.routeId,
        old.startDate,
        old.endDate,
      );
    await reconcileDatedAssignments(
      client,
      routeId,
      input.startDate,
      input.endDate,
    );
    await audit(
      client,
      ctx,
      'substitution',
      id,
      old ? 'substitution.updated' : 'substitution.created',
      { startDate: input.startDate, endDate: input.endDate, allocations },
    );
    return result;
  });
}

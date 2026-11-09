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
import { findTerritory } from '../territories/repository.js';
import { findStaff } from '../staff/repository.js';
import {
  readRoutes,
  findRoute,
  routeStopIds,
  writeRoute,
  replaceStops,
} from './repository.js';
export interface StopInput {
  id?: string;
  label: string;
  door: string;
  sequence: number;
}
export interface RouteInput {
  id?: string;
  version?: number;
  code: string;
  name: string;
  territoryId: string;
  staffId?: string | null;
  active?: boolean;
  stops?: StopInput[];
}
export const routes = (ctx: RequestContext) =>
  agencyRead(ctx, (client) => readRoutes(client));
export function saveRoute(ctx: RequestContext, input: RouteInput) {
  return configMutation(ctx, async (client) => {
    const name = cleanText(input.name, 'route name'),
      code = cleanText(input.code, 'route code', 32).toUpperCase();
    const territoryId = idValue(input.territoryId),
      staffId = input.staffId ? idValue(input.staffId) : null;
    const id = input.id ? idValue(input.id) : randomUUID();
    const old = input.id ? await findRoute(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Route not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
    }
    const active = input.active ?? old?.active ?? true;
    const territory = await findTerritory(client, territoryId);
    if (!territory) fail('Territory not found.', 'NOT_FOUND');
    if (
      !territory.active &&
      (active || !old || territoryId !== old.territoryId)
    )
      fail('Choose an active territory.');
    if (staffId) {
      const person = await findStaff(client, staffId);
      if (!person) fail('Staff member not found.', 'NOT_FOUND');
      if (
        person.status !== 'ACTIVE' &&
        (!old || staffId !== old.staffId || (!old.active && active))
      )
        fail('Choose an active staff member.');
    }
    await writeRoute(
      client,
      ctx.agent!.agencyId,
      { id, code, name, territoryId, staffId, active },
      Boolean(input.id),
    );
    if (input.stops !== undefined) {
      if (!Array.isArray(input.stops) || input.stops.length > 5000)
        fail('A route supports up to 5000 delivery points.');
      const ownIds = await routeStopIds(client, id);
      const seenIds = new Set<string>(),
        positions = new Set<number>();
      const stops = input.stops.map((stop) => {
        const stopId = stop.id ? idValue(stop.id) : randomUUID();
        if (stop.id && !ownIds.has(stopId))
          fail('Delivery point not found on this route.', 'NOT_FOUND');
        if (
          seenIds.has(stopId) ||
          !Number.isInteger(stop.sequence) ||
          stop.sequence < 1 ||
          stop.sequence > 99999 ||
          positions.has(stop.sequence)
        )
          fail('Use distinct delivery points and positive drop positions.');
        seenIds.add(stopId);
        positions.add(stop.sequence);
        return {
          ...stop,
          id: stopId,
          label: cleanText(stop.label, 'delivery point', 160),
          door: cleanText(stop.door, 'door/address', 120),
        };
      });
      await replaceStops(client, ctx.agent!.agencyId, id, stops);
    }
    await audit(
      client,
      ctx,
      'route',
      id,
      input.id ? 'route.updated' : 'route.created',
      { staffId, version: input.id ? input.version! + 1 : 1 },
    );
    return (await readRoutes(client, id))[0];
  });
}

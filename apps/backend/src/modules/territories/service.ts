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

export interface TerritoryInput {
  id?: string;
  version?: number;
  name: string;
  locality: string;
  pinCodes: string[];
  sectors: string[];
  active?: boolean;
  overlapReason?: string;
}
import {
  listTerritories,
  findTerritory,
  overlapsTerritory,
  territoryHasActiveRoutes,
  writeTerritory,
  hasResidentsOutsideSectors,
} from './repository.js';
export const territories = (ctx: RequestContext) =>
  agencyRead(ctx, listTerritories);
export function saveTerritory(ctx: RequestContext, input: TerritoryInput) {
  return configMutation(ctx, async (client) => {
    const name = cleanText(input.name, 'territory name'),
      locality = cleanText(input.locality, 'locality');
    if (
      !Array.isArray(input.pinCodes) ||
      !input.pinCodes.length ||
      input.pinCodes.length > 32
    )
      fail('Add one to 32 PIN codes.');
    const pins = [
      ...new Set(input.pinCodes.map((v) => cleanText(v, 'PIN code', 6))),
    ];
    if (pins.some((v) => !/^\d{6}$/.test(v)))
      fail('PIN codes must have six digits.');
    if (
      !Array.isArray(input.sectors) ||
      !input.sectors.length ||
      input.sectors.length > 100
    )
      fail('Add one to 100 sector boundaries.');
    const sectors = input.sectors.map((v) => cleanText(v, 'sector', 120));
    const keys = sectors.map((v) => v.toLocaleLowerCase('en'));
    if (new Set(keys).size !== keys.length)
      fail('Sector boundaries must be distinct.');
    const id = input.id ? idValue(input.id) : randomUUID();
    let active = input.active ?? true;
    if (input.id) {
      const old = await findTerritory(client, id, true);
      if (!old) fail('Territory not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      active = input.active ?? old.active;
    }
    if (input.id && (await hasResidentsOutsideSectors(client, id, keys)))
      fail('Move residents before removing their territory sectors.');
    const overlap = await overlapsTerritory(
      client,
      id,
      locality.toLocaleLowerCase('en'),
      pins,
      keys,
    );
    const reason = input.overlapReason
      ? cleanText(input.overlapReason, 'overlap authorization reason', 500)
      : undefined;
    if (active && overlap && !reason)
      fail(
        'This territory overlaps an existing boundary. Supply an owner authorization reason to continue.',
      );
    if (!active && (await territoryHasActiveRoutes(client, id)))
      fail(
        'Reassign or deactivate active routes before deactivating this territory.',
      );
    const result = await writeTerritory(
      client,
      {
        id,
        agencyId: ctx.agent!.agencyId,
        name,
        locality,
        localityKey: locality.toLocaleLowerCase('en'),
        pinCodes: pins,
        sectors,
        sectorKeys: keys,
        active,
      },
      Boolean(input.id),
    );
    await audit(
      client,
      ctx,
      'territory',
      id,
      active && overlap
        ? 'territory.overlap_authorized'
        : input.id
          ? 'territory.updated'
          : 'territory.created',
      { reason: reason ?? null, version: result.version },
    );
    return result;
  });
}

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
import { nextCode } from '../counter.js';
import { parseMoney } from '../money.js';
import { fingerprint, receiveDeposit } from '../deposits/service.js';
import {
  creationRequest,
  findStop,
  linkStop,
  lockResident,
  readResidents,
  residentStop,
  routeSectorChoices,
  touchRoutes,
  writeResident,
} from './repository.js';
export interface ResidentInput {
  id?: string;
  version?: number;
  requestId?: string;
  name: string;
  address: string;
  phone: string;
  sector: string;
  routeId: string;
  dropOrder: number;
  status?: string;
  openingDeposit?: string;
  stopId?: string;
}
export const residents = (ctx: RequestContext) =>
  agencyRead(ctx, (client) => readResidents(client));
export function saveResident(ctx: RequestContext, input: ResidentInput) {
  return configMutation(ctx, async (client) => {
    const name = cleanText(input.name, 'resident name'),
      address = cleanText(input.address, 'address', 240),
      sectorInput = cleanText(input.sector, 'sector');
    let phone = cleanText(input.phone, 'phone number', 30).replace(
      /[\s()-]/g,
      '',
    );
    if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      return fail('Enter a valid phone number with country code.');
    if (
      !Number.isInteger(input.dropOrder) ||
      input.dropOrder < 1 ||
      input.dropOrder > 99999
    )
      return fail('Choose a positive delivery drop position.');
    const routeId = idValue(input.routeId),
      amount = parseMoney(input.openingDeposit ?? '0');
    const id = input.id ? idValue(input.id) : randomUUID(),
      old = input.id ? await lockResident(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Resident not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      if (old.status === 'CLOSED')
        return fail('Archived accounts cannot be edited.');
      if (amount > 0n) return fail('Record additional deposits separately.');
    }
    const status = input.status ?? old?.status ?? 'ACTIVE';
    if (
      !['ACTIVE', 'INACTIVE'].includes(status) &&
      !(old?.status === 'SUSPENDED' && status === 'SUSPENDED')
    )
      return fail('Choose an active or inactive resident status.');
    const requestId = input.id ? '' : idValue(input.requestId);
    const hash = fingerprint({
      name,
      address,
      phone,
      sector: sectorInput.toLocaleLowerCase('en'),
      routeId,
      dropOrder: input.dropOrder,
      status,
      openingDeposit: amount.toString(),
      stopId: input.stopId ?? null,
    });
    if (!input.id) {
      const previous = await creationRequest(client, requestId);
      if (previous) {
        if (previous.fingerprint !== hash)
          return fail(
            'This request identifier was used for different resident details.',
            'CONFLICT',
          );
        return (await readResidents(client, previous.id))[0];
      }
    }
    const route = await routeSectorChoices(client, routeId);
    if (!route) return fail('Route not found.', 'NOT_FOUND');
    if (
      !route.active &&
      (status === 'ACTIVE' || !old || old.routeId !== routeId)
    )
      return fail('Choose an active delivery route.');
    const sector = route.sectors.find(
      (s) => s.toLocaleLowerCase('en') === sectorInput.toLocaleLowerCase('en'),
    );
    if (!sector) return fail('Choose a sector inside this route territory.');
    const current = old ? await residentStop(client, id) : undefined;
    const selected = await findStop(client, routeId, input.dropOrder);
    if (selected && selected.id !== current?.id && selected.id !== input.stopId)
      return fail(
        'This delivery position is already occupied. Choose another position or explicitly link its existing point.',
      );
    if (
      input.stopId &&
      (!selected ||
        selected.id !== idValue(input.stopId) ||
        selected.residentId)
    )
      return fail('That existing delivery point is unavailable.');
    if (old && input.stopId && input.stopId !== current?.id)
      return fail(
        'Move the existing resident point instead of linking a different point.',
      );
    const stop = current ?? (input.stopId ? selected : undefined);
    await writeResident(
      client,
      {
        id,
        agencyId: ctx.agent!.agencyId,
        code:
          old?.code ??
          (await nextCode(client, ctx.agent!.agencyId, 'resident', 'RES-')),
        name,
        address,
        phone,
        sector,
        routeId,
        status,
        requestId,
        fingerprint: hash,
      },
      Boolean(old),
    );
    await linkStop(
      client,
      ctx.agent!.agencyId,
      id,
      stop?.id ?? randomUUID(),
      routeId,
      name,
      address,
      input.dropOrder,
      Boolean(stop),
    );
    await touchRoutes(client, [routeId, ...(old ? [old.routeId] : [])]);
    if (!old && amount > 0n)
      await receiveDeposit(client, ctx, id, requestId, amount, 'opening');
    const result = (await readResidents(client, id))[0];
    await audit(
      client,
      ctx,
      'resident',
      id,
      old ? 'resident.updated' : 'resident.created',
      { routeId, status, version: result.version },
    );
    return result;
  });
}

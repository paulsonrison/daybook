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

export interface StaffInput {
  id?: string;
  version?: number;
  name: string;
  staffCode: string;
  phone: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
}
import {
  listStaff,
  findStaff,
  staffHasActiveRoutes,
  writeStaff,
} from './repository.js';
export const staff = (ctx: RequestContext) => agencyRead(ctx, listStaff);
export function saveStaff(ctx: RequestContext, input: StaffInput) {
  return configMutation(ctx, async (client) => {
    const name = cleanText(input.name, 'staff name'),
      code = cleanText(input.staffCode, 'staff ID', 40).toUpperCase();
    let phone = cleanText(input.phone, 'phone number', 30).replace(
      /[\s()-]/g,
      '',
    );
    if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      fail('Enter a valid phone number with country code.');
    if (!['ACTIVE', 'ON_LEAVE', 'INACTIVE'].includes(input.status))
      fail('Choose a valid staff status.');
    const id = input.id ? idValue(input.id) : randomUUID();
    if (input.id) {
      const old = await findStaff(client, id, true);
      if (!old) fail('Staff record not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      if (input.status === 'INACTIVE') {
        const assigned = await staffHasActiveRoutes(client, id);
        if (assigned)
          fail('Reassign active routes before deactivating this staff member.');
      }
    }
    const result = await writeStaff(
      client,
      ctx.agent!.agencyId,
      { id, name, staffCode: code, phone, status: input.status },
      Boolean(input.id),
    );
    await audit(
      client,
      ctx,
      'staff',
      id,
      input.id ? 'staff.updated' : 'staff.created',
      { status: input.status, version: result.version },
    );
    return result;
  });
}

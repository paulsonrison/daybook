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
import { findDelivery, updateDelivery } from '../delivery/repository.js';
import { moneyString, parseMoney } from '../money.js';
import {
  closeComplaint,
  findComplaint,
  insertComplaint,
  readComplaints,
  hasBenefit,
} from './repository.js';
export const complaints = (ctx: RequestContext) =>
  agencyRead(ctx, readComplaints);
export interface ComplaintInput {
  requestId: string;
  deliveryId: string;
  kind: string;
  note: string;
}
export function recordComplaint(ctx: RequestContext, input: ComplaintInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'complaint.create',
      input,
      async () => {
        const log = await findDelivery(c, idValue(input.deliveryId));
        if (!log) return fail('Delivery not found.', 'NOT_FOUND');
        if (!['MISSED', 'DAMAGED', 'LATE'].includes(input.kind))
          return fail('Choose a valid complaint type.');
        const note = cleanText(input.note, 'complaint details', 1000),
          id = randomUUID();
        const result = await insertComplaint(
          c,
          ctx.agent!.agencyId,
          id,
          log.id,
          input.kind,
          note,
        );
        await audit(c, ctx, 'complaint', id, 'complaint.created', {
          deliveryId: log.id,
          kind: input.kind,
        });
        return result;
      },
    ),
  );
}
export interface ComplaintResolutionInput {
  rating?: number | null;
  requestId: string;
  id: string;
  version: number;
  resolution: string;
  note: string;
}
export function resolveComplaint(
  ctx: RequestContext,
  input: ComplaintResolutionInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'complaint.resolve',
      input,
      async () => {
        const complaint = await findComplaint(c, idValue(input.id));
        if (
          input.rating != null &&
          (!Number.isInteger(input.rating) ||
            input.rating < 1 ||
            input.rating > 5)
        )
          return fail('Resident feedback must be a rating from one to five.');
        if (!complaint) return fail('Complaint not found.', 'NOT_FOUND');
        versionMatches(complaint.version, input.version);
        if (complaint.status !== 'OPEN')
          return fail('This complaint has already been resolved.', 'CONFLICT');
        if (
          !['REPLACEMENT', 'CREDIT', 'UNSUBSTANTIATED'].includes(
            input.resolution,
          )
        )
          return fail('Choose a valid resolution.');
        const note = cleanText(input.note, 'resolution details', 1000),
          delivery = await findDelivery(c, complaint.deliveryId);
        if (!delivery) return fail('Delivery not found.', 'NOT_FOUND');
        if (
          input.resolution === 'REPLACEMENT' &&
          (await hasBenefit(c, delivery.id, 'REPLACEMENT'))
        )
          return fail(
            'This delivery already received its replacement.',
            'CONFLICT',
          );
        if (
          input.resolution === 'CREDIT' &&
          (await hasBenefit(c, delivery.id, 'CREDIT'))
        )
          return fail(
            'This delivery already received a credit resolution.',
            'CONFLICT',
          );
        const copies =
            input.resolution === 'REPLACEMENT' ? delivery.quantity : 0,
          credit =
            input.resolution === 'CREDIT'
              ? delivery.pricePaise * BigInt(delivery.quantity)
              : 0n;
        parseMoney(moneyString(credit));
        if (input.resolution !== 'UNSUBSTANTIATED')
          await updateDelivery(
            c,
            delivery.id,
            input.resolution === 'REPLACEMENT' ? 'REPLACED' : 'CREDITED',
            'COMPLAINT',
            note,
            input.resolution === 'REPLACEMENT' ? delivery.quantity : 0,
          );
        const result = await closeComplaint(
          c,
          complaint.id,
          input.resolution,
          note,
          copies,
          credit,
          input.rating ?? null,
        );
        await audit(c, ctx, 'complaint', complaint.id, 'complaint.resolved', {
          resolution: input.resolution,
          replacementCopies: copies,
          credit: moneyString(credit),
        });
        return result;
      },
    ),
  );
}

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
import { parseMoney } from '../money.js';
import {
  findPublication,
  listPublications,
  writePublication,
  hasActiveSubscriptions,
} from './repository.js';
export interface PublicationInput {
  id?: string;
  version?: number;
  name: string;
  edition: string;
  kind: string;
  language: string;
  dispatch: string;
  frequency: string;
  publishingDays: number[];
  anchorDate?: string | null;
  weekdayPrice: string;
  weekendPrice: string;
  procurementNetCost?: string | null;
  active?: boolean;
}
export const publications = (ctx: RequestContext) =>
  agencyRead(ctx, listPublications);
export function savePublication(ctx: RequestContext, input: PublicationInput) {
  return configMutation(ctx, async (client) => {
    const name = cleanText(input.name, 'publication name'),
      edition = cleanText(input.edition, 'edition', 100),
      language = cleanText(input.language, 'publication language', 40);
    if (
      !['NEWSPAPER', 'MAGAZINE', 'PERIODICAL', 'SUPPLEMENT'].includes(
        input.kind,
      ) ||
      !['MORNING', 'EVENING'].includes(input.dispatch) ||
      !['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'YEARLY'].includes(
        input.frequency,
      )
    )
      return fail('Choose valid publication and publishing options.');
    if (
      !Array.isArray(input.publishingDays) ||
      !input.publishingDays.length ||
      input.publishingDays.length > 7 ||
      input.publishingDays.some((v) => !Number.isInteger(v) || v < 0 || v > 6)
    )
      return fail('Choose valid publishing weekdays.');
    const anchor = input.anchorDate ?? null;
    if (
      anchor &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
        !Number.isFinite(Date.parse(`${anchor}T00:00:00Z`)) ||
        new Date(`${anchor}T00:00:00Z`).toISOString().slice(0, 10) !== anchor)
    )
      return fail('Choose a valid publishing anchor date.');
    if (
      ['FORTNIGHTLY', 'MONTHLY', 'YEARLY'].includes(input.frequency) &&
      !anchor
    )
      return fail('This publication frequency needs an anchor issue date.');
    const id = input.id ? idValue(input.id) : randomUUID(),
      old = input.id ? await findPublication(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Publication not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      const calendarChanged =
        old.frequency !== input.frequency ||
        old.anchorDate !== anchor ||
        JSON.stringify([...old.publishingDays].sort()) !==
          JSON.stringify([...new Set(input.publishingDays)].sort());
      if (calendarChanged && (await hasActiveSubscriptions(client, id)))
        return fail(
          'Pause or cancel active subscriptions before changing the publication issue calendar, then validate their new schedules.',
        );
    }
    const result = await writePublication(
      client,
      {
        id,
        agencyId: ctx.agent!.agencyId,
        name,
        edition,
        kind: input.kind,
        language,
        dispatch: input.dispatch,
        frequency: input.frequency,
        publishingDays: [...new Set(input.publishingDays)].sort(),
        anchorDate: anchor,
        weekdayPaise: parseMoney(input.weekdayPrice),
        weekendPaise: parseMoney(input.weekendPrice),
        procurementPaise:
          input.procurementNetCost == null
            ? null
            : parseMoney(input.procurementNetCost),
        active: input.active ?? old?.active ?? true,
      },
      Boolean(input.id),
    );
    await audit(
      client,
      ctx,
      'publication',
      id,
      input.id ? 'publication.updated' : 'publication.created',
      { version: result.version },
    );
    return result;
  });
}

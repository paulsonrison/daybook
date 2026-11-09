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
import { findPublication } from '../publications/repository.js';
import { calendarDate } from '../scheduling/calendar.js';
import { parseMoney } from '../money.js';
import { findPrice, readPrices, writePrice } from './repository.js';
export interface PriceInput {
  id?: string;
  version?: number;
  publicationId: string;
  startDate: string;
  endDate?: string | null;
  weekdays: number[];
  price: string;
  active?: boolean;
}
export const priceRules = (ctx: RequestContext, publicationId?: string) =>
  agencyRead(ctx, (c) =>
    readPrices(c, publicationId ? idValue(publicationId) : undefined),
  );
export function savePriceRule(ctx: RequestContext, input: PriceInput) {
  return configMutation(ctx, async (client) => {
    const publicationId = idValue(input.publicationId),
      id = input.id ? idValue(input.id) : randomUUID();
    calendarDate(input.startDate);
    const endDate = input.endDate ?? null;
    if (endDate) {
      calendarDate(endDate);
      if (endDate < input.startDate)
        return fail('Price validity ends before its start.');
    }
    if (
      !Array.isArray(input.weekdays) ||
      input.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      new Set(input.weekdays).size !== input.weekdays.length
    )
      return fail('Choose valid distinct pricing weekdays.');
    if (!input.weekdays.length && !endDate)
      return fail('Date-based prices need a bounded validity period.');
    if (!(await findPublication(client, publicationId)))
      return fail('Publication not found.', 'NOT_FOUND');
    const old = input.id ? await findPrice(client, id) : undefined;
    if (input.id) {
      if (!old) return fail('Price rule not found.', 'NOT_FOUND');
      versionMatches(old.version, input.version);
      if (old.publicationId !== publicationId)
        return fail(
          'Create a separate price rule for a different publication.',
        );
    }
    const active = input.active ?? old?.active ?? true,
      rank = !input.weekdays.length ? 3 : endDate ? 2 : 1;
    if (active)
      for (const rule of await readPrices(client, publicationId)) {
        if (
          rule.id === id ||
          !rule.active ||
          (!rule.weekdays.length ? 3 : rule.endDate ? 2 : 1) !== rank
        )
          continue;
        if (
          (endDate && endDate < rule.startDate) ||
          (rule.endDate && rule.endDate < input.startDate)
        )
          continue;
        const from =
            input.startDate > rule.startDate ? input.startDate : rule.startDate,
          to = !endDate
            ? rule.endDate
            : !rule.endDate
              ? endDate
              : endDate < rule.endDate
                ? endDate
                : rule.endDate;
        for (let day = 0; day < 7; day++)
          if (
            (!input.weekdays.length || input.weekdays.includes(day)) &&
            (!rule.weekdays.length || rule.weekdays.includes(day))
          ) {
            const first = calendarDate(from);
            first.setUTCDate(
              first.getUTCDate() + ((day - first.getUTCDay() + 7) % 7),
            );
            if (!to || first.toISOString().slice(0, 10) <= to)
              return fail(
                'An equal-priority price rule already covers these dates.',
                'CONFLICT',
              );
          }
      }
    const result = await writePrice(
      client,
      ctx.agent!.agencyId,
      {
        id,
        publicationId,
        startDate: input.startDate,
        endDate,
        weekdays: input.weekdays,
        pricePaise: parseMoney(input.price),
        active,
      },
      Boolean(old),
    );
    await audit(
      client,
      ctx,
      'price_rule',
      id,
      old ? 'price.updated' : 'price.created',
      { version: result.version },
    );
    return result;
  });
}

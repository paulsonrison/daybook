import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { onceRequest } from '../requests.js';
import { approvedTemplate } from './templates.js';
export type Locale = 'en' | 'ml' | 'hi';
export interface ContactPreferenceInput {
  requestId: string;
  residentId: string;
  version: number;
  locale: string;
  whatsapp: boolean;
  sms: boolean;
  confirmedConsent: boolean;
  evidence: string;
}
export interface ContactAttemptInput {
  requestId: string;
  residentId: string;
  channel: string;
}
export interface CommunicationSettingsInput {
  requestId: string;
  version: number;
  remindersEnabled: boolean;
  frequencyDays: number;
  cooldownHours: number;
  reminderChannel: string;
  templates?: unknown[];
  confirmTemplatesApproved?: boolean;
}
export function phoneValue(value: unknown) {
  const phone = cleanText(value, 'international phone number', 20);
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    fail('A valid international phone number is required.');
  return phone;
}
export async function contactResident(c: PoolClient, residentId: string) {
  idValue(residentId);
  const r = (
    await c.query<{ id: string; name: string; phone: string; status: string }>(
      'SELECT id,name,phone,status FROM daybook.residents WHERE id=$1',
      [residentId],
    )
  ).rows[0];
  if (!r) fail('Resident not found.', 'NOT_FOUND');
  return r;
}
export async function readContactPreference(c: PoolClient, residentId: string) {
  const resident = await contactResident(c, residentId),
    r = (
      await c.query<{
        residentId: string;
        locale: Locale;
        whatsapp: boolean;
        sms: boolean;
        phoneSnapshot: string;
        evidence: string;
        version: number;
        updatedAt: Date;
      }>(
        `SELECT resident_id AS "residentId",locale,whatsapp,sms,phone_snapshot AS "phoneSnapshot",consent_evidence AS evidence,version,updated_at AS "updatedAt" FROM daybook.contact_preferences WHERE resident_id=$1`,
        [residentId],
      )
    ).rows[0];
  return r
    ? {
        ...r,
        updatedAt: r.updatedAt.toISOString(),
        needsConsentRenewal:
          (r.whatsapp || r.sms) && r.phoneSnapshot !== resident.phone,
      }
    : {
        residentId,
        locale: 'en' as Locale,
        whatsapp: false,
        sms: false,
        phoneSnapshot: null,
        evidence: '',
        version: 0,
        updatedAt: null,
        needsConsentRenewal: false,
      };
}
export const contactPreference = (ctx: RequestContext, residentId: string) =>
  financialRead(ctx, (c) => readContactPreference(c, residentId));
export function saveContactPreference(
  ctx: RequestContext,
  i: ContactPreferenceInput,
) {
  return configMutation(ctx, async (c) => {
    await onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'contact.preference',
      i,
      async () => {
        const resident = await contactResident(c, i.residentId),
          old = await readContactPreference(c, i.residentId);
        versionMatches(old.version, i.version);
        if (!['en', 'ml', 'hi'].includes(i.locale))
          fail('Choose English, Malayalam or Hindi.');
        if ((i.whatsapp || i.sms) && i.confirmedConsent !== true)
          fail(
            'Explicitly confirm the resident requested automated messages on the selected channels.',
          );
        const phone = phoneValue(resident.phone),
          evidence = cleanText(i.evidence, 'consent or opt-out evidence', 500);
        await c.query(
          'INSERT INTO daybook.contact_preferences(agency_id,resident_id,locale,whatsapp,sms,phone_snapshot,consent_evidence,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(agency_id,resident_id) DO UPDATE SET locale=excluded.locale,whatsapp=excluded.whatsapp,sms=excluded.sms,phone_snapshot=excluded.phone_snapshot,consent_evidence=excluded.consent_evidence,confirmed_by=excluded.confirmed_by,version=contact_preferences.version+1,updated_at=now()',
          [
            ctx.agent!.agencyId,
            resident.id,
            i.locale,
            i.whatsapp,
            i.sms,
            phone,
            evidence,
            ctx.agent!.id,
          ],
        );
        await c.query(
          "UPDATE daybook.notification_intents SET status='CANCELLED',last_error='CHANNEL_CONSENT_WITHDRAWN',lease_until=NULL WHERE resident_id=$1 AND status IN('PENDING','CLAIMED') AND ((channel='WHATSAPP' AND NOT $2::boolean) OR (channel='SMS' AND NOT $3::boolean))",
          [resident.id, i.whatsapp, i.sms],
        );
        await audit(c, ctx, 'contact_preference', resident.id, 'RECORDED', {
          locale: i.locale,
          whatsapp: i.whatsapp,
          sms: i.sms,
          evidence,
        });
        return { residentId: resident.id };
      },
    );
    return readContactPreference(c, i.residentId);
  });
}
export async function readCommunicationSettings(c: PoolClient) {
  const r = (
    await c.query<{
      version: number;
      remindersEnabled: boolean;
      frequencyDays: number;
      cooldownHours: number;
      reminderChannel: string;
      templates: unknown[];
    }>(
      `SELECT version,reminders_enabled AS "remindersEnabled",frequency_days AS "frequencyDays",cooldown_hours AS "cooldownHours",reminder_channel AS "reminderChannel",templates FROM daybook.communication_settings`,
    )
  ).rows[0];
  return {
    ...(r ?? {
      version: 0,
      remindersEnabled: false,
      frequencyDays: 7,
      cooldownHours: 24,
      reminderChannel: 'WHATSAPP',
      templates: [],
    }),
    whatsappStatus: 'NOT_CONFIGURED',
    smsStatus: 'NOT_CONFIGURED',
  };
}
export const communicationSettings = (ctx: RequestContext) =>
  financialRead(ctx, async (c) => ({
    ...(await readCommunicationSettings(c)),
    whatsappStatus:
      ctx.providers?.get(ctx.agent!.agencyId, 'WHATSAPP').status ??
      'NOT_CONFIGURED',
    smsStatus:
      ctx.providers?.get(ctx.agent!.agencyId, 'SMS').status ?? 'NOT_CONFIGURED',
  }));
export function saveCommunicationSettings(
  ctx: RequestContext,
  i: CommunicationSettingsInput,
) {
  return configMutation(ctx, async (c) => {
    await onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'communications.settings',
      i,
      async () => {
        const old = await readCommunicationSettings(c);
        versionMatches(old.version, i.version);
        let templates = old.templates;
        if (i.templates !== undefined) {
          if (!Array.isArray(i.templates) || i.templates.length > 9)
            fail(
              'Configure one template for each supported message kind and language.',
            );
          if (i.templates.length && !i.confirmTemplatesApproved)
            fail(
              'Confirm these templates are approved in the provider account.',
            );
          try {
            templates = i.templates.map(approvedTemplate);
          } catch (error) {
            fail((error as Error).message);
          }
          const keys = templates.map((value) => {
            const template = approvedTemplate(value);
            return `${template.kind}:${template.locale}`;
          });
          if (new Set(keys).size !== keys.length)
            fail('Use one approved template per message kind and language.');
        }
        if (
          !Number.isInteger(i.frequencyDays) ||
          i.frequencyDays < 1 ||
          i.frequencyDays > 365 ||
          !Number.isInteger(i.cooldownHours) ||
          i.cooldownHours < 1 ||
          i.cooldownHours > 720 ||
          !['WHATSAPP', 'SMS'].includes(i.reminderChannel)
        )
          fail('Choose valid reminder frequency, cooldown and channel.');
        await c.query(
          'INSERT INTO daybook.communication_settings(agency_id,reminders_enabled,frequency_days,cooldown_hours,reminder_channel,templates) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id) DO UPDATE SET reminders_enabled=excluded.reminders_enabled,frequency_days=excluded.frequency_days,cooldown_hours=excluded.cooldown_hours,reminder_channel=excluded.reminder_channel,templates=excluded.templates,version=communication_settings.version+1',
          [
            ctx.agent!.agencyId,
            i.remindersEnabled,
            i.frequencyDays,
            i.cooldownHours,
            i.reminderChannel,
            JSON.stringify(templates),
          ],
        );
        await audit(
          c,
          ctx,
          'communication_settings',
          ctx.agent!.agencyId,
          'SAVED',
          {
            remindersEnabled: i.remindersEnabled,
            frequencyDays: i.frequencyDays,
            cooldownHours: i.cooldownHours,
            reminderChannel: i.reminderChannel,
            templates,
            templatesApprovalConfirmed: i.confirmTemplatesApproved === true,
          },
        );
        return { id: ctx.agent!.agencyId };
      },
    );
    return {
      ...(await readCommunicationSettings(c)),
      whatsappStatus:
        ctx.providers?.get(ctx.agent!.agencyId, 'WHATSAPP').status ??
        'NOT_CONFIGURED',
      smsStatus:
        ctx.providers?.get(ctx.agent!.agencyId, 'SMS').status ??
        'NOT_CONFIGURED',
    };
  });
}
const greetings: Record<Locale, (name: string, agency: string) => string> = {
  en: (n, a) => `Hello ${n}, this is ${a}.`,
  ml: (n, a) => `നമസ്കാരം ${n}, ${a} ആണ്.`,
  hi: (n, a) => `नमस्ते ${n}, यह ${a} है।`,
};
export const contactLinks = (ctx: RequestContext, residentId: string) =>
  financialRead(ctx, async (c) => {
    const resident = await contactResident(c, residentId),
      preference = await readContactPreference(c, residentId),
      phone = phoneValue(resident.phone),
      text = greetings[preference.locale](
        resident.name,
        ctx.agent!.agency.name,
      );
    return {
      tel: `tel:${phone}`,
      whatsapp: `https://wa.me/${phone.slice(1)}?${new URLSearchParams({ text })}`,
    };
  });
export function recordContactAttempt(
  ctx: RequestContext,
  i: ContactAttemptInput,
) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'contact.attempt',
      i,
      async () => {
        const resident = await contactResident(c, i.residentId);
        if (!['CALL', 'WHATSAPP'].includes(i.channel))
          fail('Choose a call or direct WhatsApp contact.');
        const id = randomUUID();
        await c.query(
          'INSERT INTO daybook.contact_attempts(id,agency_id,resident_id,request_id,channel,phone_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            id,
            ctx.agent!.agencyId,
            resident.id,
            i.requestId,
            i.channel,
            phoneValue(resident.phone),
            ctx.agent!.id,
          ],
        );
        await audit(c, ctx, 'resident', resident.id, 'CONTACT_ATTEMPT', {
          channel: i.channel,
          outcome: 'ATTEMPTED',
        });
        return { id, outcome: 'ATTEMPTED' };
      },
    ),
  );
}
export interface CommunicationCursor {
  id: string;
  createdAt: string;
}
export const communicationHistory = (
  ctx: RequestContext,
  residentId: string,
  attemptsBefore?: CommunicationCursor | null,
  messagesBefore?: CommunicationCursor | null,
) =>
  financialRead(ctx, async (c) => {
    await contactResident(c, residentId);
    async function page(
      table: 'contact_attempts' | 'notification_intents',
      cursor?: CommunicationCursor | null,
    ) {
      if (cursor) {
        idValue(cursor.id);
        if (
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
            cursor.createdAt,
          ) ||
          !Number.isFinite(Date.parse(cursor.createdAt)) ||
          new Date(cursor.createdAt).toISOString() !== cursor.createdAt
        )
          fail('Use a valid contact history cursor.');
      }
      const columns =
        table === 'contact_attempts'
          ? 'channel,outcome'
          : 'kind,channel,status';
      const rows = (
        await c.query(
          `SELECT id,${columns},created_at AS "createdAt" FROM daybook.${table} WHERE resident_id=$1 ${cursor ? "AND (date_trunc('milliseconds',created_at),id)<($2::timestamptz,$3::uuid)" : ''} ORDER BY date_trunc('milliseconds',created_at) DESC,id DESC LIMIT 201`,
          cursor ? [residentId, cursor.createdAt, cursor.id] : [residentId],
        )
      ).rows;
      return {
        hasMore: rows.length > 200,
        items: rows
          .slice(0, 200)
          .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      };
    }
    const attempts = await page('contact_attempts', attemptsBefore),
      messages = await page('notification_intents', messagesBefore);
    return {
      attempts: attempts.items,
      messages: messages.items,
      attemptsHasMore: attempts.hasMore,
      messagesHasMore: messages.hasMore,
    };
  });

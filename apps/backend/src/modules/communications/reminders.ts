import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { agencyToday } from '../delivery/repository.js';
import { financialResidents } from '../reports/financial-residents.js';
import { moneyString } from '../money.js';
import { readCommunicationSettings, readContactPreference } from './service.js';
import type { ProviderRegistry } from './config.js';
import { approvedTemplate } from './templates.js';
import { prepareAccountNotice } from './account-notices.js';
/** One current-date evaluation; missed dates never expand into catch-up sends. */
export function evaluateReminders(
  pool: Pool,
  agencyId: string,
  providers: ProviderRegistry,
  now = new Date(),
) {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    const date = await agencyToday(c, now),
      settings = await readCommunicationSettings(c);
    if (!settings.remindersEnabled) return { date, created: 0 };
    await c.query(
      "UPDATE daybook.notification_intents SET status='STALE',last_error='PREVIOUS_REMINDER_DATE',lease_until=NULL WHERE kind='REMINDER' AND status IN('PENDING','CLAIMED','WAITING_DOCUMENT') AND payload->>'sourceDate'<$1",
      [date],
    );
    await c.query(
      'INSERT INTO daybook.communication_evaluations(agency_id,evaluation_date) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [agencyId, date],
    );
    const evaluation = (
      await c.query<{ afterId: string | null; completed: boolean }>(
        'SELECT after_resident_id AS "afterId",completed FROM daybook.communication_evaluations WHERE evaluation_date=$1 FOR UPDATE',
        [date],
      )
    ).rows[0];
    if (evaluation.completed) return { date, created: 0 };
    const agency = (
      await c.query<{ name: string }>(
        'SELECT name FROM daybook.agencies WHERE id=$1',
        [agencyId],
      )
    ).rows[0].name;
    let created = 0;
    const residents = await financialResidents(c, date, {
      afterId: evaluation.afterId,
      limit: 25,
    });
    for (const resident of residents) {
      if (
        resident.status !== 'ACTIVE' ||
        !resident.routeActive ||
        resident.balancePaise <= 0n ||
        resident.overduePaise <= 0n
      )
        continue;
      const unresolved = await c.query(
        "SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND status IN('PENDING','CLAIMED','SUBMITTING','UNKNOWN','UNKNOWN_CLOSED','WAITING_DOCUMENT') LIMIT 1",
        [resident.residentId, settings.reminderChannel],
      );
      if (unresolved.rowCount) continue;
      const recent = await c.query(
        "SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND status IN('ACCEPTED','DELIVERED','READ','SENT','OWNER_ACCEPTED') AND (coalesce(accepted_at,created_at)>$3::timestamptz-($4::integer*interval '1 hour') OR (kind='REMINDER' AND coalesce(accepted_at,created_at)>$3::timestamptz-($5::integer*interval '24 hours'))) LIMIT 1",
        [
          resident.residentId,
          settings.reminderChannel,
          now,
          settings.cooldownHours,
          settings.frequencyDays,
        ],
      );
      if (recent.rowCount) continue;
      const preference = await readContactPreference(c, resident.residentId),
        provider = providers.get(
          agencyId,
          settings.reminderChannel === 'SMS' ? 'SMS' : 'WHATSAPP',
        );
      const template = settings.templates
        .map(approvedTemplate)
        .find(
          (item) =>
            item.kind === 'REMINDER' && item.locale === preference.locale,
        );
      let status = 'WAITING_DOCUMENT',
        reason = 'GENERATED_DOCUMENT_AND_LINK_REQUIRED';
      if (provider.status !== 'CONFIGURED') {
        status = 'NOT_CONFIGURED';
        reason =
          provider.status === 'NOT_CONFIGURED'
            ? 'PROVIDER_NOT_CONFIGURED'
            : 'PROVIDER_CONFIGURATION_ERROR';
      } else if (
        !(settings.reminderChannel === 'SMS'
          ? preference.sms
          : preference.whatsapp) ||
        preference.needsConsentRenewal
      ) {
        status = 'NO_CONSENT';
        reason = 'CURRENT_CHANNEL_CONSENT_REQUIRED';
      } else if (!/^\+[1-9]\d{7,14}$/.test(resident.phone)) {
        status = 'INVALID_RECIPIENT';
        reason = 'INTERNATIONAL_PHONE_REQUIRED';
      } else if (settings.reminderChannel === 'WHATSAPP' && !template) {
        status = 'MISSING_TEMPLATE';
        reason = 'APPROVED_REMINDER_TEMPLATE_REQUIRED';
      }
      const id = randomUUID();
      const document =
        status === 'WAITING_DOCUMENT'
          ? await prepareAccountNotice(
              c,
              agencyId,
              agency,
              resident,
              preference.locale,
              date,
            )
          : null;
      if (status === 'WAITING_DOCUMENT' && !document) {
        status = 'NOT_CONFIGURED';
        reason = 'PAYMENT_OR_PUBLIC_DOCUMENT_CONFIGURATION_REQUIRED';
      }
      await c.query(
        "INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,locale,payload,dedupe_key,status,created_by,actor_kind,last_error) VALUES($1,$2,$3,'REMINDER',$4,$5,$6,$7,$8,$9,NULL,'SYSTEM',$10)",
        [
          id,
          agencyId,
          resident.residentId,
          settings.reminderChannel,
          resident.phone,
          preference.locale,
          JSON.stringify({
            kind: 'REMINDER',
            agency,
            resident: resident.name,
            amount: moneyString(resident.balancePaise),
            overdueAmount: moneyString(resident.overduePaise),
            sourceDate: date,
            consentVersion: preference.version,
            template: template ?? null,
            ...(document ?? {}),
          }),
          `REMINDER:${date}:${resident.residentId}`,
          status,
          reason,
        ],
      );
      created++;
    }
    await c.query(
      'UPDATE daybook.communication_evaluations SET after_resident_id=$2,completed=$3 WHERE evaluation_date=$1',
      [
        date,
        residents.at(-1)?.residentId ?? evaluation.afterId,
        residents.length < 25,
      ],
    );
    return { date, created };
  });
}

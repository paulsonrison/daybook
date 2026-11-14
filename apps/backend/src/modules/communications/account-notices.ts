import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  audit,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { readMessages } from './dispatch.js';
import type { FinancialDocumentModel } from '@daybook/ui/documents';
import { withTenant } from '../../db/tenant.js';
import { agencyToday } from '../delivery/repository.js';
import {
  financialResidents,
  type FinancialResident,
} from '../reports/financial-residents.js';
import {
  readCollectionSettings,
  buildUpiIntent,
} from '../reports/collection.js';
import { snapshotHash } from '../documents/service.js';
import {
  createSystemDocumentLink,
  publicDocumentStatus,
  readDocumentLink,
} from '../documents/links.js';
import { moneyString } from '../money.js';
import {
  readCommunicationSettings,
  readContactPreference,
  type Locale,
} from './service.js';
import type { Channel, ProviderRegistry } from './config.js';
import {
  approvedTemplate,
  noticeText,
  providerTemplate,
  type NoticeKind,
} from './templates.js';
const labels = {
  en: {
    title: 'Account notice',
    date: 'Prepared date',
    amount: 'Account balance at preparation',
    overdue: 'Overdue at preparation',
    description: 'Description',
    quantity: 'Quantity',
    rate: 'Rate',
    total: 'Amount',
    note: 'Figures reflect preparation time. Later payments may change the balance. QR codes request payment and do not confirm receipt.',
  },
  ml: {
    title: 'അക്കൗണ്ട് അറിയിപ്പ്',
    date: 'തയ്യാറാക്കിയ തീയതി',
    amount: 'തയ്യാറാക്കിയ സമയത്തെ അക്കൗണ്ട് ബാലൻസ്',
    overdue: 'തയ്യാറാക്കിയ സമയത്തെ കുടിശ്ശിക',
    description: 'വിവരണം',
    quantity: 'എണ്ണം',
    rate: 'നിരക്ക്',
    total: 'തുക',
    note: 'തയ്യാറാക്കിയ സമയത്തെ കണക്കുകൾ. പിന്നീടുള്ള പണമടവുകൾ ബാലൻസ് മാറ്റിയേക്കാം. QR പണം ആവശ്യപ്പെടുന്നു; ലഭിച്ചതിന് തെളിവല്ല.',
  },
  hi: {
    title: 'खाता सूचना',
    date: 'तैयार करने की तारीख',
    amount: 'तैयारी के समय खाते की शेष राशि',
    overdue: 'तैयारी के समय बकाया',
    description: 'विवरण',
    quantity: 'मात्रा',
    rate: 'दर',
    total: 'राशि',
    note: 'आंकड़े तैयारी के समय के हैं। बाद के भुगतान से शेष राशि बदल सकती है। QR भुगतान का अनुरोध है, प्राप्ति का प्रमाण नहीं।',
  },
};
export async function queueCreditHoldNotice(
  c: PoolClient,
  ctx: RequestContext,
  residentId: string,
  requestId: string,
  reasonText: string,
) {
  return queueAccountNotice(
    c,
    ctx,
    residentId,
    requestId,
    reasonText,
    'CREDIT_HOLD',
    'WHATSAPP',
  );
}
export interface QueueReminderInput {
  requestId: string;
  residentId: string;
  channel: string;
}
export function queueReminder(ctx: RequestContext, input: QueueReminderInput) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'communications.manualReminder',
      input,
      async () => {
        idValue(input.residentId);
        if (!['SMS', 'WHATSAPP'].includes(input.channel))
          fail('Choose WhatsApp or SMS.');
        const result = await queueAccountNotice(
          c,
          ctx,
          input.residentId,
          input.requestId,
          'Owner requested an overdue account reminder',
          'REMINDER',
          input.channel as Channel,
        );
        await audit(c, ctx, 'message', result.id, 'MANUAL_REMINDER_PREPARED', {
          residentId: input.residentId,
          channel: input.channel,
          status: result.status,
        });
        return { id: result.id };
      },
    );
    return (await readMessages(c, [saved.id]))[0];
  });
}
async function queueAccountNotice(
  c: PoolClient,
  ctx: RequestContext,
  residentId: string,
  requestId: string,
  reasonText: string,
  kind: 'REMINDER' | 'CREDIT_HOLD',
  channel: Channel,
) {
  const agencyId = ctx.agent!.agencyId,
    date = await agencyToday(c);
  const resident = (await financialResidents(c, date)).find(
    (row) => row.residentId === residentId,
  );
  if (!resident) return fail('Resident not found.', 'NOT_FOUND');
  const preference = await readContactPreference(c, residentId),
    settings = await readCommunicationSettings(c);
  const provider = ctx.providers?.get(agencyId, channel);
  const template = settings.templates
    .map(approvedTemplate)
    .find((row) => row.kind === kind && row.locale === preference.locale);
  let status = 'WAITING_DOCUMENT',
    reason = 'GENERATED_DOCUMENT_AND_LINK_REQUIRED';
  if (
    resident.balancePaise <= 0n ||
    resident.overduePaise <= 0n ||
    !resident.routeActive ||
    resident.status !== (kind === 'REMINDER' ? 'ACTIVE' : 'SUSPENDED')
  ) {
    status = 'NOT_DUE';
    reason = 'NO_OUTSTANDING_BALANCE';
  } else if (provider?.status !== 'CONFIGURED') {
    status = 'NOT_CONFIGURED';
    reason = 'PROVIDER_NOT_CONFIGURED';
  } else if (
    !(channel === 'SMS' ? preference.sms : preference.whatsapp) ||
    preference.needsConsentRenewal
  ) {
    status = 'NO_CONSENT';
    reason = 'CURRENT_CHANNEL_CONSENT_REQUIRED';
  } else if (channel === 'WHATSAPP' && !template) {
    status = 'MISSING_TEMPLATE';
    reason = 'APPROVED_TEMPLATE_REQUIRED';
  }
  const unresolved = await c.query(
    "SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND status IN('PENDING','CLAIMED','SUBMITTING','UNKNOWN','UNKNOWN_CLOSED','WAITING_DOCUMENT') LIMIT 1",
    [residentId, channel],
  );
  if (status === 'WAITING_DOCUMENT' && unresolved.rowCount) {
    status = 'UNRESOLVED';
    reason = 'EXISTING_SEND_REQUIRES_RESOLUTION';
  }
  const document =
    status === 'WAITING_DOCUMENT'
      ? await prepareAccountNotice(
          c,
          agencyId,
          ctx.agent!.agency.name,
          resident,
          preference.locale,
          date,
          ctx.agent!.id,
        )
      : null;
  if (status === 'WAITING_DOCUMENT' && !document) {
    status = 'NOT_CONFIGURED';
    reason = 'PAYMENT_OR_PUBLIC_DOCUMENT_CONFIGURATION_REQUIRED';
  }
  const id = randomUUID();
  await c.query(
    'INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,locale,payload,dedupe_key,status,created_by,last_error) VALUES($1,$2,$3,$11,$12,$4,$5,$6,$7,$8,$9,$10)',
    [
      id,
      agencyId,
      residentId,
      resident.phone,
      preference.locale,
      JSON.stringify({
        kind,
        trigger: 'MANUAL',
        agency: ctx.agent!.agency.name,
        resident: resident.name,
        reason: reasonText,
        amount: moneyString(resident.balancePaise),
        overdueAmount: moneyString(resident.overduePaise),
        sourceDate: date,
        consentVersion: preference.version,
        template: template ?? null,
        ...(document ?? {}),
      }),
      `${kind}:${requestId}`,
      status,
      ctx.agent!.id,
      reason,
      kind,
      channel,
    ],
  );
  return { id, status };
}
export async function prepareAccountNotice(
  c: PoolClient,
  agencyId: string,
  agency: string,
  resident: FinancialResident,
  locale: Locale,
  date: string,
  actorId: string | null = null,
) {
  const settings = await readCollectionSettings(c);
  if (
    !settings.upiId ||
    !settings.payeeName ||
    publicDocumentStatus() !== 'CONFIGURED'
  )
    return null;
  const id = randomUUID(),
    reference = `ACCOUNT-${resident.code}-${date}`,
    l = labels[locale];
  const qr = await buildUpiIntent(
    settings,
    resident.balancePaise,
    reference,
    'Account balance at preparation',
  );
  const model: FinancialDocumentModel = {
    locale,
    kind: 'ACCOUNT_NOTICE',
    title: l.title,
    agencyName: agency,
    reference,
    preparedAt: new Date().toISOString(),
    subject: {
      name: resident.name,
      reference: resident.code,
      address: resident.address,
    },
    meta: [{ label: l.date, value: date }],
    columns: [l.description, l.quantity, l.rate, l.total],
    lines: [],
    totals: [
      { label: l.amount, amount: moneyString(resident.balancePaise) },
      { label: l.overdue, amount: moneyString(resident.overduePaise) },
    ],
    note: l.note,
    footer: l.note,
    ...qr,
  };
  const hash = snapshotHash(model);
  await c.query(
    "INSERT INTO daybook.documents(id,agency_id,kind,source_id,source_version,resident_id,locale,snapshot,snapshot_hash,filename,created_by,actor_kind) VALUES($1,$2,'ACCOUNT_NOTICE',$3,1,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      agencyId,
      resident.residentId,
      locale,
      JSON.stringify(model),
      hash,
      `account-${id}.pdf`,
      actorId,
      actorId ? 'AGENT' : 'SYSTEM',
    ],
  );
  const linkId = await createSystemDocumentLink(c, agencyId, id);
  return { documentId: id, linkId, documentSnapshotHash: hash };
}
export async function activateAccountNotices(pool: Pool, agencyId: string) {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    await c.query(
      "UPDATE daybook.notification_intents n SET status='FAILED',last_error='DOCUMENT_GENERATION_FAILED' WHERE n.status='WAITING_DOCUMENT' AND n.kind IN('REMINDER','CREDIT_HOLD') AND EXISTS(SELECT 1 FROM daybook.documents d WHERE d.id=(n.payload->>'documentId')::uuid AND d.status='FAILED' AND d.attempts>=3)",
    );
    await c.query(
      "UPDATE daybook.notification_intents n SET status='PENDING',last_error=NULL WHERE n.status='WAITING_DOCUMENT' AND n.kind IN('REMINDER','CREDIT_HOLD') AND EXISTS(SELECT 1 FROM daybook.documents d WHERE d.id=(n.payload->>'documentId')::uuid AND d.status='READY')",
    );
  });
}
export async function prepareAccountSubmission(
  c: PoolClient,
  agencyId: string,
  providers: ProviderRegistry,
  active: {
    id: string;
    residentId: string;
    recipient: string;
    channel: string;
    locale: string;
    payload: Record<string, unknown>;
  },
) {
  const blocked = (status: string, reason: string) => ({
    status,
    reason,
    prepared: null,
  });
  const p = active.payload,
    kind = p.kind as NoticeKind;
  if (!['REMINDER', 'CREDIT_HOLD'].includes(kind))
    return blocked('STALE', 'PREPARED_MESSAGE_CHANGED');
  const settings = await readCommunicationSettings(c),
    today = await agencyToday(c);
  if (
    kind === 'REMINDER' &&
    p.trigger !== 'MANUAL' &&
    !settings.remindersEnabled
  )
    return blocked('CANCELLED', 'REMINDERS_DISABLED');
  const resident = (await financialResidents(c, today)).find(
    (row) => row.residentId === active.residentId,
  );
  if (
    !resident ||
    resident.balancePaise <= 0n ||
    resident.overduePaise <= 0n ||
    !resident.routeActive ||
    resident.status !== (kind === 'REMINDER' ? 'ACTIVE' : 'SUSPENDED')
  )
    return blocked('NOT_DUE', 'NO_OUTSTANDING_BALANCE');
  const preference = await readContactPreference(c, resident.residentId);
  if (
    !(active.channel === 'SMS' ? preference.sms : preference.whatsapp) ||
    preference.needsConsentRenewal
  )
    return blocked('NO_CONSENT', 'CURRENT_CHANNEL_CONSENT_REQUIRED');
  const agency = (
    await c.query<{ name: string }>(
      'SELECT name FROM daybook.agencies WHERE id=$1',
      [agencyId],
    )
  ).rows[0].name;
  if (
    p.sourceDate !== today ||
    p.amount !== moneyString(resident.balancePaise) ||
    p.overdueAmount !== moneyString(resident.overduePaise) ||
    p.resident !== resident.name ||
    p.agency !== agency ||
    active.recipient !== resident.phone ||
    active.locale !== preference.locale ||
    p.consentVersion !== preference.version
  )
    return blocked('STALE', 'PREPARED_MESSAGE_CHANGED');
  const template = settings.templates
    .map(approvedTemplate)
    .find((item) => item.kind === kind && item.locale === preference.locale);
  if (active.channel === 'WHATSAPP' && !template)
    return blocked('MISSING_TEMPLATE', 'APPROVED_TEMPLATE_REQUIRED');
  if (
    active.channel === 'WHATSAPP' &&
    JSON.stringify(template) !== JSON.stringify(approvedTemplate(p.template))
  )
    return blocked('STALE', 'PREPARED_MESSAGE_CHANGED');
  const provider = providers.get(agencyId, active.channel as Channel);
  if (provider.status !== 'CONFIGURED')
    return blocked('NOT_CONFIGURED', 'PROVIDER_NOT_CONFIGURED');
  if (typeof p.documentId !== 'string' || typeof p.linkId !== 'string')
    return blocked('WAITING_DOCUMENT', 'GENERATED_DOCUMENT_AND_LINK_REQUIRED');
  const doc = (
    await c.query<{
      status: string;
      snapshot: FinancialDocumentModel;
      hash: string;
    }>(
      'SELECT status,snapshot,snapshot_hash AS hash FROM daybook.documents WHERE id=$1 AND resident_id=$2',
      [p.documentId, resident.residentId],
    )
  ).rows[0];
  if (!doc || doc.status !== 'READY')
    return blocked('WAITING_DOCUMENT', 'DOCUMENT_NOT_READY');
  if (
    doc.hash !== p.documentSnapshotHash ||
    snapshotHash(doc.snapshot) !== doc.hash ||
    doc.snapshot.subject.address !== resident.address
  )
    return blocked('STALE', 'DOCUMENT_FINANCIAL_SNAPSHOT_CHANGED');
  const collection = await readCollectionSettings(c);
  if (!doc.snapshot.upiUri) return blocked('STALE', 'PAYMENT_QR_MISSING');
  const upi = new URL(doc.snapshot.upiUri);
  if (
    upi.searchParams.get('pa') !== collection.upiId ||
    upi.searchParams.get('pn') !== collection.payeeName ||
    upi.searchParams.get('am') !== p.amount
  )
    return blocked('STALE', 'PAYMENT_IDENTITY_OR_AMOUNT_CHANGED');
  const link = await readDocumentLink(c, agencyId, p.linkId);
  if (
    link.documentId !== p.documentId ||
    !link.url ||
    link.status !== 'ACTIVE' ||
    new URL(link.url).protocol !== 'https:'
  )
    return blocked('STALE', 'SECURE_ACTIVE_DOCUMENT_LINK_REQUIRED');
  const recent = await c.query(
    "SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND id<>$3 AND status IN('ACCEPTED','DELIVERED','READ','SENT','OWNER_ACCEPTED') AND (coalesce(accepted_at,created_at)>now()-($4::integer*interval '1 hour') OR (kind='REMINDER' AND $5='REMINDER' AND coalesce(accepted_at,created_at)>now()-($6::integer*interval '24 hours'))) LIMIT 1",
    [
      resident.residentId,
      active.channel,
      active.id,
      settings.cooldownHours,
      kind,
      settings.frequencyDays,
    ],
  );
  if (recent.rowCount) return blocked('COOLDOWN', 'RECIPIENT_COOLDOWN');
  const values = {
    agency,
    resident: resident.name,
    amount: moneyString(resident.balancePaise),
    documentUrl: link.url,
    paymentUrl: doc.snapshot.upiUri,
  };
  return {
    status: 'PENDING',
    reason: null,
    prepared: {
      config: provider.transport,
      message: {
        recipient: active.recipient,
        body: noticeText(kind, preference.locale, values),
        ...(active.channel === 'WHATSAPP'
          ? {
              template: providerTemplate(
                template!,
                values,
                link.url + '/qr.png',
              ),
            }
          : {
              callbackUrl: `${new URL(link.url).origin}/webhooks/sms/${agencyId}?intent=${active.id}`,
            }),
      },
    },
  };
}

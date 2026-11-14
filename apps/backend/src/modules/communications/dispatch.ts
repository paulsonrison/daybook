import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FinancialDocumentModel } from '@daybook/ui/documents';
import {
  audit,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { invoiceView } from '../billing/service.js';
import { onceRequest } from '../requests.js';
import { readDocumentLink } from '../documents/links.js';
import { readCollectionSettings } from '../reports/collection.js';
import { parseMoney } from '../money.js';
import {
  readCommunicationSettings,
  readContactPreference,
  contactResident,
  type Locale,
} from './service.js';
import { approvedTemplate, type ApprovedTemplate } from './templates.js';
import type { Channel, ProviderRegistry } from './config.js';

export interface InvoiceMessageItem {
  invoiceId: string;
  version: number;
  documentId?: string | null;
  linkId?: string | null;
}
export interface InvoiceMessageBatchInput {
  requestId: string;
  channel: string;
  items: InvoiceMessageItem[];
}
export interface InvoiceNoticePayload {
  kind: 'INVOICE';
  invoiceId: string;
  invoiceVersion: number;
  documentId: string | null;
  linkId: string | null;
  amount: string;
  invoiceRemaining: string;
  consentVersion: number;
  documentSnapshotHash: string | null;
  agency: string;
  resident: string;
  reference: string;
  template: ApprovedTemplate | null;
}
export interface InvoiceInspection {
  status: string;
  reason: string | null;
  recipient: string;
  locale: Locale;
  payload: InvoiceNoticePayload;
  documentUrl?: string;
  qrUrl?: string;
  paymentUrl?: string;
}
type Settings = Awaited<ReturnType<typeof readCommunicationSettings>>;
export async function inspectInvoiceMessage(
  c: PoolClient,
  agencyId: string,
  providers: ProviderRegistry | undefined,
  channel: Channel,
  item: InvoiceMessageItem,
  agency: string,
  settings: Settings,
  excludeId?: string,
): Promise<InvoiceInspection> {
  const invoice = await invoiceView(c, idValue(item.invoiceId));
  const resident = await contactResident(c, invoice.resident.id);
  const preference = await readContactPreference(c, resident.id);
  const result: InvoiceInspection = {
    status: 'PENDING',
    reason: null,
    recipient: resident.phone,
    locale: preference.locale,
    payload: {
      kind: 'INVOICE',
      invoiceId: item.invoiceId,
      invoiceVersion: invoice.version,
      documentId: item.documentId ?? null,
      linkId: item.linkId ?? null,
      amount: invoice.accountBalance,
      invoiceRemaining: invoice.remaining,
      consentVersion: preference.version,
      documentSnapshotHash: null,
      agency,
      resident: invoice.resident.name,
      reference: invoice.code,
      template: null,
    },
  };
  const blocked = (status: string, reason: string) => ({
    ...result,
    status,
    reason,
  });
  if (item.version !== invoice.version)
    return blocked('STALE', 'INVOICE_REVISED');
  if (
    invoice.accountBalance.startsWith('-') ||
    parseMoney(invoice.accountBalance) === 0n
  )
    return blocked('NOT_DUE', 'NO_OUTSTANDING_BALANCE');
  const provider = providers?.get(agencyId, channel);
  if (provider?.status !== 'CONFIGURED')
    return blocked(
      'NOT_CONFIGURED',
      provider?.status === 'CONFIGURATION_ERROR'
        ? 'PROVIDER_CONFIGURATION_ERROR'
        : 'PROVIDER_NOT_CONFIGURED',
    );
  if (!/^\+[1-9]\d{7,14}$/.test(resident.phone))
    return blocked('INVALID_RECIPIENT', 'INTERNATIONAL_PHONE_REQUIRED');
  if (
    preference.needsConsentRenewal ||
    !(channel === 'SMS' ? preference.sms : preference.whatsapp)
  )
    return blocked('NO_CONSENT', 'CURRENT_CHANNEL_CONSENT_REQUIRED');
  if (channel === 'WHATSAPP') {
    for (const value of settings.templates) {
      const template = approvedTemplate(value);
      if (template.kind === 'INVOICE' && template.locale === preference.locale)
        result.payload.template = template;
    }
    if (!result.payload.template)
      return blocked('MISSING_TEMPLATE', 'APPROVED_INVOICE_TEMPLATE_REQUIRED');
  }
  if (!item.documentId || !item.linkId)
    return blocked('WAITING_DOCUMENT', 'GENERATED_DOCUMENT_AND_LINK_REQUIRED');
  idValue(item.documentId);
  idValue(item.linkId);
  const doc = (
    await c.query<{
      sourceId: string;
      sourceVersion: number;
      residentId: string;
      kind: string;
      locale: string;
      status: string;
      snapshotHash: string;
      snapshot: FinancialDocumentModel;
    }>(
      'SELECT source_id AS "sourceId",source_version AS "sourceVersion",resident_id AS "residentId",kind,locale,status,snapshot_hash AS "snapshotHash",snapshot FROM daybook.documents WHERE id=$1',
      [item.documentId],
    )
  ).rows[0];
  if (
    !doc ||
    doc.sourceId !== invoice.id ||
    doc.residentId !== resident.id ||
    doc.kind !== 'INVOICE'
  )
    fail('Choose this resident’s invoice document.', 'NOT_FOUND');
  if (doc.status !== 'READY')
    return blocked('WAITING_DOCUMENT', 'DOCUMENT_NOT_READY');
  if (
    doc.sourceVersion !== invoice.version ||
    doc.locale !== preference.locale ||
    doc.snapshot.totals[1]?.amount !== invoice.remaining ||
    doc.snapshot.totals[2]?.amount !== invoice.accountBalance
  )
    return blocked('STALE', 'DOCUMENT_FINANCIAL_SNAPSHOT_CHANGED');
  result.payload.documentSnapshotHash = doc.snapshotHash;
  const link = await readDocumentLink(c, agencyId, item.linkId);
  if (link.documentId !== item.documentId)
    fail('Choose a link for this invoice document.');
  if (
    link.status !== 'ACTIVE' ||
    !link.url ||
    new URL(link.url).protocol !== 'https:'
  )
    return blocked('WAITING_DOCUMENT', 'SECURE_ACTIVE_DOCUMENT_LINK_REQUIRED');
  const collection = await readCollectionSettings(c);
  if (!collection.upiId || !collection.payeeName)
    return blocked('NOT_CONFIGURED', 'PAYMENT_IDENTITY_NOT_CONFIGURED');
  if (!doc.snapshot.upiUri || !doc.snapshot.qrDataUrl)
    return blocked('STALE', 'PAYMENT_QR_MISSING');
  const payment = new URL(doc.snapshot.upiUri);
  if (
    payment.protocol !== 'upi:' ||
    payment.hostname !== 'pay' ||
    payment.searchParams.get('pa') !== collection.upiId ||
    payment.searchParams.get('pn') !== collection.payeeName ||
    payment.searchParams.get('am') !== invoice.accountBalance
  )
    return blocked('STALE', 'PAYMENT_IDENTITY_OR_AMOUNT_CHANGED');
  const pending = await c.query(
    `SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND status IN('PENDING','CLAIMED','SUBMITTING','UNKNOWN','UNKNOWN_CLOSED') AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [resident.id, channel, excludeId ?? null],
  );
  if (pending.rowCount)
    return blocked('UNRESOLVED', 'EXISTING_SEND_REQUIRES_RESOLUTION');
  const recent = await c.query(
    `SELECT 1 FROM daybook.notification_intents WHERE resident_id=$1 AND channel=$2 AND status IN('ACCEPTED','DELIVERED','READ','SENT','OWNER_ACCEPTED') AND coalesce(accepted_at,created_at)>now()-($3::integer*interval '1 hour') AND ($4::uuid IS NULL OR id<>$4) LIMIT 1`,
    [resident.id, channel, settings.cooldownHours, excludeId ?? null],
  );
  if (recent.rowCount) return blocked('COOLDOWN', 'RECIPIENT_COOLDOWN');
  result.documentUrl = link.url;
  result.qrUrl = link.url + '/qr.png';
  result.paymentUrl = doc.snapshot.upiUri;
  return result;
}
const fields = `id,resident_id AS "residentId",payload->>'invoiceId' AS "invoiceId",payload->>'documentId' AS "documentId",(SELECT d.status FROM daybook.documents d WHERE d.id=(daybook.notification_intents.payload->>'documentId')::uuid) AS "documentStatus",kind,channel,recipient,provider_message_id AS "providerMessageId",status,last_error AS reason,attempts,created_at AS "createdAt"`;
export async function readMessages(c: PoolClient, ids?: string[]) {
  return (
    await c.query(
      `SELECT ${fields} FROM daybook.notification_intents ${ids ? 'WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],id)' : "ORDER BY date_trunc('milliseconds',created_at) DESC,id DESC LIMIT 200"}`,
      ids ? [ids] : [],
    )
  ).rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export const messageDispatches = (ctx: RequestContext) =>
  financialRead(ctx, (c) => readMessages(c));
export interface DispatchHistoryInput {
  residentId?: string | null;
  status?: string | null;
  beforeCreatedAt?: string | null;
  beforeId?: string | null;
}
export function dispatchHistory(
  ctx: RequestContext,
  input: DispatchHistoryInput,
) {
  return financialRead(ctx, async (c) => {
    const values: unknown[] = [],
      clauses: string[] = [];
    if (input.residentId != null) {
      idValue(input.residentId);
      if (
        !(
          await c.query('SELECT 1 FROM daybook.residents WHERE id=$1', [
            input.residentId,
          ])
        ).rowCount
      )
        fail('Resident not found.', 'NOT_FOUND');
      values.push(input.residentId);
      clauses.push(`resident_id=$${values.length}`);
    }
    if (input.status != null) {
      if (
        ![
          'NOT_CONFIGURED',
          'NO_CONSENT',
          'MISSING_TEMPLATE',
          'PENDING',
          'CLAIMED',
          'SUBMITTING',
          'ACCEPTED',
          'DELIVERED',
          'READ',
          'FAILED',
          'UNKNOWN',
          'UNKNOWN_CLOSED',
          'OWNER_NOT_SENT',
          'OWNER_ACCEPTED',
          'CANCELLED',
          'STALE',
          'WAITING_DOCUMENT',
          'NOT_DUE',
          'COOLDOWN',
          'UNRESOLVED',
          'INVALID_RECIPIENT',
          'SENT',
        ].includes(input.status)
      )
        fail('Choose a recorded dispatch status.');
      values.push(input.status);
      clauses.push(`status=$${values.length}`);
    }
    if ((input.beforeCreatedAt != null) !== (input.beforeId != null))
      fail('Use a complete dispatch history cursor.');
    if (input.beforeCreatedAt != null) {
      idValue(input.beforeId);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          input.beforeCreatedAt,
        ) ||
        !Number.isFinite(Date.parse(input.beforeCreatedAt))
      )
        fail('Use a valid dispatch history timestamp.');
      values.push(input.beforeCreatedAt, input.beforeId);
      clauses.push(
        `(date_trunc('milliseconds',created_at),id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`,
      );
    }
    // Match cursor precision to the serialized timestamp to preserve tied rows.
    const rows = (
      await c.query(
        `SELECT ${fields} FROM daybook.notification_intents ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY date_trunc('milliseconds',created_at) DESC,id DESC LIMIT 201`,
        values,
      )
    ).rows;
    return {
      hasMore: rows.length > 200,
      items: rows
        .slice(0, 200)
        .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  });
}
export const messageDispatchStatuses = (ctx: RequestContext, ids: string[]) =>
  financialRead(ctx, async (c) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100)
      fail('Choose one to one hundred original message records.');
    const unique = [...new Set(ids.map((id) => idValue(id).toLowerCase()))];
    const rows = await readMessages(c, unique);
    if (rows.length !== unique.length)
      fail('Message record not found.', 'NOT_FOUND');
    return rows;
  });
export function queueInvoiceMessages(
  ctx: RequestContext,
  input: InvoiceMessageBatchInput,
) {
  return configMutation(ctx, async (c) => {
    if (
      !['WHATSAPP', 'SMS'].includes(input.channel) ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100
    )
      fail('Choose one to one hundred invoices and a supported channel.');
    if (
      new Set(input.items.map((item) => item.invoiceId)).size !==
      input.items.length
    )
      fail('Choose each invoice once per batch.');
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'communications.invoiceBatch',
      input,
      async () => {
        const settings = await readCommunicationSettings(c);
        const ids: string[] = [];
        const residents = new Set<string>();
        for (const item of input.items) {
          const checked = await inspectInvoiceMessage(
            c,
            ctx.agent!.agencyId,
            ctx.providers,
            input.channel as Channel,
            item,
            ctx.agent!.agency.name,
            settings,
          );
          const invoice = await invoiceView(c, item.invoiceId);
          if (residents.has(invoice.resident.id))
            fail('Choose one invoice per resident in each batch.');
          residents.add(invoice.resident.id);
          const id = randomUUID();
          await c.query(
            `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,locale,payload,dedupe_key,status,created_by,last_error) VALUES($1,$2,$3,'INVOICE',$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              id,
              ctx.agent!.agencyId,
              invoice.resident.id,
              input.channel,
              checked.recipient,
              checked.locale,
              JSON.stringify(checked.payload),
              `invoice:${input.requestId}:${item.invoiceId}`,
              checked.status,
              ctx.agent!.id,
              checked.reason,
            ],
          );
          ids.push(id);
        }
        await audit(c, ctx, 'notification_batch', input.requestId, 'PREPARED', {
          channel: input.channel,
          ids,
        });
        return { ids };
      },
    );
    return readMessages(c, saved.ids);
  });
}

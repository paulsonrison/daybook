import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { claimMessage, beginSubmission, finishSubmission } from './outbox.js';
import {
  inspectInvoiceMessage,
  type InvoiceNoticePayload,
} from './dispatch.js';
import { readCommunicationSettings } from './service.js';
import { approvedTemplate, noticeText, providerTemplate } from './templates.js';
import {
  createTransport,
  type PreparedMessage,
  type ProviderConfig,
  type SubmissionResult,
} from './providers.js';
import type { ProviderRegistry } from './config.js';
import { runDocumentJobs } from '../documents/service.js';
import { evaluateReminders } from './reminders.js';
import {
  activateAccountNotices,
  prepareAccountSubmission,
} from './account-notices.js';
type Submit = (
  config: ProviderConfig,
  message: PreparedMessage,
) => Promise<SubmissionResult>;
async function currentResult(pool: Pool, agency: string, id: string) {
  return withTenant(
    pool,
    agency,
    async (c) =>
      (
        await c.query<{ id: string; status: string; reason: string | null }>(
          'SELECT id,status,last_error AS reason FROM daybook.notification_intents WHERE id=$1',
          [id],
        )
      ).rows[0],
  );
}
/** Claims and validates in short transactions; provider I/O runs after commit. */
export async function processNextMessage(
  pool: Pool,
  agencyId: string,
  providers: ProviderRegistry,
  submit: Submit = createTransport(),
) {
  const claim = await claimMessage(pool, agencyId);
  if (!claim) return null;
  const prepared: {
    value?: { config: ProviderConfig; message: PreparedMessage };
  } = {};
  let began: boolean;
  try {
    began = await beginSubmission(
      pool,
      agencyId,
      claim.id,
      claim.attempts,
      new Date(),
      async (c, active) => {
        if (
          active.payload.kind === 'REMINDER' ||
          active.payload.kind === 'CREDIT_HOLD'
        ) {
          const result = await prepareAccountSubmission(
            c,
            agencyId,
            providers,
            active,
          );
          if (!result.prepared) {
            await c.query(
              'UPDATE daybook.notification_intents SET status=$2,last_error=$3,lease_until=NULL WHERE id=$1',
              [active.id, result.status, result.reason],
            );
            return false;
          }
          prepared.value = result.prepared;
          return true;
        }
        const original = active.payload as unknown as InvoiceNoticePayload;
        if (
          original.kind !== 'INVOICE' ||
          typeof original.invoiceId !== 'string' ||
          typeof original.invoiceVersion !== 'number'
        )
          throw new Error('Unsupported message source');
        const checked = await inspectInvoiceMessage(
          c,
          agencyId,
          providers,
          active.channel,
          {
            invoiceId: original.invoiceId,
            version: original.invoiceVersion,
            documentId: original.documentId,
            linkId: original.linkId,
          },
          original.agency,
          await readCommunicationSettings(c),
          active.id,
        );
        let status = checked.status,
          reason = checked.reason;
        const fields = [
          'amount',
          'invoiceRemaining',
          'consentVersion',
          'documentSnapshotHash',
          'resident',
          'reference',
        ] as const;
        if (
          status === 'PENDING' &&
          (active.recipient !== checked.recipient ||
            active.locale !== checked.locale ||
            fields.some((key) => original[key] !== checked.payload[key]) ||
            JSON.stringify(
              original.template ? approvedTemplate(original.template) : null,
            ) !== JSON.stringify(checked.payload.template))
        ) {
          status = 'STALE';
          reason = 'PREPARED_MESSAGE_CHANGED';
        }
        if (status !== 'PENDING') {
          await c.query(
            'UPDATE daybook.notification_intents SET status=$2,last_error=$3,lease_until=NULL WHERE id=$1',
            [active.id, status, reason],
          );
          return false;
        }
        const provider = providers.get(agencyId, active.channel);
        if (
          provider.status !== 'CONFIGURED' ||
          !checked.documentUrl ||
          !checked.paymentUrl
        )
          throw new Error('Message preparation unavailable');
        const values = {
          ...checked.payload,
          documentUrl: checked.documentUrl,
          paymentUrl: checked.paymentUrl,
        };
        prepared.value = {
          config: provider.transport,
          message: {
            recipient: active.recipient,
            body: noticeText('INVOICE', checked.locale, values),
            ...(active.channel === 'WHATSAPP'
              ? {
                  template: providerTemplate(
                    checked.payload.template!,
                    values,
                    checked.qrUrl,
                  ),
                }
              : {
                  callbackUrl: `${new URL(checked.documentUrl).origin}/webhooks/sms/${agencyId}?intent=${active.id}`,
                }),
          },
        };
        return true;
      },
    );
  } catch {
    await withTenant(pool, agencyId, (c) =>
      c.query(
        "UPDATE daybook.notification_intents SET status='FAILED',last_error='PREPARATION_FAILED',lease_until=NULL WHERE id=$1 AND attempts=$2 AND status='CLAIMED'",
        [claim.id, claim.attempts],
      ),
    );
    return currentResult(pool, agencyId, claim.id);
  }
  if (!began || !prepared.value) return currentResult(pool, agencyId, claim.id);
  let result: SubmissionResult;
  try {
    result = await submit(prepared.value.config, prepared.value.message);
  } catch {
    result = { status: 'UNKNOWN', errorCode: 'SUBMISSION_UNCERTAIN' };
  }
  await finishSubmission(pool, agencyId, claim.id, claim.attempts, result);
  return currentResult(pool, agencyId, claim.id);
}

export async function runCommunicationsCycle(
  pool: Pool,
  agencyId: string,
  providers: ProviderRegistry,
  submit: Submit = createTransport(),
) {
  await evaluateReminders(pool, agencyId, providers);
  await runDocumentJobs(pool, agencyId);
  await activateAccountNotices(pool, agencyId);
  const messages: { id: string; status: string; reason: string | null }[] = [];
  for (let count = 0; count < 5; count++) {
    const result = await processNextMessage(pool, agencyId, providers, submit);
    if (!result) break;
    messages.push(result);
  }
  return { messages };
}

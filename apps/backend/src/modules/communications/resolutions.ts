import { randomUUID } from 'node:crypto';
import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { onceRequest } from '../requests.js';
import { readMessages } from './dispatch.js';
export interface MessageResolutionInput {
  requestId: string;
  messageId: string;
  decision: string;
  evidence: string;
  providerReference?: string | null;
  confirmedEvidence: boolean;
}
export function resolveMessageUncertainty(
  ctx: RequestContext,
  input: MessageResolutionInput,
) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'communications.resolveUncertainty',
      input,
      async () => {
        idValue(input.messageId);
        if (
          ![
            'CLOSE_UNKNOWN',
            'CONFIRMED_NOT_SENT',
            'CONFIRMED_ACCEPTED',
          ].includes(input.decision) ||
          input.confirmedEvidence !== true
        )
          fail(
            'Choose a decision and confirm the supporting provider evidence.',
          );
        const evidence = cleanText(
          input.evidence,
          'provider verification evidence',
          1000,
        );
        const reference =
          input.decision === 'CONFIRMED_ACCEPTED'
            ? cleanText(input.providerReference, 'provider reference', 255)
            : null;
        if (input.decision !== 'CONFIRMED_ACCEPTED' && input.providerReference)
          fail(
            'Only an acceptance verification should include a provider reference.',
          );
        const row = (
          await c.query<{
            status: string;
            recipient: string;
            providerId: string | null;
            submittedAt: Date | null;
            attempts: number;
          }>(
            'SELECT status,recipient,provider_message_id AS "providerId",submitted_at AS "submittedAt",attempts FROM daybook.notification_intents WHERE id=$1 FOR UPDATE',
            [input.messageId],
          )
        ).rows[0];
        if (!row) fail('Message record not found.', 'NOT_FOUND');
        if (
          ![
            'UNKNOWN',
            'UNKNOWN_CLOSED',
            'OWNER_ACCEPTED',
            'OWNER_NOT_SENT',
          ].includes(row.status) ||
          row.providerId ||
          !row.submittedAt ||
          row.attempts < 1
        )
          fail(
            'The recorded provider outcome changed or is already verified. Refresh before deciding.',
            'CONFLICT',
          );
        const status =
          input.decision === 'CLOSE_UNKNOWN'
            ? 'UNKNOWN_CLOSED'
            : input.decision === 'CONFIRMED_NOT_SENT'
              ? 'OWNER_NOT_SENT'
              : 'OWNER_ACCEPTED';
        const id = randomUUID();
        await c.query(
          'INSERT INTO daybook.notification_resolutions(id,agency_id,intent_id,request_id,decision,recipient_snapshot,evidence,provider_reference,confirmed_by,agent_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            id,
            ctx.agent!.agencyId,
            input.messageId,
            input.requestId,
            input.decision,
            row.recipient,
            evidence,
            reference,
            ctx.agent!.id,
            ctx.agent!.name,
          ],
        );
        // An owner's reference is audit evidence, never a fabricated provider ID.
        await c.query(
          "UPDATE daybook.notification_intents SET status=$2,last_error=$2,lease_until=NULL,accepted_at=CASE WHEN $2='OWNER_ACCEPTED' THEN now() ELSE NULL END WHERE id=$1",
          [input.messageId, status],
        );
        await audit(c, ctx, 'message_resolution', id, 'RECORDED', {
          messageId: input.messageId,
          decision: input.decision,
          evidence,
          providerReference: reference,
        });
        return { messageId: input.messageId };
      },
    );
    return (await readMessages(c, [saved.messageId]))[0];
  });
}
export function messageResolutions(ctx: RequestContext, messageId: string) {
  return financialRead(ctx, async (c) => {
    idValue(messageId);
    if (
      !(
        await c.query(
          'SELECT 1 FROM daybook.notification_intents WHERE id=$1',
          [messageId],
        )
      ).rowCount
    )
      fail('Message record not found.', 'NOT_FOUND');
    return (
      await c.query(
        'SELECT id,intent_id AS "messageId",decision,evidence,provider_reference AS "providerReference",agent_name AS "agentName",created_at AS "createdAt" FROM daybook.notification_resolutions WHERE intent_id=$1 ORDER BY created_at DESC,id DESC',
        [messageId],
      )
    ).rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });
}

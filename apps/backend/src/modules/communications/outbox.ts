import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { SubmissionResult } from './providers.js';
import { randomUUID } from 'node:crypto';

export interface MessageClaim {
  id: string;
  attempts: number;
  residentId: string;
  channel: 'WHATSAPP' | 'SMS';
  recipient: string;
  locale: 'en' | 'ml' | 'hi';
  payload: Record<string, unknown>;
}

export function claimMessage(
  pool: Pool,
  agencyId: string,
  now = new Date(),
): Promise<MessageClaim | null> {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    await c.query(
      `UPDATE daybook.notification_intents SET status=CASE WHEN status='SUBMITTING' THEN 'UNKNOWN' ELSE 'FAILED' END,lease_until=NULL,last_error=CASE WHEN status='SUBMITTING' THEN 'SUBMISSION_UNCERTAIN' ELSE 'ATTEMPTS_EXHAUSTED' END WHERE agency_id=$1 AND lease_until<=$2 AND (status='SUBMITTING' OR (status='CLAIMED' AND attempts>=5))`,
      [agencyId, now],
    );
    const result = await c.query<MessageClaim>(
      `UPDATE daybook.notification_intents SET status='CLAIMED',attempts=attempts+1,lease_until=$2::timestamptz+interval '60 seconds',last_error=NULL WHERE id=(SELECT id FROM daybook.notification_intents WHERE agency_id=$1 AND attempts<5 AND ((status='PENDING' AND next_attempt_at<=$2) OR (status='CLAIMED' AND lease_until<=$2)) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,attempts,resident_id AS "residentId",channel,recipient,locale,payload`,
      [agencyId, now],
    );
    return result.rows[0] ?? null;
  });
}

// The eligibility check shares the tenant transaction and agency lock with the
// submission boundary. It must not perform network requests.
export function beginSubmission(
  pool: Pool,
  agencyId: string,
  id: string,
  attempt: number,
  now: Date,
  eligible: (client: PoolClient, claim: MessageClaim) => Promise<boolean>,
): Promise<boolean> {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    const claim = (
      await c.query<MessageClaim>(
        `SELECT id,attempts,resident_id AS "residentId",channel,recipient,locale,payload FROM daybook.notification_intents WHERE agency_id=$1 AND id=$2 AND attempts=$3 AND status='CLAIMED' AND lease_until>$4 FOR UPDATE`,
        [agencyId, id, attempt, now],
      )
    ).rows[0];
    if (!claim || !(await eligible(c, claim))) return false;
    const result = await c.query(
      `UPDATE daybook.notification_intents SET status='SUBMITTING',submitted_at=$4,lease_until=$4::timestamptz+interval '60 seconds' WHERE agency_id=$1 AND id=$2 AND attempts=$3 AND status='CLAIMED' AND lease_until>$4`,
      [agencyId, id, attempt, now],
    );
    return result.rowCount === 1;
  });
}

export function finishSubmission(
  pool: Pool,
  agencyId: string,
  id: string,
  attempt: number,
  result: SubmissionResult,
  now = new Date(),
): Promise<boolean> {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    const row = (
      await c.query<{
        status: string;
        attempts: number;
        providerId: string | null;
      }>(
        'SELECT status,attempts,provider_message_id AS "providerId" FROM daybook.notification_intents WHERE agency_id=$1 AND id=$2 FOR UPDATE',
        [agencyId, id],
      )
    ).rows[0];
    if (
      !row ||
      row.attempts !== attempt ||
      (result.status === 'ACCEPTED' &&
        row.providerId !== null &&
        row.providerId !== result.messageId) ||
      !(
        row.status === 'SUBMITTING' ||
        ([
          'UNKNOWN',
          'UNKNOWN_CLOSED',
          'OWNER_NOT_SENT',
          'OWNER_ACCEPTED',
        ].includes(row.status) &&
          result.status === 'ACCEPTED')
      )
    )
      return false;
    const status =
      result.status === 'REJECTED'
        ? result.retryable && attempt < 5
          ? 'PENDING'
          : 'FAILED'
        : result.status;
    const delay =
      result.status === 'REJECTED' && result.retryAfterSeconds
        ? Math.max(1, Math.min(3600, result.retryAfterSeconds))
        : 60;
    await c.query(
      `UPDATE daybook.notification_intents SET status=$3,lease_until=NULL,provider_message_id=$4,last_error=$5,next_attempt_at=$6,accepted_at=coalesce(accepted_at,CASE WHEN $3='ACCEPTED' THEN $7::timestamptz ELSE NULL END) WHERE agency_id=$1 AND id=$2`,
      [
        agencyId,
        id,
        status,
        result.status === 'ACCEPTED' ? result.messageId : null,
        result.status === 'ACCEPTED' ? null : result.errorCode,
        new Date(now.getTime() + delay * 1000),
        now,
      ],
    );
    if (result.status === 'ACCEPTED') {
      const channel = (
        await c.query<{ channel: 'SMS' | 'WHATSAPP' }>(
          'SELECT channel FROM daybook.notification_intents WHERE id=$1',
          [id],
        )
      ).rows[0].channel;
      await applyInbox(c, agencyId, channel, result.messageId);
    }
    return true;
  });
}

export interface ProviderEvent {
  channel: 'SMS' | 'WHATSAPP';
  messageId: string;
  status: 'ACCEPTED' | 'FAILED' | 'DELIVERED' | 'READ';
  eventKey: string;
}
/** The caller must first verify Twilio's signature against the configured URL. */
export function associateSmsCallback(
  pool: Pool,
  agencyId: string,
  intentId: string,
  providerId: string,
  recipient: string,
): Promise<boolean> {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    const row = (
      await c.query<{
        channel: string;
        recipient: string;
        status: string;
        providerId: string | null;
        submittedAt: Date | null;
        attempts: number;
      }>(
        'SELECT channel,recipient,status,provider_message_id AS "providerId",submitted_at AS "submittedAt",attempts FROM daybook.notification_intents WHERE id=$1 FOR UPDATE',
        [intentId],
      )
    ).rows[0];
    if (!row || row.channel !== 'SMS' || row.recipient !== recipient)
      return false;
    if (row.providerId) return row.providerId === providerId;
    if (
      ![
        'SUBMITTING',
        'UNKNOWN',
        'UNKNOWN_CLOSED',
        'OWNER_ACCEPTED',
        'OWNER_NOT_SENT',
      ].includes(row.status) ||
      !row.submittedAt ||
      !row.attempts
    )
      return false;
    await c.query(
      "UPDATE daybook.notification_intents SET status='ACCEPTED',provider_message_id=$2,accepted_at=coalesce(accepted_at,now()),lease_until=NULL,last_error=NULL WHERE id=$1",
      [intentId, providerId],
    );
    await applyInbox(c, agencyId, 'SMS', providerId);
    return true;
  });
}
// Call only after authenticating the callback and resolving its configured agency.
export function recordProviderEvent(
  pool: Pool,
  agencyId: string,
  event: ProviderEvent,
): Promise<boolean> {
  return withTenant(pool, agencyId, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
      [agencyId],
    );
    if (
      !Object.hasOwn(deliveryRanks, event.status) ||
      !event.eventKey ||
      event.eventKey.length > 128 ||
      !event.messageId ||
      event.messageId.length > 255
    )
      return false;
    await c.query(
      `INSERT INTO daybook.notification_inbox(id,agency_id,channel,message_id,event_key,provider_status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,channel,message_id,event_key) DO NOTHING`,
      [
        randomUUID(),
        agencyId,
        event.channel,
        event.messageId,
        event.eventKey,
        event.status,
      ],
    );
    return applyInbox(c, agencyId, event.channel, event.messageId);
  });
}
const deliveryRanks: Record<string, number> = {
  ACCEPTED: 0,
  FAILED: 1,
  DELIVERED: 2,
  READ: 3,
};
async function applyInbox(
  c: PoolClient,
  agencyId: string,
  channel: 'SMS' | 'WHATSAPP',
  messageId: string,
): Promise<boolean> {
  const row = (
    await c.query<{ id: string; status: string }>(
      'SELECT id,status FROM daybook.notification_intents WHERE agency_id=$1 AND channel=$2 AND provider_message_id=$3 FOR UPDATE',
      [agencyId, channel, messageId],
    )
  ).rows[0];
  if (!row || !Object.hasOwn(deliveryRanks, row.status)) return false;
  const events = (
    await c.query<{ id: string; status: string; eventKey: string }>(
      'SELECT id,provider_status AS status,event_key AS "eventKey" FROM daybook.notification_inbox WHERE agency_id=$1 AND channel=$2 AND message_id=$3 AND processed_at IS NULL ORDER BY created_at,id',
      [agencyId, channel, messageId],
    )
  ).rows;
  let applied = false;
  for (const event of events) {
    const applies = deliveryRanks[event.status] > deliveryRanks[row.status];
    const inserted = await c.query(
      `INSERT INTO daybook.notification_events(id,agency_id,intent_id,event_key,provider_status,applied) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,intent_id,event_key) DO NOTHING`,
      [randomUUID(), agencyId, row.id, event.eventKey, event.status, applies],
    );
    await c.query(
      'UPDATE daybook.notification_inbox SET processed_at=now() WHERE agency_id=$1 AND id=$2',
      [agencyId, event.id],
    );
    if (!inserted.rowCount || !applies) continue;
    await c.query(
      'UPDATE daybook.notification_intents SET status=$3 WHERE agency_id=$1 AND id=$2',
      [agencyId, row.id, event.status],
    );
    row.status = event.status;
    applied = true;
  }
  return applied;
}

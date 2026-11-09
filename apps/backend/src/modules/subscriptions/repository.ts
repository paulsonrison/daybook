import type { PoolClient } from 'pg';
import type { Schedule } from '../scheduling/calendar.js';
export interface SubscriptionRow extends Schedule {
  id: string;
  residentId: string;
  publicationId: string;
  quantity: number;
  status: string;
  version: number;
}
const projection = `id,resident_id AS "residentId",publication_id AS "publicationId",cadence,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",weekdays,quantity,status,version`;
export async function listSubscriptions(
  client: PoolClient,
  residentId?: string,
) {
  return (
    await client.query<SubscriptionRow>(
      `SELECT ${projection} FROM daybook.subscriptions ${residentId ? 'WHERE resident_id=$1' : ''} ORDER BY resident_id,publication_id,id`,
      residentId ? [residentId] : [],
    )
  ).rows;
}
export async function findSubscription(client: PoolClient, id: string) {
  return (
    await client.query<SubscriptionRow>(
      `SELECT ${projection} FROM daybook.subscriptions WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}
export async function writeSubscription(
  client: PoolClient,
  agencyId: string,
  row: Omit<SubscriptionRow, 'version'>,
  existing: boolean,
  request?: { id: string; fingerprint: string },
) {
  const values = [
    row.residentId,
    row.publicationId,
    row.cadence,
    row.startDate,
    row.endDate,
    row.weekdays,
    row.quantity,
    row.status,
    row.id,
    agencyId,
  ];
  const result = existing
    ? await client.query<SubscriptionRow>(
        `UPDATE daybook.subscriptions SET resident_id=$1,publication_id=$2,cadence=$3,start_date=$4,end_date=$5,weekdays=$6,quantity=$7,status=$8,version=version+1 WHERE id=$9 AND agency_id=$10 RETURNING ${projection}`,
        values,
      )
    : await client.query<SubscriptionRow>(
        `INSERT INTO daybook.subscriptions(resident_id,publication_id,cadence,start_date,end_date,weekdays,quantity,status,id,agency_id,creation_request_id,creation_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${projection}`,
        [...values, request!.id, request!.fingerprint],
      );
  return result.rows[0];
}
export async function subscriptionRequest(
  client: PoolClient,
  requestId: string,
) {
  return (
    await client.query<SubscriptionRow & { fingerprint: string }>(
      `SELECT ${projection},creation_fingerprint AS fingerprint FROM daybook.subscriptions WHERE creation_request_id=$1`,
      [requestId],
    )
  ).rows[0];
}

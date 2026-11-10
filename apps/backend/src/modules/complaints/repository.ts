import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export async function hasBenefit(
  client: PoolClient,
  deliveryId: string,
  resolution: string,
) {
  return Boolean(
    (
      await client.query(
        'SELECT id FROM daybook.complaints WHERE delivery_id=$1 AND status=$2 LIMIT 1',
        [deliveryId, resolution],
      )
    ).rowCount,
  );
}
export interface Complaint {
  id: string;
  deliveryId: string;
  kind: string;
  note: string;
  status: string;
  resolutionNote: string | null;
  replacementCopies: number;
  credit: string;
  version: number;
  residentName: string;
  routeName: string;
  staffId: string | null;
  staffName: string | null;
}
const projection = `c.id,c.delivery_id AS "deliveryId",c.kind,c.note,c.status,c.resolution_note AS "resolutionNote",c.replacement_copies AS "replacementCopies",c.credit_paise,c.version,d.resident_name AS "residentName",d.route_name AS "routeName",d.staff_id AS "staffId",d.staff_name AS "staffName"`;
type Raw = Omit<Complaint, 'credit'> & { credit_paise: string };
const map = (r: Raw): Complaint => ({
  ...r,
  credit: moneyString(BigInt(r.credit_paise)),
});
export async function readComplaints(client: PoolClient) {
  return (
    await client.query<Raw>(
      `SELECT ${projection} FROM daybook.complaints c JOIN daybook.delivery_logs d ON(d.agency_id,d.id)=(c.agency_id,c.delivery_id) ORDER BY c.created_at,c.id`,
    )
  ).rows.map(map);
}
export async function findComplaint(client: PoolClient, id: string) {
  const row = (
    await client.query<Raw>(
      `SELECT ${projection} FROM daybook.complaints c JOIN daybook.delivery_logs d ON(d.agency_id,d.id)=(c.agency_id,c.delivery_id) WHERE c.id=$1 FOR UPDATE OF c`,
      [id],
    )
  ).rows[0];
  return row ? map(row) : undefined;
}
export async function insertComplaint(
  client: PoolClient,
  agencyId: string,
  id: string,
  deliveryId: string,
  kind: string,
  note: string,
) {
  await client.query(
    'INSERT INTO daybook.complaints(id,agency_id,delivery_id,kind,note) VALUES($1,$2,$3,$4,$5)',
    [id, agencyId, deliveryId, kind, note],
  );
  return (await findComplaint(client, id))!;
}
export async function closeComplaint(
  client: PoolClient,
  id: string,
  resolution: string,
  note: string,
  replacementCopies: number,
  credit: bigint,
  rating: number | null,
) {
  await client.query(
    'UPDATE daybook.complaints SET status=$2,resolution_note=$3,replacement_copies=$4,credit_paise=$5,satisfaction_rating=$6,version=version+1,resolved_at=now() WHERE id=$1',
    [id, resolution, note, replacementCopies, credit.toString(), rating],
  );
  return (await findComplaint(client, id))!;
}

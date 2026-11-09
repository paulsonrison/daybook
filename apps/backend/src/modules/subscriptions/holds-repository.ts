import type { PoolClient } from 'pg';
export interface HoldRow {
  id: string;
  residentId: string;
  subscriptionId: string | null;
  startDate: string;
  resumeDate: string | null;
  active: boolean;
  version: number;
}
const projection = `id,resident_id AS "residentId",subscription_id AS "subscriptionId",to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(resume_date,'YYYY-MM-DD') AS "resumeDate",active,version`;
export async function readHolds(client: PoolClient, residentId?: string) {
  return (
    await client.query<HoldRow>(
      `SELECT ${projection} FROM daybook.holds ${residentId ? 'WHERE resident_id=$1' : ''} ORDER BY start_date,id`,
      residentId ? [residentId] : [],
    )
  ).rows;
}

export async function findHold(client: PoolClient, id: string) {
  return (
    await client.query<HoldRow>(
      `SELECT ${projection} FROM daybook.holds WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}
export async function writeHold(
  client: PoolClient,
  agencyId: string,
  row: Omit<HoldRow, 'version'>,
  existing: boolean,
) {
  const values = [
    row.residentId,
    row.subscriptionId,
    row.startDate,
    row.resumeDate,
    row.active,
    row.id,
    agencyId,
  ];
  const result = existing
    ? await client.query<HoldRow>(
        `UPDATE daybook.holds SET resident_id=$1,subscription_id=$2,start_date=$3,resume_date=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7 RETURNING ${projection}`,
        values,
      )
    : await client.query<HoldRow>(
        `INSERT INTO daybook.holds(resident_id,subscription_id,start_date,resume_date,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${projection}`,
        values,
      );
  return result.rows[0];
}

import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface PublicationWrite {
  id: string;
  agencyId: string;
  name: string;
  edition: string;
  kind: string;
  language: string;
  dispatch: string;
  frequency: string;
  publishingDays: number[];
  anchorDate: string | null;
  weekdayPaise: bigint;
  weekendPaise: bigint;
  procurementPaise: bigint | null;
  active: boolean;
}
const projection =
  'id,name,edition,kind,language,dispatch,frequency,publishing_days AS "publishingDays",to_char(anchor_date,\'YYYY-MM-DD\') AS "anchorDate",weekday_paise,weekend_paise,procurement_net_paise,active,version';
interface PublicationRow {
  id: string;
  name: string;
  edition: string;
  kind: string;
  language: string;
  dispatch: string;
  frequency: string;
  publishingDays: number[];
  anchorDate: string | null;
  active: boolean;
  version: number;
  weekday_paise: string;
  weekend_paise: string;
  procurement_net_paise: string | null;
}
function map(row: PublicationRow) {
  return {
    ...row,
    weekdayPrice: moneyString(BigInt(row.weekday_paise)),
    weekendPrice: moneyString(BigInt(row.weekend_paise)),
    procurementNetCost:
      row.procurement_net_paise === null
        ? null
        : moneyString(BigInt(row.procurement_net_paise)),
  };
}
export async function listPublications(client: PoolClient) {
  return (
    await client.query<PublicationRow>(
      `SELECT ${projection} FROM daybook.publications ORDER BY name,edition,id`,
    )
  ).rows.map(map);
}
export async function findPublication(client: PoolClient, id: string) {
  return (
    await client.query<{
      version: number;
      active: boolean;
      frequency: string;
      publishingDays: number[];
      anchorDate: string | null;
    }>(
      `SELECT version,active,frequency,publishing_days AS "publishingDays",to_char(anchor_date,'YYYY-MM-DD') AS "anchorDate" FROM daybook.publications WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}
export async function hasActiveSubscriptions(client: PoolClient, id: string) {
  return Boolean(
    (
      await client.query(
        "SELECT id FROM daybook.subscriptions WHERE publication_id=$1 AND status='ACTIVE' LIMIT 1",
        [id],
      )
    ).rowCount,
  );
}
export async function writePublication(
  client: PoolClient,
  row: PublicationWrite,
  existing: boolean,
) {
  const values = [
    row.name,
    row.edition,
    row.name.toLocaleLowerCase('en'),
    row.edition.toLocaleLowerCase('en'),
    row.kind,
    row.language,
    row.dispatch,
    row.frequency,
    row.publishingDays,
    row.anchorDate,
    row.weekdayPaise.toString(),
    row.weekendPaise.toString(),
    row.procurementPaise?.toString() ?? null,
    row.active,
    row.id,
    row.agencyId,
  ];
  const columns =
    'name,edition,name_key,edition_key,kind,language,dispatch,frequency,publishing_days,anchor_date,weekday_paise,weekend_paise,procurement_net_paise,active,id,agency_id';
  const result = existing
    ? await client.query<PublicationRow>(
        `UPDATE daybook.publications SET name=$1,edition=$2,name_key=$3,edition_key=$4,kind=$5,language=$6,dispatch=$7,frequency=$8,publishing_days=$9,anchor_date=$10,weekday_paise=$11,weekend_paise=$12,procurement_net_paise=$13,active=$14,version=version+1 WHERE id=$15 AND agency_id=$16 RETURNING ${projection}`,
        values,
      )
    : await client.query<PublicationRow>(
        `INSERT INTO daybook.publications(${columns}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${projection}`,
        values,
      );
  return map(result.rows[0]);
}

import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface PriceRow {
  id: string;
  publicationId: string;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  pricePaise: bigint;
  price: string;
  active: boolean;
  version: number;
}
const projection = `id,publication_id AS "publicationId",to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",weekdays,price_paise,active,version`;
interface RawPrice extends Omit<PriceRow, 'pricePaise' | 'price'> {
  price_paise: string;
}
const map = (row: RawPrice) => ({
  ...row,
  pricePaise: BigInt(row.price_paise),
  price: moneyString(BigInt(row.price_paise)),
});
export async function readPrices(client: PoolClient, publicationId?: string) {
  return (
    await client.query<RawPrice>(
      `SELECT ${projection} FROM daybook.price_rules ${publicationId ? 'WHERE publication_id=$1' : ''} ORDER BY start_date,id`,
      publicationId ? [publicationId] : [],
    )
  ).rows.map(map);
}
export async function findPrice(client: PoolClient, id: string) {
  const row = (
    await client.query<RawPrice>(
      `SELECT ${projection} FROM daybook.price_rules WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  return row ? map(row) : undefined;
}
export async function writePrice(
  client: PoolClient,
  agencyId: string,
  row: Omit<PriceRow, 'version' | 'price'>,
  existing: boolean,
) {
  const values = [
    row.publicationId,
    row.startDate,
    row.endDate,
    row.weekdays,
    row.pricePaise.toString(),
    row.active,
    row.id,
    agencyId,
  ];
  const result = existing
    ? await client.query<RawPrice>(
        `UPDATE daybook.price_rules SET publication_id=$1,start_date=$2,end_date=$3,weekdays=$4,price_paise=$5,active=$6,version=version+1 WHERE id=$7 AND agency_id=$8 RETURNING ${projection}`,
        values,
      )
    : await client.query<RawPrice>(
        `INSERT INTO daybook.price_rules(publication_id,start_date,end_date,weekdays,price_paise,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${projection}`,
        values,
      );
  return map(result.rows[0]);
}

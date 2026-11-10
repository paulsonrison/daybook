import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface Publisher {
  id: string;
  name: string;
  phone: string;
  returnCutoff: string;
  returnWindowDays: number;
  active: boolean;
  version: number;
}
const publisherColumns = `id,name,phone,to_char(return_cutoff,'HH24:MI') AS "returnCutoff",return_window_days AS "returnWindowDays",active,version`;
export async function readPublishers(c: PoolClient) {
  return (
    await c.query<Publisher>(
      `SELECT ${publisherColumns} FROM daybook.publishers ORDER BY name,id`,
    )
  ).rows;
}
export async function findPublisher(c: PoolClient, id: string) {
  return (
    await c.query<Publisher>(
      `SELECT ${publisherColumns} FROM daybook.publishers WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}
export async function writePublisher(
  c: PoolClient,
  agencyId: string,
  row: Omit<Publisher, 'version'>,
  existing: boolean,
) {
  const values = [
    row.name,
    row.phone,
    row.returnCutoff,
    row.returnWindowDays,
    row.active,
    row.id,
    agencyId,
  ];
  return (
    existing
      ? await c.query<Publisher>(
          `UPDATE daybook.publishers SET name=$1,phone=$2,return_cutoff=$3,return_window_days=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7 RETURNING ${publisherColumns}`,
          values,
        )
      : await c.query<Publisher>(
          `INSERT INTO daybook.publishers(name,phone,return_cutoff,return_window_days,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${publisherColumns}`,
          values,
        )
  ).rows[0];
}
export interface SupplyLot {
  id: string;
  publisherId: string;
  publicationId: string;
  date: string;
  quantity: number;
  publicationName: string;
  dispatch: string;
  netCost: string;
  totalCost: string;
  returnDeadline: string;
  netPaise: bigint;
  returned: number;
}
type RawLot = Omit<
  SupplyLot,
  'netCost' | 'totalCost' | 'returnDeadline' | 'netPaise'
> & { net_paise: string; total_paise: string; return_deadline: Date };
const supplyColumns = `l.id,l.publisher_id AS "publisherId",l.publication_id AS "publicationId",to_char(l.supply_date,'YYYY-MM-DD') AS date,l.quantity,l.publication_name AS "publicationName",l.dispatch,l.net_paise,l.total_paise,l.return_deadline,coalesce((SELECT sum(r.quantity) FROM daybook.supply_returns r WHERE(r.agency_id,r.supply_id)=(l.agency_id,l.id)),0)::integer AS returned`;
const mapLot = (r: RawLot): SupplyLot => ({
  ...r,
  netPaise: BigInt(r.net_paise),
  netCost: moneyString(BigInt(r.net_paise)),
  totalCost: moneyString(BigInt(r.total_paise)),
  returnDeadline: r.return_deadline.toISOString(),
});
export async function readSupply(c: PoolClient) {
  return (
    await c.query<RawLot>(
      `SELECT ${supplyColumns} FROM daybook.supply_lots l ORDER BY l.supply_date DESC,l.id`,
    )
  ).rows.map(mapLot);
}
export async function findSupply(c: PoolClient, id: string) {
  const row = (
    await c.query<RawLot>(
      `SELECT ${supplyColumns} FROM daybook.supply_lots l WHERE l.id=$1`,
      [id],
    )
  ).rows[0];
  return row ? mapLot(row) : undefined;
}
export async function publisherTimezone(c: PoolClient) {
  return (
    await c.query<{ timezone: string }>(
      'SELECT timezone FROM daybook.agencies WHERE id=daybook.current_agency()',
    )
  ).rows[0].timezone;
}
export async function returnDeadline(
  c: PoolClient,
  date: string,
  publisher: Publisher,
  timezone: string,
) {
  return (
    await c.query<{ deadline: Date }>(
      'SELECT (($1::date+$2::integer)+$3::time) AT TIME ZONE $4 AS deadline',
      [date, publisher.returnWindowDays, publisher.returnCutoff, timezone],
    )
  ).rows[0].deadline;
}
export async function insertSupply(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    publisherId: string;
    publicationId: string;
    date: string;
    quantity: number;
    publicationName: string;
    dispatch: string;
    netPaise: bigint;
    listPaise: bigint | null;
    marginBps: number | null;
    totalPaise: bigint;
    deadline: Date;
  },
) {
  await c.query(
    'INSERT INTO daybook.supply_lots(id,agency_id,publisher_id,publication_id,supply_date,quantity,publication_name,dispatch,net_paise,list_paise,margin_bps,total_paise,return_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [
      row.id,
      agencyId,
      row.publisherId,
      row.publicationId,
      row.date,
      row.quantity,
      row.publicationName,
      row.dispatch,
      row.netPaise.toString(),
      row.listPaise?.toString() ?? null,
      row.marginBps,
      row.totalPaise.toString(),
      row.deadline.toISOString(),
    ],
  );
  return (await findSupply(c, row.id))!;
}
export interface SupplyReturn {
  id: string;
  supplyId: string;
  quantity: number;
  reason: string;
  credit: string;
  date: string;
}
export async function readReturns(c: PoolClient) {
  return (
    await c.query<Omit<SupplyReturn, 'credit'> & { credit_paise: string }>(
      `SELECT id,supply_id AS "supplyId",quantity,reason,credit_paise,to_char(recorded_date,'YYYY-MM-DD') AS date FROM daybook.supply_returns ORDER BY created_at DESC,id`,
    )
  ).rows.map((r) => ({ ...r, credit: moneyString(BigInt(r.credit_paise)) }));
}
export async function insertReturn(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    supplyId: string;
    quantity: number;
    reason: string;
    creditPaise: bigint;
    date: string;
  },
) {
  await c.query(
    'INSERT INTO daybook.supply_returns(id,agency_id,supply_id,quantity,reason,credit_paise,recorded_date) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      row.id,
      agencyId,
      row.supplyId,
      row.quantity,
      row.reason,
      row.creditPaise.toString(),
      row.date,
    ],
  );
  return {
    id: row.id,
    supplyId: row.supplyId,
    quantity: row.quantity,
    reason: row.reason,
    credit: moneyString(row.creditPaise),
    date: row.date,
  };
}
export async function statementSupply(
  c: PoolClient,
  publisherId: string,
  month: string,
) {
  return (
    await c.query<{
      publicationId: string;
      name: string;
      dispatch: string;
      quantity: number;
      cost: string;
    }>(
      `SELECT publication_id AS "publicationId",publication_name AS name,dispatch,sum(quantity)::integer AS quantity,sum(total_paise)::text AS cost FROM daybook.supply_lots WHERE publisher_id=$1 AND supply_date>=$2::date AND supply_date<($2::date+interval '1 month') GROUP BY publication_id,publication_name,dispatch ORDER BY publication_name,dispatch`,
      [publisherId, `${month}-01`],
    )
  ).rows;
}
export async function statementReturns(
  c: PoolClient,
  publisherId: string,
  month: string,
) {
  return (
    await c.query<{
      publicationId: string;
      name: string;
      dispatch: string;
      quantity: number;
      credit: string;
    }>(
      `SELECT l.publication_id AS "publicationId",l.publication_name AS name,l.dispatch,sum(r.quantity)::integer AS quantity,sum(r.credit_paise)::text AS credit FROM daybook.supply_returns r JOIN daybook.supply_lots l ON(l.agency_id,l.id)=(r.agency_id,r.supply_id) WHERE l.publisher_id=$1 AND r.recorded_date>=$2::date AND r.recorded_date<($2::date+interval '1 month') GROUP BY l.publication_id,l.publication_name,l.dispatch ORDER BY l.publication_name,l.dispatch`,
      [publisherId, `${month}-01`],
    )
  ).rows;
}

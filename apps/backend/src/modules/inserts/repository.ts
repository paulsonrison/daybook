import type { ManifestExtraItem } from '../manifests/repository.js';
import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface Advertiser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  billingAddress: string;
  active: boolean;
  version: number;
}
const advertiserColumns = `id,name,phone,email,billing_address AS "billingAddress",active,version`;
export async function readAdvertisers(c: PoolClient) {
  return (
    await c.query<Advertiser>(
      `SELECT ${advertiserColumns} FROM daybook.advertisers ORDER BY name,id`,
    )
  ).rows;
}
export async function findAdvertiser(c: PoolClient, id: string) {
  return (
    await c.query<Advertiser>(
      `SELECT ${advertiserColumns} FROM daybook.advertisers WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}
export async function writeAdvertiser(
  c: PoolClient,
  agencyId: string,
  row: Omit<Advertiser, 'version'>,
  existing: boolean,
) {
  const values = [
    row.name,
    row.phone,
    row.email,
    row.billingAddress,
    row.active,
    row.id,
    agencyId,
  ];
  return (
    existing
      ? await c.query<Advertiser>(
          `UPDATE daybook.advertisers SET name=$1,phone=$2,email=$3,billing_address=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7 RETURNING ${advertiserColumns}`,
          values,
        )
      : await c.query<Advertiser>(
          `INSERT INTO daybook.advertisers(name,phone,email,billing_address,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${advertiserColumns}`,
          values,
        )
  ).rows[0];
}
export interface InsertAllocation {
  routeId: string;
  quantity: number;
}
export interface InsertOrder {
  id: string;
  advertiserId: string;
  title: string;
  quantity: number;
  date: string;
  dispatch: string;
  unitPrice: string;
  unitPaise: bigint;
  total: string;
  totalPaise: bigint;
  status: string;
  version: number;
  allocations: InsertAllocation[];
}
type RawOrder = Omit<
  InsertOrder,
  'unitPrice' | 'unitPaise' | 'total' | 'totalPaise' | 'allocations'
> & { unit_paise: string; total_paise: string };
const orderColumns = `id,advertiser_id AS "advertiserId",title,quantity,to_char(drop_date,'YYYY-MM-DD') AS date,dispatch,unit_paise,total_paise,status,version`;
const map = (r: RawOrder, allocations: InsertAllocation[]): InsertOrder => ({
  ...r,
  unitPrice: moneyString(BigInt(r.unit_paise)),
  unitPaise: BigInt(r.unit_paise),
  total: moneyString(BigInt(r.total_paise)),
  totalPaise: BigInt(r.total_paise),
  allocations,
});
export async function readInsertOrders(c: PoolClient) {
  const orders = (
      await c.query<RawOrder>(
        `SELECT ${orderColumns} FROM daybook.insert_orders ORDER BY drop_date,id`,
      )
    ).rows,
    allocations = (
      await c.query<InsertAllocation & { orderId: string }>(
        'SELECT order_id AS "orderId",route_id AS "routeId",quantity FROM daybook.insert_allocations ORDER BY route_id',
      )
    ).rows;
  return orders.map((r) =>
    map(
      r,
      allocations
        .filter((a) => a.orderId === r.id)
        .map(({ routeId, quantity }) => ({ routeId, quantity })),
    ),
  );
}
export async function findInsertOrder(c: PoolClient, id: string) {
  await c.query('SELECT id FROM daybook.insert_orders WHERE id=$1 FOR UPDATE', [
    id,
  ]);
  return (await readInsertOrders(c)).find((o) => o.id === id);
}
export async function writeInsertOrder(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    advertiserId: string;
    title: string;
    quantity: number;
    date: string;
    dispatch: string;
    unitPaise: bigint;
    totalPaise: bigint;
    allocations: InsertAllocation[];
  },
  existing: boolean,
) {
  const values = [
    row.advertiserId,
    row.title,
    row.quantity,
    row.date,
    row.dispatch,
    row.unitPaise.toString(),
    row.totalPaise.toString(),
    row.id,
    agencyId,
  ];
  if (existing)
    await c.query(
      'UPDATE daybook.insert_orders SET advertiser_id=$1,title=$2,quantity=$3,drop_date=$4,dispatch=$5,unit_paise=$6,total_paise=$7,version=version+1 WHERE id=$8 AND agency_id=$9',
      values,
    );
  else
    await c.query(
      "INSERT INTO daybook.insert_orders(advertiser_id,title,quantity,drop_date,dispatch,unit_paise,total_paise,id,agency_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SCHEDULED')",
      values,
    );
  await c.query('DELETE FROM daybook.insert_allocations WHERE order_id=$1', [
    row.id,
  ]);
  for (const a of row.allocations)
    await c.query(
      'INSERT INTO daybook.insert_allocations(id,agency_id,order_id,route_id,quantity) VALUES(gen_random_uuid(),$1,$2,$3,$4)',
      [agencyId, row.id, a.routeId, a.quantity],
    );
  return (await findInsertOrder(c, row.id))!;
}
export async function setInsertStatus(
  c: PoolClient,
  id: string,
  status: string,
) {
  await c.query(
    'UPDATE daybook.insert_orders SET status=$2,version=version+1 WHERE id=$1',
    [id, status],
  );
  return (await findInsertOrder(c, id))!;
}
export interface AdvertiserInvoice {
  packedItems: ManifestExtraItem[];
  id: string;
  orderId: string;
  advertiserId: string;
  code: string;
  advertiserName: string;
  billingAddress: string;
  subtotal: string;
  tax: string;
  total: string;
  proofReference: string;
  date: string;
}
export async function readAdvertiserInvoices(c: PoolClient) {
  return (
    await c.query<
      Omit<AdvertiserInvoice, 'subtotal' | 'tax' | 'total'> & {
        subtotal_paise: string;
        tax_paise: string;
        total_paise: string;
      }
    >(
      `SELECT id,order_id AS "orderId",advertiser_id AS "advertiserId",code,advertiser_name AS "advertiserName",billing_address AS "billingAddress",subtotal_paise,tax_paise,total_paise,packed_items AS "packedItems",proof_reference AS "proofReference",to_char(issued_date,'YYYY-MM-DD') AS date FROM daybook.advertiser_invoices ORDER BY issued_date,id`,
    )
  ).rows.map((r) => ({
    ...r,
    subtotal: moneyString(BigInt(r.subtotal_paise)),
    tax: moneyString(BigInt(r.tax_paise)),
    total: moneyString(BigInt(r.total_paise)),
  }));
}
export async function insertAdvertiserInvoice(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    orderId: string;
    advertiserId: string;
    code: string;
    advertiserName: string;
    billingAddress: string;
    packedItems: ManifestExtraItem[];
    subtotalPaise: bigint;
    proofReference: string;
    date: string;
  },
) {
  await c.query(
    'INSERT INTO daybook.advertiser_invoices(id,agency_id,order_id,advertiser_id,code,advertiser_name,billing_address,subtotal_paise,tax_paise,total_paise,no_tax_confirmed,proof_reference,issued_date,packed_items) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$8,true,$9,$10,$11)',
    [
      row.id,
      agencyId,
      row.orderId,
      row.advertiserId,
      row.code,
      row.advertiserName,
      row.billingAddress,
      row.subtotalPaise.toString(),
      row.proofReference,
      row.date,
      JSON.stringify(row.packedItems),
    ],
  );
  return (await readAdvertiserInvoices(c)).find((i) => i.id === row.id)!;
}

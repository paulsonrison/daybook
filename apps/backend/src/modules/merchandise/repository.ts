import type { ManifestExtraItem } from '../manifests/repository.js';
import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface MerchandiseItem {
  id: string;
  name: string;
  sku: string;
  kind: string;
  price: string;
  pricePaise: bigint;
  onHand: number;
  reserved: number;
  available: number;
  active: boolean;
  version: number;
}
type RawItem = Omit<MerchandiseItem, 'price' | 'pricePaise' | 'available'> & {
  price_paise: string;
};
const itemColumns = `id,name,sku,kind,price_paise,on_hand AS "onHand",reserved,active,version`;
const mapItem = (r: RawItem): MerchandiseItem => ({
  ...r,
  pricePaise: BigInt(r.price_paise),
  price: moneyString(BigInt(r.price_paise)),
  available: r.onHand - r.reserved,
});
export async function readItems(c: PoolClient) {
  return (
    await c.query<RawItem>(
      `SELECT ${itemColumns} FROM daybook.merchandise_items ORDER BY name,id`,
    )
  ).rows.map(mapItem);
}
export async function findItem(c: PoolClient, id: string) {
  const r = (
    await c.query<RawItem>(
      `SELECT ${itemColumns} FROM daybook.merchandise_items WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  return r ? mapItem(r) : undefined;
}
export async function writeItem(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    name: string;
    sku: string;
    kind: string;
    pricePaise: bigint;
    active: boolean;
  },
  existing: boolean,
) {
  const values = [
    row.name,
    row.sku,
    row.kind,
    row.pricePaise.toString(),
    row.active,
    row.id,
    agencyId,
  ];
  if (existing)
    await c.query(
      'UPDATE daybook.merchandise_items SET name=$1,sku=$2,kind=$3,price_paise=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7',
      values,
    );
  else
    await c.query(
      'INSERT INTO daybook.merchandise_items(name,sku,kind,price_paise,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      values,
    );
  return (await findItem(c, row.id))!;
}
export async function receiveStock(
  c: PoolClient,
  agencyId: string,
  id: string,
  quantity: number,
  note: string,
) {
  await c.query(
    'INSERT INTO daybook.merchandise_receipts(id,agency_id,item_id,quantity,note) VALUES(gen_random_uuid(),$1,$2,$3,$4)',
    [agencyId, id, quantity, note],
  );
  await c.query(
    'UPDATE daybook.merchandise_items SET on_hand=on_hand+$2,version=version+1 WHERE id=$1',
    [id, quantity],
  );
  return (await findItem(c, id))!;
}
export interface MerchandiseOrder {
  packingSnapshot: ManifestExtraItem[] | null;
  id: string;
  residentId: string;
  itemId: string;
  name: string;
  quantity: number;
  date: string;
  dispatch: string;
  unitPrice: string;
  unitPaise: bigint;
  total: string;
  totalPaise: bigint;
  settlement: string;
  status: string;
  version: number;
  receiptCode: string | null;
}
type RawOrder = Omit<
  MerchandiseOrder,
  'unitPrice' | 'unitPaise' | 'total' | 'totalPaise'
> & { unit_paise: string; total_paise: string };
const orderColumns = `o.id,o.resident_id AS "residentId",o.item_id AS "itemId",o.item_name AS name,o.quantity,to_char(o.drop_date,'YYYY-MM-DD') AS date,o.dispatch,o.unit_paise,o.total_paise,o.settlement,o.status,o.version,o.packing_snapshot AS "packingSnapshot",(SELECT receipt_code FROM daybook.merchandise_charges c WHERE(c.agency_id,c.order_id)=(o.agency_id,o.id)) AS "receiptCode"`;
const mapOrder = (r: RawOrder): MerchandiseOrder => ({
  ...r,
  unitPaise: BigInt(r.unit_paise),
  unitPrice: moneyString(BigInt(r.unit_paise)),
  totalPaise: BigInt(r.total_paise),
  total: moneyString(BigInt(r.total_paise)),
});
export async function readOrders(c: PoolClient) {
  return (
    await c.query<RawOrder>(
      `SELECT ${orderColumns} FROM daybook.merchandise_orders o ORDER BY o.drop_date,o.id`,
    )
  ).rows.map(mapOrder);
}
export async function findOrder(c: PoolClient, id: string) {
  const r = (
    await c.query<RawOrder>(
      `SELECT ${orderColumns} FROM daybook.merchandise_orders o WHERE o.id=$1 FOR UPDATE OF o`,
      [id],
    )
  ).rows[0];
  return r ? mapOrder(r) : undefined;
}
export async function insertOrder(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    residentId: string;
    itemId: string;
    name: string;
    quantity: number;
    date: string;
    dispatch: string;
    unitPaise: bigint;
    totalPaise: bigint;
    settlement: string;
  },
) {
  await c.query(
    "INSERT INTO daybook.merchandise_orders(id,agency_id,resident_id,item_id,item_name,quantity,drop_date,dispatch,unit_paise,total_paise,settlement,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PREORDER')",
    [
      row.id,
      agencyId,
      row.residentId,
      row.itemId,
      row.name,
      row.quantity,
      row.date,
      row.dispatch,
      row.unitPaise.toString(),
      row.totalPaise.toString(),
      row.settlement,
    ],
  );
  return (await findOrder(c, row.id))!;
}
export async function moveStock(
  c: PoolClient,
  itemId: string,
  onHandChange: number,
  reservedChange: number,
) {
  await c.query(
    'UPDATE daybook.merchandise_items SET on_hand=on_hand+$2,reserved=reserved+$3,version=version+1 WHERE id=$1',
    [itemId, onHandChange, reservedChange],
  );
}
export async function orderStatus(
  c: PoolClient,
  id: string,
  status: string,
  packingSnapshot?: ManifestExtraItem[],
) {
  await c.query(
    "UPDATE daybook.merchandise_orders SET status=$2,version=version+1,packing_snapshot=COALESCE($3::jsonb,packing_snapshot),fulfilled_at=CASE WHEN $2='FULFILLED' THEN now() ELSE fulfilled_at END WHERE id=$1",
    [id, status, packingSnapshot ? JSON.stringify(packingSnapshot) : null],
  );
  return (await findOrder(c, id))!;
}
export async function insertCharge(
  c: PoolClient,
  agencyId: string,
  row: {
    id: string;
    orderId: string;
    residentId: string;
    amountPaise: bigint;
    settlement: string;
    receiptCode: string | null;
    date: string;
  },
) {
  await c.query(
    'INSERT INTO daybook.merchandise_charges(id,agency_id,order_id,resident_id,amount_paise,settlement,receipt_code,charge_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      row.id,
      agencyId,
      row.orderId,
      row.residentId,
      row.amountPaise.toString(),
      row.settlement,
      row.receiptCode,
      row.date,
    ],
  );
}
export async function readCharges(c: PoolClient) {
  return (
    await c.query<{
      id: string;
      orderId: string;
      residentId: string;
      amount_paise: string;
      settlement: string;
      receiptCode: string | null;
      date: string;
    }>(
      `SELECT id,order_id AS "orderId",resident_id AS "residentId",amount_paise,settlement,receipt_code AS "receiptCode",to_char(charge_date,'YYYY-MM-DD') AS date FROM daybook.merchandise_charges ORDER BY created_at,id`,
    )
  ).rows.map((r) => ({ ...r, amount: moneyString(BigInt(r.amount_paise)) }));
}

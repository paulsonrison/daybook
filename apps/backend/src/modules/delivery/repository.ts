import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
import { localClock } from '../scheduling/time.js';
export async function agencyToday(client: PoolClient, now = new Date()) {
  const timezone = (
    await client.query<{ timezone: string }>(
      'SELECT timezone FROM daybook.agencies WHERE id=daybook.current_agency()',
    )
  ).rows[0].timezone;
  return localClock(now, timezone).date;
}
export async function wasMarked(client: PoolClient, date: string) {
  return Boolean(
    (
      await client.query(
        'SELECT 1 FROM daybook.delivery_days WHERE delivery_date=$1',
        [date],
      )
    ).rowCount,
  );
}
export async function markDay(
  client: PoolClient,
  agencyId: string,
  date: string,
) {
  await client.query(
    'INSERT INTO daybook.delivery_days(agency_id,delivery_date) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [agencyId, date],
  );
}
export interface DeliveryRow {
  permanentStaffId: string | null;
  permanentStaffName: string | null;
  id: string;
  subscriptionId: string;
  residentId: string;
  publicationId: string;
  routeId: string;
  staffId: string | null;
  date: string;
  dispatch: string;
  dropOrder: number;
  residentName: string;
  address: string;
  publicationName: string;
  routeName: string;
  staffName: string | null;
  quantity: number;
  price: string;
  pricePaise: bigint;
  ruleId: string | null;
  status: string;
  source: string;
  reason: string | null;
  chargeableQuantity: number;
  version: number;
}
type Raw = Omit<DeliveryRow, 'pricePaise' | 'price'> & { price_paise: string };
const projection = `id,subscription_id AS "subscriptionId",resident_id AS "residentId",publication_id AS "publicationId",route_id AS "routeId",staff_id AS "staffId",to_char(delivery_date,'YYYY-MM-DD') AS date,dispatch,drop_order AS "dropOrder",resident_name AS "residentName",address,publication_name AS "publicationName",route_name AS "routeName",staff_name AS "staffName",quantity,price_paise,price_rule_id AS "ruleId",permanent_staff_id AS "permanentStaffId",permanent_staff_name AS "permanentStaffName",status,source,reason,chargeable_quantity AS "chargeableQuantity",version`;
const map = (row: Raw): DeliveryRow => ({
  ...row,
  pricePaise: BigInt(row.price_paise),
  price: moneyString(BigInt(row.price_paise)),
});
export async function readDeliveries(
  client: PoolClient,
  date: string,
  routeId?: string,
) {
  return (
    await client.query<Raw>(
      `SELECT ${projection} FROM daybook.delivery_logs WHERE delivery_date=$1 ${routeId ? 'AND route_id=$2' : ''} ORDER BY route_name,drop_order,publication_name,id`,
      routeId ? [date, routeId] : [date],
    )
  ).rows.map(map);
}
export async function findDelivery(client: PoolClient, id: string) {
  const row = (
    await client.query<Raw>(
      `SELECT ${projection} FROM daybook.delivery_logs WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  return row ? map(row) : undefined;
}
export async function insertDelivery(
  client: PoolClient,
  agencyId: string,
  row: Omit<
    DeliveryRow,
    'price' | 'status' | 'source' | 'reason' | 'chargeableQuantity' | 'version'
  >,
) {
  return Boolean(
    (
      await client.query(
        `INSERT INTO daybook.delivery_logs(id,agency_id,subscription_id,resident_id,publication_id,route_id,staff_id,delivery_date,dispatch,drop_order,resident_name,address,publication_name,route_name,staff_name,quantity,price_paise,price_rule_id,permanent_staff_id,permanent_staff_name,status,source,chargeable_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'DELIVERED','AUTO',$16) ON CONFLICT(agency_id,subscription_id,delivery_date) DO NOTHING`,
        [
          row.id,
          agencyId,
          row.subscriptionId,
          row.residentId,
          row.publicationId,
          row.routeId,
          row.staffId,
          row.date,
          row.dispatch,
          row.dropOrder,
          row.residentName,
          row.address,
          row.publicationName,
          row.routeName,
          row.staffName,
          row.quantity,
          row.pricePaise.toString(),
          row.ruleId,
          row.permanentStaffId,
          row.permanentStaffName,
        ],
      )
    ).rowCount,
  );
}
export async function updateAssignedStaff(
  client: PoolClient,
  date: string,
  subscriptionId: string,
  routeId: string,
  staffId: string | null,
  staffName: string | null,
) {
  await client.query(
    'UPDATE daybook.delivery_logs SET staff_id=$4,staff_name=$5,version=version+1 WHERE delivery_date=$1 AND subscription_id=$2 AND route_id=$3 AND (staff_id IS DISTINCT FROM $4::uuid OR staff_name IS DISTINCT FROM $5::text)',
    [date, subscriptionId, routeId, staffId, staffName],
  );
}
export async function reconcileAutomatic(
  client: PoolClient,
  date: string,
  subscriptionIds: string[],
) {
  await client.query(
    "UPDATE daybook.delivery_logs SET status=CASE WHEN subscription_id=ANY($2::uuid[]) THEN 'DELIVERED' ELSE 'SKIPPED' END,chargeable_quantity=CASE WHEN subscription_id=ANY($2::uuid[]) THEN quantity ELSE 0 END,version=version+1 WHERE delivery_date=$1 AND source='AUTO' AND NOT EXISTS(SELECT 1 FROM daybook.invoice_delivery_claims claim WHERE (claim.agency_id,claim.delivery_id)=(delivery_logs.agency_id,delivery_logs.id)) AND status<>CASE WHEN subscription_id=ANY($2::uuid[]) THEN 'DELIVERED' ELSE 'SKIPPED' END",
    [date, subscriptionIds],
  );
}
export async function updateDelivery(
  client: PoolClient,
  id: string,
  status: string,
  source: string,
  reason: string,
  chargeableQuantity: number,
) {
  await client.query(
    'UPDATE daybook.delivery_logs SET status=$2,source=$3,reason=$4,chargeable_quantity=$5,version=version+1 WHERE id=$1',
    [id, status, source, reason, chargeableQuantity],
  );
  return (await findDelivery(client, id))!;
}
export interface PressHoliday {
  id: string;
  publicationId: string;
  date: string;
  reason: string;
  active: boolean;
  version: number;
}
const holidayProjection = `id,publication_id AS "publicationId",to_char(issue_date,'YYYY-MM-DD') AS date,reason,active,version`;
export async function readHolidays(client: PoolClient) {
  return (
    await client.query<PressHoliday>(
      `SELECT ${holidayProjection} FROM daybook.press_holidays ORDER BY issue_date,id`,
    )
  ).rows;
}
export async function writeHoliday(
  client: PoolClient,
  agencyId: string,
  row: Omit<PressHoliday, 'version'>,
  existing: boolean,
) {
  const values = [
    row.publicationId,
    row.date,
    row.reason,
    row.active,
    row.id,
    agencyId,
  ];
  return (
    existing
      ? await client.query<PressHoliday>(
          `UPDATE daybook.press_holidays SET publication_id=$1,issue_date=$2,reason=$3,active=$4,version=version+1 WHERE id=$5 AND agency_id=$6 RETURNING ${holidayProjection}`,
          values,
        )
      : await client.query<PressHoliday>(
          `INSERT INTO daybook.press_holidays(publication_id,issue_date,reason,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${holidayProjection}`,
          values,
        )
  ).rows[0];
}

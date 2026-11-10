import type { PoolClient } from 'pg';
import type { BillingPeriod } from './periods.js';
import type {
  BillingPolicy,
  DeliverySource,
  InvoiceHeader,
  InvoicePayload,
  MerchandiseSource,
} from './model.js';
export async function billingResident(c: PoolClient, id: string) {
  return (
    await c.query<{
      id: string;
      name: string;
      code: string;
      address: string;
      routeId: string;
      routeName: string;
      dropOrder: number | null;
      status: string;
    }>(
      `SELECT r.id,r.name,r.code,r.address,r.route_id AS "routeId",route.name AS "routeName",s.sequence AS "dropOrder",r.status FROM daybook.residents r JOIN daybook.routes route ON(route.agency_id,route.id)=(r.agency_id,r.route_id) LEFT JOIN daybook.route_stops s ON(s.agency_id,s.resident_id)=(r.agency_id,r.id) WHERE r.id=$1`,
      [id],
    )
  ).rows[0];
}
export async function readPolicy(c: PoolClient): Promise<BillingPolicy> {
  return (
    (
      await c.query<BillingPolicy>(
        'SELECT tax_treatment AS "taxTreatment",default_due_days AS "defaultDueDays",auto_issue AS "autoIssue",version FROM daybook.billing_policies',
      )
    ).rows[0] ?? {
      taxTreatment: 'UNCONFIGURED',
      defaultDueDays: 7,
      autoIssue: false,
      version: 0,
    }
  );
}
export async function writePolicy(
  c: PoolClient,
  agencyId: string,
  row: Omit<BillingPolicy, 'version'>,
) {
  return (
    await c.query<BillingPolicy>(
      'INSERT INTO daybook.billing_policies(agency_id,tax_treatment,default_due_days,auto_issue) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET tax_treatment=excluded.tax_treatment,default_due_days=excluded.default_due_days,auto_issue=excluded.auto_issue,version=billing_policies.version+1 RETURNING tax_treatment AS "taxTreatment",default_due_days AS "defaultDueDays",auto_issue AS "autoIssue",version',
      [agencyId, row.taxTreatment, row.defaultDueDays, row.autoIssue],
    )
  ).rows[0];
}
const headerColumns = `i.id,i.resident_id AS "residentId",i.code,i.resident_name AS "residentName",i.resident_code AS "residentCode",i.address,i.route_id AS "routeId",i.route_name AS "routeName",i.drop_order AS "dropOrder",i.period_mode AS "periodMode",i.periods,to_char(i.issued_date,'YYYY-MM-DD') AS "issuedDate",to_char(i.due_date,'YYYY-MM-DD') AS "dueDate",i.current_total_paise,i.state,i.version,i.note,daybook.invoice_open_paise(i.id)::text AS open_paise,daybook.invoice_locked(i.id) AS locked`;
type RawHeader = Omit<InvoiceHeader, 'totalPaise' | 'remainingPaise'> & {
  current_total_paise: string;
  open_paise: string;
};
const mapHeader = (r: RawHeader): InvoiceHeader => ({
  ...r,
  totalPaise: BigInt(r.current_total_paise),
  remainingPaise: BigInt(r.open_paise),
});
export async function findInvoice(c: PoolClient, id: string, lock = false) {
  const r = (
    await c.query<RawHeader>(
      `SELECT ${headerColumns} FROM daybook.invoices i WHERE i.id=$1 ${lock ? 'FOR UPDATE OF i' : ''}`,
      [id],
    )
  ).rows[0];
  return r ? mapHeader(r) : undefined;
}
export async function readInvoiceHeaders(c: PoolClient, residentId?: string) {
  return (
    await c.query<RawHeader>(
      `SELECT ${headerColumns} FROM daybook.invoices i WHERE state='ISSUED' ${residentId ? 'AND resident_id=$1' : ''} ORDER BY issued_date,code,id`,
      residentId ? [residentId] : [],
    )
  ).rows.map(mapHeader);
}
export async function invoiceRevisions(c: PoolClient, id: string) {
  return (
    await c.query<{
      version: number;
      payload: InvoicePayload;
      created_at: Date;
    }>(
      'SELECT version,payload,created_at FROM daybook.invoice_revisions WHERE invoice_id=$1 ORDER BY version',
      [id],
    )
  ).rows.map((r) => ({
    version: r.version,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  }));
}
export async function readInvoicePayload(
  c: PoolClient,
  id: string,
  version: number,
) {
  return (
    await c.query<{ payload: InvoicePayload }>(
      'SELECT payload FROM daybook.invoice_revisions WHERE invoice_id=$1 AND version=$2',
      [id, version],
    )
  ).rows[0]?.payload;
}
export async function readDeliverySources(
  c: PoolClient,
  residentId: string,
  periods: BillingPeriod[],
  invoiceId?: string | null,
) {
  return (
    await c.query<Omit<DeliverySource, 'pricePaise'> & { price_paise: string }>(
      `SELECT d.id,d.publication_id AS "publicationId",d.publication_name AS description,to_char(d.delivery_date,'YYYY-MM-DD') AS date,d.quantity,d.chargeable_quantity AS "chargeableQuantity",d.price_paise,d.version,d.status,claim.invoice_id AS "claimedInvoiceId" FROM daybook.delivery_logs d LEFT JOIN daybook.invoice_delivery_claims claim ON(claim.agency_id,claim.delivery_id)=(d.agency_id,d.id) WHERE d.resident_id=$1 AND d.status<>'SKIPPED' AND(($3::uuid IS NULL AND claim.invoice_id IS NULL) OR claim.invoice_id=$3::uuid) AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r("from" date,"to" date) WHERE d.delivery_date BETWEEN r."from" AND r."to") ORDER BY d.delivery_date,d.publication_id,d.id`,
      [residentId, JSON.stringify(periods), invoiceId ?? null],
    )
  ).rows.map((r) => ({ ...r, pricePaise: BigInt(r.price_paise) }));
}
export async function readMerchandiseSources(
  c: PoolClient,
  residentId: string,
  periods: BillingPeriod[],
  invoiceId?: string | null,
) {
  return (
    await c.query<
      Omit<MerchandiseSource, 'unitPaise' | 'amountPaise'> & {
        unit_paise: string;
        amount_paise: string;
      }
    >(
      `SELECT charge.id,o.item_name AS description,to_char(charge.charge_date,'YYYY-MM-DD') AS date,o.quantity,o.unit_paise,charge.amount_paise,claim.invoice_id AS "claimedInvoiceId" FROM daybook.merchandise_charges charge JOIN daybook.merchandise_orders o ON(o.agency_id,o.id)=(charge.agency_id,charge.order_id) LEFT JOIN daybook.invoice_merchandise_claims claim ON(claim.agency_id,claim.charge_id)=(charge.agency_id,charge.id) WHERE charge.resident_id=$1 AND charge.settlement='INVOICE' AND(($3::uuid IS NULL AND claim.invoice_id IS NULL) OR claim.invoice_id=$3::uuid) AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r("from" date,"to" date) WHERE charge.charge_date BETWEEN r."from" AND r."to") ORDER BY charge.charge_date,charge.id`,
      [residentId, JSON.stringify(periods), invoiceId ?? null],
    )
  ).rows.map((r) => ({
    ...r,
    unitPaise: BigInt(r.unit_paise),
    amountPaise: BigInt(r.amount_paise),
  }));
}
export async function missingPreparation(
  c: PoolClient,
  periods: BillingPeriod[],
  afterDate?: string,
) {
  const rows = (
    await c.query<{ date: string; total: string }>(
      `WITH dates AS(SELECT DISTINCT day::date AS day FROM jsonb_to_recordset($1::jsonb) AS r("from" date,"to" date) CROSS JOIN LATERAL generate_series(r."from"::timestamp,r."to"::timestamp,interval '1 day') day) SELECT to_char(d.day,'YYYY-MM-DD') AS date,count(*) OVER()::text AS total FROM dates d LEFT JOIN daybook.delivery_days marked ON(marked.agency_id,marked.delivery_date)=(daybook.current_agency(),d.day) WHERE marked.delivery_date IS NULL AND($2::date IS NULL OR d.day>=$2::date) ORDER BY d.day LIMIT 31`,
      [JSON.stringify(periods), afterDate ?? null],
    )
  ).rows;
  return { count: Number(rows[0]?.total ?? 0), days: rows.map((r) => r.date) };
}
export async function insertInvoice(
  c: PoolClient,
  agencyId: string,
  row: Omit<InvoiceHeader, 'state' | 'version' | 'remainingPaise' | 'locked'>,
) {
  await c.query(
    "INSERT INTO daybook.invoices(id,agency_id,resident_id,code,resident_name,resident_code,address,route_id,route_name,drop_order,period_mode,periods,issued_date,due_date,current_total_paise,state,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT',$16)",
    [
      row.id,
      agencyId,
      row.residentId,
      row.code,
      row.residentName,
      row.residentCode,
      row.address,
      row.routeId,
      row.routeName,
      row.dropOrder,
      row.periodMode,
      JSON.stringify(row.periods),
      row.issuedDate,
      row.dueDate,
      row.totalPaise.toString(),
      row.note,
    ],
  );
}
export async function reviseHeader(
  c: PoolClient,
  id: string,
  totalPaise: bigint,
  note: string,
) {
  await c.query(
    'UPDATE daybook.invoices SET current_total_paise=$2,note=$3,version=version+1 WHERE id=$1',
    [id, totalPaise.toString(), note],
  );
}
export async function markIssued(c: PoolClient, id: string) {
  await c.query("UPDATE daybook.invoices SET state='ISSUED' WHERE id=$1", [id]);
}
export async function writeInvoiceRevision(
  c: PoolClient,
  agencyId: string,
  id: string,
  version: number,
  payload: InvoicePayload,
  actorId: string | null,
) {
  await c.query(
    'INSERT INTO daybook.invoice_revisions(id,agency_id,invoice_id,version,payload,created_by) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)',
    [agencyId, id, version, JSON.stringify(payload), actorId],
  );
  for (const line of payload.preview.lines)
    await c.query(
      'INSERT INTO daybook.invoice_lines(id,agency_id,invoice_id,revision,line_key,kind,description,quantity,source_quantity,unit_paise,source_unit_paise,amount_paise,correction_reason) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        agencyId,
        id,
        version,
        line.key,
        line.kind,
        line.description,
        line.quantity,
        line.sourceQuantity,
        decimalPaise(line.rate),
        decimalPaise(line.sourceRate),
        decimalPaise(line.amount),
        line.reason,
      ],
    );
}
function decimalPaise(value: string) {
  const negative = value.startsWith('-'),
    raw = negative ? value.slice(1) : value,
    [whole, fraction = ''] = raw.split('.');
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    (negative ? -1n : 1n)
  ).toString();
}
export async function claimInvoiceSources(
  c: PoolClient,
  agencyId: string,
  residentId: string,
  invoiceId: string,
  payload: InvoicePayload,
) {
  for (const binding of payload.deliveryBindings)
    await c.query(
      'INSERT INTO daybook.invoice_delivery_claims(agency_id,resident_id,delivery_id,invoice_id,billed_quantity,billed_unit_paise) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,delivery_id) DO UPDATE SET billed_quantity=excluded.billed_quantity,billed_unit_paise=excluded.billed_unit_paise WHERE invoice_delivery_claims.invoice_id=excluded.invoice_id',
      [
        agencyId,
        residentId,
        binding.deliveryId,
        invoiceId,
        binding.quantity,
        decimalPaise(binding.rate),
      ],
    );
  for (const chargeId of payload.merchandiseIds)
    await c.query(
      'INSERT INTO daybook.invoice_merchandise_claims(agency_id,resident_id,charge_id,invoice_id) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id,charge_id) DO NOTHING',
      [agencyId, residentId, chargeId, invoiceId],
    );
}
export async function closedPeriod(c: PoolClient, date: string) {
  return Boolean(
    (
      await c.query(
        "SELECT id FROM daybook.billing_cycles WHERE cycle_month=date_trunc('month',$1::date)::date",
        [date],
      )
    ).rowCount,
  );
}

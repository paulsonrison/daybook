import type { PoolClient } from 'pg';
export interface LedgerRow {
  createdAt: string;
  id: string;
  agencyId: string;
  residentId: string;
  kind: string;
  sourceKey: string;
  amountPaise: bigint;
  settledPaise: bigint;
  date: string;
  dueDate: string;
  description: string;
  invoiceId: string | null;
  referenceInvoiceId: string | null;
  actorId: string | null;
}
type Raw = Omit<LedgerRow, 'amountPaise' | 'settledPaise' | 'createdAt'> & {
  amount_paise: string;
  settled_paise: string;
  created_at: Date;
};
const projection = `e.created_at,e.id,e.agency_id AS "agencyId",e.resident_id AS "residentId",e.kind,e.source_key AS "sourceKey",e.amount_paise,to_char(e.entry_date,'YYYY-MM-DD') AS date,to_char(e.due_date,'YYYY-MM-DD') AS "dueDate",e.description,e.invoice_id AS "invoiceId",e.reference_invoice_id AS "referenceInvoiceId",e.actor_id AS "actorId",coalesce((SELECT sum(s.amount_paise) FROM daybook.ledger_settlements s WHERE s.agency_id=e.agency_id AND(s.debit_entry_id=e.id OR s.credit_entry_id=e.id)),0)::text AS settled_paise`;
const map = (r: Raw): LedgerRow => ({
  ...r,
  createdAt: r.created_at.toISOString(),
  amountPaise: BigInt(r.amount_paise),
  settledPaise: BigInt(r.settled_paise),
});
export async function readLedger(c: PoolClient, residentId: string) {
  return (
    await c.query<Raw>(
      `SELECT ${projection} FROM daybook.ledger_entries e WHERE resident_id=$1 ORDER BY entry_date,e.created_at,e.id`,
      [residentId],
    )
  ).rows.map(map);
}
export async function entryBySource(c: PoolClient, sourceKey: string) {
  const r = (
    await c.query<Raw>(
      `SELECT ${projection} FROM daybook.ledger_entries e WHERE source_key=$1`,
      [sourceKey],
    )
  ).rows[0];
  return r ? map(r) : undefined;
}
export async function insertEntry(
  c: PoolClient,
  row: Omit<LedgerRow, 'settledPaise' | 'createdAt'>,
) {
  await c.query(
    'INSERT INTO daybook.ledger_entries(id,agency_id,resident_id,kind,source_key,amount_paise,entry_date,due_date,description,invoice_id,reference_invoice_id,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      row.id,
      row.agencyId,
      row.residentId,
      row.kind,
      row.sourceKey,
      row.amountPaise.toString(),
      row.date,
      row.dueDate,
      row.description,
      row.invoiceId,
      row.referenceInvoiceId,
      row.actorId,
    ],
  );
  return (await entryBySource(c, row.sourceKey))!;
}
export async function insertSettlement(
  c: PoolClient,
  agencyId: string,
  debitId: string,
  creditId: string,
  amountPaise: bigint,
) {
  await c.query(
    'INSERT INTO daybook.ledger_settlements(id,agency_id,debit_entry_id,credit_entry_id,amount_paise) VALUES(gen_random_uuid(),$1,$2,$3,$4)',
    [agencyId, debitId, creditId, amountPaise.toString()],
  );
}

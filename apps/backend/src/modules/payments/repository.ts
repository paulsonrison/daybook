import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface PaymentRow {
  balanceAfterPaise: bigint | null;
  id: string;
  residentId: string;
  requestId: string;
  purpose: string;
  method: string;
  amountPaise: bigint;
  amount: string;
  date: string;
  reference: string | null;
  targetInvoiceId: string | null;
  status: string;
  receiptCode: string | null;
  confirmationEvidence: string;
  confirmedAt: string | null;
  postingDate: string | null;
  version: number;
}
type Raw = Omit<
  PaymentRow,
  'amountPaise' | 'amount' | 'confirmedAt' | 'balanceAfterPaise'
> & {
  balance_after_paise: string | null;
  amount_paise: string;
  confirmedAt: Date | null;
};
const projection = `id,resident_id AS "residentId",request_id AS "requestId",purpose,method,amount_paise,balance_after_paise::text,to_char(received_date,'YYYY-MM-DD') AS date,reference,target_invoice_id AS "targetInvoiceId",status,receipt_code AS "receiptCode",confirmation_evidence AS "confirmationEvidence",confirmed_at AS "confirmedAt",to_char(posting_date,'YYYY-MM-DD') AS "postingDate",version`;
const mapped = (r: Raw): PaymentRow => ({
  ...r,
  balanceAfterPaise:
    r.balance_after_paise === null ? null : BigInt(r.balance_after_paise),
  amountPaise: BigInt(r.amount_paise),
  amount: moneyString(BigInt(r.amount_paise)),
  confirmedAt: r.confirmedAt?.toISOString() ?? null,
});
export async function readPayments(c: PoolClient, residentId?: string) {
  return (
    await c.query<Raw>(
      `SELECT ${projection} FROM daybook.payments ${residentId ? 'WHERE resident_id=$1' : ''} ORDER BY created_at,id`,
      residentId ? [residentId] : [],
    )
  ).rows.map(mapped);
}
export async function findPayment(c: PoolClient, id: string) {
  const row = (
    await c.query<Raw>(
      `SELECT ${projection} FROM daybook.payments WHERE id=$1`,
      [id],
    )
  ).rows[0];
  return row ? mapped(row) : undefined;
}
export async function paymentForRequest(c: PoolClient, id: string) {
  const row = (
    await c.query<Raw>(
      `SELECT ${projection} FROM daybook.payments WHERE request_id=$1`,
      [id],
    )
  ).rows[0];
  return row ? mapped(row) : undefined;
}
export async function insertPayment(
  c: PoolClient,
  agencyId: string,
  actorId: string,
  row: {
    id: string;
    residentId: string;
    requestId: string;
    purpose: string;
    method: string;
    amountPaise: bigint;
    date: string;
    reference: string | null;
    targetInvoiceId: string | null;
  },
) {
  await c.query(
    'INSERT INTO daybook.payments(id,agency_id,resident_id,request_id,purpose,method,amount_paise,received_date,reference,target_invoice_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      row.id,
      agencyId,
      row.residentId,
      row.requestId,
      row.purpose,
      row.method,
      row.amountPaise.toString(),
      row.date,
      row.reference,
      row.targetInvoiceId,
      actorId,
    ],
  );
  return (await findPayment(c, row.id))!;
}
export async function finishPayment(
  c: PoolClient,
  row: {
    id: string;
    status: string;
    reference: string | null;
    receiptCode: string | null;
    evidence: string;
    actorId: string;
    postingDate: string | null;
    depositEntryId: string | null;
    balanceAfterPaise: bigint | null;
  },
) {
  await c.query(
    "UPDATE daybook.payments SET status=$2,reference=$3,receipt_code=$4,confirmation_evidence=$5,confirmed_by=CASE WHEN $2='CONFIRMED' THEN $6::uuid END,confirmed_at=CASE WHEN $2='CONFIRMED' THEN now() END,posting_date=$7,deposit_entry_id=$8,balance_after_paise=$9,version=version+1 WHERE id=$1",
    [
      row.id,
      row.status,
      row.reference,
      row.receiptCode,
      row.evidence,
      row.actorId,
      row.postingDate,
      row.depositEntryId,
      row.balanceAfterPaise?.toString() ?? null,
    ],
  );
}

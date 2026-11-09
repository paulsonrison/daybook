import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface DepositRow {
  id: string;
  residentId: string;
  fingerprint: string;
  amount_paise: string;
  balance_after_paise: string;
  receiptCode: string;
}
const projection =
  'id,resident_id AS "residentId",fingerprint,amount_paise,balance_after_paise,receipt_code AS "receiptCode"';
export const depositReceipt = (row: DepositRow) => ({
  id: row.id,
  residentId: row.residentId,
  receiptCode: row.receiptCode,
  amount: moneyString(BigInt(row.amount_paise)),
  balance: moneyString(BigInt(row.balance_after_paise)),
});
export async function depositByRequest(client: PoolClient, id: string) {
  return (
    await client.query<DepositRow>(
      `SELECT ${projection} FROM daybook.deposit_entries WHERE request_id=$1`,
      [id],
    )
  ).rows[0];
}
export async function depositBalance(
  client: PoolClient,
  residentId: string,
): Promise<bigint> {
  const { rows } = await client.query<{ balance: string }>(
    "SELECT COALESCE(sum(CASE WHEN kind='RECEIVED' THEN amount_paise ELSE -amount_paise END),0)::text AS balance FROM daybook.deposit_entries WHERE resident_id=$1",
    [residentId],
  );
  return BigInt(rows[0].balance);
}
export async function insertDeposit(
  client: PoolClient,
  row: {
    id: string;
    agencyId: string;
    residentId: string;
    requestId: string;
    fingerprint: string;
    receiptCode: string;
    amount: bigint;
    balance: bigint;
    actorId: string;
  },
) {
  return (
    await client.query<DepositRow>(
      `INSERT INTO daybook.deposit_entries(id,agency_id,resident_id,request_id,fingerprint,receipt_code,kind,amount_paise,balance_after_paise,actor_id) VALUES($1,$2,$3,$4,$5,$6,'RECEIVED',$7,$8,$9) RETURNING ${projection}`,
      [
        row.id,
        row.agencyId,
        row.residentId,
        row.requestId,
        row.fingerprint,
        row.receiptCode,
        row.amount.toString(),
        row.balance.toString(),
        row.actorId,
      ],
    )
  ).rows[0];
}

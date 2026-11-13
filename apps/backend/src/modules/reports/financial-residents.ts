import type { PoolClient } from 'pg';
export interface FinancialResident {
  residentId: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  status: string;
  version: number;
  routeId: string;
  routeName: string;
  routeActive: boolean;
  door: string | null;
  sequence: number | null;
  balancePaise: bigint;
  overduePaise: bigint;
  oldestDueDate: string | null;
  overdueDays: number;
}
export async function financialResidents(
  c: PoolClient,
  today: string,
): Promise<FinancialResident[]> {
  const rows = (
    await c.query<
      Omit<FinancialResident, 'balancePaise' | 'overduePaise'> & {
        balance_paise: string;
        overdue_paise: string;
      }
    >(
      `WITH settlements AS(SELECT debit_entry_id,sum(amount_paise) AS used FROM daybook.ledger_settlements GROUP BY debit_entry_id),totals AS(SELECT resident_id,sum(amount_paise) AS balance FROM daybook.ledger_entries GROUP BY resident_id),debits AS(SELECT e.resident_id,sum(CASE WHEN e.due_date<$1::date THEN greatest(e.amount_paise-coalesce(s.used,0),0) ELSE 0 END) AS overdue,min(e.due_date) FILTER(WHERE e.due_date<$1::date AND e.amount_paise>coalesce(s.used,0)) AS oldest FROM daybook.ledger_entries e LEFT JOIN settlements s ON s.debit_entry_id=e.id WHERE e.amount_paise>0 GROUP BY e.resident_id) SELECT r.id AS "residentId",r.name,r.code,r.phone,r.address,r.status,r.version,r.route_id AS "routeId",route.name AS "routeName",(route.active AND territory.active) AS "routeActive",stop.door,stop.sequence,coalesce(t.balance,0)::text AS balance_paise,coalesce(d.overdue,0)::text AS overdue_paise,to_char(d.oldest,'YYYY-MM-DD') AS "oldestDueDate",coalesce($1::date-d.oldest,0)::integer AS "overdueDays" FROM daybook.residents r JOIN daybook.routes route ON(route.agency_id,route.id)=(r.agency_id,r.route_id) JOIN daybook.territories territory ON(territory.agency_id,territory.id)=(route.agency_id,route.territory_id) LEFT JOIN daybook.route_stops stop ON(stop.agency_id,stop.resident_id)=(r.agency_id,r.id) LEFT JOIN totals t ON t.resident_id=r.id LEFT JOIN debits d ON d.resident_id=r.id ORDER BY route.name,stop.sequence,r.id`,
      [today],
    )
  ).rows;
  return rows.map((r) => ({
    ...r,
    balancePaise: BigInt(r.balance_paise),
    overduePaise: BigInt(r.overdue_paise),
  }));
}

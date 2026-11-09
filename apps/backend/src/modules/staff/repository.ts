import type { PoolClient } from 'pg';
export interface StaffRecord {
  id: string;
  name: string;
  staffCode: string;
  phone: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
  version: number;
  assignedSectors: string[];
}
const projection = 'id,name,staff_code AS "staffCode",phone,status,version';
export async function listStaff(client: PoolClient) {
  const records = await client.query<Omit<StaffRecord, 'assignedSectors'>>(
    `SELECT ${projection} FROM daybook.staff ORDER BY name,id`,
  );
  const assigned = await client.query<{ staff_id: string; sectors: string[] }>(
    'SELECT r.staff_id,t.sectors FROM daybook.routes r JOIN daybook.territories t ON(t.agency_id,t.id)=(r.agency_id,r.territory_id) WHERE r.active AND r.staff_id IS NOT NULL',
  );
  return records.rows.map((row) => ({
    ...row,
    assignedSectors: [
      ...new Set(
        assigned.rows
          .filter((r) => r.staff_id === row.id)
          .flatMap((r) => r.sectors),
      ),
    ].sort(),
  }));
}
export async function findStaff(client: PoolClient, id: string, lock = false) {
  return (
    await client.query<Omit<StaffRecord, 'assignedSectors'>>(
      `SELECT ${projection} FROM daybook.staff WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
}
export async function staffHasActiveRoutes(client: PoolClient, id: string) {
  return Boolean(
    (
      await client.query(
        'SELECT id FROM daybook.routes WHERE staff_id=$1 AND active LIMIT 1',
        [id],
      )
    ).rowCount,
  );
}
export async function writeStaff(
  client: PoolClient,
  agencyId: string,
  row: Omit<StaffRecord, 'assignedSectors' | 'version'>,
  existing: boolean,
) {
  const values = [
    row.name,
    row.staffCode,
    row.phone,
    row.status,
    row.id,
    agencyId,
  ];
  if (existing)
    await client.query(
      'UPDATE daybook.staff SET name=$1,staff_code=$2,phone=$3,status=$4,version=version+1 WHERE id=$5 AND agency_id=$6',
      values,
    );
  else
    await client.query(
      'INSERT INTO daybook.staff(name,staff_code,phone,status,id,agency_id) VALUES($1,$2,$3,$4,$5,$6)',
      values,
    );
  return (await listStaff(client)).find((r) => r.id === row.id)!;
}

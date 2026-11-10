import type { PoolClient } from 'pg';
export async function reconcileDatedAssignments(
  client: PoolClient,
  routeId: string,
  startDate: string,
  endDate: string,
) {
  await client.query(
    `WITH desired AS(SELECT d.id,coalesce(a.staff_id,d.permanent_staff_id) AS staff_id,CASE WHEN a.staff_id IS NOT NULL THEN s.name ELSE d.permanent_staff_name END AS staff_name FROM daybook.delivery_logs d LEFT JOIN LATERAL(SELECT allocation.staff_id FROM daybook.substitute_assignments assignment JOIN daybook.substitute_allocations allocation ON(allocation.agency_id,allocation.assignment_id)=(assignment.agency_id,assignment.id) WHERE assignment.route_id=d.route_id AND assignment.agency_id=d.agency_id AND assignment.active AND d.delivery_date BETWEEN assignment.start_date AND assignment.end_date AND d.drop_order BETWEEN allocation.from_drop AND allocation.to_drop LIMIT 1) a ON true LEFT JOIN daybook.staff s ON(s.agency_id,s.id)=(d.agency_id,a.staff_id) WHERE d.route_id=$1 AND d.delivery_date BETWEEN $2::date AND $3::date) UPDATE daybook.delivery_logs d SET staff_id=desired.staff_id,staff_name=desired.staff_name,version=d.version+1 FROM desired WHERE d.id=desired.id AND (d.staff_id IS DISTINCT FROM desired.staff_id OR d.staff_name IS DISTINCT FROM desired.staff_name)`,
    [routeId, startDate, endDate],
  );
}
export interface Allocation {
  staffId: string;
  fromDrop: number;
  toDrop: number;
}
export interface Assignment {
  id: string;
  routeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  active: boolean;
  version: number;
  allocations: Allocation[];
}
const projection = `id,route_id AS "routeId",to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",reason,active,version`;
export async function readAssignments(client: PoolClient) {
  const records = (
    await client.query<Omit<Assignment, 'allocations'>>(
      `SELECT ${projection} FROM daybook.substitute_assignments ORDER BY start_date,id`,
    )
  ).rows;
  const allocations = (
    await client.query<Allocation & { assignmentId: string }>(
      'SELECT assignment_id AS "assignmentId",staff_id AS "staffId",from_drop AS "fromDrop",to_drop AS "toDrop" FROM daybook.substitute_allocations ORDER BY from_drop',
    )
  ).rows;
  return records.map((row) => ({
    ...row,
    allocations: allocations
      .filter((a) => a.assignmentId === row.id)
      .map(({ staffId, fromDrop, toDrop }) => ({ staffId, fromDrop, toDrop })),
  }));
}
export async function writeAssignment(
  client: PoolClient,
  agencyId: string,
  row: Omit<Assignment, 'version'>,
  existing: boolean,
) {
  const values = [
    row.routeId,
    row.startDate,
    row.endDate,
    row.reason,
    row.active,
    row.id,
    agencyId,
  ];
  if (existing)
    await client.query(
      'UPDATE daybook.substitute_assignments SET route_id=$1,start_date=$2,end_date=$3,reason=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7',
      values,
    );
  else
    await client.query(
      'INSERT INTO daybook.substitute_assignments(route_id,start_date,end_date,reason,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      values,
    );
  await client.query(
    'DELETE FROM daybook.substitute_allocations WHERE assignment_id=$1',
    [row.id],
  );
  for (const a of row.allocations)
    await client.query(
      'INSERT INTO daybook.substitute_allocations(id,agency_id,assignment_id,staff_id,from_drop,to_drop) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)',
      [agencyId, row.id, a.staffId, a.fromDrop, a.toDrop],
    );
  return (await readAssignments(client)).find((a) => a.id === row.id)!;
}

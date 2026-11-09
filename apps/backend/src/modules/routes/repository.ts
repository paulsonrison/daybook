import type { PoolClient } from 'pg';
export interface StopRecord {
  id: string;
  label: string;
  door: string;
  sequence: number;
}
export interface RouteRecord {
  id: string;
  code: string;
  name: string;
  territoryId: string;
  staffId: string | null;
  staffName: string | null;
  active: boolean;
  version: number;
  stops: StopRecord[];
}
const projection =
  'r.id,r.code,r.name,r.territory_id AS "territoryId",r.staff_id AS "staffId",s.name AS "staffName",r.active,r.version';
export async function readRoutes(client: PoolClient, id?: string) {
  const rows = await client.query<Omit<RouteRecord, 'stops'>>(
    `SELECT ${projection} FROM daybook.routes r LEFT JOIN daybook.staff s ON(s.agency_id,s.id)=(r.agency_id,r.staff_id) ${id ? 'WHERE r.id=$1' : ''} ORDER BY r.code,r.id`,
    id ? [id] : [],
  );
  const stops = await client.query<StopRecord & { routeId: string }>(
    'SELECT id,route_id AS "routeId",label,door,sequence FROM daybook.route_stops ORDER BY sequence,id',
  );
  return rows.rows.map((row) => ({
    ...row,
    stops: stops.rows.filter((s) => s.routeId === row.id),
  }));
}
export async function findRoute(client: PoolClient, id: string) {
  return (
    await client.query<{
      version: number;
      active: boolean;
      territoryId: string;
      staffId: string | null;
    }>(
      'SELECT version,active,territory_id AS "territoryId",staff_id AS "staffId" FROM daybook.routes WHERE id=$1 FOR UPDATE',
      [id],
    )
  ).rows[0];
}
export async function routeStopIds(client: PoolClient, id: string) {
  return new Set(
    (
      await client.query<{ id: string }>(
        'SELECT id FROM daybook.route_stops WHERE route_id=$1',
        [id],
      )
    ).rows.map((r) => r.id),
  );
}
export async function writeRoute(
  client: PoolClient,
  agencyId: string,
  row: Omit<RouteRecord, 'staffName' | 'version' | 'stops'>,
  existing: boolean,
) {
  const values = [
    row.code,
    row.name,
    row.territoryId,
    row.staffId,
    row.active,
    row.id,
    agencyId,
  ];
  if (existing)
    await client.query(
      'UPDATE daybook.routes SET code=$1,name=$2,territory_id=$3,staff_id=$4,active=$5,version=version+1 WHERE id=$6 AND agency_id=$7',
      values,
    );
  else
    await client.query(
      'INSERT INTO daybook.routes(code,name,territory_id,staff_id,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      values,
    );
}
export async function replaceStops(
  client: PoolClient,
  agencyId: string,
  routeId: string,
  stops: StopRecord[],
) {
  await client.query(
    'DELETE FROM daybook.route_stops WHERE route_id=$1 AND NOT(id=ANY($2::uuid[]))',
    [routeId, stops.map((s) => s.id)],
  );
  for (const stop of stops)
    await client.query(
      'INSERT INTO daybook.route_stops(id,agency_id,route_id,label,door,sequence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET label=excluded.label,door=excluded.door,sequence=excluded.sequence WHERE route_stops.agency_id=excluded.agency_id AND route_stops.route_id=excluded.route_id',
      [stop.id, agencyId, routeId, stop.label, stop.door, stop.sequence],
    );
}

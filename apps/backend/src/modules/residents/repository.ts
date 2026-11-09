import type { PoolClient } from 'pg';
import { moneyString } from '../money.js';
export interface ResidentWrite {
  id: string;
  agencyId: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  sector: string;
  routeId: string;
  status: string;
  requestId: string;
  fingerprint: string;
}
export interface ResidentRow {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  sector: string;
  routeId: string;
  status: string;
  version: number;
  dropOrder: number;
  depositPaise: string;
}
const projection = `r.id,r.code,r.name,r.address,r.phone,r.sector,r.route_id AS "routeId",r.status,r.version,s.sequence AS "dropOrder",COALESCE((SELECT sum(CASE WHEN e.kind='RECEIVED' THEN e.amount_paise ELSE -e.amount_paise END) FROM daybook.deposit_entries e WHERE(e.agency_id,e.resident_id)=(r.agency_id,r.id)),0)::text AS "depositPaise"`;
export async function readResidents(client: PoolClient, id?: string) {
  const result = await client.query<ResidentRow>(
    `SELECT ${projection} FROM daybook.residents r LEFT JOIN daybook.route_stops s ON(s.agency_id,s.resident_id)=(r.agency_id,r.id) ${id ? 'WHERE r.id=$1' : ''} ORDER BY r.name,r.id`,
    id ? [id] : [],
  );
  return result.rows.map((row) => ({
    ...row,
    depositBalance: moneyString(BigInt(row.depositPaise)),
  }));
}
export async function lockResident(client: PoolClient, id: string) {
  return (
    await client.query<{
      id: string;
      routeId: string;
      version: number;
      status: string;
      code: string;
    }>(
      'SELECT id,route_id AS "routeId",version,status,code FROM daybook.residents WHERE id=$1 FOR UPDATE',
      [id],
    )
  ).rows[0];
}
export async function creationRequest(client: PoolClient, id: string) {
  return (
    await client.query<{ id: string; fingerprint: string }>(
      'SELECT id,creation_fingerprint AS fingerprint FROM daybook.residents WHERE creation_request_id=$1',
      [id],
    )
  ).rows[0];
}
export async function writeResident(
  client: PoolClient,
  row: ResidentWrite,
  existing: boolean,
) {
  const values = [
    row.name,
    row.address,
    row.phone,
    row.sector,
    row.routeId,
    row.status,
    row.id,
    row.agencyId,
  ];
  if (existing)
    await client.query(
      'UPDATE daybook.residents SET name=$1,address=$2,phone=$3,sector=$4,route_id=$5,status=$6,version=version+1 WHERE id=$7 AND agency_id=$8',
      values,
    );
  else
    await client.query(
      'INSERT INTO daybook.residents(name,address,phone,sector,route_id,status,id,agency_id,code,creation_request_id,creation_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [...values, row.code, row.requestId, row.fingerprint],
    );
}
export interface ResidentStop {
  id: string;
  residentId: string | null;
  sequence: number;
  routeId: string;
  label: string;
  door: string;
}
export async function findStop(
  client: PoolClient,
  routeId: string,
  sequence: number,
) {
  return (
    await client.query<ResidentStop>(
      'SELECT id,resident_id AS "residentId",sequence,route_id AS "routeId",label,door FROM daybook.route_stops WHERE route_id=$1 AND sequence=$2',
      [routeId, sequence],
    )
  ).rows[0];
}
export async function residentStop(client: PoolClient, residentId: string) {
  return (
    await client.query<ResidentStop>(
      'SELECT id,resident_id AS "residentId",sequence,route_id AS "routeId",label,door FROM daybook.route_stops WHERE resident_id=$1',
      [residentId],
    )
  ).rows[0];
}
export async function linkStop(
  client: PoolClient,
  agencyId: string,
  residentId: string,
  stopId: string,
  routeId: string,
  label: string,
  door: string,
  sequence: number,
  existing: boolean,
) {
  const values = [stopId, agencyId, routeId, label, door, sequence, residentId];
  if (existing)
    await client.query(
      'UPDATE daybook.route_stops SET route_id=$3,label=$4,door=$5,sequence=$6,resident_id=$7 WHERE id=$1 AND agency_id=$2',
      values,
    );
  else
    await client.query(
      'INSERT INTO daybook.route_stops(id,agency_id,route_id,label,door,sequence,resident_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      values,
    );
}
export async function touchRoutes(client: PoolClient, ids: string[]) {
  await client.query(
    'UPDATE daybook.routes SET version=version+1 WHERE id=ANY($1::uuid[])',
    [[...new Set(ids)]],
  );
}
export async function routeSectorChoices(client: PoolClient, routeId: string) {
  return (
    await client.query<{ active: boolean; sectors: string[] }>(
      'SELECT r.active,t.sectors FROM daybook.routes r JOIN daybook.territories t ON(t.agency_id,t.id)=(r.agency_id,r.territory_id) WHERE r.id=$1',
      [routeId],
    )
  ).rows[0];
}

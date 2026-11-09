import type { PoolClient } from 'pg';
export async function hasResidentsOutsideSectors(
  client: PoolClient,
  id: string,
  keys: string[],
) {
  return Boolean(
    (
      await client.query(
        'SELECT r.id FROM daybook.residents r JOIN daybook.routes route ON (route.agency_id,route.id)=(r.agency_id,r.route_id) WHERE route.territory_id=$1 AND NOT(lower(r.sector)=ANY($2::text[])) LIMIT 1',
        [id, keys],
      )
    ).rowCount,
  );
}
export interface TerritoryRecord {
  id: string;
  name: string;
  locality: string;
  pinCodes: string[];
  sectors: string[];
  active: boolean;
  version: number;
}
export interface TerritoryWrite {
  id: string;
  agencyId: string;
  name: string;
  locality: string;
  localityKey: string;
  pinCodes: string[];
  sectors: string[];
  sectorKeys: string[];
  active: boolean;
}
const projection =
  'id,name,locality,pin_codes AS "pinCodes",sectors,active,version';
export async function listTerritories(client: PoolClient) {
  return (
    await client.query<TerritoryRecord>(
      `SELECT ${projection} FROM daybook.territories ORDER BY name,id`,
    )
  ).rows;
}
export async function findTerritory(
  client: PoolClient,
  id: string,
  lock = false,
) {
  return (
    await client.query<TerritoryRecord>(
      `SELECT ${projection} FROM daybook.territories WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
}
export async function overlapsTerritory(
  client: PoolClient,
  id: string,
  locality: string,
  pins: string[],
  sectors: string[],
) {
  return Boolean(
    (
      await client.query(
        'SELECT id FROM daybook.territories WHERE id<>$1 AND active AND locality_key=$2 AND pin_codes && $3::text[] AND sector_keys && $4::text[]',
        [id, locality, pins, sectors],
      )
    ).rowCount,
  );
}
export async function territoryHasActiveRoutes(client: PoolClient, id: string) {
  return Boolean(
    (
      await client.query(
        'SELECT id FROM daybook.routes WHERE territory_id=$1 AND active LIMIT 1',
        [id],
      )
    ).rowCount,
  );
}
export async function writeTerritory(
  client: PoolClient,
  row: TerritoryWrite,
  existing: boolean,
) {
  const values = [
    row.name,
    row.locality,
    row.localityKey,
    row.pinCodes,
    row.sectors,
    row.sectorKeys,
    row.active,
    row.id,
    row.agencyId,
  ];
  const result = existing
    ? await client.query<TerritoryRecord>(
        `UPDATE daybook.territories SET name=$1,locality=$2,locality_key=$3,pin_codes=$4,sectors=$5,sector_keys=$6,active=$7,version=version+1 WHERE id=$8 AND agency_id=$9 RETURNING ${projection}`,
        values,
      )
    : await client.query<TerritoryRecord>(
        `INSERT INTO daybook.territories(name,locality,locality_key,pin_codes,sectors,sector_keys,active,id,agency_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${projection}`,
        values,
      );
  return result.rows[0];
}

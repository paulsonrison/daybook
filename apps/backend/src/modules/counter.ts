import type { PoolClient } from 'pg';
export async function nextCode(
  client: PoolClient,
  agencyId: string,
  name: string,
  prefix: string,
): Promise<string> {
  const { rows } = await client.query<{ value: string }>(
    'INSERT INTO daybook.agency_counters(agency_id,name,value) VALUES($1,$2,1) ON CONFLICT(agency_id,name) DO UPDATE SET value=agency_counters.value+1 RETURNING value::text',
    [agencyId, name],
  );
  return `${prefix}${rows[0].value.padStart(4, '0')}`;
}

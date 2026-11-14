import type { Pool, PoolClient } from 'pg';

export async function assertRuntimeRole(
  pool: Pick<Pool, 'query'>,
): Promise<void> {
  const { rows } = await pool.query(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,pg_has_role(current_user,'daybook_auth','MEMBER') AS auth_member FROM pg_roles WHERE rolname=current_user",
  );
  if (!rows.length || rows[0].rolsuper || rows[0].rolbypassrls)
    throw new Error(
      'The application must use a non-superuser database role without BYPASSRLS.',
    );
  if (
    rows[0].auth_member ||
    rows[0].rolcreaterole ||
    rows[0].rolcreatedb ||
    rows[0].rolreplication
  )
    throw new Error(
      'Use a restricted runtime role without authentication-owner membership or administrative privileges.',
    );
  const encoding = (await pool.query('SHOW server_encoding')).rows[0]
    ?.server_encoding;
  if (encoding !== 'UTF8')
    throw new Error(
      'A UTF8 database is required for supported resident names and languages.',
    );
}

export async function withTenant<T>(
  pool: Pool,
  agencyId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      agencyId,
    )
  )
    throw new Error('Invalid agency identity.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('daybook.agency_id',$1,true)", [
      agencyId,
    ]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

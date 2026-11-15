import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertRuntimeRole } from './tenant.js';

/** Preview-only bootstrap. This owner connection never reaches an HTTP process. */
export async function preparePreviewDatabase(
  ownerUrl: string,
  password: string,
) {
  if (!/^[A-Za-z0-9+/=_-]{32,128}$/.test(password))
    throw new Error('A generated preview runtime password is required.');
  const owner = new pg.Client({
    connectionString: ownerUrl,
    connectionTimeoutMillis: 10000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('SELECT pg_advisory_xact_lock(78130421)');
    await owner.query('CREATE SCHEMA IF NOT EXISTS daybook');
    for (const role of ['daybook_app', 'daybook_auth', 'daybook_scheduler']) {
      if (
        !(await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]))
          .rowCount
      )
        await owner.query(
          `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
      await owner.query(`GRANT ${role} TO CURRENT_USER`);
    }
    // PostgreSQL requires the target function owner to have schema CREATE.
    await owner.query(
      'GRANT USAGE,CREATE ON SCHEMA daybook TO daybook_auth,daybook_scheduler',
    );
    await owner.query(
      'CREATE TABLE IF NOT EXISTS public.daybook_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const directory = fileURLToPath(
      new URL('../../db/migrations/', import.meta.url),
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if (
        (
          await owner.query(
            'SELECT 1 FROM public.daybook_migrations WHERE name=$1',
            [name],
          )
        ).rowCount
      )
        continue;
      await owner.query(await readFile(`${directory}/${name}`, 'utf8'));
      await owner.query(
        'INSERT INTO public.daybook_migrations(name) VALUES($1)',
        [name],
      );
    }
    await owner.query(
      'REVOKE CREATE ON SCHEMA daybook FROM daybook_auth,daybook_scheduler',
    );
    if (
      !(
        await owner.query(
          "SELECT 1 FROM pg_roles WHERE rolname='daybook_preview_runtime'",
        )
      ).rowCount
    )
      await owner.query(
        'CREATE ROLE daybook_preview_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
      );
    // Password is constrained above, never user text, and never logged.
    await owner.query(
      `ALTER ROLE daybook_preview_runtime PASSWORD '${password}'`,
    );
    await owner.query('GRANT daybook_app TO daybook_preview_runtime');
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  } finally {
    await owner.end();
  }
  const url = new URL(ownerUrl);
  url.username = 'daybook_preview_runtime';
  url.password = password;
  const runtimeUrl = url.toString();
  const pool = new pg.Pool({
    connectionString: runtimeUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    await assertRuntimeRole(pool);
  } finally {
    await pool.end();
  }
  return runtimeUrl;
}

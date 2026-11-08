import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.js';
const pool = createPool();
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(78130421)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS public.daybook_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const directory = fileURLToPath(
      new URL('../../db/migrations/', import.meta.url),
    );
    const files = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of files) {
      const existing = await client.query(
        'SELECT name FROM public.daybook_migrations WHERE name = $1',
        [name],
      );
      if (existing.rowCount) continue;
      await client.query(await readFile(`${directory}/${name}`, 'utf8'));
      await client.query(
        'INSERT INTO public.daybook_migrations (name) VALUES ($1)',
        [name],
      );
      console.log(`Applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch {
  console.error(
    'Migration failed. Check database availability and SQL migration files.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

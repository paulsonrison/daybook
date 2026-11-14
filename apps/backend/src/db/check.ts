import { createPool } from './pool.js';
const pool = createPool();
try {
  await pool.query('SELECT 1');
  const encoding = (await pool.query('SHOW server_encoding')).rows[0]
    ?.server_encoding;
  if (encoding !== 'UTF8') {
    console.error(
      'A UTF8 database is required for supported resident names and languages.',
    );
    process.exitCode = 1;
  } else console.log('PostgreSQL UTF8 connection verified.');
} catch {
  console.error(
    'PostgreSQL unavailable. Check DATABASE_URL and start PostgreSQL.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

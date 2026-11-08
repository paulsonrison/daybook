import { createPool } from './pool.js';
const pool = createPool();
try {
  await pool.query('SELECT 1');
  console.log('PostgreSQL connection verified.');
} catch {
  console.error(
    'PostgreSQL unavailable. Check DATABASE_URL and start PostgreSQL.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

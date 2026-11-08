import 'dotenv/config';
import pg from 'pg';
export function createPool() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env in apps/backend.',
    );
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', () =>
    console.error('Unexpected idle database connection error.'),
  );
  return pool;
}

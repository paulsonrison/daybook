import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createPool } from './db/pool.js';
const pool = createPool();
const app = createApp({
  frontendOrigin: process.env.FRONTEND_ORIGIN,
  databaseReady: async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
});
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '127.0.0.1';
const server = createServer(app);
server.listen(port, host, () =>
  console.log(`Daybook API: http://${host}:${port}/graphql`),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  server.close(() => {
    void pool.end().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

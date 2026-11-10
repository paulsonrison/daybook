import 'dotenv/config';
import { createPool } from './db/pool.js';
import { assertRuntimeRole } from './db/tenant.js';
import { runAgencyJobs, workerTenants } from './modules/jobs/service.js';
const pool = createPool();
await assertRuntimeRole(pool);
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log('Daybook background worker started.');
try {
  while (!stopping) {
    try {
      for (const tenant of await workerTenants(pool)) {
        if (stopping) break;
        await runAgencyJobs(pool, tenant, new Date());
      }
    } catch {
      console.error(
        'Worker cycle failed; it will retry with durable job state.',
      );
    }
    for (let second = 0; second < 30 && !stopping; second++)
      await new Promise((done) => setTimeout(done, 1000));
  }
} finally {
  await pool.end();
}

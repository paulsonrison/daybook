import 'dotenv/config';
import { createPool } from './db/pool.js';
import { assertRuntimeRole } from './db/tenant.js';
import { workerTenants } from './modules/jobs/service.js';
import { providerRegistry } from './modules/communications/config.js';
import { runCommunicationsCycle } from './modules/communications/worker.js';
const pool = createPool();
await assertRuntimeRole(pool);
const providers = providerRegistry();
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log('Daybook communications worker started.');
try {
  while (!stopping) {
    try {
      for (const tenant of await workerTenants(pool)) {
        if (stopping) break;
        try {
          await runCommunicationsCycle(pool, tenant.id, providers);
        } catch {
          console.error(
            'One agency communication cycle failed; durable state is retained for the next cycle.',
          );
        }
      }
    } catch {
      console.error(
        'Communication tenant discovery failed; the worker will retry.',
      );
    }
    for (let second = 0; second < 10 && !stopping; second++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await pool.end();
}

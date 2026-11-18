import { readBackupConfiguration } from './modules/backups/configuration.js';
import { PrivateObjectStore } from './storage/private.js';
import { executeBackup } from './modules/backups/runner.js';
import pg from 'pg';
import { readBackupStatus } from './modules/backups/status.js';
import { backupClientMajor } from './modules/backups/client.js';
const stores: PrivateObjectStore[] = [];
function report(result: { state: string; [key: string]: unknown }) {
  if (process.send && process.connected)
    process.send({ type: 'daybook.backup.result', result }, () =>
      process.disconnect(),
    );
  else console.log(JSON.stringify(result));
}
let key: Buffer | undefined;
const shutdown = new AbortController();
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (shutdown.signal.aborted) return;
  shutdown.abort();
  for (const store of stores) store.close();
  shutdownTimer = setTimeout(() => process.exit(1), 10000);
  shutdownTimer.unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  const configuration = readBackupConfiguration(process.env);
  const operation = process.argv[2] ?? 'tick';
  if (!['tick', 'status'].includes(operation) || process.argv.length > 3)
    throw new Error('Invalid backup operation.');
  if (!configuration) {
    report({ state: 'NOT_CONFIGURED' });
    process.exitCode = 2;
  } else {
    key = configuration.key;
    if (operation === 'status') {
      const pool = new pg.Pool({
        connectionString: configuration.databaseUrl,
        max: 1,
        connectionTimeoutMillis: 10000,
        statement_timeout: 15000,
        query_timeout: 20000,
      });
      pool.on('error', () => {});
      try {
        const status = await readBackupStatus(
          pool,
          configuration.scopeId,
          configuration.destinations.map((d) => d.name),
        );
        const major = await backupClientMajor(configuration.pgDumpPath);
        const clientReady = major !== null && major >= 17;
        report({
          ...status,
          clientReady,
          protected: status.protected && clientReady,
        });
      } finally {
        await pool.end();
      }
    } else {
      const destinations = configuration.destinations.map((d) => {
        const store = new PrivateObjectStore(d.storage);
        stores.push(store);
        return { name: d.name, store, limit: d.limit };
      });
      const result = await executeBackup({
        ...configuration,
        destinations,
        signal: shutdown.signal,
      });
      report(result);
      if (!['VERIFIED', 'SKIPPED'].includes(result.state)) process.exitCode = 2;
    }
  }
} catch {
  console.error(
    'Backup configuration or execution failed. Check the private worker settings.',
  );
  process.exitCode = 1;
} finally {
  for (const store of stores) store.close();
  key?.fill(0);
  if (shutdownTimer) clearTimeout(shutdownTimer);
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}

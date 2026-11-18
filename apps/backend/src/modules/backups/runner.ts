import pg from 'pg';
import { createReadStream } from 'node:fs';
import { createDatabaseArchive } from './archive.js';
import {
  claimBackup,
  recordBackupSnapshot,
  reserveBackupDestination,
  performBackupUpload,
  finishBackupRun,
  type BackupClaim,
} from './jobs.js';
import { replicateBackup, type BackupDestination } from './replication.js';
export interface BackupInvocation {
  databaseUrl: string;
  scopeId: string;
  keyId: string;
  key?: Uint8Array;
  pgDumpPath?: string;
  now?: Date;
  signal?: AbortSignal;
  destinations: Array<{
    name: 'neon' | 'b2';
    store: NonNullable<BackupDestination['store']>;
    limit: number;
  }>;
}
export async function executeBackup(configuration: BackupInvocation): Promise<{
  state:
    | 'NOT_CONFIGURED'
    | 'SKIPPED'
    | 'VERIFIED'
    | 'PARTIAL'
    | 'FAILED'
    | 'ABANDONED';
  runId?: string;
}> {
  if (configuration.signal?.aborted) return { state: 'ABANDONED' };
  if (
    !configuration.key ||
    configuration.key.byteLength !== 32 ||
    !configuration.destinations.length
  )
    return { state: 'NOT_CONFIGURED' };
  if (
    new Set(configuration.destinations.map((d) => d.name)).size !==
    configuration.destinations.length
  )
    throw new Error('Configure each backup destination once.');
  const start = configuration.now ?? new Date(),
    started = performance.now(),
    clock = () => new Date(start.valueOf() + performance.now() - started);
  const pool = new pg.Pool({
    connectionString: configuration.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', () => {});
  let claim: BackupClaim | null = null,
    archive: Awaited<ReturnType<typeof createDatabaseArchive>> | undefined;
  try {
    claim = await claimBackup(pool, {
      period: start.toISOString().slice(0, 10),
      scopeId: configuration.scopeId,
      keyId: configuration.keyId,
      now: clock(),
    });
    if (!claim) return { state: 'SKIPPED' };
    archive = await createDatabaseArchive({
      databaseUrl: configuration.databaseUrl,
      pgDumpPath: configuration.pgDumpPath,
      signal: configuration.signal,
    });
    await recordBackupSnapshot(
      pool,
      claim,
      { bytes: archive.bytes, sha256: archive.sha256 },
      clock(),
    );
    const snapshot = {
      identity: { agencyId: claim.scopeId, backupId: claim.objectId },
      key: configuration.key,
      bytes: archive.bytes,
      sha256: archive.sha256,
      source: () => createReadStream(archive!.file),
    };
    for (const destination of configuration.destinations) {
      configuration.signal?.throwIfAborted();
      const reservation = await reserveBackupDestination(
        pool,
        claim,
        destination.name,
        destination.limit,
        clock(),
      );
      if (!reservation) continue;
      await performBackupUpload(
        pool,
        claim,
        destination.name,
        clock(),
        async () => {
          const result = await replicateBackup(snapshot, [
            {
              name: destination.name,
              store: destination.store,
              budget: reservation,
            },
          ]);
          return (
            result.destinations.find((d) => d.name === destination.name)
              ?.state === 'VERIFIED'
          );
        },
      );
    }
    return {
      state: await finishBackupRun(pool, claim, clock()),
      runId: claim.id,
    };
  } catch {
    if (!claim) return { state: 'FAILED' };
    try {
      return {
        state: await finishBackupRun(pool, claim, clock()),
        runId: claim.id,
      };
    } catch {
      return { state: 'ABANDONED', runId: claim.id };
    }
  } finally {
    await archive?.cleanup();
    await pool.end();
  }
}

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { MAX_BACKUP_BYTES } from './encryption.js';
import { backupRetention } from './policy.js';
import type { PrivateObjectIdentity } from '../../storage/private.js';
export interface BackupClaim {
  id: string;
  objectId: string;
  scopeId: string;
  keyId: string;
  token: string;
  attempt: number;
}
type Destination = 'neon' | 'b2';
const CAPACITY_LIMIT = 1024 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function clock(now: Date) {
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid backup clock.');
  return now;
}
async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  const onDisconnect = () => {};
  client.on('error', onDisconnect);
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='15s'");
    // Cooperate with the transfer's session lock before any operator writes.
    const gate = await client.query(
      'SELECT pg_try_advisory_xact_lock_shared(78130423) AS ready',
    );
    if (!gate.rows[0].ready)
      throw new Error('Database transfer maintenance is active.');
    const marker = await client.query(
      "SELECT to_regclass('public.daybook_transfer_maintenance') IS NOT NULL AS present",
    );
    if (
      marker.rows[0].present &&
      (
        await client.query(
          'SELECT EXISTS(SELECT 1 FROM public.daybook_transfer_maintenance) AS active',
        )
      ).rows[0].active
    )
      throw new Error(
        'Database transfer maintenance keeps the retired source fenced.',
      );

    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    client.removeListener('error', onDisconnect);
  }
}
async function lease(client: PoolClient, claim: BackupClaim, now: Date) {
  clock(now);
  const result = await client.query(
    "SELECT * FROM daybook.operator_backup_runs WHERE id=$1 AND object_id=$2 AND lease_token=$3 AND status='RUNNING' AND lease_until>$4 FOR UPDATE",
    [claim.id, claim.objectId, claim.token, now],
  );
  if (!result.rowCount)
    throw new Error('Backup lease is expired or no longer owned.');
  return result.rows[0];
}
export async function claimBackup(
  pool: Pool,
  input: { period: string; scopeId: string; keyId: string; now: Date },
): Promise<BackupClaim | null> {
  clock(input.now);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.period) ||
    !uuid.test(input.scopeId) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.keyId)
  )
    throw new Error('Invalid backup job identity.');
  return transaction(pool, async (client) => {
    await client.query(
      'INSERT INTO daybook.operator_backup_runs(id,period,scope_id,key_id) VALUES($1,$2,$3,$4) ON CONFLICT(period) DO NOTHING',
      [randomUUID(), input.period, input.scopeId, input.keyId],
    );
    const row = (
      await client.query(
        'SELECT * FROM daybook.operator_backup_runs WHERE period=$1 FOR UPDATE SKIP LOCKED',
        [input.period],
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.scope_id !== input.scopeId.toLowerCase() ||
      row.key_id !== input.keyId
    )
      throw new Error(
        'Backup period belongs to a different system scope or key.',
      );
    if (
      row.status === 'VERIFIED' ||
      (row.status === 'RUNNING' &&
        new Date(row.lease_until).valueOf() > input.now.valueOf())
    )
      return null;
    if (row.attempts >= 3) {
      if (row.status === 'RUNNING') {
        const verified = Number(
          (
            await client.query(
              "SELECT count(*) AS n FROM daybook.operator_backup_objects WHERE object_id=$1 AND status='VERIFIED'",
              [row.object_id],
            )
          ).rows[0].n,
        );
        const state =
          verified === 2 ? 'VERIFIED' : verified === 1 ? 'PARTIAL' : 'FAILED';
        await client.query(
          'UPDATE daybook.operator_backup_runs SET status=$2,lease_token=NULL,lease_until=NULL,finished_at=$3 WHERE id=$1',
          [row.id, state, input.now],
        );
      }
      return null;
    }
    const claim = {
      id: row.id,
      objectId: randomUUID(),
      scopeId: row.scope_id,
      keyId: row.key_id,
      token: randomUUID(),
      attempt: row.attempts + 1,
    };
    await client.query(
      "UPDATE daybook.operator_backup_runs SET status='RUNNING',attempts=$2,object_id=$3,lease_token=$4,lease_until=$5,archive_bytes=NULL,sha256=NULL,finished_at=NULL WHERE id=$1",
      [
        claim.id,
        claim.attempt,
        claim.objectId,
        claim.token,
        new Date(input.now.valueOf() + 15 * 60000),
      ],
    );
    return claim;
  });
}
export async function recordBackupSnapshot(
  pool: Pool,
  claim: BackupClaim,
  snapshot: { bytes: number; sha256: string },
  now: Date,
) {
  if (
    !Number.isSafeInteger(snapshot.bytes) ||
    snapshot.bytes < 1 ||
    snapshot.bytes > MAX_BACKUP_BYTES ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  )
    throw new Error('Invalid backup snapshot metadata.');
  return transaction(pool, async (client) => {
    const row = await lease(client, claim, now);
    if (
      row.archive_bytes !== null &&
      (row.archive_bytes !== snapshot.bytes || row.sha256 !== snapshot.sha256)
    )
      throw new Error('A backup attempt snapshot is immutable.');
    await client.query(
      'UPDATE daybook.operator_backup_runs SET archive_bytes=$2,sha256=$3 WHERE id=$1',
      [claim.id, snapshot.bytes, snapshot.sha256],
    );
  });
}
export async function reserveBackupDestination(
  pool: Pool,
  claim: BackupClaim,
  destination: Destination,
  limit: number,
  now: Date,
) {
  if (
    !['neon', 'b2'].includes(destination) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CAPACITY_LIMIT
  )
    throw new Error('Invalid backup destination quota.');
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(78130425)');
    const row = await lease(client, claim, now);
    if (row.archive_bytes === null)
      throw new Error(
        'Complete the database snapshot before reserving upload capacity.',
      );
    const current = (
      await client.query(
        'SELECT * FROM daybook.operator_backup_objects WHERE object_id=$1 AND destination=$2',
        [claim.objectId, destination],
      )
    ).rows[0];
    const usage = (
      await client.query(
        "SELECT coalesce(sum(reserved_bytes) FILTER(WHERE status='VERIFIED'),0)::text AS used,coalesce(sum(reserved_bytes) FILTER(WHERE status IN('RESERVED','FAILED')),0)::text AS reserved FROM daybook.operator_backup_objects WHERE destination=$1 AND object_id<>$2",
        [destination, claim.objectId],
      )
    ).rows[0];
    const used = Number(usage.used),
      otherReserved = Number(usage.reserved),
      bytes = row.archive_bytes + 36;
    if (
      !Number.isSafeInteger(used + otherReserved + bytes) ||
      used + otherReserved + bytes > limit
    )
      return null;
    if (!current)
      await client.query(
        "INSERT INTO daybook.operator_backup_objects(object_id,destination,run_id,attempt,scope_id,key_id,status,reserved_bytes,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,$9)",
        [
          claim.objectId,
          destination,
          claim.id,
          row.attempts,
          row.scope_id,
          row.key_id,
          bytes,
          row.sha256,
          now,
        ],
      );
    else if (current.reserved_bytes !== bytes || current.sha256 !== row.sha256)
      throw new Error(
        'Backup object reservation differs from its immutable snapshot.',
      );
    return {
      objectId: claim.objectId,
      used,
      otherReserved,
      limit,
      state: current?.status ?? 'RESERVED',
    };
  });
}
export async function finishBackupDestination(
  pool: Pool,
  claim: BackupClaim,
  destination: Destination,
  state: 'VERIFIED' | 'FAILED',
  now: Date,
) {
  if (
    !['neon', 'b2'].includes(destination) ||
    !['VERIFIED', 'FAILED'].includes(state)
  )
    throw new Error('Invalid backup destination result.');
  return transaction(pool, async (client) => {
    await lease(client, claim, now);
    const result = await client.query(
      "UPDATE daybook.operator_backup_objects SET status=$3,verified_at=CASE WHEN $3='VERIFIED' THEN $4::timestamptz ELSE NULL END WHERE object_id=$1 AND destination=$2 AND status IN('RESERVED',$3)",
      [claim.objectId, destination, state, now],
    );
    if (!result.rowCount)
      throw new Error(
        'Backup destination was not reserved or has a different final result.',
      );
  });
}
export async function finishBackupRun(
  pool: Pool,
  claim: BackupClaim,
  now: Date,
) {
  return transaction(pool, async (client) => {
    await lease(client, claim, now);
    const verified = Number(
      (
        await client.query(
          "SELECT count(*) AS n FROM daybook.operator_backup_objects WHERE object_id=$1 AND status='VERIFIED'",
          [claim.objectId],
        )
      ).rows[0].n,
    );
    const state =
      verified === 2 ? 'VERIFIED' : verified === 1 ? 'PARTIAL' : 'FAILED';
    await client.query(
      'UPDATE daybook.operator_backup_runs SET status=$2,lease_token=NULL,lease_until=NULL,finished_at=$3 WHERE id=$1',
      [claim.id, state, now],
    );
    return state;
  });
}

/** Hold the same transfer fence through provider I/O and durable result recording. */
export async function performBackupUpload(
  pool: Pool,
  claim: BackupClaim,
  destination: Destination,
  now: Date,
  upload: () => Promise<boolean>,
) {
  if (!['neon', 'b2'].includes(destination))
    throw new Error('Invalid backup destination.');
  return transaction(pool, async (client) => {
    await lease(client, claim, now);
    const object = (
      await client.query(
        'SELECT status FROM daybook.operator_backup_objects WHERE object_id=$1 AND destination=$2',
        [claim.objectId, destination],
      )
    ).rows[0];
    if (!object) throw new Error('Reserve backup capacity before upload.');
    if (object.status === 'VERIFIED') return true;
    if (object.status !== 'RESERVED') return false;
    await client.query("SET LOCAL idle_in_transaction_session_timeout='180s'");
    const started = performance.now();
    let verified = false;
    try {
      verified = await upload();
    } catch {
      verified = false;
    }
    const finished = new Date(now.valueOf() + performance.now() - started);
    await lease(client, claim, finished);
    await client.query(
      "UPDATE daybook.operator_backup_objects SET status=$3,verified_at=CASE WHEN $3='VERIFIED' THEN $4::timestamptz ELSE NULL END WHERE object_id=$1 AND destination=$2",
      [claim.objectId, destination, verified ? 'VERIFIED' : 'FAILED', finished],
    );
    return verified;
  });
}

/** Remove at most one expired, verified object. Unknown uploads never release quota. */
export async function expireOneBackup(
  pool: Pool,
  scopeId: string,
  destination: Destination,
  now: Date,
  remove: (object: PrivateObjectIdentity) => Promise<void>,
) {
  clock(now);
  if (!uuid.test(scopeId) || !['neon', 'b2'].includes(destination))
    throw new Error('Invalid backup retention scope.');
  const scope = scopeId.toLowerCase();
  return transaction(pool, async (client) => {
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('backup-retention:'||$1||':'||$2,0)) AS ready",
      [scope, destination],
    );
    if (!lock.rows[0].ready) return false;
    const records = (
      await client.query(
        "SELECT o.* FROM daybook.operator_backup_objects o JOIN daybook.operator_backup_runs r ON r.id=o.run_id WHERE o.scope_id=$1 AND o.destination=$2 AND o.status='VERIFIED' AND r.status<>'RUNNING' ORDER BY o.created_at DESC,o.object_id LIMIT 1001 FOR UPDATE OF o SKIP LOCKED",
        [scope, destination],
      )
    ).rows;
    if (records.length > 1000)
      throw new Error('Backup retention inventory exceeds its bounded limit.');
    const plan = backupRetention(
      records.map((r) => ({
        id: r.object_id,
        agencyId: r.scope_id,
        key: `agencies/${r.scope_id}/backups/${r.object_id}`,
        createdAt: new Date(r.created_at).toISOString(),
        verified: true,
        bytes: r.reserved_bytes,
      })),
      scope,
      now,
    );
    const objectId = plan.deleteIds.at(-1);
    if (!objectId) return false;
    await client.query("SET LOCAL idle_in_transaction_session_timeout='90s'");
    await remove({ agencyId: scope, objectId, kind: 'backup' });
    // Keep usage reserved until storage has confirmed all owned versions are absent.
    await client.query('SELECT pg_advisory_xact_lock(78130425)');
    await client.query(
      "UPDATE daybook.operator_backup_objects SET status='DELETED',verified_at=NULL WHERE object_id=$1 AND destination=$2 AND status='VERIFIED'",
      [objectId, destination],
    );
    return true;
  });
}

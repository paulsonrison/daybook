import { createHash } from 'node:crypto';
import type { PrivateObjectStore } from '../../storage/private.js';
import {
  encryptBackup,
  decryptBackup,
  MAX_BACKUP_BYTES,
  type BackupIdentity,
} from './encryption.js';
import { canReserveBackup } from './policy.js';
export interface BackupSnapshot {
  identity: BackupIdentity;
  key: Uint8Array;
  bytes: number;
  sha256: string;
  source: () => AsyncIterable<Uint8Array>;
}
export interface BackupDestination {
  name: 'neon' | 'b2';
  store?: Pick<PrivateObjectStore, 'put' | 'get'>;
  /** Atomic reservation accounting: otherReserved excludes this backup's own held lease. */
  budget: { used: number; otherReserved: number; limit: number };
}
export interface ReplicationResult {
  name: 'neon' | 'b2';
  state: 'VERIFIED' | 'MISSING' | 'QUOTA' | 'FAILED';
  verifiedAt: string | null;
}
/** A successful PUT alone never counts as a verified or independently replicated backup. */
export async function replicateBackup(
  snapshot: BackupSnapshot,
  destinations: BackupDestination[],
) {
  if (snapshot.key.byteLength !== 32)
    throw new Error('Backup encryption key is missing or invalid.');
  if (
    !Number.isSafeInteger(snapshot.bytes) ||
    snapshot.bytes < 1 ||
    snapshot.bytes > MAX_BACKUP_BYTES ||
    !/^[0-9a-f]{64}$/.test(snapshot.sha256)
  )
    throw new Error('Backup snapshot metadata is invalid.');
  if (
    new Set(destinations.map((d) => d.name)).size !== destinations.length ||
    destinations.some((d) => !['neon', 'b2'].includes(d.name))
  )
    throw new Error('Configure each independent backup destination once.');
  const scope = {
    agencyId: snapshot.identity.agencyId,
    objectId: snapshot.identity.backupId,
    kind: 'backup' as const,
  };
  const results: ReplicationResult[] = [];
  for (const name of ['neon', 'b2'] as const) {
    const destination = destinations.find((d) => d.name === name);
    if (!destination?.store) {
      results.push({ name, state: 'MISSING', verifiedAt: null });
      continue;
    }
    try {
      if (
        !canReserveBackup({
          used: destination.budget.used,
          reserved: destination.budget.otherReserved,
          limit: destination.budget.limit,
          requested: snapshot.bytes + 36,
        })
      ) {
        results.push({ name, state: 'QUOTA', verifiedAt: null });
        continue;
      }
      async function* checkedSource() {
        const hash = createHash('sha256');
        let count = 0;
        for await (const chunk of snapshot.source()) {
          count += chunk.byteLength;
          if (count > snapshot.bytes)
            throw new Error('Snapshot size mismatch.');
          hash.update(chunk);
          yield chunk;
        }
        if (count !== snapshot.bytes || hash.digest('hex') !== snapshot.sha256)
          throw new Error('Snapshot checksum mismatch.');
      }
      await destination.store.put(
        scope,
        encryptBackup(
          checkedSource(),
          snapshot.key,
          snapshot.identity,
          snapshot.bytes,
        ),
        snapshot.bytes + 36,
      );
      const restored = await decryptBackup(
        destination.store.get(scope, snapshot.bytes + 36),
        snapshot.key,
        snapshot.identity,
        snapshot.bytes,
      );
      try {
        if (
          restored.length !== snapshot.bytes ||
          createHash('sha256').update(restored).digest('hex') !==
            snapshot.sha256
        )
          throw new Error('Backup restore verification failed.');
      } finally {
        restored.fill(0);
      }
      results.push({
        name,
        state: 'VERIFIED',
        verifiedAt: new Date().toISOString(),
      });
    } catch {
      results.push({ name, state: 'FAILED', verifiedAt: null });
    }
  }
  return {
    protected: results.every((r) => r.state === 'VERIFIED'),
    destinations: results,
  };
}

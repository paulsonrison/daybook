import type { Pool } from 'pg';
import { backupHealth } from './policy.js';
type Destination = 'neon' | 'b2';
/** System protection summary only: no tenant data, object paths, keys or operator IDs. */
export async function readBackupStatus(
  pool: Pool,
  scopeId: string,
  configured: Destination[],
  now = new Date(),
) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(scopeId))
    throw new Error('Invalid backup status scope.');
  const { rows } = await pool.query({
    text: `SELECT destination,max(verified_at) AS verified_at,max(created_at) AS attempted_at,
      (array_agg(status ORDER BY created_at DESC,attempt DESC))[1] AS latest_status,
      coalesce(sum(reserved_bytes) FILTER(WHERE status='VERIFIED'),0)::text AS used,
      coalesce(sum(reserved_bytes) FILTER(WHERE status IN('RESERVED','FAILED')),0)::text AS reserved
      FROM daybook.operator_backup_objects WHERE scope_id=$1 GROUP BY destination`,
    values: [scopeId],
  });
  const destinations = (['neon', 'b2'] as const).map((name) => {
    const row = rows.find((r) => r.destination === name);
    return {
      name,
      configured: configured.includes(name),
      verifiedAt: row?.verified_at
        ? new Date(row.verified_at).toISOString()
        : null,
      lastAttemptAt: row?.attempted_at
        ? new Date(row.attempted_at).toISOString()
        : null,
      error: row && row.latest_status !== 'VERIFIED' ? 'UNVERIFIED' : null,
      usedBytes: Number(row?.used ?? 0),
      reservedBytes: Number(row?.reserved ?? 0),
    };
  });
  const health = backupHealth(destinations, now);
  const latest = await pool.query({
    text: 'SELECT status FROM daybook.operator_backup_runs WHERE scope_id=$1 ORDER BY period DESC LIMIT 1',
    values: [scopeId],
  });
  const latestRunState: string | null = latest.rows[0]?.status ?? null;
  return {
    state: 'READY' as const,
    protected:
      health.protected && !['FAILED', 'PARTIAL'].includes(latestRunState ?? ''),
    latestRunState,
    checkedAt: now.toISOString(),
    destinations: destinations.map((d) => ({
      ...d,
      healthy: health.destinations.find((h) => h.name === d.name)!.healthy,
    })),
  };
}

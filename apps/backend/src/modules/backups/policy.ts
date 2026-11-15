export interface BackupRecord {
  id: string;
  agencyId: string;
  key: string;
  createdAt: string;
  verified: boolean;
  bytes: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
/** Only verified, uniquely identified objects under this tenant's exact backup prefix can expire. */
export function backupRetention(
  records: BackupRecord[],
  agencyId: string,
  now: Date,
) {
  if (!UUID.test(agencyId) || !Number.isFinite(now.valueOf()))
    throw new Error('Invalid backup retention scope.');
  const counts = new Map<string, number>();
  for (const record of records)
    counts.set(
      record.id.toLowerCase(),
      (counts.get(record.id.toLowerCase()) ?? 0) + 1,
    );
  const eligible = records
    .filter(
      (r) =>
        UUID.test(r.id) &&
        r.agencyId === agencyId &&
        r.key ===
          `agencies/${agencyId.toLowerCase()}/backups/${r.id.toLowerCase()}` &&
        r.verified &&
        counts.get(r.id.toLowerCase()) === 1 &&
        Number.isSafeInteger(r.bytes) &&
        r.bytes >= 0 &&
        Number.isFinite(Date.parse(r.createdAt)) &&
        Date.parse(r.createdAt) <= now.valueOf(),
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const keep = new Set<string>();
  const seenDays = new Set<number>(),
    seenWeeks = new Set<number>(),
    seenMonths = new Set<number>();
  const today = Math.floor(now.valueOf() / DAY),
    thisWeek = Math.floor((today + 3) / 7);
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const record of eligible) {
    const stamp = new Date(record.createdAt),
      day = Math.floor(stamp.valueOf() / DAY),
      week = Math.floor((day + 3) / 7);
    const month = stamp.getUTCFullYear() * 12 + stamp.getUTCMonth();
    if (
      (today - day < 7 && !seenDays.has(day)) ||
      (thisWeek - week < 4 && !seenWeeks.has(week)) ||
      (thisMonth - month < 3 && !seenMonths.has(month))
    )
      keep.add(record.id);
    seenDays.add(day);
    seenWeeks.add(week);
    seenMonths.add(month);
  }
  // Always retain at least the newest verified recovery point, even after a long outage.
  if (eligible[0]) keep.add(eligible[0].id);
  return {
    deleteIds: eligible.filter((r) => !keep.has(r.id)).map((r) => r.id),
  };
}
export function canReserveBackup(input: {
  used: number;
  reserved: number;
  requested: number;
  limit: number;
}) {
  if (
    Object.values(input).some((v) => !Number.isSafeInteger(v) || v < 0) ||
    input.limit < 1 ||
    input.requested < 1
  )
    throw new Error('Invalid backup quota.');
  const total = input.used + input.reserved + input.requested;
  if (!Number.isSafeInteger(total))
    throw new Error('Invalid backup quota arithmetic.');
  return total <= input.limit;
}
export interface BackupDestinationHealth {
  name: string;
  configured: boolean;
  verifiedAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
}
export function backupHealth(
  destinations: BackupDestinationHealth[],
  now: Date,
) {
  if (!Number.isFinite(now.valueOf()))
    throw new Error('Invalid backup health clock.');
  const counts = new Map<string, number>();
  for (const d of destinations)
    counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  const states = destinations.map((d) => {
    const verified = Date.parse(d.verifiedAt ?? ''),
      attempt = Date.parse(d.lastAttemptAt ?? '');
    return {
      name: d.name,
      healthy:
        !!d.name &&
        counts.get(d.name) === 1 &&
        d.configured &&
        !d.error &&
        Number.isFinite(verified) &&
        Number.isFinite(attempt) &&
        verified <= now.valueOf() &&
        attempt <= now.valueOf() &&
        verified >= attempt &&
        now.valueOf() - verified <= 36 * 3600000,
    };
  });
  return {
    protected: states.filter((d) => d.healthy).length >= 2,
    destinations: states,
  };
}

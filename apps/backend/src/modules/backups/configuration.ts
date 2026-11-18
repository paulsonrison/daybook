import { requireDirectMigrationUrl } from '../../db/transfer.js';
import type { StorageConfiguration } from '../../storage/private.js';
export interface BackupConfiguration {
  databaseUrl: string;
  scopeId: string;
  keyId: string;
  key: Buffer;
  pgDumpPath?: string;
  destinations: Array<{
    name: 'neon' | 'b2';
    storage: StorageConfiguration;
    limit: number;
  }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function endpoint(value: string, name: 'neon' | 'b2', region: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid backup storage endpoint.');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('Invalid backup storage endpoint.');
  if (name === 'b2' && host !== `s3.${region}.backblazeb2.com`)
    throw new Error('Backblaze backup endpoint must match its region.');
  if (
    name === 'neon' &&
    (!host.endsWith('.neon.tech') || !host.includes('.storage.'))
  )
    throw new Error('Use the approved Neon storage endpoint.');
  return url.origin;
}
export function readBackupConfiguration(
  env: NodeJS.ProcessEnv,
): BackupConfiguration | null {
  if (env.DAYBOOK_BACKUP_ENABLED !== 'true') return null;
  const databaseUrl = env.DAYBOOK_BACKUP_DATABASE_URL,
    scopeId = env.DAYBOOK_BACKUP_SCOPE_ID,
    keyId = env.DAYBOOK_BACKUP_KEY_ID,
    keyHex = env.DAYBOOK_BACKUP_KEY;
  if (
    !databaseUrl ||
    !scopeId ||
    !UUID.test(scopeId) ||
    !keyId ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(keyId) ||
    !keyHex ||
    !/^[a-f0-9]{64}$/i.test(keyHex)
  )
    throw new Error(
      'Backup owner connection, system scope and external encryption key are required.',
    );
  requireDirectMigrationUrl(databaseUrl);
  const destinations: BackupConfiguration['destinations'] = [];
  for (const name of ['neon', 'b2'] as const) {
    const prefix = `DAYBOOK_BACKUP_${name.toUpperCase()}_`;
    const values = [
      'ENDPOINT',
      'REGION',
      'BUCKET',
      'ACCESS_KEY_ID',
      'SECRET_ACCESS_KEY',
    ].map((k) => env[prefix + k]);
    if (values.every((v) => !v)) continue;
    if (values.some((v) => !v))
      throw new Error('Backup destination configuration is incomplete.');
    const [url, region, bucket, accessKeyId, secretAccessKey] =
      values as string[];
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') ||
      !/^[a-z0-9-]+$/.test(region)
    )
      throw new Error('Invalid backup destination configuration.');
    destinations.push({
      name,
      storage: {
        endpoint: endpoint(url, name, region),
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
      },
      limit: 512 * 1024 * 1024,
    });
  }
  return {
    databaseUrl,
    scopeId: scopeId.toLowerCase(),
    keyId,
    key: Buffer.from(keyHex, 'hex'),
    pgDumpPath: env.DAYBOOK_BACKUP_PG_DUMP_PATH || undefined,
    destinations,
  };
}

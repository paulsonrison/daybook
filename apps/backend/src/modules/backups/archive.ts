import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rootCertificates } from 'node:tls';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { requireDirectMigrationUrl } from '../../db/transfer.js';
import { MAX_BACKUP_BYTES } from './encryption.js';
function connectionEnvironment(connection: string, caFile: string) {
  requireDirectMigrationUrl(connection);
  const url = new URL(connection);
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
  ])
    if (process.env[name]) env[name] = process.env[name];
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || '5432';
  env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_-]+$/.test(env.PGDATABASE))
    throw new Error('Invalid backup database name.');
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGSSLMODE =
    url.searchParams.get('sslmode') ||
    (url.hostname.toLowerCase().replace(/\.$/, '').endsWith('.neon.tech')
      ? 'verify-full'
      : 'prefer');
  if (
    ![
      'disable',
      'allow',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
    ].includes(env.PGSSLMODE)
  )
    throw new Error('Invalid backup connection TLS mode.');
  env.PGSSLROOTCERT = caFile;
  env.PGCONNECT_TIMEOUT = '15';
  env.PGOPTIONS =
    '-c statement_timeout=120000 -c idle_in_transaction_session_timeout=120000';
  return env;
}
export function waitForBackupProcess(child: ChildProcess) {
  // Raw stderr may include connection identities. Never return it to a browser or log.
  child.stderr?.resume();
  return new Promise<void>((done, reject) => {
    let failed = false;
    child.once('error', () => {
      failed = true;
      // AbortError means termination was requested, not that a restore rolled back.
      // Escalate immediately and wait for close before releasing files or the job lease.
      child.kill('SIGKILL');
    });
    child.once('close', (code) => {
      if (!failed && code === 0) done();
      else
        reject(
          new Error('PostgreSQL backup client failed or could not start.'),
        );
    });
  });
}
async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), 'daybook-backup-'));
  const caFile = join(directory, 'ca.pem');
  await writeFile(caFile, rootCertificates.join('\n'), {
    flag: 'wx',
    mode: 0o600,
  });
  return { directory, caFile };
}
async function removeOwned(directory: string, files: string[]) {
  for (const file of files)
    await unlink(join(directory, file)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  await rmdir(directory);
}
export async function createDatabaseArchive(configuration: {
  databaseUrl: string;
  pgDumpPath?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}) {
  configuration.signal?.throwIfAborted();
  const limit = configuration.maxBytes ?? MAX_BACKUP_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BACKUP_BYTES)
    throw new Error('Invalid database archive byte limit.');
  requireDirectMigrationUrl(configuration.databaseUrl);
  const { directory, caFile } = await scratch(),
    file = join(directory, 'database.dump');
  let bytes = 0;
  const hash = createHash('sha256');
  let child: ChildProcess | undefined;
  try {
    child = spawn(
      configuration.pgDumpPath || 'pg_dump',
      [
        '--format=custom',
        '--compress=0',
        '--schema=daybook',
        '--schema=public',
        '--strict-names',
        '--no-password',
        '--lock-wait-timeout=10000',
      ],
      {
        env: connectionEnvironment(configuration.databaseUrl, caFile),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: configuration.signal
          ? AbortSignal.any([configuration.signal, AbortSignal.timeout(180000)])
          : AbortSignal.timeout(180000),
      },
    );
    const completed = waitForBackupProcess(child);
    // Install a rejection handler immediately; both stream and process must finish successfully.
    completed.catch(() => {});
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > limit)
          return done(new Error('Database backup exceeds byte limit.'));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        child.stdout!,
        bound,
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      );
      await completed;
    } catch {
      child.kill('SIGKILL');
      await completed.catch(() => {});
      throw new Error('Database archive failed or exceeded its byte limit.');
    }
    if (bytes < 5) throw new Error('Database archive is empty.');
    return {
      file,
      bytes,
      sha256: hash.digest('hex'),
      cleanup: () => removeOwned(directory, ['database.dump', 'ca.pem']),
    };
  } catch (error) {
    child?.kill('SIGKILL');
    await removeOwned(directory, ['database.dump', 'ca.pem']);
    throw error;
  }
}
/** Operator recovery only: never overwrite existing data or use a clean/drop restore. */
export async function restoreEmptyDatabaseArchive(configuration: {
  databaseUrl: string;
  file: string;
  pgRestorePath?: string;
}) {
  requireDirectMigrationUrl(configuration.databaseUrl);
  const client = new pg.Client({
    connectionString: configuration.databaseUrl,
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
  });
  client.on('error', () => {});
  let temporary: Awaited<ReturnType<typeof scratch>> | undefined,
    prepared = false;
  try {
    await client.connect();
    const occupied = (
      await client.query(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN('r','p','v','m','S','f')) AS occupied",
      )
    ).rows[0].occupied;
    if (occupied)
      throw new Error('Restore requires an empty disposable database.');
    temporary = await scratch();
    const { directory, caFile } = temporary;
    const listing = spawn(
      configuration.pgRestorePath || 'pg_restore',
      ['--list', configuration.file],
      {
        env: connectionEnvironment(configuration.databaseUrl, caFile),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: AbortSignal.timeout(30000),
      },
    );
    const listed = waitForBackupProcess(listing);
    listed.catch(() => {});
    const entries: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of listing.stdout!) {
        length += chunk.length;
        if (length > 1048576)
          throw new Error('Backup archive catalogue exceeds its limit.');
        entries.push(Buffer.from(chunk));
      }
      await listed;
    } catch (error) {
      listing.kill('SIGKILL');
      await listed.catch(() => {});
      throw error;
    }
    const lines = Buffer.concat(entries).toString('utf8').split(/\r?\n/);
    const schemaOwner = lines
      .map((line) => line.match(/^\d+; \d+ \d+ SCHEMA - daybook (.+)$/)?.[1])
      .find(Boolean)
      ?.trim();
    const owner = (await client.query('SELECT current_user AS name')).rows[0]
      .name as string;
    if (schemaOwner !== owner)
      throw new Error(
        'Restore using the original Daybook migration owner role.',
      );
    const existing = (
      await client.query(
        "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='daybook'",
      )
    ).rows[0];
    if (existing && existing.owner !== owner)
      throw new Error('The empty recovery schema has a different owner.');
    // Non-superuser owners need this bridge before pg_restore assigns definer owners.
    // The roles are NOLOGIN and are never inherited by the HTTP runtime.
    await client.query('CREATE SCHEMA IF NOT EXISTS daybook');
    prepared = true;
    await client.query(
      'GRANT USAGE,CREATE ON SCHEMA daybook TO daybook_auth,daybook_scheduler',
    );
    const listFile = join(directory, 'restore.list');
    const applicationOwners = new Set([
      owner,
      'daybook_auth',
      'daybook_scheduler',
      'daybook_app',
    ]);
    const list = lines
      .filter((line) => {
        if (/^\d+; \d+ \d+ SCHEMA - (public|daybook) /.test(line)) return false;
        // Managed hosts install their own administrator defaults. Preserve app ACLs,
        // but do not attempt ALTER DEFAULT PRIVILEGES for a foreign platform role.
        if (line.includes(' DEFAULT ACL '))
          return applicationOwners.has(line.trimEnd().split(/\s+/).at(-1)!);
        return true;
      })
      .join('\n');
    await writeFile(listFile, list, { flag: 'wx', mode: 0o600 });
    const child = spawn(
      configuration.pgRestorePath || 'pg_restore',
      [
        '--exit-on-error',
        `--use-list=${listFile}`,
        `--dbname=${decodeURIComponent(new URL(configuration.databaseUrl).pathname.slice(1))}`,
        '--single-transaction',
        '--no-password',
        configuration.file,
      ],
      {
        env: connectionEnvironment(configuration.databaseUrl, caFile),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        signal: AbortSignal.timeout(180000),
      },
    );
    await waitForBackupProcess(child);
  } finally {
    try {
      if (prepared)
        await client.query(
          'REVOKE CREATE ON SCHEMA daybook FROM daybook_auth,daybook_scheduler',
        );
    } finally {
      try {
        if (temporary)
          await removeOwned(temporary.directory, ['restore.list', 'ca.pem']);
      } finally {
        await client.end();
      }
    }
  }
}

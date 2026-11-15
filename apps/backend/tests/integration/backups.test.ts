import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { testApi } from './support.js';
import {
  encryptBackup,
  decryptBackup,
} from '../../src/modules/backups/encryption.js';
test('real pg_dump encrypted archive restores into an empty disposable database with original sessions, exact ledger and native data', async () => {
  const feature = await import('../../src/modules/backups/archive.js').catch(
    () => null,
  );
  assert.ok(
    feature?.createDatabaseArchive,
    'Real bounded database archive implementation must exist',
  );
  const admin = new pg.Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await admin.connect();
  const targetName = `backup_restore_${randomBytes(5).toString('hex')}`;
  const targetUrl = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
  targetUrl.pathname = `/${targetName}`;
  const api = testApi();
  let restoredApi: ReturnType<typeof testApi> | undefined,
    archive:
      Awaited<ReturnType<typeof feature.createDatabaseArchive>> | undefined;
  const directory = await mkdtemp(resolve('.cache/backup-restore-'));
  const restoredFile = join(directory, 'verified.dump');
  try {
    await admin.query(`CREATE DATABASE ${targetName}`);
    const cookies = [await api.agency(), await api.agency()];
    for (const cookie of cookies) {
      const route = await api.route(cookie);
      const resident = await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: 'അനിത हिन्दी',
            address: 'Exact backup fixture',
            phone: '9876543210',
            routeId: route.id,
            sector: 'Lotus Lane',
            dropOrder: 1,
          },
        },
      );
      assert.ok(resident.data?.saveResident);
      const debit = await api.query(
        cookie,
        'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            residentId: resident.data.saveResident.id,
            direction: 'DEBIT',
            category: 'OPENING',
            amount: '90071992547409.93',
            reason: 'Restore fixture',
          },
        },
      );
      assert.ok(debit.data?.postAdjustment, JSON.stringify(debit));
    }
    const binary = randomBytes(1048576),
      binaryId = randomUUID();
    await admin.query(
      'CREATE TABLE daybook.backup_binary_fixture(id uuid PRIMARY KEY,payload bytea NOT NULL,byte_length integer GENERATED ALWAYS AS (octet_length(payload)) STORED)',
    );
    await admin.query(
      'INSERT INTO daybook.backup_binary_fixture(id,payload) VALUES($1,$2)',
      [binaryId, binary],
    );
    await admin.query(
      'CREATE TABLE public.daybook_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await admin.query(
      "INSERT INTO public.daybook_migrations(name) VALUES('restore-fixture')",
    );
    await assert.rejects(
      feature.createDatabaseArchive({
        databaseUrl: process.env.TEST_ADMIN_DATABASE_URL!,
        pgDumpPath: process.env.TEST_PG_DUMP_PATH,
        maxBytes: 1024,
      }),
      /limit|failed/i,
    );
    assert.ok(
      (await api.query(cookies[0], '{me{id}}')).data?.me,
      'Failed backup leaves source usable',
    );
    archive = await feature.createDatabaseArchive({
      databaseUrl: process.env.TEST_ADMIN_DATABASE_URL!,
      pgDumpPath: process.env.TEST_PG_DUMP_PATH,
    });
    const original = await readFile(archive.file);
    assert.equal(original.subarray(0, 5).toString(), 'PGDMP');
    assert.equal(original.length, archive.bytes);
    assert.equal(
      createHash('sha256').update(original).digest('hex'),
      archive.sha256,
    );
    const key = randomBytes(32),
      scope = { agencyId: randomUUID(), backupId: randomUUID() };
    const plain = await decryptBackup(
      encryptBackup(createReadStream(archive.file), key, scope),
      key,
      scope,
    );
    assert.deepEqual(plain, original);
    await writeFile(restoredFile, plain, { flag: 'wx', mode: 0o600 });
    plain.fill(0);
    key.fill(0);
    await assert.rejects(
      feature.restoreEmptyDatabaseArchive({
        databaseUrl: process.env.TEST_ADMIN_DATABASE_URL!,
        file: restoredFile,
        pgRestorePath: process.env.TEST_PG_RESTORE_PATH,
      }),
      /empty/i,
    );
    await feature.restoreEmptyDatabaseArchive({
      databaseUrl: targetUrl.toString(),
      file: restoredFile,
      pgRestorePath: process.env.TEST_PG_RESTORE_PATH,
    });
    const target = new pg.Client({ connectionString: targetUrl.toString() });
    await target.connect();
    try {
      const restoredBinary = (
        await target.query(
          'SELECT payload,byte_length FROM daybook.backup_binary_fixture WHERE id=$1',
          [binaryId],
        )
      ).rows[0];
      assert.deepEqual(restoredBinary.payload, binary);
      assert.equal(restoredBinary.byte_length, binary.length);
      assert.equal(
        (await target.query('SELECT name FROM public.daybook_migrations'))
          .rows[0].name,
        'restore-fixture',
      );
      assert.equal(
        (
          await target.query(
            "SELECT relforcerowsecurity FROM pg_class WHERE oid='daybook.residents'::regclass",
          )
        ).rows[0].relforcerowsecurity,
        true,
      );
      assert.deepEqual(
        (
          await target.query(
            "SELECT p.proname,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='daybook' AND p.prosecdef ORDER BY p.proname",
          )
        ).rows,
        (
          await admin.query(
            "SELECT p.proname,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='daybook' AND p.prosecdef ORDER BY p.proname",
          )
        ).rows,
      );
      assert.equal(
        (await target.query('SELECT count(*)::int AS n FROM daybook.agencies'))
          .rows[0].n,
        2,
      );
      assert.deepEqual(
        (
          await target.query(
            'SELECT amount_paise::text AS amount FROM daybook.ledger_entries ORDER BY id',
          )
        ).rows.map((r) => r.amount),
        ['9007199254740993', '9007199254740993'],
      );
      assert.equal(
        (await target.query('SELECT name FROM daybook.residents ORDER BY id'))
          .rows[0].name,
        'അനിത हिन्दी',
      );
    } finally {
      await target.end();
    }
    const runtime = new URL(process.env.TEST_RUNTIME_DATABASE_URL!);
    runtime.pathname = `/${targetName}`;
    restoredApi = testApi(undefined, undefined, undefined, runtime.toString());
    for (const cookie of cookies)
      assert.ok(
        (await restoredApi.query(cookie, '{me{id agencyId}}')).data?.me,
      );
    await assert.rejects(
      feature.restoreEmptyDatabaseArchive({
        databaseUrl: targetUrl.toString(),
        file: restoredFile,
        pgRestorePath: process.env.TEST_PG_RESTORE_PATH,
      }),
      /empty/i,
    );
  } finally {
    await restoredApi?.pool.end();
    await api.pool.end();
    await archive?.cleanup();
    await unlink(restoredFile).catch(() => {});
    await rmdir(directory);
    await admin.query(`DROP DATABASE ${targetName}`);
    await admin.end();
  }
});

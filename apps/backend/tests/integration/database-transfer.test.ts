import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { preparePreviewDatabase } from '../../src/db/preview.js';
import { testApi } from './support.js';
import { assertRuntimeRole, withTenant } from '../../src/db/tenant.js';
import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function loseCommitAcknowledgement(connection: string) {
  const original = new URL(connection),
    sockets = new Set<Socket>();
  const upstreamPort = Number(original.port),
    upstreamHost = original.hostname;
  let dropped = false;
  const proxy = createServer((client) => {
    const upstream = connect(upstreamPort, upstreamHost);
    sockets.add(client);
    sockets.add(upstream);
    let commit = false,
      tail = Buffer.alloc(0);
    client.on('data', (chunk) => {
      const data = Buffer.concat([tail, chunk]);
      if (!dropped && data.includes(Buffer.from('COMMIT\0'))) commit = true;
      tail = data.subarray(Math.max(0, data.length - 16));
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (commit && !dropped && chunk.includes(Buffer.from('COMMIT\0'))) {
        dropped = true;
        client.destroy();
        upstream.destroy();
      } else client.write(chunk);
    });
    client.on('error', () => {});
    upstream.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  original.hostname = '127.0.0.1';
  original.port = String((proxy.address() as { port: number }).port);
  return {
    url: original.toString(),
    dropped: () => dropped,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => proxy.close(() => done()));
    },
  };
}

test('database transfer preserves every tenant, exact data and retry identities; failure restores source access and cutover never recopies new target writes', async () => {
  const module = await import('../../src/db/transfer.js').catch(() => null);
  assert.ok(
    module?.transferDatabase,
    'A verified database transfer implementation must exist',
  );
  const admin = new pg.Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await admin.connect();
  const suffix = randomBytes(6).toString('hex'),
    owner = `transfer_owner_${suffix}`,
    password = randomBytes(24).toString('hex');
  const names = [
    `transfer_source_${suffix}`,
    `transfer_test_${suffix}`,
    `transfer_live_${suffix}`,
  ];
  const pools: pg.Pool[] = [];
  let api: ReturnType<typeof testApi> | undefined;
  try {
    await admin.query(
      `CREATE ROLE ${owner} LOGIN CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    for (const role of ['daybook_app', 'daybook_auth', 'daybook_scheduler'])
      await admin.query(`GRANT ${role} TO ${owner} WITH ADMIN OPTION`);
    const urls = [];
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
      const url = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
      url.username = owner;
      url.password = password;
      url.pathname = `/${name}`;
      urls.push(url.toString());
    }
    // Neon maintenance owners can bypass RLS; exercise that destination too.
    const privilegedTarget = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
    privilegedTarget.pathname = `/${names[2]}`;
    urls[2] = privilegedTarget.toString();
    const runtime = [];
    for (const url of urls)
      runtime.push(await preparePreviewDatabase(url, password));
    api = testApi(undefined, undefined, undefined, runtime[0]);
    const cookies = [await api.agency(), await api.agency()];
    const residents = [];
    for (const [i, cookie] of cookies.entries()) {
      const savedPreferences = await api.query(
        cookie,
        'mutation($input:AgentPreferencesInput!){saveAgentPreferences(input:$input){locale}}',
        {
          input: {
            requestId: randomUUID(),
            version: 0,
            locale: i === 0 ? 'ml' : 'hi',
            mode: 'dark',
            scheme: 'nord',
            layout: 'CARDS',
            fontFamily: 'inter',
            fontSize: 18,
            fontWeight: 500,
            fontStyle: 'normal',
            lineHeight: 1.6,
          },
        },
      );
      assert.ok(
        savedPreferences.data?.saveAgentPreferences,
        JSON.stringify(savedPreferences),
      );
      const route = await api.route(cookie);
      const result = await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: `Transfer resident ${i}`,
            address: 'മലയാളം · हिंदी · exact transfer',
            phone: '9876543210',
            routeId: route.id,
            sector: 'Lotus Lane',
            dropOrder: 1,
          },
        },
      );
      assert.ok(result.data?.saveResident, JSON.stringify(result));
      residents.push(result.data.saveResident.id);
      const debit = await api.query(
        cookie,
        'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            residentId: residents[i],
            direction: 'DEBIT',
            category: 'OPENING',
            amount: '90071992547409.93',
            reason: 'Exact migration fixture',
          },
        },
      );
      assert.ok(debit.data?.postAdjustment, JSON.stringify(debit));
    }
    const agencyId = (await api.query(cookies[0], '{me{agencyId}}')).data.me
      .agencyId;
    const sourceOwner = new pg.Pool({ connectionString: urls[0], max: 1 });
    pools.push(sourceOwner);
    const documentId = randomUUID(),
      pdf = Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(10485760 - 14, 0x20),
        Buffer.from('%%EOF'),
      ]);
    const actor = (await api.query(cookies[0], '{me{id}}')).data.me.id;
    await withTenant(sourceOwner, agencyId, (c) =>
      c.query(
        "INSERT INTO daybook.documents(id,agency_id,kind,source_id,source_version,resident_id,locale,snapshot,snapshot_hash,filename,status,pdf,sha256,created_by) VALUES($1,$2,'PAYMENT_RECEIPT',$3,1,$4,'ml','{}',$5,'migration.pdf','READY',$6,$7,$8)",
        [
          documentId,
          agencyId,
          randomUUID(),
          residents[0],
          '0'.repeat(64),
          pdf,
          createHash('sha256').update(pdf).digest('hex'),
          actor,
        ],
      ),
    );
    const backupRunId = randomUUID(),
      backupObjectId = randomUUID(),
      backupScopeId = randomUUID();
    await sourceOwner.query(
      "INSERT INTO daybook.operator_backup_runs(id,period,scope_id,key_id,status,attempts,object_id,archive_bytes,sha256) VALUES($1,'2026-11-16',$2,'migration-key','FAILED',1,$3,100,$4)",
      [backupRunId, backupScopeId, backupObjectId, 'e'.repeat(64)],
    );
    await sourceOwner.query(
      "INSERT INTO daybook.operator_backup_objects(object_id,destination,run_id,attempt,scope_id,key_id,status,reserved_bytes,sha256,created_at) VALUES($1,'neon',$2,1,$3,'migration-key','FAILED',136,$4,now())",
      [backupObjectId, backupRunId, backupScopeId, 'e'.repeat(64)],
    );
    const destination = new pg.Pool({ connectionString: urls[1], max: 1 });
    pools.push(destination);
    await destination.query(
      "ALTER TABLE daybook.residents ADD CONSTRAINT transfer_failure CHECK(name NOT LIKE 'Transfer resident%')",
    );
    await assert.rejects(
      module.transferDatabase(urls[0], urls[1], {
        id: 'failed-transfer',
        cutover: true,
      }),
    );
    assert.ok(
      (await api.query(cookies[0], '{me{id}}')).data?.me,
      'Failed transfer restores source authentication',
    );
    assert.equal(
      (
        await destination.query(
          'SELECT count(*)::int AS n FROM daybook.agencies',
        )
      ).rows[0].n,
      0,
      'Partial destination transaction rolled back',
    );
    await destination.query(
      'ALTER TABLE daybook.residents DROP CONSTRAINT transfer_failure',
    );
    const trial = await module.transferDatabase(urls[0], urls[1], {
      id: 'rehearsal',
      cutover: false,
    });
    assert.ok(trial.tables > 40);
    assert.equal(
      (
        await destination.query(
          'SELECT count(*)::int AS n FROM daybook.operator_backup_runs WHERE id=$1',
          [backupRunId],
        )
      ).rows[0].n,
      1,
      'Owner backup job history must survive migration',
    );
    assert.equal(
      (
        await destination.query(
          'SELECT reserved_bytes FROM daybook.operator_backup_objects WHERE object_id=$1',
          [backupObjectId],
        )
      ).rows[0]?.reserved_bytes,
      136,
      'Uncertain upload capacity must survive migration',
    );

    assert.match(trial.sha256, /^[a-f0-9]{64}$/);
    const exact = await withTenant(destination, agencyId, (c) =>
      c.query(
        'SELECT amount_paise::text AS amount FROM daybook.ledger_entries',
      ),
    );
    assert.equal(exact.rows[0].amount, '9007199254740993');
    const document = (
      await withTenant(destination, agencyId, (c) =>
        c.query('SELECT pdf,byte_length FROM daybook.documents WHERE id=$1', [
          documentId,
        ]),
      )
    ).rows[0];
    assert.ok(document.pdf.equals(pdf));
    assert.equal(
      document.byte_length,
      pdf.length,
      'Generated length and exact stored document bytes survive',
    );
    assert.ok(
      (await api.query(cookies[1], '{me{id}}')).data?.me,
      'Rehearsal leaves source usable',
    );
    await assert.rejects(
      module.transferDatabase(urls[0], urls[1], {
        id: 'must-not-overwrite',
        cutover: true,
      }),
      /empty|existing|destination/i,
    );
    const proxy = await loseCommitAcknowledgement(urls[2]);
    let live;
    try {
      live = await module.transferDatabase(urls[0], proxy.url, {
        id: 'cutover',
        cutover: true,
      });
      assert.ok(
        proxy.dropped(),
        'The commit acknowledgement was actually lost',
      );
    } finally {
      await proxy.close();
    }
    assert.equal(live.sha256, trial.sha256);
    const targetRuntime = new pg.Pool({ connectionString: runtime[2], max: 1 });
    pools.push(targetRuntime);
    await assertRuntimeRole(targetRuntime);
    await assert.rejects(
      withTenant(api.pool, agencyId, (c) =>
        c.query('SELECT * FROM daybook.residents'),
      ),
      /permission/i,
      'Old runtime cannot continue reading/writing the stale source',
    );
    const targetApi = testApi(undefined, undefined, undefined, runtime[2]);
    pools.push(targetApi.pool);
    const me = await targetApi.query(cookies[0], '{me{agencyId}}');
    assert.equal(
      me.data.me.agencyId,
      agencyId,
      'Existing session survives migration',
    );
    const preferences = await targetApi.query(
      cookies[0],
      '{agentPreferences{locale version}}',
    );
    assert.deepEqual(
      preferences.data.agentPreferences,
      { locale: 'ml', version: 1 },
      'Agent-specific preferences survive migration',
    );
    const payInput = {
      requestId: randomUUID(),
      residentId: residents[0],
      purpose: 'ACCOUNT',
      method: 'CASH',
      amount: '1.01',
      date: '2024-02-01',
      confirmReceived: true,
      confirmationNote: 'Synthetic post-migration payment',
    };
    const pay = await targetApi.query(
      cookies[0],
      'mutation($input:PaymentInput!){recordPayment(input:$input){id receiptCode}}',
      { input: payInput },
    );
    assert.ok(pay.data?.recordPayment, JSON.stringify(pay));
    const retry = await module.transferDatabase(urls[0], urls[2], {
      id: 'cutover',
      cutover: true,
    });
    assert.deepEqual(retry, live);
    const payments = await targetApi.query(cookies[0], '{payments{amount}}');
    assert.deepEqual(
      payments.data.payments,
      [{ amount: '1.01' }],
      'Startup retry never replaces new destination activity',
    );
    if (process.env.TEST_PREVIEW_START === 'true') {
      const port = await freePort(),
        backendPort = await freePort(),
        origin = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ['scripts/start-preview.mjs'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: urls[0],
          NEON_MIGRATION_DATABASE_URL: urls[2],
          DAYBOOK_DATABASE_TRANSFER_ID: 'cutover',
          PREVIEW_RUNTIME_PASSWORD: password,
          FRONTEND_ORIGIN: origin,
          PORT: String(port),
          PREVIEW_BACKEND_PORT: String(backendPort),
          DOCUMENT_LINK_SECRET: password,
        },
      });
      try {
        const deadline = Date.now() + 60000;
        let ready = false;
        while (Date.now() < deadline && child.exitCode === null) {
          try {
            if (
              (
                await fetch(`${origin}/api/health`, {
                  signal: AbortSignal.timeout(1000),
                })
              ).ok
            ) {
              ready = true;
              break;
            }
          } catch {}
          await new Promise((done) => setTimeout(done, 250));
        }
        assert.ok(ready, 'Migrated production launcher becomes healthy');
        const result = await fetch(`${origin}/api/graphql`, {
          method: 'POST',
          headers: {
            origin,
            cookie: cookies[0],
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query: '{me{agencyId} payments{amount}}' }),
        });
        assert.deepEqual(
          (await result.json()).data,
          { me: { agencyId }, payments: [{ amount: '1.01' }] },
          'Production launcher uses the destination and retains new activity',
        );
      } finally {
        if (process.platform === 'win32') {
          const killer = spawn(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
          await new Promise((done) => killer.once('exit', done));
        } else {
          child.kill('SIGTERM');
          await new Promise((done) => child.once('exit', done));
        }
      }
    }
  } finally {
    await api?.pool.end();
    await Promise.all(pools.map((pool) => pool.end()));
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query('DROP ROLE IF EXISTS daybook_preview_runtime');
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    await admin.end();
  }
});

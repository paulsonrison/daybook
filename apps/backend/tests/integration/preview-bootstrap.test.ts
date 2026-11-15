import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { assertRuntimeRole } from '../../src/db/tenant.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
test('preview bootstraps migrations with owner privileges but returns an isolated least-privilege runtime connection', async () => {
  const module = await import('../../src/db/preview.js').catch(() => null);
  assert.ok(
    module?.preparePreviewDatabase,
    'Preview database bootstrap must exist',
  );
  const admin = new pg.Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await admin.connect();
  const suffix = randomBytes(6).toString('hex'),
    owner = `preview_owner_${suffix}`,
    database = `preview_${suffix}`,
    password = randomBytes(24).toString('hex');
  let runtime: pg.Pool | undefined;
  try {
    await admin.query(
      `CREATE ROLE ${owner} LOGIN CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    for (const role of ['daybook_app', 'daybook_auth', 'daybook_scheduler'])
      await admin.query(`GRANT ${role} TO ${owner} WITH ADMIN OPTION`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${owner}`);
    const ownerUrl = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
    ownerUrl.username = owner;
    ownerUrl.password = password;
    ownerUrl.pathname = `/${database}`;
    const url = await module.preparePreviewDatabase(
      ownerUrl.toString(),
      password,
    );
    runtime = new pg.Pool({ connectionString: url, max: 1 });
    await assertRuntimeRole(runtime);
    assert.equal(
      (
        await runtime.query(
          "SELECT to_regclass('daybook.agencies')::text AS name",
        )
      ).rows[0].name,
      'daybook.agencies',
    );
    const privileges = (
      await runtime.query(
        "SELECT pg_has_role(current_user,'daybook_auth','MEMBER') AS auth, pg_has_role(current_user,'daybook_scheduler','MEMBER') AS scheduler, has_schema_privilege(current_user,'daybook','CREATE') AS create_schema",
      )
    ).rows[0];
    assert.deepEqual(privileges, {
      auth: false,
      scheduler: false,
      create_schema: false,
    });
    const result = (
      await runtime.query('SELECT * FROM daybook.login_identity($1)', [
        'missing@example.test',
      ])
    ).rows;
    assert.deepEqual(result, []);
    assert.equal(
      await module.preparePreviewDatabase(ownerUrl.toString(), password),
      url,
      'Restart reuses migrations and the runtime identity',
    );
    if (process.env.TEST_PREVIEW_START === 'true') {
      const port = await freePort(),
        backendPort = await freePort(),
        origin = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ['scripts/start-preview.mjs'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: ownerUrl.toString(),
          PREVIEW_RUNTIME_PASSWORD: password,
          FRONTEND_ORIGIN: origin,
          PORT: String(port),
          PREVIEW_BACKEND_PORT: String(backendPort),
          DOCUMENT_LINK_SECRET: password,
        },
      });
      try {
        const end = Date.now() + 60000;
        let healthy = false;
        while (Date.now() < end && child.exitCode === null) {
          try {
            if (
              (
                await fetch(`${origin}/api/health`, {
                  signal: AbortSignal.timeout(1000),
                })
              ).ok
            ) {
              healthy = true;
              break;
            }
          } catch {}
          await new Promise((done) => setTimeout(done, 250));
        }
        assert.ok(
          healthy,
          'Combined production frontend/API must become healthy',
        );
        assert.equal(
          (await fetch(`${origin}/manifest.webmanifest`)).status,
          200,
        );
        assert.equal((await fetch(`${origin}/field.html`)).status, 200);
        const registration = await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            agencyName: 'Production preview test',
            name: 'Owner',
            email: `${suffix}@example.test`,
            password: 'Preview test password 123',
          }),
        });
        assert.equal(registration.status, 201);
        const cookie = registration.headers.get('set-cookie')!;
        const response = await fetch(`${origin}/api/graphql`, {
          method: 'POST',
          headers: { origin, cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{me{name agency{name}}}' }),
        });
        assert.deepEqual((await response.json()).data.me, {
          name: 'Owner',
          agency: { name: 'Production preview test' },
        });
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
    await runtime?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    // Runtime is cluster-wide and belongs only to this disposable test cluster.
    await admin.query(`DROP ROLE IF EXISTS daybook_preview_runtime`);
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    await admin.end();
  }
});

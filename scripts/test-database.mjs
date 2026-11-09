import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await mkdir('.cache', { recursive: true });
const databaseDir = await mkdtemp(resolve('.cache/daybook-pg-'));
const probe = createServer();
await new Promise((done, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', done);
});
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const password = randomBytes(24).toString('hex');
const database = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password,
  port,
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: (e) => console.error(e),
});
let admin;
const servers = [];
const logs = [];
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const number = server.address().port;
  await new Promise((done) => server.close(done));
  return number;
}
try {
  await database.initialise();
  await database.start();
  admin = new pg.Client({
    connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
  });
  await admin.connect();
  await admin.query(
    `CREATE ROLE daybook_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  const files = (await readdir('apps/backend/db/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort();
  for (const file of files)
    await admin.query(
      await readFile(`apps/backend/db/migrations/${file}`, 'utf8'),
    );
  console.log(
    `Disposable PostgreSQL 17 started; ${files.length} migrations applied; restricted runtime role enabled.`,
  );
  const runtimeUrl = `postgresql://daybook_app:${password}@127.0.0.1:${port}/postgres`;
  const environment = {
    ...process.env,
    TEST_RUNTIME_DATABASE_URL: runtimeUrl,
    TEST_ADMIN_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
  };
  let args = ['--import', 'tsx', '--test', ...process.argv.slice(2)];
  if (process.argv.length === 2)
    args = [
      '--import',
      'tsx',
      '--test',
      ...(await readdir('apps/backend/tests/integration'))
        .filter((name) => name.endsWith('.test.ts'))
        .sort()
        .map((name) => `apps/backend/tests/integration/${name}`),
    ];
  if (process.argv[2] === '--app') {
    const frontendPort = await freePort(),
      backendPort = await freePort();
    const frontend = `http://127.0.0.1:${frontendPort}`;
    const backend = `http://127.0.0.1:${backendPort}`;
    for (const [name, command, cwd, extra] of [
      [
        'backend',
        ['--import', 'tsx', 'apps/backend/src/server.ts'],
        process.cwd(),
        {
          PORT: String(backendPort),
          DATABASE_URL: runtimeUrl,
          FRONTEND_ORIGIN: frontend,
        },
      ],
      [
        'frontend',
        [
          resolve('node_modules/next/dist/bin/next'),
          'dev',
          '--port',
          String(frontendPort),
          '--hostname',
          '127.0.0.1',
        ],
        resolve('apps/frontend'),
        {
          GRAPHQL_SERVER_URL: backend,
          FRONTEND_ORIGIN: frontend,
          DAYBOOK_BUILD_DIR: `.cache/next-application-tests-${frontendPort}`,
        },
      ],
    ]) {
      const log = await open(`.cache/${name}-test.log`, 'w');
      logs.push(log);
      const server = spawn(process.execPath, command, {
        cwd,
        env: { ...environment, ...extra },
        stdio: ['ignore', log.fd, log.fd],
      });
      servers.push(server);
      const url = name === 'backend' ? `${backend}/health` : frontend;
      const end = Date.now() + 90000;
      while (true) {
        if (server.exitCode !== null)
          throw new Error(
            `${name} test server stopped; inspect .cache/${name}-test.log`,
          );
        try {
          if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok)
            break;
        } catch {}
        if (Date.now() > end)
          throw new Error(
            `${name} test server timed out; inspect .cache/${name}-test.log`,
          );
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    environment.TEST_APP_URL = frontend;
    args = [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.app.config.ts',
      ...process.argv.slice(3),
    ];
  }
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: environment,
  });
  process.exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => done(code ?? 1));
  });
} finally {
  for (const server of servers) {
    if (server.exitCode !== null) continue;
    if (process.platform === 'win32')
      await new Promise((done) => {
        const killer = spawn(
          'taskkill',
          ['/PID', String(server.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        killer.once('error', done);
        killer.once('exit', done);
      });
    else server.kill();
  }
  await Promise.all(logs.map((log) => log.close()));
  await admin?.end();
  await database.stop();
}

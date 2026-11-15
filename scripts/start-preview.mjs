import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { transferDatabase } from '../apps/backend/dist/db/transfer.js';
import { preparePreviewDatabase } from '../apps/backend/dist/db/preview.js';
const sourceUrl = process.env.MIGRATION_DATABASE_URL;
const neonUrl = process.env.NEON_MIGRATION_DATABASE_URL;
const rehearsalUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
const ownerUrl = neonUrl || sourceUrl;
const password = process.env.PREVIEW_RUNTIME_PASSWORD;
if (!ownerUrl || !password)
  throw new Error('Preview database configuration is missing.');
const origin = process.env.FRONTEND_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (!origin || new URL(origin).origin !== origin)
  throw new Error('Set the public preview origin.');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 9000).unref();
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((done) => child.once('exit', done)),
    ),
  ).then(() => process.exit(code));
}
function launch(args, options) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', ...options });
  children.push(child);
  child.once('error', () => stop(1));
  child.once('exit', () => {
    if (!stopping) stop(1);
  });
  return child;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
let runtimeUrl;
try {
  runtimeUrl = await preparePreviewDatabase(ownerUrl, password);
  if (neonUrl && sourceUrl) {
    const id = process.env.DAYBOOK_DATABASE_TRANSFER_ID;
    if (!id) throw new Error('Set the verified database transfer identity.');
    if (rehearsalUrl) {
      await preparePreviewDatabase(rehearsalUrl, password);
      const trial = await transferDatabase(sourceUrl, rehearsalUrl, {
        id: `${id}-rehearsal`,
        cutover: false,
      });
      console.log('Database rehearsal verified:', JSON.stringify(trial));
    }
    const result = await transferDatabase(sourceUrl, neonUrl, {
      id,
      cutover: true,
    });
    console.log('Database migration verified:', JSON.stringify(result));
    const pooled = new URL(runtimeUrl);
    if (
      pooled.hostname.endsWith('.neon.tech') &&
      !pooled.hostname.split('.')[0].endsWith('-pooler')
    ) {
      pooled.hostname = pooled.hostname.replace('.', '-pooler.');
      runtimeUrl = pooled.toString();
    }
  }
} catch {
  console.error(
    'Preview database bootstrap failed. Check database readiness and owner role permissions.',
  );
  process.exit(1);
}
delete process.env.MIGRATION_DATABASE_URL;
delete process.env.NEON_MIGRATION_DATABASE_URL;
delete process.env.NEON_REHEARSAL_DATABASE_URL;
delete process.env.PREVIEW_RUNTIME_PASSWORD;
const backendPort = process.env.PREVIEW_BACKEND_PORT || '4000';
launch(['--max-old-space-size=128', 'apps/backend/dist/server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: runtimeUrl,
    PORT: backendPort,
    HOST: '127.0.0.1',
    FRONTEND_ORIGIN: origin,
    PUBLIC_APP_ORIGIN: origin,
  },
});
const deadline = Date.now() + 60000;
while (true) {
  if (stopping) break;
  try {
    if (
      (
        await fetch(`http://127.0.0.1:${backendPort}/health`, {
          signal: AbortSignal.timeout(1000),
        })
      ).ok
    )
      break;
  } catch {}
  if (Date.now() > deadline) {
    console.error('Preview API did not become healthy.');
    stop(1);
    break;
  }
  await new Promise((done) => setTimeout(done, 250));
}
if (!stopping) {
  // Frontend receives only its required variables, never database/provider secrets.
  const env = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USERPROFILE',
      'SystemRoot',
      'TEMP',
      'TMP',
      'NODE_EXTRA_CA_CERTS',
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  launch(
    [
      '--max-old-space-size=192',
      resolve('node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '0.0.0.0',
      '--port',
      process.env.PORT || '10000',
    ],
    {
      cwd: resolve('apps/frontend'),
      env: {
        ...env,
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: origin,
        GRAPHQL_SERVER_URL: `http://127.0.0.1:${backendPort}`,
        DAYBOOK_PREVIEW: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  );
}

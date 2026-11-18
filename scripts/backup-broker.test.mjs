import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP environment cannot inherit owner, backup, provider or process injection secrets', async () => {
  const { backendEnvironment } = await import('./runtime-environment.mjs');
  const env = backendEnvironment(
    {
      PATH: 'bin',
      NODE_OPTIONS: '--import hostile',
      NODE_PATH: 'hostile',
      DAYBOOK_BACKUP_KEY: 'secret',
      DAYBOOK_BACKUP_DATABASE_URL: 'owner',
      MIGRATION_DATABASE_URL: 'owner',
      NEON_MIGRATION_DATABASE_URL: 'owner',
      AWS_SECRET_ACCESS_KEY: 'secret',
      RANDOM_SECRET: 'secret',
      GROQ_API_KEY: 'ai-key',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler',
      DOCUMENT_LINK_SECRET: 'document-key',
      PDF_BROWSER_PATH: 'browser',
      AGENCY_WHATSAPP_ACCESS_TOKEN: 'provider-key',
    },
    { databaseUrl: 'runtime', origin: 'https://example.com', port: '4000' },
  );
  assert.equal(env.DATABASE_URL, 'runtime');
  assert.equal(env.GROQ_API_KEY, 'ai-key');
  assert.equal(env.DAYBOOK_SCHEDULER_SECRET, 'scheduler');
  assert.equal(env.DOCUMENT_LINK_SECRET, 'document-key');
  assert.equal(env.PDF_BROWSER_PATH, 'browser');
  assert.equal(env.AGENCY_WHATSAPP_ACCESS_TOKEN, 'provider-key');
  assert.equal(env.PATH, 'bin');
  assert.ok(!Object.values(env).includes('secret'));
  assert.ok(!Object.values(env).includes('owner'));
  assert.ok(!Object.values(env).includes('hostile'));
});

test('only the isolated scheduled worker receives the application runtime URL', async () => {
  const { backendEnvironment, backupEnvironment } =
    await import('./runtime-environment.mjs');
  const source = {
    DAYBOOK_BACKUP_DATABASE_URL: 'owner',
    DAYBOOK_BACKUP_KEY: 'key',
    DAYBOOK_SCHEDULE_DATABASE_URL: 'injected',
    DAYBOOK_PROVIDER_SMS_TOKEN: 'provider',
    DAYBOOK_COMMUNICATIONS_PROVIDERS: 'configured',
  };
  const backend = backendEnvironment(source, {
    databaseUrl: 'runtime',
    origin: 'https://example.com',
    port: '4000',
  });
  const worker = backupEnvironment(source, { scheduleDatabaseUrl: 'runtime' });
  assert.equal(worker.DAYBOOK_SCHEDULE_DATABASE_URL, 'runtime');
  assert.equal(backend.DAYBOOK_SCHEDULE_DATABASE_URL, undefined);
  assert.equal(worker.DAYBOOK_BACKUP_DATABASE_URL, 'owner');
  assert.equal(worker.DAYBOOK_PROVIDER_SMS_TOKEN, undefined);
  assert.equal(worker.DAYBOOK_COMMUNICATIONS_PROVIDERS, undefined);
});

test('broker permits only fixed bounded operations and strips caller-supplied worker settings', async () => {
  const { attachBackupBroker } = await import('./backup-broker.mjs');
  const peer = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const results=[];
    process.on('message', message=>{
      results.push(message);
      if(results.length===3){console.log(JSON.stringify(results));process.disconnect();}
    });
    process.send({type:'daybook.backup.request',id:'invalid',operation:'exec',command:'bad'});
    process.send({type:'daybook.backup.request',id:'extra',operation:'tick',env:{DAYBOOK_BACKUP_ENABLED:'true'}});
    process.send({type:'daybook.backup.request',id:'valid',operation:'tick'});
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const detach = attachBackupBroker(peer, {
    env: { PATH: process.env.PATH, DAYBOOK_BACKUP_ENABLED: 'false' },
  });
  let output = '';
  peer.stdout.on('data', (d) => {
    output += d;
  });
  const timeout = setTimeout(() => peer.kill(), 15000);
  try {
    const [code] = await once(peer, 'close');
    assert.equal(code, 0);
    const results = JSON.parse(output);
    assert.deepEqual(results.find((r) => r.id === 'invalid').result, {
      state: 'REJECTED',
    });
    assert.deepEqual(results.find((r) => r.id === 'extra').result, {
      state: 'REJECTED',
    });
    assert.deepEqual(results.find((r) => r.id === 'valid').result, {
      state: 'NOT_CONFIGURED',
      scheduled: { state: 'NOT_CONFIGURED' },
    });
  } finally {
    clearTimeout(timeout);
    detach();
    peer.kill();
  }
});

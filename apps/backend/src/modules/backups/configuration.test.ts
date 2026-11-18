import assert from 'node:assert/strict';
import { test } from 'node:test';
async function feature() {
  const mod = await import('./configuration.js').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw e;
    },
  );
  assert.ok(
    mod?.readBackupConfiguration,
    'Strict backup configuration must exist',
  );
  return mod;
}
const environment = {
  DAYBOOK_BACKUP_ENABLED: 'true',
  DAYBOOK_BACKUP_DATABASE_URL:
    'postgresql://backup:synthetic@ep-example.c-2.ap-southeast-1.aws.neon.tech/daybook?sslmode=verify-full',
  DAYBOOK_BACKUP_SCOPE_ID: 'abcddcba-abcd-4abc-8abc-abcdefabcdef',
  DAYBOOK_BACKUP_KEY_ID: 'key-test',
  DAYBOOK_BACKUP_KEY: '01'.repeat(32),
  DAYBOOK_BACKUP_NEON_ENDPOINT:
    'https://br-example.storage.c-2.ap-southeast-1.aws.neon.tech',
  DAYBOOK_BACKUP_NEON_REGION: 'ap-southeast-1',
  DAYBOOK_BACKUP_NEON_BUCKET: 'daybook-private',
  DAYBOOK_BACKUP_NEON_ACCESS_KEY_ID: 'synthetic',
  DAYBOOK_BACKUP_NEON_SECRET_ACCESS_KEY: 'synthetic',
  DAYBOOK_BACKUP_B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  DAYBOOK_BACKUP_B2_REGION: 'us-east-005',
  DAYBOOK_BACKUP_B2_BUCKET: 'daybook-backups',
  DAYBOOK_BACKUP_B2_ACCESS_KEY_ID: 'synthetic',
  DAYBOOK_BACKUP_B2_SECRET_ACCESS_KEY: 'synthetic',
};
test('backup configuration is opt-in, requires a separate owner URL and key, and keeps independent providers bounded', async () => {
  const { readBackupConfiguration } = await feature();
  assert.equal(readBackupConfiguration({}), null);
  const config = readBackupConfiguration(environment);
  assert.ok(config);
  assert.equal(config.key.byteLength, 32);
  assert.equal(config.destinations.length, 2);
  assert.ok(config.destinations.every((d) => d.limit <= 1024 * 1024 * 1024));
  for (const field of [
    'DAYBOOK_BACKUP_DATABASE_URL',
    'DAYBOOK_BACKUP_KEY',
    'DAYBOOK_BACKUP_SCOPE_ID',
    'DAYBOOK_BACKUP_KEY_ID',
  ])
    assert.throws(() =>
      readBackupConfiguration({ ...environment, [field]: '' }),
    );
  assert.throws(() =>
    readBackupConfiguration({
      ...environment,
      DAYBOOK_BACKUP_KEY: 'not-a-key',
    }),
  );
  assert.throws(
    () =>
      readBackupConfiguration({
        ...environment,
        DAYBOOK_BACKUP_DATABASE_URL:
          environment.DAYBOOK_BACKUP_DATABASE_URL.replace(
            'ep-example.',
            'ep-example-pooler.',
          ),
      }),
    /direct/i,
  );
});
test('provider configuration cannot redirect backup secrets to an arbitrary endpoint or enable paid fallback', async () => {
  const { readBackupConfiguration } = await feature();
  for (const endpoint of [
    'http://s3.us-east-005.backblazeb2.com',
    'https://example.test',
    'https://s3.us-east-005.backblazeb2.com.evil.test',
    'https://user:secret@s3.us-east-005.backblazeb2.com',
    'https://s3.us-east-005.backblazeb2.com/?key=secret',
  ])
    assert.throws(() =>
      readBackupConfiguration({
        ...environment,
        DAYBOOK_BACKUP_B2_ENDPOINT: endpoint,
      }),
    );
  assert.throws(() =>
    readBackupConfiguration({
      ...environment,
      DAYBOOK_BACKUP_B2_REGION: 'us-west-004',
    }),
  );
  assert.throws(() =>
    readBackupConfiguration({
      ...environment,
      DAYBOOK_BACKUP_NEON_ENDPOINT: environment.DAYBOOK_BACKUP_B2_ENDPOINT,
    }),
  );
  const {
    DAYBOOK_BACKUP_B2_ENDPOINT,
    DAYBOOK_BACKUP_B2_REGION,
    DAYBOOK_BACKUP_B2_BUCKET,
    DAYBOOK_BACKUP_B2_ACCESS_KEY_ID,
    DAYBOOK_BACKUP_B2_SECRET_ACCESS_KEY,
    ...onlyNeon
  } = environment;
  assert.equal(
    readBackupConfiguration(onlyNeon)?.destinations.length,
    1,
    'A configured independent first copy is still usable while the other is absent',
  );
});

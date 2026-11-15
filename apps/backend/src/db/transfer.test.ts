import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as transfer from './transfer.js';

test('migration rejects Neon transaction-pooler URLs before opening a connection', () => {
  assert.equal(
    typeof transfer.requireDirectMigrationUrl,
    'function',
    'Direct migration connection guard must exist',
  );
  assert.throws(
    () =>
      transfer.requireDirectMigrationUrl(
        'postgresql://test:synthetic@ep-example-pooler.c-2.ap-southeast-1.aws.neon.tech/daybook',
      ),
    /direct/i,
  );
});
test('direct migration guard preserves direct URLs and ignores pooler text in passwords or database names', () => {
  assert.equal(typeof transfer.requireDirectMigrationUrl, 'function');
  for (const url of [
    'postgresql://test:synthetic-pooler@ep-example.c-2.ap-southeast-1.aws.neon.tech/daybook?sslmode=verify-full',
    'postgresql://test:synthetic@127.0.0.1:5432/test-pooler',
  ])
    assert.equal(transfer.requireDirectMigrationUrl(url), url);
});

test('migration rejects case variants and fully qualified Neon pooler hostnames', () => {
  for (const host of [
    'EP-EXAMPLE-POOLER.c-2.ap-southeast-1.aws.NEON.TECH',
    'ep-example-pooler.c-2.ap-southeast-1.aws.neon.tech.',
  ])
    assert.throws(
      () =>
        transfer.requireDirectMigrationUrl(
          `postgresql://test:synthetic@${host}/daybook`,
        ),
      /direct/i,
    );
});

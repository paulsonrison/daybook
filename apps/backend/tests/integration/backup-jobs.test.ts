import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
test('backup leases and capacity reservations are owner-only, exclusive, retry-safe and conservative on ambiguous uploads', async () => {
  const feature = await import('../../src/modules/backups/jobs.js').catch(
    () => null,
  );
  assert.ok(
    feature?.claimBackup,
    'Durable backup job implementation must exist',
  );
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 4,
  });
  const runtime = new pg.Pool({
    connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
    max: 1,
  });
  const scopeId = randomUUID(),
    now = new Date('2026-11-16T02:00:00Z');
  try {
    await assert.rejects(
      runtime.query('SELECT * FROM daybook.operator_backup_runs'),
      /permission denied/i,
    );
    const claims = await Promise.all([
      feature.claimBackup(pool, {
        period: '2026-11-16',
        scopeId,
        keyId: 'test-key',
        now,
      }),
      feature.claimBackup(pool, {
        period: '2026-11-16',
        scopeId,
        keyId: 'test-key',
        now,
      }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean)!;
    assert.equal(first.attempt, 1);
    assert.equal(
      await feature.claimBackup(pool, {
        period: '2026-11-16',
        scopeId,
        keyId: 'test-key',
        now,
      }),
      null,
    );
    await feature.recordBackupSnapshot(
      pool,
      first,
      { bytes: 100, sha256: 'a'.repeat(64) },
      now,
    );
    const reservation = await feature.reserveBackupDestination(
      pool,
      first,
      'neon',
      1024,
      now,
    );
    assert.ok(reservation);
    assert.equal(reservation.used, 0);
    assert.equal(reservation.otherReserved, 0);
    assert.equal(
      (await feature.reserveBackupDestination(pool, first, 'neon', 1024, now))
        ?.objectId,
      reservation.objectId,
    );
    const later = new Date(now.valueOf() + 16 * 60000);
    const second = await feature.claimBackup(pool, {
      period: '2026-11-16',
      scopeId,
      keyId: 'test-key',
      now: later,
    });
    assert.ok(second);
    assert.equal(second.attempt, 2);
    assert.notEqual(second.objectId, first.objectId);
    await assert.rejects(
      feature.finishBackupDestination(pool, first, 'neon', 'VERIFIED', now),
      /lease/i,
    );
    await feature.recordBackupSnapshot(
      pool,
      second,
      { bytes: 100, sha256: 'b'.repeat(64) },
      later,
    );
    assert.equal(
      await feature.reserveBackupDestination(pool, second, 'neon', 200, later),
      null,
      'Unverified old upload retains its136-byte reservation',
    );
    const next = await feature.reserveBackupDestination(
      pool,
      second,
      'neon',
      1024,
      later,
    );
    assert.ok(next);
    assert.equal(next.otherReserved, 136);
    await feature.finishBackupDestination(
      pool,
      second,
      'neon',
      'VERIFIED',
      later,
    );
    assert.equal(await feature.finishBackupRun(pool, second, later), 'PARTIAL');
    const third = await feature.claimBackup(pool, {
      period: '2026-11-16',
      scopeId,
      keyId: 'test-key',
      now: new Date(later.valueOf() + 60000),
    });
    assert.ok(third);
    assert.equal(third.attempt, 3);
    await feature.recordBackupSnapshot(
      pool,
      third,
      { bytes: 100, sha256: 'c'.repeat(64) },
      new Date(later.valueOf() + 60000),
    );
    for (const name of ['neon', 'b2'] as const) {
      assert.ok(
        await feature.reserveBackupDestination(
          pool,
          third,
          name,
          1024,
          new Date(later.valueOf() + 60000),
        ),
      );
      await feature.finishBackupDestination(
        pool,
        third,
        name,
        'VERIFIED',
        new Date(later.valueOf() + 60000),
      );
    }
    assert.equal(
      await feature.finishBackupRun(
        pool,
        third,
        new Date(later.valueOf() + 60000),
      ),
      'VERIFIED',
    );
    assert.equal(
      await feature.claimBackup(pool, {
        period: '2026-11-16',
        scopeId,
        keyId: 'test-key',
        now: new Date(later.valueOf() + 120000),
      }),
      null,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM daybook.operator_backup_objects',
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await runtime.end();
    await pool.end();
  }
});
test('an abandoned final attempt settles from verified replica evidence instead of remaining running forever', async () => {
  const feature = await import('../../src/modules/backups/jobs.js');
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 1,
  });
  const scopeId = randomUUID(),
    start = new Date('2026-11-18T02:00:00Z');
  try {
    let last: Awaited<ReturnType<typeof feature.claimBackup>> = null;
    for (let i = 0; i < 3; i++) {
      const now = new Date(start.valueOf() + i * 16 * 60000);
      last = await feature.claimBackup(pool, {
        period: '2026-11-18',
        scopeId,
        keyId: 'test-key',
        now,
      });
      assert.ok(last);
    }
    const at = new Date(start.valueOf() + 32 * 60000);
    await feature.recordBackupSnapshot(
      pool,
      last!,
      { bytes: 100, sha256: 'd'.repeat(64) },
      at,
    );
    for (const destination of ['neon', 'b2'] as const)
      assert.ok(
        await feature.reserveBackupDestination(
          pool,
          last!,
          destination,
          2048,
          at,
        ),
      );
    await feature.finishBackupDestination(pool, last!, 'neon', 'VERIFIED', at);
    assert.equal(
      await feature.claimBackup(pool, {
        period: '2026-11-18',
        scopeId,
        keyId: 'test-key',
        now: new Date(start.valueOf() + 48 * 60000),
      }),
      null,
    );
    const row = (
      await pool.query(
        'SELECT status,lease_token,lease_until,finished_at FROM daybook.operator_backup_runs WHERE id=$1',
        [last!.id],
      )
    ).rows[0];
    assert.equal(row.status, 'PARTIAL');
    assert.equal(row.lease_token, null);
    assert.equal(row.lease_until, null);
    assert.ok(row.finished_at);
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM daybook.operator_backup_objects WHERE object_id=$1 AND destination='b2'",
          [last!.objectId],
        )
      ).rows[0].status,
      'RESERVED',
      'Uncertain upload retains its reservation',
    );
  } finally {
    await pool.end();
  }
});
test('operator backup writes stop during transfer and remain fenced on the retired source', async () => {
  const feature = await import('../../src/modules/backups/jobs.js');
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 1,
  });
  const control = new pg.Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await control.connect();
  const input = {
    period: '2026-11-19',
    scopeId: randomUUID(),
    keyId: 'test-key',
    now: new Date('2026-11-19T02:00:00Z'),
  };
  try {
    await control.query('SELECT pg_advisory_lock(78130423)');
    await assert.rejects(feature.claimBackup(pool, input), /maintenance/i);
    await control.query('SELECT pg_advisory_unlock(78130423)');
    await control.query(
      'CREATE TABLE public.daybook_transfer_maintenance(id text PRIMARY KEY,grants jsonb NOT NULL)',
    );
    await control.query(
      "INSERT INTO public.daybook_transfer_maintenance VALUES('retired-source','[]')",
    );
    await assert.rejects(feature.claimBackup(pool, input), /maintenance/i);
    await control.query('DROP TABLE public.daybook_transfer_maintenance');
    assert.ok(await feature.claimBackup(pool, input));
  } finally {
    await control.query('SELECT pg_advisory_unlock_all()');
    await control.query(
      'DROP TABLE IF EXISTS public.daybook_transfer_maintenance',
    );
    await control.end();
    await pool.end();
  }
});

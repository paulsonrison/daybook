import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
test('backup status reports independent fresh copies without exposing operator identifiers or treating partial replication as protected', async () => {
  const { readBackupStatus } =
    await import('../../src/modules/backups/status.js');
  const feature = await import('../../src/modules/backups/jobs.js');
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 1,
  });
  const scopeId = randomUUID(),
    now = new Date('2026-12-01T02:00:00Z');
  try {
    const claim = await feature.claimBackup(pool, {
      period: '2026-12-01',
      scopeId,
      keyId: 'private-key-id',
      now,
    });
    assert.ok(claim);
    await feature.recordBackupSnapshot(
      pool,
      claim,
      { bytes: 100, sha256: 'a'.repeat(64) },
      now,
    );
    await feature.reserveBackupDestination(pool, claim, 'neon', 1024, now);
    await feature.finishBackupDestination(pool, claim, 'neon', 'VERIFIED', now);
    let status = await readBackupStatus(pool, scopeId, ['neon', 'b2'], now);
    assert.equal(status.protected, false);
    assert.equal(
      status.destinations.find((d) => d.name === 'neon')?.healthy,
      true,
    );
    assert.equal(
      status.destinations.find((d) => d.name === 'b2')?.healthy,
      false,
    );
    await feature.reserveBackupDestination(pool, claim, 'b2', 1024, now);
    await feature.finishBackupDestination(pool, claim, 'b2', 'VERIFIED', now);
    status = await readBackupStatus(pool, scopeId, ['neon', 'b2'], now);
    assert.equal(status.protected, true);
    const failed = await feature.claimBackup(pool, {
      period: '2026-12-02',
      scopeId,
      keyId: 'private-key-id',
      now: new Date('2026-12-02T02:00:00Z'),
    });
    assert.ok(failed);
    await feature.finishBackupRun(
      pool,
      failed,
      new Date('2026-12-02T02:00:01Z'),
    );
    const afterFailure = await readBackupStatus(
      pool,
      scopeId,
      ['neon', 'b2'],
      new Date('2026-12-02T02:00:02Z'),
    );
    assert.equal(
      afterFailure.protected,
      false,
      'A new failed archive must not be hidden by yesterday’s verified copies',
    );
    assert.equal(afterFailure.latestRunState, 'FAILED');
    assert.equal(
      (await readBackupStatus(pool, scopeId, ['neon'], now)).protected,
      false,
    );
    assert.equal(
      (
        await readBackupStatus(
          pool,
          scopeId,
          ['neon', 'b2'],
          new Date('2026-12-03T02:00:00Z'),
        )
      ).protected,
      false,
    );
    assert.equal(
      (await readBackupStatus(pool, randomUUID(), ['neon', 'b2'], now))
        .protected,
      false,
    );
    const payload = JSON.stringify(status);
    for (const secret of [
      scopeId,
      claim.id,
      claim.objectId,
      'private-key-id',
      'a'.repeat(64),
    ])
      assert.ok(!payload.includes(secret));
  } finally {
    await pool.query(
      'DELETE FROM daybook.operator_backup_objects WHERE scope_id=$1',
      [scopeId],
    );
    await pool.query(
      'DELETE FROM daybook.operator_backup_runs WHERE scope_id=$1',
      [scopeId],
    );
    await pool.end();
  }
});
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
test('provider upload holds the transfer fence and concurrent invocation skips instead of overwriting', async () => {
  const feature = await import('../../src/modules/backups/jobs.js');
  assert.equal(
    typeof feature.performBackupUpload,
    'function',
    'Guarded provider invocation must exist',
  );
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 4,
  });
  const control = new pg.Client({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  await control.connect();
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((done) => (release = done)),
    ready = new Promise<void>((done) => (started = done));
  let running: Promise<boolean> | undefined,
    calls = 0;
  const input = {
    period: '2026-11-23',
    scopeId: randomUUID(),
    keyId: 'test-key',
    now: new Date('2026-11-23T02:00:00Z'),
  };
  try {
    const claim = await feature.claimBackup(pool, input);
    assert.ok(claim);
    await feature.recordBackupSnapshot(
      pool,
      claim,
      { bytes: 100, sha256: 'f'.repeat(64) },
      input.now,
    );
    assert.ok(
      await feature.reserveBackupDestination(
        pool,
        claim,
        'neon',
        2048,
        input.now,
      ),
    );
    const provider = async () => {
      calls++;
      started();
      await waiting;
      return true;
    };
    running = feature.performBackupUpload(
      pool,
      claim,
      'neon',
      input.now,
      provider,
    );
    await ready;
    assert.equal(
      (await control.query('SELECT pg_try_advisory_lock(78130423) AS acquired'))
        .rows[0].acquired,
      false,
    );
    assert.equal(await feature.claimBackup(pool, input), null);
    release();
    assert.equal(await running, true);
    assert.equal(
      (await control.query('SELECT pg_try_advisory_lock(78130423) AS acquired'))
        .rows[0].acquired,
      true,
    );
    await control.query('SELECT pg_advisory_unlock(78130423)');
    assert.equal(
      await feature.performBackupUpload(
        pool,
        claim,
        'neon',
        input.now,
        provider,
      ),
      true,
    );
    assert.equal(calls, 1, 'Verified provider object is never overwritten');
  } finally {
    release();
    await running?.catch(() => {});
    await control.query('SELECT pg_advisory_unlock_all()');
    await control.end();
    await pool.end();
  }
});
test('retention releases quota only after verified removal and always preserves a recovery point', async () => {
  const feature = await import('../../src/modules/backups/jobs.js');
  assert.equal(
    typeof feature.expireOneBackup,
    'function',
    'Verified retention execution must exist',
  );
  const pool = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    max: 1,
  });
  const scopeId = randomUUID(),
    ids: string[] = [];
  try {
    for (let day = 1; day <= 10; day++) {
      const id = randomUUID(),
        objectId = randomUUID();
      ids.push(objectId);
      const at = new Date(`2025-01-${String(day).padStart(2, '0')}T02:00:00Z`);
      await pool.query(
        "INSERT INTO daybook.operator_backup_runs(id,period,scope_id,key_id,status,attempts,object_id,archive_bytes,sha256,finished_at) VALUES($1,$2::timestamptz::date,$3,'retention-key','PARTIAL',1,$4,100,$5,$2::timestamptz)",
        [id, at, scopeId, objectId, 'a'.repeat(64)],
      );
      await pool.query(
        "INSERT INTO daybook.operator_backup_objects(object_id,destination,run_id,attempt,scope_id,key_id,status,reserved_bytes,sha256,created_at,verified_at) VALUES($1,'neon',$2,1,$3,'retention-key','VERIFIED',136,$4,$5,$5)",
        [objectId, id, scopeId, 'a'.repeat(64), at],
      );
    }
    const now = new Date('2026-11-26T02:00:00Z');
    await assert.rejects(
      feature.expireOneBackup(pool, scopeId, 'neon', now, async () => {
        throw new Error('Storage unavailable');
      }),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM daybook.operator_backup_objects WHERE scope_id=$1 AND status='VERIFIED'",
          [scopeId],
        )
      ).rows[0].n,
      10,
    );
    const deleted: string[] = [];
    assert.equal(
      await feature.expireOneBackup(
        pool,
        scopeId,
        'neon',
        now,
        async (object) => {
          assert.equal(object.agencyId, scopeId);
          deleted.push(object.objectId);
        },
      ),
      true,
    );
    assert.equal(deleted.length, 1);
    assert.ok(!deleted.includes(ids.at(-1)!));
    assert.equal(
      (
        await pool.query(
          "SELECT sum(reserved_bytes)::int AS bytes FROM daybook.operator_backup_objects WHERE scope_id=$1 AND status<>'DELETED'",
          [scopeId],
        )
      ).rows[0].bytes,
      9 * 136,
    );
    for (let count = 0; count < 12; count++)
      await feature.expireOneBackup(
        pool,
        scopeId,
        'neon',
        now,
        async (object) => {
          deleted.push(object.objectId);
        },
      );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM daybook.operator_backup_objects WHERE scope_id=$1 AND status='VERIFIED'",
          [scopeId],
        )
      ).rows[0].n,
      1,
    );
    assert.ok(
      !deleted.includes(ids.at(-1)!),
      'Newest recovery point survives even after a prolonged outage',
    );
  } finally {
    await pool.end();
  }
});

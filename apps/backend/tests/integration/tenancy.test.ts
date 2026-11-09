import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { withTenant, assertRuntimeRole } from '../../src/db/tenant.js';

const pool = new pg.Pool({
  connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
  max: 1,
});
const admin = new pg.Pool({
  connectionString: process.env.TEST_ADMIN_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});
const north = randomUUID(),
  south = randomUUID();
test('runtime startup rejects inherited authentication privileges', async () => {
  const role = `unsafe_${randomUUID().replaceAll('-', '')}`;
  const client = await admin.connect();
  try {
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await client.query(`GRANT daybook_app,daybook_auth TO ${role}`);
    await client.query(`SET ROLE ${role}`);
    await assert.rejects(
      assertRuntimeRole(client),
      /authentication|restricted/,
    );
  } finally {
    await client.query('RESET ROLE');
    await client.query(`DROP ROLE ${role}`);
    client.release();
  }
});
test('restricted database role cannot bypass row security or become authentication owner', async () => {
  await assertRuntimeRole(pool);
  await assert.rejects(assertRuntimeRole(admin), /non-superuser/);
  await assert.rejects(
    pool.query('SET ROLE daybook_auth'),
    /permission denied/,
  );
});
test('two agencies cannot read or change one another and scope resets on pooled connection reuse', async () => {
  await withTenant(pool, north, (c) =>
    c.query('INSERT INTO daybook.agencies(id,name) VALUES($1,$2)', [
      north,
      'North isolated',
    ]),
  );
  await withTenant(pool, south, (c) =>
    c.query('INSERT INTO daybook.agencies(id,name) VALUES($1,$2)', [
      south,
      'South isolated',
    ]),
  );
  const own = await withTenant(pool, north, (c) =>
    c.query('SELECT id,name FROM daybook.agencies'),
  );
  assert.deepEqual(own.rows, [{ id: north, name: 'North isolated' }]);
  const forbidden = await withTenant(pool, north, (c) =>
    c.query('UPDATE daybook.agencies SET name=$1 WHERE id=$2', [
      'Forged',
      south,
    ]),
  );
  assert.equal(forbidden.rowCount, 0);
  assert.equal(
    (await pool.query('SELECT * FROM daybook.agencies')).rowCount,
    0,
  );
  await assert.rejects(
    withTenant(pool, north, async (c) => {
      await c.query('SELECT 1');
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(
    (await pool.query('SELECT * FROM daybook.agencies')).rowCount,
    0,
  );
  const flags = await admin.query(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='daybook' AND relname IN ('agencies','agents','sessions')",
  );
  assert.equal(flags.rowCount, 3);
  assert.ok(flags.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
});
test('forged cross-tenant writes and composite session identity are rejected', async () => {
  const a = randomUUID(),
    b = randomUUID(),
    agent = randomUUID();
  await withTenant(pool, a, async (c) => {
    await c.query('INSERT INTO daybook.agencies(id,name) VALUES($1,$2)', [
      a,
      'First',
    ]);
    await c.query(
      'INSERT INTO daybook.agents(id,agency_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)',
      [agent, a, 'A', `${agent}@example.test`, 'test hash only'],
    );
  });
  await withTenant(pool, b, (c) =>
    c.query('INSERT INTO daybook.agencies(id,name) VALUES($1,$2)', [
      b,
      'Second',
    ]),
  );
  await assert.rejects(
    withTenant(pool, a, (c) =>
      c.query(
        'INSERT INTO daybook.agents(id,agency_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), b, 'X', 'forged@example.test', 'forged'],
      ),
    ),
    /row-level security/,
  );
  await assert.rejects(
    withTenant(pool, b, (c) =>
      c.query(
        "INSERT INTO daybook.sessions(token_hash,agency_id,agent_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        ['a'.repeat(64), b, agent],
      ),
    ),
    /foreign key/,
  );
});

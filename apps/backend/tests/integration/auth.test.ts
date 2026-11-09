import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import { createApp } from '../../src/app.js';

const pool = new pg.Pool({
  connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
  max: 1,
});
after(() => pool.end());
const app = createApp({ pool, databaseReady: async () => true });
async function request(
  path: string,
  data?: unknown,
  cookie?: string,
  origin = 'http://localhost:3000',
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: data ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin,
        ...(cookie ? { cookie } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
  );
}
const password = 'Test-only strong password 123';
test('expired and tampered sessions never authenticate', async () => {
  const registered = await request('/auth/register', {
    agencyName: 'Expiring Agency',
    name: 'Agent',
    email: 'expiry@example.test',
    password,
  });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie')!;
  const admin = new pg.Pool({
    connectionString: process.env.TEST_ADMIN_DATABASE_URL,
  });
  try {
    await admin.query(
      "UPDATE daybook.sessions SET expires_at=now()-interval '1 second' WHERE agent_id IN (SELECT id FROM daybook.agents WHERE email='expiry@example.test')",
    );
    assert.equal((await request('/auth/me', undefined, cookie)).status, 401);
    assert.equal(
      (
        await request(
          '/auth/me',
          undefined,
          `daybook_session=${'0'.repeat(64)}`,
        )
      ).status,
      401,
    );
  } finally {
    await admin.end();
  }
});
test('unauthenticated account request is denied', async () => {
  assert.equal((await request('/auth/me')).status, 401);
});
test('untrusted browser origin cannot create an agency', async () => {
  assert.equal(
    (
      await request(
        '/auth/register',
        {
          agencyName: 'Denied',
          name: 'Agent',
          email: 'bad@example.test',
          password,
        },
        undefined,
        'https://untrusted.example',
      )
    ).status,
    403,
  );
});
test('agency session survives requests, rejects wrong password, and logout revokes it', async () => {
  const registered = await request('/auth/register', {
    agencyName: 'North Agency',
    name: 'North Agent',
    email: 'north@example.test',
    password,
  });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.doesNotMatch(
    JSON.stringify(await registered.json()),
    /password|token/i,
  );
  const me = await request('/auth/me', undefined, cookie);
  assert.equal(me.status, 200);
  const person = await me.json();
  assert.equal(person.agent.email, 'north@example.test');
  const wrong = await request('/auth/login', {
    email: 'north@example.test',
    password: 'wrong password 123',
  });
  assert.equal(wrong.status, 401);
  const login = await request('/auth/login', {
    email: 'north@example.test',
    password,
  });
  assert.equal(login.status, 200);
  const loginCookie = login.headers.get('set-cookie')!;
  assert.equal((await request('/auth/logout', {}, loginCookie)).status, 200);
  assert.equal((await request('/auth/me', undefined, loginCookie)).status, 401);
});
test('GraphQL reads only the agency authenticated by its cookie', async () => {
  const registered = await request('/auth/register', {
    agencyName: 'South Agency',
    name: 'South Agent',
    email: 'south@example.test',
    password,
  });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie')!;
  const response = await request(
    '/graphql',
    { query: '{ me { email agency { name } } }' },
    cookie,
  );
  assert.deepEqual(await response.json(), {
    data: {
      me: { email: 'south@example.test', agency: { name: 'South Agency' } },
    },
  });
  const denied = await request('/graphql', { query: '{ me { email } }' });
  const body = await denied.json();
  assert.equal(body.errors[0].extensions.code, 'UNAUTHENTICATED');
});

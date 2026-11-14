import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());
const fields =
  'version locale mode scheme layout typography{family size weight style lineHeight}';
const mutation = `mutation($input:AgentPreferencesInput!){saveAgentPreferences(input:$input){${fields}}}`;
const choice = () => ({
  requestId: randomUUID(),
  version: 0,
  locale: 'ml',
  mode: 'dark',
  scheme: 'nord',
  layout: 'CARDS',
  fontFamily: 'inter',
  fontSize: 18,
  fontWeight: 500,
  fontStyle: 'normal',
  lineHeight: 1.6,
});
test('preferences persist only for the authenticated agent and replay the current choice without overwriting it', async () => {
  const cookie = await api.agency(),
    other = await api.agency();
  const initial = await api.query(cookie, `{agentPreferences{${fields}}}`);
  assert.ok(initial.data?.agentPreferences, JSON.stringify(initial));
  assert.equal(initial.data.agentPreferences.locale, 'en');
  assert.equal(initial.data.agentPreferences.version, 0);
  const input = choice();
  const saved = await api.query(cookie, mutation, { input });
  assert.ok(saved.data?.saveAgentPreferences, JSON.stringify(saved));
  assert.equal(saved.data.saveAgentPreferences.locale, 'ml');
  assert.equal(saved.data.saveAgentPreferences.version, 1);
  assert.equal(
    (await api.query(other, `{agentPreferences{${fields}}}`)).data
      .agentPreferences.locale,
    'en',
  );
  const second = await api.query(cookie, mutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      version: 1,
      locale: 'hi',
      layout: 'ROUTE',
    },
  });
  assert.equal(second.data.saveAgentPreferences.version, 2);
  assert.equal(
    (await api.query(cookie, mutation, { input })).data.saveAgentPreferences
      .locale,
    'hi',
  );
  assert.equal(
    (await api.query(cookie, mutation, { input })).data.saveAgentPreferences
      .version,
    2,
  );
  assert.ok(
    (
      await api.query(cookie, mutation, {
        input: { ...input, requestId: randomUUID() },
      })
    ).errors,
  );
  assert.equal(
    (await api.query(cookie, `{agentPreferences{${fields}}}`)).data
      .agentPreferences.layout,
    'ROUTE',
  );
  assert.ok((await api.query('', `{agentPreferences{${fields}}}`)).errors);
});
test('invalid and racing preference choices fail safely, while agent row security holds inside an agency', async () => {
  const cookie = await api.agency();
  const input = choice();
  for (const patch of [
    { locale: 'ar' },
    { mode: 'unknown' },
    { scheme: 'foreign' },
    { layout: 'MAP' },
    { fontFamily: 'unknown' },
    { fontSize: 99 },
    { fontWeight: 100 },
    { fontStyle: 'oblique' },
    { lineHeight: 9 },
  ]) {
    const result = await api.query(cookie, mutation, {
      input: { ...input, requestId: randomUUID(), ...patch },
    });
    assert.ok(result.errors, JSON.stringify({ patch, result }));
  }
  const race = await Promise.all([
    api.query(cookie, mutation, { input }),
    api.query(cookie, mutation, {
      input: { ...input, requestId: randomUUID(), locale: 'hi' },
    }),
  ]);
  assert.equal(
    race.filter((result) => result.data?.saveAgentPreferences).length,
    1,
  );
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  await withTenant(api.pool, me.agencyId, async (c) => {
    assert.equal(
      (await c.query('SELECT * FROM daybook.agent_preferences')).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.agent_id',$1,true)", [randomUUID()]);
    assert.equal(
      (await c.query('SELECT * FROM daybook.agent_preferences')).rowCount,
      0,
    );
    await c.query("SELECT set_config('app.agent_id',$1,true)", [me.id]);
    assert.equal(
      (await c.query('SELECT * FROM daybook.agent_preferences')).rowCount,
      1,
    );
  });
});

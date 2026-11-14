import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { defaultPreferences } from '@daybook/ui/preferences';
test('late preference responses cannot erase a newer scoped recovery record after navigation', async () => {
  const previous = axios.defaults.adapter;
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    removeItem: (key: string) => {
      records.delete(key);
    },
  };
  const requests: {
    finish: (value: unknown) => void;
    input: Record<string, unknown>;
  }[] = [];
  axios.defaults.adapter = async (config) => {
    const body = JSON.parse(config.data);
    if (!body.query.includes('saveAgentPreferences'))
      return {
        data: {
          data: { agentPreferences: { ...defaultPreferences, version: 0 } },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    const result = await new Promise((resolve) =>
      requests.push({ finish: resolve, input: body.variables.input }),
    );
    return {
      data: { data: { saveAgentPreferences: result } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  try {
    const feature = await import('./store.js').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
        throw error;
      },
    );
    assert.ok(
      feature?.PreferencesStore,
      'Preference recovery store must exist',
    );
    const scope = {
      agencyId: '00000000-0000-4000-8000-000000000001',
      agentId: '00000000-0000-4000-8000-000000000002',
    };
    const a = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    a.resume();
    await a.load();
    const first = a.save({ ...defaultPreferences, locale: 'ml' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    a.dispose();
    // Simulate a resolved original before a new mounted screen creates another request.
    records.clear();
    const b = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    b.resume();
    await b.load();
    const second = b.save({ ...defaultPreferences, locale: 'hi' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 2);
    const snapshot = JSON.stringify([...records]);
    requests[0].finish({ ...defaultPreferences, locale: 'ml', version: 1 });
    await first;
    assert.equal(JSON.stringify([...records]), snapshot);
    assert.equal(b.pending?.requestId, requests[1].input.requestId);
    requests[1].finish({ ...defaultPreferences, locale: 'hi', version: 1 });
    await second;
    assert.equal(b.values.locale, 'hi');
    assert.equal(b.pending, null);
    b.dispose();
    const c = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    c.resume();
    await c.load();
    const third = c.save({ ...defaultPreferences, mode: 'dark' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    c.dispose();
    requests[2].finish({ ...defaultPreferences, mode: 'dark', version: 1 });
    await third;
    const d = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    d.resume();
    const loading = d.load();
    const replay = d.checkOriginal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      requests.length,
      4,
      'Reload must preserve the original envelope and send its original request',
    );
    assert.equal(requests[3].input.requestId, requests[2].input.requestId);
    requests[3].finish({ ...defaultPreferences, mode: 'dark', version: 1 });
    await replay;
    await loading;
    assert.equal(d.pending, null);
    assert.equal(d.values.mode, 'dark');
    assert.equal(
      d.state,
      'ready',
      'A recovered save must finish loading even if it supersedes the initial read',
    );
    assert.equal(d.locked, false);
    d.dispose();
    records.set(d.key, JSON.stringify({ layout: 'CARDS' }));
    const e = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    e.resume();
    await e.load();
    const language = e.save(
      { ...defaultPreferences, locale: 'hi' },
      'language',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    e.dispose();
    requests[4].finish({ ...defaultPreferences, locale: 'hi', version: 1 });
    await language;
    const f = new feature.PreferencesStore(scope, {
      session: storage,
      device: storage,
    });
    f.resume();
    const initial = f.load();
    const recoveredLanguage = f.checkOriginal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    requests[5].finish({ ...defaultPreferences, locale: 'hi', version: 1 });
    await recoveredLanguage;
    await initial;
    assert.equal(
      f.effectiveLayout,
      'CARDS',
      'Language recovery before the initial read must retain the device layout override',
    );
    f.dispose();
  } finally {
    axios.defaults.adapter = previous;
  }
});

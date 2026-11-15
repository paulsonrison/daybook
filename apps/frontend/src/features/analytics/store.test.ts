import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
test('analytics uses the agency month and ignores older selections and disposed-session responses', async () => {
  const previous = axios.defaults.adapter;
  const pending: { month: string; finish: (value: unknown) => void }[] = [];
  axios.defaults.adapter = async (config) => {
    const body = JSON.parse(config.data);
    const result = body.query.includes('deliveryMetrics')
      ? { deliveryMetrics: { today: '2026-01-31' } }
      : await new Promise((resolve) =>
          pending.push({ month: body.variables.input.month, finish: resolve }),
        );
    return {
      data: { data: result },
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
    assert.ok(feature?.AnalyticsStore, 'The scoped analytics store must exist');
    const store = new feature.AnalyticsStore();
    const initial = store.initialize();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pending[0].month, '2026-01');
    assert.equal(store.today, '2026-01-31');
    const newer = store.load('2025-12');
    await new Promise((resolve) => setImmediate(resolve));
    pending[1].finish({ agencyAnalytics: { month: '2025-12' } });
    await newer;
    pending[0].finish({ agencyAnalytics: { month: '2026-01' } });
    await initial;
    assert.equal(store.month, '2025-12');
    assert.equal(store.report?.month, '2025-12');
    const late = store.load('2025-11');
    await new Promise((resolve) => setImmediate(resolve));
    store.dispose();
    pending[2].finish({ agencyAnalytics: { month: '2025-11' } });
    await late;
    assert.equal(
      store.report,
      null,
      'Loading clears earlier data, and disposed-session responses cannot repopulate it',
    );
  } finally {
    axios.defaults.adapter = previous;
  }
});

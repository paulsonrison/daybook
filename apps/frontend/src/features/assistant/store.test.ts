import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
test('assistant keeps its question on provider failure and ignores a response after leaving the agency screen', async () => {
  const previous = axios.defaults.adapter;
  let finish: (value: unknown) => void = () => {};
  axios.defaults.adapter = async (config) => {
    const assistant =
      JSON.parse(config.data).operationName === 'DaybookAssistant';
    assert.equal(config.timeout, assistant ? 80000 : 10000);
    const data = assistant
      ? {
          askAssistant: await new Promise((resolve) => {
            finish = resolve;
          }),
        }
      : { health: { status: 'ok' } };
    return {
      data: { data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  try {
    const feature = await import('./store.js').catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
        throw e;
      },
    );
    assert.ok(feature?.AssistantStore);
    const store = new feature.AssistantStore();
    store.question = 'Show overdue balances';
    const request = store.ask();
    await new Promise((resolve) => setImmediate(resolve));
    finish({ status: 'NOT_CONFIGURED', answer: null, facts: null, asOf: null });
    await request;
    assert.equal(store.question, 'Show overdue balances');
    assert.equal(store.reply?.status, 'NOT_CONFIGURED');
    const late = store.ask();
    await new Promise((resolve) => setImmediate(resolve));
    store.dispose();
    finish({
      status: 'READY',
      answer: 'late response',
      facts: '{}',
      asOf: '2026-11-15',
    });
    await late;
    assert.equal(store.reply, null);
    const { graphqlRequest } = await import('../../lib/graphql/client.js');
    assert.deepEqual(await graphqlRequest('{health{status}}'), {
      health: { status: 'ok' },
    });
  } finally {
    axios.defaults.adapter = previous;
  }
});

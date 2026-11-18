import assert from 'node:assert/strict';
import test from 'node:test';
test('only the fixed assistant operation gets a longer upstream deadline; other mutations retain the normal deadline', async () => {
  const feature = await import('./assistant-operation.js').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw e;
    },
  );
  assert.ok(feature?.upstreamTimeout);
  assert.equal(
    feature.upstreamTimeout('/operations/backups', undefined, 'GET'),
    50000,
  );
  assert.equal(
    feature.upstreamTimeout('/operations/backups', undefined, 'POST'),
    10000,
  );
  assert.equal(
    feature.upstreamTimeout('/operations/backups/other', undefined, 'GET'),
    10000,
  );
  const body = JSON.stringify({
    query: feature.ASSISTANT_OPERATION,
    operationName: 'DaybookAssistant',
    variables: { input: { question: 'Show balances' } },
  });
  assert.equal(feature.upstreamTimeout('/graphql', body), 75000);
  assert.equal(feature.upstreamTimeout('/auth/login', body), 10000);
  assert.equal(
    feature.upstreamTimeout(
      '/graphql',
      JSON.stringify({
        operationName: 'DaybookAssistant',
        query: 'mutation{recordPayment(input:{}){id}}',
      }),
    ),
    10000,
  );
  assert.equal(feature.upstreamTimeout('/graphql', 'malformed'), 10000);
});

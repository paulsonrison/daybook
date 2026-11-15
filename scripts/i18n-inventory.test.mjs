import assert from 'node:assert/strict';
import test from 'node:test';

test('framework directives are code while visible client-facing copy remains inventoried', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const rows = scanSource(
    '"use client"; function Screen(){"use strict"; return <h1>Client workspace</h1>;}',
    'apps/frontend/src/features/example.tsx',
  );
  assert.deepEqual(
    rows.map((row) => row.message),
    ['Client workspace'],
  );
});

test('operational error and warning assignments retain punctuation without accepting CSS', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const rows = scanSource(
    "this.deviceWarning='Device layout could not be read; your saved profile is used.'; this.error='Please restore storage; retry the original request.'; const css='background: red; color: blue';",
    'apps/frontend/src/features/preferences/store.ts',
  );
  const copy = rows.map((row) => row.message);
  assert.ok(
    copy.includes(
      'Device layout could not be read; your saved profile is used.',
    ),
  );
  assert.ok(
    copy.includes('Please restore storage; retry the original request.'),
  );
  assert.ok(!copy.includes('background: red; color: blue'));
});

test('recovery catalogue inventory includes default action labels as well as descriptions', async () => {
  const { collectInventory } = await import('./i18n-inventory.mjs');
  const rows = await collectInventory();
  assert.ok(
    rows.some(
      (row) =>
        row.message === 'Check payment status' &&
        row.locations.some((location) => location.category === 'recovery'),
    ),
  );
});

test('form field arrays retain user-facing labels while query projections remain technical', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const rows = scanSource(
    '<FinanceForm fields={[{key:"amount",label:"Cash outflow amount"}]} /><Grid fields="id amount" />',
    'apps/frontend/src/features/cash/screen.tsx',
  );
  assert.deepEqual(
    rows.map((row) => row.message),
    ['Cash outflow amount'],
  );
});

test('form field option templates retain visible literals and opaque parameter slots', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const rows = scanSource(
    '<FinanceForm fields={[{key:"handover",options:rows.map(row=>({value:row.id,label:`Memo ${row.number} · ${row.name}`}))}]} />',
    'apps/frontend/src/features/cash/screen.tsx',
  );
  assert.deepEqual(
    rows.map((row) => row.message),
    ['Memo {p0} · {p1}'],
  );
});

test('explicit translation keys stay inventoried inside validation and technical-looking text', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const rows = scanSource(
    "const error=t('Enter a supported reading size (12–24 px).'); const x=t('Value {p0}');",
    'packages/ui/src/components/preferences.tsx',
  );
  assert.deepEqual(
    rows.map((row) => row.message),
    ['Enter a supported reading size (12–24 px).', 'Value {p0}'],
  );
});
test('translation inventory distinguishes executable copy from protocols, SQL, styles and user data', async () => {
  const feature = await import('./i18n-inventory.mjs').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(
    feature?.scanSource,
    'An executable translation inventory must exist',
  );
  const source = `const status='ACTIVE';const css='db-stack';const query='SELECT name FROM daybook.residents';const columns='id,resident_id AS "residentId"';
    const copy={title:'Delivery routes',description:'Review recorded stops.'};
    function Screen(){return <section><h1>Residents</h1><Field label="Phone number"/><p>{resident.name}</p><span>{status}</span></section>}
    function validate(){fail('Choose a resident.','NOT_FOUND');throw new Error('Unable to retain the original request.');}`;
  const messages = feature
    .scanSource(source, 'apps/frontend/src/features/example.tsx')
    .map((row) => row.message);
  for (const text of [
    'Delivery routes',
    'Review recorded stops.',
    'Residents',
    'Phone number',
    'Choose a resident.',
    'Unable to retain the original request.',
  ])
    assert.ok(messages.includes(text), text);
  for (const text of [
    'ACTIVE',
    'NOT_FOUND',
    'db-stack',
    'SELECT name FROM daybook.residents',
    'id,resident_id AS "residentId"',
    'resident.name',
  ])
    assert.ok(!messages.includes(text), text);
});
test('developer-controlled validation field labels are inventoried separately from their values', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const messages = scanSource(
    "const value=cleanText(input.name,'territory name');",
    'apps/backend/src/modules/example.ts',
  ).map((row) => row.message);
  assert.deepEqual(messages, ['territory name']);
});
test('public backend authentication and JSON errors enter the same message inventory', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const messages = scanSource(
    "throw new AuthError('Credentials are invalid.',401);Response.json({error:'Database unavailable.'},{status:503});",
    'apps/backend/src/app.ts',
  ).map((row) => row.message);
  assert.ok(messages.includes('Credentials are invalid.'));
  assert.ok(messages.includes('Database unavailable.'));
});
test('generated catalogues are outputs rather than new source messages', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  assert.deepEqual(
    scanSource(
      "export default {'Save':'Native saved label'}",
      'packages/ui/src/i18n/ml.js',
    ),
    [],
  );
});
test('dynamic request templates and class names remain code while interpolated messages enter the inventory', async () => {
  const { scanSource } = await import('./i18n-inventory.mjs');
  const source = [
    'const fields="id residentId amount status version";',
    'const query=`query($id:ID!){resident(id:$id){${fields}}}`;',
    'const url=`/api/documents/owner/${id}`;',
    'const clock=`${date}T00:00:00Z`;',
    'graphqlRequest(`{residents{id name} invoices{${fields}}}`);',
    'function View(){return <div className={`db-card ${tone}`} aria-label={`Review ${name}`}>Ready</div>}',
    'function validate(){fail(`Enter an amount below ${limit}.`)}',
  ].join('\n');
  const messages = scanSource(
    source,
    'apps/frontend/src/features/example.tsx',
  ).map((row) => row.message);
  assert.ok(messages.includes('Review {p0}'));
  assert.ok(messages.includes('Enter an amount below {p0}.'));
  assert.ok(messages.includes('Ready'));
  assert.ok(
    !messages.some(
      (message) =>
        message.startsWith('query') ||
        message.startsWith('/api/') ||
        message.startsWith('db-card') ||
        message.includes('T00:00:00Z') ||
        message.startsWith('{residents') ||
        message === 'id residentId amount status version',
    ),
  );
});

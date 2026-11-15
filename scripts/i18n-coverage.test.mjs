import assert from 'node:assert/strict';
import test from 'node:test';
test('localization coverage rejects fallback, empty native text and missing interpolation parameters', async () => {
  const feature = await import('./i18n-coverage.mjs').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(
    feature?.inspectCoverage,
    'Translation completeness needs an explicit gate',
  );
  const inventory = [
    { message: 'Save', locations: [] },
    { message: 'English', locations: [] },
    { message: '{p0} copies', locations: [] },
  ];
  const bad = feature.inspectCoverage(inventory, {
    en: { Save: 'Save', English: 'English', '{p0} copies': '{p0} copies' },
    ml: { Save: 'Save', English: 'English', '{p0} copies': 'പകർപ്പുകൾ' },
    hi: { Save: '', English: 'English' },
  });
  assert.equal(bad.complete, false);
  assert.ok(
    bad.issues.some(
      (row) =>
        row.locale === 'ml' &&
        row.message === 'Save' &&
        row.kind === 'unchanged',
    ),
  );
  assert.ok(!bad.issues.some((row) => row.message === 'English'));
  assert.ok(
    bad.issues.some((row) => row.locale === 'ml' && row.kind === 'parameters'),
  );
  assert.ok(
    bad.issues.some(
      (row) =>
        row.locale === 'hi' && row.message === 'Save' && row.kind === 'empty',
    ),
  );
  const good = feature.inspectCoverage(inventory, {
    en: { Save: 'Save', English: 'English', '{p0} copies': '{p0} copies' },
    ml: {
      Save: 'സേവ് ചെയ്യുക',
      English: 'English',
      '{p0} copies': '{p0} പകർപ്പുകൾ',
    },
    hi: { Save: 'सहेजें', English: 'English', '{p0} copies': '{p0} प्रतियाँ' },
  });
  assert.equal(good.complete, true);
});

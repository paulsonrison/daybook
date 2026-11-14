import assert from 'node:assert/strict';
import test from 'node:test';

test('provider configuration binds credentials to one agency and reports malformed settings safely', async () => {
  const path = './config.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.providerRegistry, 'Agency provider registry must exist');
  const agency = '00000000-0000-4000-8000-000000000001';
  const env = {
    TOKEN: 'synthetic-secret',
    APP: 'app-secret',
    VERIFY: 'verify-secret',
    DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
      [agency]: {
        whatsapp: {
          phoneNumberId: '123',
          apiVersion: 'v27.0',
          accessTokenEnv: 'TOKEN',
          appSecretEnv: 'APP',
          verifyTokenEnv: 'VERIFY',
        },
      },
    }),
  };
  const registry = module.providerRegistry(env);
  assert.equal(registry.get(agency, 'WHATSAPP').status, 'CONFIGURED');
  assert.equal(
    registry.get('00000000-0000-4000-8000-000000000002', 'WHATSAPP').status,
    'NOT_CONFIGURED',
  );
  assert.equal(registry.get(agency, 'SMS').status, 'NOT_CONFIGURED');
  assert.equal(
    module.providerRegistry({ ...env, TOKEN: '' }).get(agency, 'WHATSAPP')
      .status,
    'CONFIGURATION_ERROR',
  );
  const malformed = module
    .providerRegistry({
      DAYBOOK_COMMUNICATIONS_PROVIDERS: 'synthetic-secret broken JSON',
    })
    .get(agency, 'WHATSAPP');
  assert.deepEqual(malformed, { status: 'CONFIGURATION_ERROR' });
  assert.ok(!JSON.stringify(malformed).includes('synthetic-secret'));
  const duplicate = JSON.parse(env.DAYBOOK_COMMUNICATIONS_PROVIDERS);
  duplicate['00000000-0000-4000-8000-000000000002'] = duplicate[agency];
  assert.equal(
    module
      .providerRegistry({
        ...env,
        DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify(duplicate),
      })
      .get(agency, 'WHATSAPP').status,
    'CONFIGURATION_ERROR',
  );
});

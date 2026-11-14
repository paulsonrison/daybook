import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import twilio from 'twilio';

test('WhatsApp callback authenticates exact raw bytes and configured phone identity', async () => {
  const path = './signatures.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.verifyWhatsApp, 'Callback authentication must exist');
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '123' },
              statuses: [{ id: 'wamid.test', status: 'delivered' }],
            },
          },
        ],
      },
    ],
  });
  const signature =
    'sha256=' + createHmac('sha256', 'synthetic').update(body).digest('hex');
  assert.equal(
    module.verifyWhatsApp('synthetic', '123', body, signature),
    true,
  );
  assert.equal(
    module.verifyWhatsApp('synthetic', '456', body, signature),
    false,
  );
  assert.equal(
    module.verifyWhatsApp('synthetic', '123', body + ' ', signature),
    false,
  );
  assert.equal(
    module.verifyWhatsApp('synthetic', '123', body, 'sha256=00'),
    false,
  );
});

test('Twilio authenticates canonical configured URL, complete form and account identity', async () => {
  const path = './signatures.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.verifySms, 'Callback authentication must exist');
  const url = 'https://daybook.example/webhooks/sms/agency?intent=123';
  const params = {
    AccountSid: 'AC123',
    MessagingServiceSid: 'MG123',
    MessageSid: 'SM123',
    MessageStatus: 'delivered',
    FutureField: 'preserved',
  };
  const signature = twilio.getExpectedTwilioSignature('synthetic', url, params);
  const config = {
    accountSid: 'AC123',
    messagingServiceSid: 'MG123',
    authToken: 'synthetic',
  };
  assert.equal(module.verifySms(config, url, params, signature), true);
  assert.equal(
    module.verifySms(
      config,
      url.replace('daybook.example', 'attacker.example'),
      params,
      signature,
    ),
    false,
  );
  assert.equal(
    module.verifySms(
      config,
      url,
      { ...params, FutureField: 'changed' },
      signature,
    ),
    false,
  );
  assert.equal(
    module.verifySms(
      { ...config, accountSid: 'AC456' },
      url,
      params,
      signature,
    ),
    false,
  );
  assert.equal(
    module.verifySms(
      config,
      url,
      params,
      signature,
      'key=unknown,algorithm=HMAC_SHA256',
    ),
    false,
  );
  const shared = twilio.getExpectedTwilioSignature(
    'shared-synthetic',
    url,
    params,
    'HMAC_SHA256',
  );
  assert.equal(
    module.verifySms(
      { ...config, sharedKeys: { key1: 'shared-synthetic' } },
      url,
      params,
      shared,
      'key=key1,algorithm=HMAC_SHA256',
    ),
    true,
  );
});

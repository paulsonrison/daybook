import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import twilio from 'twilio';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { withTenant } from '../../src/db/tenant.js';
import { testApi } from './support.js';

test('provider HTTP callbacks authenticate raw content and canonical URLs before storing tenant events', async () => {
  let registry = providerRegistry({});
  const api = testApi(
    { get: (agency, channel) => registry.get(agency, channel) },
    'https://daybook.example',
  );
  try {
    const cookie = await api.agency();
    const owner = (await api.query(cookie, '{me{id agencyId}}')).data.me;
    const agency = owner.agencyId;
    registry = providerRegistry({
      TOKEN: 'synthetic',
      APP: 'synthetic-app',
      VERIFY: 'synthetic-verify',
      SMS: 'synthetic-sms',
      DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
        [agency]: {
          whatsapp: {
            phoneNumberId: '123',
            apiVersion: 'v27.0',
            accessTokenEnv: 'TOKEN',
            appSecretEnv: 'APP',
            verifyTokenEnv: 'VERIFY',
          },
          sms: {
            accountSid: 'AC123',
            messagingServiceSid: 'MG123',
            authTokenEnv: 'SMS',
          },
        },
      }),
    });
    const path = `/webhooks/whatsapp/${agency}`;
    const challenge = await api.fetch(
      new Request(
        `http://backend${path}?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345`,
      ),
    );
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), '12345');
    const malformedToken = await api.fetch(
      new Request(
        `http://backend${path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent('ന'.repeat('synthetic-verify'.length))}&hub.challenge=12345`,
      ),
    );
    assert.equal(malformedToken.status, 403);
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '123' },
                statuses: [
                  {
                    id: 'wamid.synthetic',
                    status: 'delivered',
                    timestamp: '1700000000',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature =
      'sha256=' +
      createHmac('sha256', 'synthetic-app').update(body).digest('hex');
    const post = (text: string, sig: string) =>
      api.fetch(
        new Request(`http://backend${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': sig,
          },
          body: text,
        }),
      );
    assert.equal((await post(body + ' ', signature)).status, 403);
    assert.equal((await post('x'.repeat(65537), signature)).status, 413);
    assert.equal((await post(body, signature)).status, 200);
    assert.equal((await post(body, signature)).status, 200);
    const intent = randomUUID();
    const route = await api.route(cookie);
    const resident = (
      await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: 'SMS Callback Resident',
            address: '1 Lotus Lane',
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: 1,
          },
        },
      )
    ).data.saveResident;
    await withTenant(api.pool, agency, (c) =>
      c.query(
        `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,attempts,lease_until,submitted_at) VALUES($1::uuid,$2,$3,'INVOICE','SMS','+919876543210','{}',$1::text,'SUBMITTING',$4,1,now()+interval '60 seconds',now())`,
        [intent, agency, resident.id, owner.id],
      ),
    );
    const smsPath = `/webhooks/sms/${agency}?intent=${intent}`;
    const params = {
      AccountSid: 'AC123',
      MessagingServiceSid: 'MG123',
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
      To: '+919876543210',
      FutureField: 'preserved',
    };
    const smsSig = twilio.getExpectedTwilioSignature(
      'synthetic-sms',
      `https://daybook.example${smsPath}`,
      params,
    );
    const sms = (signature: string, fields = params) =>
      api.fetch(
        new Request(`http://forged-host${smsPath}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-twilio-signature': signature,
          },
          body: new URLSearchParams(fields),
        }),
      );
    assert.equal(
      (await sms(smsSig, { ...params, FutureField: 'tampered' })).status,
      403,
    );
    assert.equal((await sms(smsSig)).status, 200);
    const wrongRecipient = { ...params, To: '+919876543211' };
    const wrongRecipientSignature = twilio.getExpectedTwilioSignature(
      'synthetic-sms',
      `https://daybook.example${smsPath}`,
      wrongRecipient,
    );
    assert.equal(
      (await sms(wrongRecipientSignature, wrongRecipient)).status,
      403,
    );
    const delivered = await withTenant(
      api.pool,
      agency,
      async (c) =>
        (
          await c.query(
            'SELECT status,provider_message_id,accepted_at IS NOT NULL AS accepted FROM daybook.notification_intents WHERE id=$1',
            [intent],
          )
        ).rows[0],
    );
    assert.deepEqual(delivered, {
      status: 'DELIVERED',
      provider_message_id: 'SM123',
      accepted: true,
    });
    const uncertain = randomUUID();
    await withTenant(api.pool, agency, (c) =>
      c.query(
        `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,attempts,submitted_at) SELECT $1::uuid,agency_id,resident_id,kind,channel,recipient,payload,$1::text,'UNKNOWN',created_by,1,submitted_at FROM daybook.notification_intents WHERE id=$2`,
        [uncertain, intent],
      ),
    );
    const uncertainPath = `/webhooks/sms/${agency}?intent=${uncertain}`;
    const uncertainParams = { ...params, MessageSid: 'SM124' };
    const uncertainSignature = twilio.getExpectedTwilioSignature(
      'synthetic-sms',
      `https://daybook.example${uncertainPath}`,
      uncertainParams,
    );
    const reconciled = await api.fetch(
      new Request(`http://backend${uncertainPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': uncertainSignature,
        },
        body: new URLSearchParams(uncertainParams),
      }),
    );
    assert.equal(reconciled.status, 200);
    const resolved = await withTenant(
      api.pool,
      agency,
      async (c) =>
        (
          await c.query(
            'SELECT status,provider_message_id FROM daybook.notification_intents WHERE id=$1',
            [uncertain],
          )
        ).rows[0],
    );
    assert.deepEqual(resolved, {
      status: 'DELIVERED',
      provider_message_id: 'SM124',
    });
    const count = await withTenant(
      api.pool,
      agency,
      async (c) =>
        (
          await c.query(
            'SELECT count(*)::int AS n FROM daybook.notification_inbox',
          )
        ).rows[0].n,
    );
    assert.equal(count, 3);
  } finally {
    await api.pool.end();
  }
});

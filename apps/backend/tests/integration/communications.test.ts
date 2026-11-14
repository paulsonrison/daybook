import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());

test('channel opt-out cancels queued and claimed sends without rewriting submissions already in flight', async () => {
  const cookie = await api.agency();
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const route = await api.route(cookie);
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Opt Out Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const preference = {
    requestId: randomUUID(),
    residentId: resident.id,
    version: 0,
    locale: 'en',
    whatsapp: true,
    sms: true,
    confirmedConsent: true,
    evidence: 'Synthetic explicit opt-in',
  };
  const mutation =
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}';
  assert.ok(!(await api.query(cookie, mutation, { input: preference })).errors);
  await withTenant(api.pool, me.agencyId, async (c) => {
    for (const [channel, status] of [
      ['SMS', 'PENDING'],
      ['SMS', 'CLAIMED'],
      ['SMS', 'SUBMITTING'],
      ['SMS', 'UNKNOWN'],
      ['SMS', 'ACCEPTED'],
      ['WHATSAPP', 'PENDING'],
    ]) {
      const id = randomUUID();
      await c.query(
        `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,lease_until) VALUES($1::uuid,$2,$3,'INVOICE',$4,'+919876543210','{}'::jsonb,$1::text,$5,$6,CASE WHEN $5 IN('CLAIMED','SUBMITTING') THEN now()+interval '60 seconds' ELSE NULL END)`,
        [id, me.agencyId, resident.id, channel, status, me.id],
      );
    }
  });
  const input = {
    ...preference,
    requestId: randomUUID(),
    version: 1,
    sms: false,
    evidence: 'Resident requested SMS opt-out',
  };
  const saved = await api.query(cookie, mutation, { input });
  assert.ok(!saved.errors, JSON.stringify(saved));
  const rows = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT channel,status,lease_until,last_error FROM daybook.notification_intents ORDER BY channel,status',
        )
      ).rows,
  );
  assert.equal(
    rows.filter((row) => row.channel === 'SMS' && row.status === 'CANCELLED')
      .length,
    2,
  );
  assert.ok(
    rows
      .filter((row) => row.status === 'CANCELLED')
      .every(
        (row) =>
          row.lease_until === null &&
          row.last_error === 'CHANNEL_CONSENT_WITHDRAWN',
      ),
  );
  for (const status of ['SUBMITTING', 'UNKNOWN', 'ACCEPTED'])
    assert.ok(
      rows.some((row) => row.channel === 'SMS' && row.status === status),
    );
  assert.ok(
    rows.some((row) => row.channel === 'WHATSAPP' && row.status === 'PENDING'),
  );
  assert.equal(
    (await api.query(cookie, mutation, { input })).data.saveContactPreference
      .version,
    2,
  );
});
test('approved template mappings require explicit confirmation, matching locale and unique message kinds', async () => {
  const cookie = await api.agency();
  const template = {
    kind: 'INVOICE',
    locale: 'ml',
    name: 'monthly_invoice_ml',
    language: 'ml',
    qrHeader: true,
  };
  const input = {
    requestId: randomUUID(),
    version: 0,
    remindersEnabled: false,
    frequencyDays: 7,
    cooldownHours: 24,
    reminderChannel: 'WHATSAPP',
    templates: [template],
    confirmTemplatesApproved: true,
  };
  const query =
    'mutation($input:CommunicationSettingsInput!){saveCommunicationSettings(input:$input){version templates{kind locale name language qrHeader}}}';
  const missingConfirmation = await api.query(cookie, query, {
    input: { ...input, confirmTemplatesApproved: false },
  });
  assert.ok(missingConfirmation.errors);
  const saved = await api.query(cookie, query, { input });
  assert.ok(saved.data?.saveCommunicationSettings, JSON.stringify(saved));
  assert.deepEqual(saved.data.saveCommunicationSettings.templates, [template]);
  const replay = await api.query(cookie, query, { input });
  assert.equal(replay.data.saveCommunicationSettings.version, 1);
  const duplicate = await api.query(cookie, query, {
    input: {
      ...input,
      requestId: randomUUID(),
      version: 1,
      templates: [template, template],
    },
  });
  assert.ok(duplicate.errors);
  const wrongLanguage = await api.query(cookie, query, {
    input: {
      ...input,
      requestId: randomUUID(),
      version: 1,
      templates: [{ ...template, language: 'en_US' }],
    },
  });
  assert.ok(wrongLanguage.errors);
  const other = await api.query(
    await api.agency(),
    '{communicationSettings{templates{name}}}',
  );
  assert.deepEqual(other.data.communicationSettings.templates, []);
});
test('settings expose configured agency transport status without credentials or another agency identity', async () => {
  let configured = providerRegistry({});
  const scoped = testApi({
    get: (agency, channel) => configured.get(agency, channel),
  });
  try {
    const cookie = await scoped.agency();
    const me = await scoped.query(cookie, '{me{agencyId}}');
    configured = providerRegistry({
      TOKEN: 'synthetic-secret',
      APP: 'synthetic-app',
      VERIFY: 'synthetic-verify',
      DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
        [me.data.me.agencyId]: {
          whatsapp: {
            phoneNumberId: '123',
            apiVersion: 'v27.0',
            accessTokenEnv: 'TOKEN',
            appSecretEnv: 'APP',
            verifyTokenEnv: 'VERIFY',
          },
        },
      }),
    });
    const own = await scoped.query(
      cookie,
      '{communicationSettings{whatsappStatus smsStatus}}',
    );
    assert.equal(own.data.communicationSettings.whatsappStatus, 'CONFIGURED');
    assert.equal(own.data.communicationSettings.smsStatus, 'NOT_CONFIGURED');
    assert.ok(!JSON.stringify(own).includes('synthetic-secret'));
    const other = await scoped.agency();
    const blocked = await scoped.query(
      other,
      '{communicationSettings{whatsappStatus}}',
    );
    assert.equal(
      blocked.data.communicationSettings.whatsappStatus,
      'NOT_CONFIGURED',
    );
  } finally {
    await scoped.pool.end();
  }
});
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    resident = (
      await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: 'Contact Resident',
            address: '1 Lotus Lane',
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: 1,
          },
        },
      )
    ).data.saveResident;
  return { cookie, resident, route };
}
test('communication settings stay unconfigured until a provider exists, and consent/locale are explicit tenant-scoped records', async () => {
  const f = await fixture();
  const initial = await api.query(
    f.cookie,
    '{communicationSettings{version remindersEnabled frequencyDays cooldownHours whatsappStatus smsStatus}}',
  );
  assert.ok(initial.data?.communicationSettings, JSON.stringify(initial));
  assert.equal(
    initial.data.communicationSettings.whatsappStatus,
    'NOT_CONFIGURED',
  );
  assert.equal(initial.data.communicationSettings.remindersEnabled, false);
  const missingProof = await api.query(
    f.cookie,
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        version: 0,
        locale: 'ml',
        whatsapp: true,
        sms: false,
        confirmedConsent: false,
        evidence: 'No verified permission',
      },
    },
  );
  assert.ok(missingProof.errors);
  const input = {
    requestId: randomUUID(),
    residentId: f.resident.id,
    version: 0,
    locale: 'ml',
    whatsapp: true,
    sms: false,
    confirmedConsent: true,
    evidence: 'Resident explicitly requested WhatsApp bills',
  };
  const saved = await api.query(
    f.cookie,
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){residentId locale whatsapp sms version}}',
    { input },
  );
  assert.ok(saved.data?.saveContactPreference, JSON.stringify(saved));
  assert.equal(saved.data.saveContactPreference.locale, 'ml');
  assert.equal(saved.data.saveContactPreference.version, 1);
  const replay = await api.query(
    f.cookie,
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
    { input },
  );
  assert.equal(replay.data.saveContactPreference.version, 1);
  const other = await api.agency(),
    leak = await api.query(
      other,
      'query($id:ID!){contactPreference(residentId:$id){whatsapp}}',
      { id: f.resident.id },
    );
  assert.ok(leak.errors);
});
test('direct call and WhatsApp links are safe greetings; a click records one attempt and never claims a delivered message', async () => {
  const f = await fixture();
  const links = await api.query(
    f.cookie,
    'query($id:ID!){contactLinks(residentId:$id){tel whatsapp}}',
    { id: f.resident.id },
  );
  assert.ok(links.data?.contactLinks, JSON.stringify(links));
  assert.equal(links.data.contactLinks.tel, 'tel:+919876543210');
  const wa = new URL(links.data.contactLinks.whatsapp);
  assert.equal(wa.origin, 'https://wa.me');
  assert.ok(wa.searchParams.get('text')?.includes('Domain Tests'));
  const input = {
    requestId: randomUUID(),
    residentId: f.resident.id,
    channel: 'WHATSAPP',
  };
  const q =
    'mutation($input:ContactAttemptInput!){recordContactAttempt(input:$input){id outcome}}';
  const first = await api.query(f.cookie, q, { input });
  assert.ok(first.data?.recordContactAttempt, JSON.stringify(first));
  assert.equal(first.data.recordContactAttempt.outcome, 'ATTEMPTED');
  const again = await api.query(f.cookie, q, { input });
  assert.equal(
    again.data.recordContactAttempt.id,
    first.data.recordContactAttempt.id,
  );
  const history = await api.query(
    f.cookie,
    'query($id:ID!){communicationHistory(residentId:$id){attempts{id channel outcome} messages{id status}}}',
    { id: f.resident.id },
  );
  assert.equal(history.data.communicationHistory.attempts.length, 1);
  assert.equal(history.data.communicationHistory.messages.length, 0);
});

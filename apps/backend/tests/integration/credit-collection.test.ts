import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { runCommunicationsCycle } from '../../src/modules/communications/worker.js';
const api = testApi();
after(() => api.pool.end());
test('configured consented credit suspension queues a real hold document and original request reflects later provider acceptance', async () => {
  process.env.DOCUMENT_LINK_SECRET =
    'synthetic-hold-link-secret-012345678901234567890';
  process.env.PUBLIC_APP_ORIGIN = 'https://holds.example.test';
  let providers = providerRegistry({});
  const scoped = testApi({
    get: (agency, channel) => providers.get(agency, channel),
  });
  try {
    const f = await fixture(scoped);
    async function run(query: string, variables: Record<string, unknown> = {}) {
      const result = await scoped.query(f.cookie, query, variables);
      assert.ok(!result.errors, JSON.stringify(result));
      return result.data;
    }
    const me = (await run('{me{agencyId}}')).me;
    providers = providerRegistry({
      TOKEN: 'synthetic',
      APP: 'synthetic-app',
      VERIFY: 'synthetic-verify',
      DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
        [me.agencyId]: {
          whatsapp: {
            phoneNumberId: '1234567',
            apiVersion: 'v27.0',
            accessTokenEnv: 'TOKEN',
            appSecretEnv: 'APP',
            verifyTokenEnv: 'VERIFY',
          },
        },
      }),
    });
    await opening(f, '120.00', 30, scoped);
    await run(
      'mutation{saveCreditPolicy(input:{maxOverdueAmount:"100.00",enabled:true}){version}saveCollectionSettings(input:{upiId:"holds@upi",payeeName:"Domain Tests",confirmOwnership:true}){version}}',
    );
    await run(
      'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: f.resident.id,
          version: 0,
          locale: 'ml',
          whatsapp: true,
          sms: false,
          confirmedConsent: true,
          evidence: 'Synthetic explicit hold-notice consent',
        },
      },
    );
    await run(
      'mutation($input:CommunicationSettingsInput!){saveCommunicationSettings(input:$input){version}}',
      {
        input: {
          requestId: randomUUID(),
          version: 0,
          remindersEnabled: false,
          frequencyDays: 7,
          cooldownHours: 24,
          reminderChannel: 'WHATSAPP',
          templates: [
            {
              kind: 'CREDIT_HOLD',
              locale: 'ml',
              name: 'synthetic_hold_ml',
              language: 'ml',
              qrHeader: true,
            },
          ],
          confirmTemplatesApproved: true,
        },
      },
    );
    const input = {
      requestId: randomUUID(),
      residentId: f.resident.id,
      version: f.resident.version,
      reason: 'Verified credit limit exceeded',
    };
    const mutation =
      'mutation($input:CreditSuspensionInput!){suspendForCredit(input:$input){status notificationStatus}}';
    assert.equal(
      (await run(mutation, { input })).suspendForCredit.notificationStatus,
      'WAITING_DOCUMENT',
    );
    let sent = 0;
    const cycle = await runCommunicationsCycle(
      scoped.pool,
      me.agencyId,
      providers,
      async (_provider, message) => {
        sent++;
        assert.equal(message.template?.name, 'synthetic_hold_ml');
        return { status: 'ACCEPTED', messageId: 'synthetic-hold-accepted' };
      },
    );
    assert.equal(sent, 1, JSON.stringify(cycle));
    const replay = (await run(mutation, { input })).suspendForCredit;
    assert.equal(replay.status, 'SUSPENDED');
    assert.equal(replay.notificationStatus, 'ACCEPTED');
  } finally {
    await scoped.pool.end();
  }
});
async function fixture(client = api) {
  const cookie = await client.agency(),
    route = await client.route(cookie),
    today = (await client.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today,
    resident = (
      await client.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id version}}',
        {
          input: {
            requestId: randomUUID(),
            name: 'Overdue Resident',
            address: '12 Lotus Lane',
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: 1,
          },
        },
      )
    ).data.saveResident;
  return { cookie, route, today, resident };
}
async function opening(
  f: Awaited<ReturnType<typeof fixture>>,
  amount: string,
  days: number,
  client = api,
) {
  const date = new Date(Date.parse(f.today + 'T00:00:00Z') - days * 86400000)
    .toISOString()
    .slice(0, 10);
  await client.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount,
        date,
        reason: 'Imported overdue account',
      },
    },
  );
}

test('credit thresholds use exact unpaid debt and overdue boundaries; suspension is explicit and notification is not falsely sent', async () => {
  const f = await fixture();
  await opening(f, '100.00', 59);
  const policy = await api.query(
    f.cookie,
    'mutation{saveCreditPolicy(input:{maxOverdueAmount:"100.00",maxOverdueDays:60,enabled:true}){version}}',
  );
  assert.ok(policy.data?.saveCreditPolicy, JSON.stringify(policy));
  let risk = await api.query(
    f.cookie,
    '{creditRiskSummary{highRiskCount accounts{residentId overdueAmount overdueDays highRisk version}}}',
  );
  assert.equal(risk.data.creditRiskSummary.highRiskCount, 0);
  assert.equal(risk.data.creditRiskSummary.accounts[0].overdueDays, 59);
  await api.query(
    f.cookie,
    'mutation{saveCreditPolicy(input:{maxOverdueAmount:"99.99",maxOverdueDays:60,enabled:true,version:1}){version}}',
  );
  risk = await api.query(
    f.cookie,
    '{creditRiskSummary{highRiskCount accounts{residentId highRisk version}}}',
  );
  assert.equal(risk.data.creditRiskSummary.highRiskCount, 1);
  const input = {
      requestId: randomUUID(),
      residentId: f.resident.id,
      version: risk.data.creditRiskSummary.accounts[0].version,
      reason: 'Overdue credit threshold exceeded',
    },
    suspended = await api.query(
      f.cookie,
      'mutation($input:CreditSuspensionInput!){suspendForCredit(input:$input){residentId status notificationStatus}}',
      { input },
    );
  assert.equal(
    suspended.data?.suspendForCredit.status,
    'SUSPENDED',
    JSON.stringify(suspended),
  );
  assert.equal(
    suspended.data.suspendForCredit.notificationStatus,
    'NOT_CONFIGURED',
  );
  const repeat = await api.query(
    f.cookie,
    'mutation($input:CreditSuspensionInput!){suspendForCredit(input:$input){status}}',
    { input },
  );
  assert.equal(repeat.data.suspendForCredit.status, 'SUSPENDED');
  const profile = (
    await api.query(
      f.cookie,
      '{residents{id name address phone sector routeId dropOrder version status}}',
    )
  ).data.residents[0];
  const updated = await api.query(
    f.cookie,
    'mutation($input:ResidentInput!){saveResident(input:$input){status}}',
    { input: { ...profile, name: 'Updated overdue resident' } },
  );
  assert.equal(
    updated.data?.saveResident.status,
    'SUSPENDED',
    JSON.stringify(updated),
  );
  const sheet = await api.query(
    f.cookie,
    'query($input:CollectionSheetInput!){buildCollectionSheet(input:$input){rows{residentId}}}',
    { input: { routeId: f.route.id } },
  );
  assert.deepEqual(sheet.data.buildCollectionSheet.rows, []);
});

test('collection sheet orders route doors, retains unknown payment identity, and generates an independently decodable exact UPI QR', async () => {
  const f = await fixture();
  await opening(f, '100.05', 60);
  const input = { routeId: f.route.id },
    query =
      'query($input:CollectionSheetInput!){buildCollectionSheet(input:$input){routeName qrStatus rows{residentId name phone door sequence balance overdueDays upiUri qrDataUrl}}}';
  let sheet = await api.query(f.cookie, query, { input });
  assert.ok(sheet.data?.buildCollectionSheet, JSON.stringify(sheet));
  assert.equal(sheet.data.buildCollectionSheet.qrStatus, 'NOT_CONFIGURED');
  assert.equal(sheet.data.buildCollectionSheet.rows[0].qrDataUrl, null);
  assert.equal(sheet.data.buildCollectionSheet.rows[0].overdueDays, 60);
  const settings = await api.query(
    f.cookie,
    'mutation{saveCollectionSettings(input:{upiId:"synthetic-agency@upi",payeeName:"Synthetic Test Agency",confirmOwnership:true}){version}}',
  );
  assert.ok(settings.data?.saveCollectionSettings, JSON.stringify(settings));
  sheet = await api.query(f.cookie, query, { input });
  const row = sheet.data.buildCollectionSheet.rows[0];
  assert.equal(row.balance, '100.05');
  assert.equal(row.sequence, 1);
  const uri = new URL(row.upiUri);
  assert.equal(uri.protocol, 'upi:');
  assert.equal(uri.hostname, 'pay');
  assert.equal(uri.searchParams.get('pa'), 'synthetic-agency@upi');
  assert.equal(uri.searchParams.get('am'), '100.05');
  assert.equal(uri.searchParams.get('cu'), 'INR');
  const { PNG } = await import('pngjs'),
    { default: jsQR } = await import('jsqr');
  const png = PNG.sync.read(Buffer.from(row.qrDataUrl.split(',')[1], 'base64')),
    decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded, 'The actual generated image must scan');
  assert.equal(decoded.data, row.upiUri);
  const foreign = await api.query(await api.agency(), query, { input });
  assert.equal(foreign.errors?.[0].extensions.code, 'NOT_FOUND');
});

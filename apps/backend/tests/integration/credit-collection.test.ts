import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today,
    resident = (
      await api.query(
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
) {
  const date = new Date(Date.parse(f.today + 'T00:00:00Z') - days * 86400000)
    .toISOString()
    .slice(0, 10);
  await api.query(
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

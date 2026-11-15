import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
const snapshot =
  'query($date:String!,$route:ID!){fieldSnapshot(date:$date,routeId:$route){agencyId agentId date residents{id name balance cashVersion} deliveries{id residentId status version}}}';
const sync =
  'mutation($input:FieldActionInput!){syncFieldAction(input:$input){requestId kind status receiptCode}}';
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Field Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const publication = (
    await api.query(
      cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Field Daily',
          edition: 'Kochi',
          kind: 'NEWSPAPER',
          language: 'English',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '8.15',
          weekendPrice: '8.15',
        },
      },
    )
  ).data.savePublication;
  await api.query(
    cookie,
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: '2024-01-01',
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await api.query(
    cookie,
    'mutation{markScheduledDeliveries(date:"2024-02-01"){total}}',
  );
  const response = await api.query(cookie, snapshot, {
    date: '2024-02-01',
    route: route.id,
  });
  assert.ok(response.data?.fieldSnapshot, JSON.stringify(response));
  const data = response.data.fieldSnapshot;
  return { cookie, route, me, resident, data };
}
function cash(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    requestId: randomUUID(),
    agencyId: f.me.agencyId,
    agentId: f.me.id,
    kind: 'CASH',
    recordId: f.resident.id,
    expectedVersion: f.data.residents[0].cashVersion,
    occurredAt: new Date().toISOString(),
    amount: '10.05',
    date: '2024-02-01',
    reason: 'Actual cash received at the door',
  };
}
test('field cash replay returns original receipt exactly once; stale financial snapshot conflicts', async () => {
  const f = await fixture(),
    input = cash(f);
  assert.equal(f.data.residents[0].balance, '0.00');
  const results = await Promise.all([
    api.query(f.cookie, sync, { input }),
    api.query(f.cookie, sync, { input }),
  ]);
  assert.ok(
    results[0].data?.syncFieldAction?.receiptCode,
    JSON.stringify(results),
  );
  assert.deepEqual(results[0], results[1]);
  const stale = await api.query(f.cookie, sync, {
    input: { ...input, requestId: randomUUID() },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const changed = await api.query(f.cookie, sync, {
    input: { ...input, amount: '11.05' },
  });
  assert.equal(changed.errors?.[0].extensions.code, 'CONFLICT');
  const payments = await api.query(f.cookie, '{payments{amount status}}');
  assert.deepEqual(payments.data.payments, [
    { amount: '10.05', status: 'CONFIRMED' },
  ]);
});
test('field delivery retries once and preserves conflicting versions; rejects another actor or tenant', async () => {
  const f = await fixture(),
    row = f.data.deliveries[0];
  assert.ok(row);
  const input = {
    requestId: randomUUID(),
    agencyId: f.me.agencyId,
    agentId: f.me.id,
    kind: 'DELIVERY',
    recordId: row.id,
    expectedVersion: String(row.version),
    occurredAt: new Date().toISOString(),
    status: 'MISSED',
    reason: 'Door inaccessible',
  };
  const first = await api.query(f.cookie, sync, { input });
  assert.equal(
    first.data?.syncFieldAction.status,
    'MISSED',
    JSON.stringify(first),
  );
  assert.deepEqual(await api.query(f.cookie, sync, { input }), first);
  const stale = await api.query(f.cookie, sync, {
    input: { ...input, requestId: randomUUID(), status: 'DAMAGED' },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const other = await api.agency();
  const cross = await api.query(other, sync, { input });
  assert.equal(cross.errors?.[0].extensions.code, 'FORBIDDEN');
  const actor = await api.query(f.cookie, sync, {
    input: { ...cash(f), agentId: randomUUID() },
  });
  assert.equal(actor.errors?.[0].extensions.code, 'FORBIDDEN');
  const foreign = await api.query(other, snapshot, {
    date: '2024-02-01',
    route: f.route.id,
  });
  assert.ok(foreign.errors);
  const unauth = await api.query('', sync, { input });
  assert.equal(unauth.errors?.[0].extensions.code, 'UNAUTHENTICATED');
});

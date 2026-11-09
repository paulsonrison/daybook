import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
const save =
  'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id residentId publicationId cadence startDate endDate weekdays status quantity version}}';
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Subscriber',
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
          name: 'Daily',
          edition: 'Kochi',
          kind: 'NEWSPAPER',
          language: 'Malayalam',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '8.15',
          weekendPrice: '12.25',
        },
      },
    )
  ).data.savePublication;
  return {
    cookie,
    resident,
    publication,
    input: {
      requestId: randomUUID(),
      residentId: resident.id,
      publicationId: publication.id,
      cadence: 'DAILY',
      startDate: '2024-01-01',
      weekdays: [],
      quantity: 1,
    },
  };
}
test('agent assigns concurrent publications, modifies schedules and rejects stale or foreign links', async () => {
  const f = await fixture();
  const first = await api.query(f.cookie, save, { input: f.input });
  assert.ok(first.data?.saveSubscription, JSON.stringify(first));
  const sub = first.data.saveSubscription;
  const changed = await api.query(f.cookie, save, {
    input: {
      ...f.input,
      id: sub.id,
      version: sub.version,
      cadence: 'WEEKDAYS',
      weekdays: [1, 3, 5],
    },
  });
  assert.equal(changed.data?.saveSubscription.version, 2);
  const magazine = (
    await api.query(
      f.cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Monthly Magazine',
          edition: 'Kochi',
          kind: 'MAGAZINE',
          language: 'English',
          dispatch: 'EVENING',
          frequency: 'MONTHLY',
          anchorDate: '2024-01-31',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '50.25',
          weekendPrice: '50.25',
        },
      },
    )
  ).data.savePublication;
  const second = await api.query(f.cookie, save, {
    input: {
      ...f.input,
      requestId: randomUUID(),
      publicationId: magazine.id,
      cadence: 'MONTHLY',
      startDate: '2024-01-31',
    },
  });
  assert.ok(second.data?.saveSubscription, JSON.stringify(second));
  const aggregate = await api.query(
    f.cookie,
    'query($id:ID!){subscriptions(residentId:$id){publicationId status} scheduledCopies(residentId:$id,date:"2024-02-29"){publicationId price}}',
    { id: f.resident.id },
  );
  assert.equal(
    aggregate.data.subscriptions.filter(
      (s: { status: string }) => s.status === 'ACTIVE',
    ).length,
    2,
  );
  assert.deepEqual(aggregate.data.scheduledCopies, [
    { publicationId: magazine.id, price: '50.25' },
  ]);
  const stale = await api.query(f.cookie, save, {
    input: { ...f.input, id: sub.id, version: sub.version },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const other = await api.agency();
  const foreign = await api.query(other, save, { input: f.input });
  assert.equal(foreign.errors?.[0].extensions.code, 'NOT_FOUND');
  const empty = await api.query(
    other,
    '{subscriptions{id} holds{id} priceRules{id}}',
  );
  assert.deepEqual(empty.data, {
    subscriptions: [],
    holds: [],
    priceRules: [],
  });
});
test('a lost subscription response retries once and a reused request cannot change its meaning', async () => {
  const f = await fixture();
  const first = await api.query(f.cookie, save, { input: f.input });
  assert.ok(first.data?.saveSubscription, JSON.stringify(first));
  const retry = await api.query(f.cookie, save, { input: f.input });
  assert.equal(retry.data?.saveSubscription.id, first.data.saveSubscription.id);
  const changed = await api.query(f.cookie, save, {
    input: { ...f.input, quantity: 2 },
  });
  assert.equal(changed.errors?.[0].extensions.code, 'CONFLICT');
  const due = await api.query(
    f.cookie,
    'query($id:ID!){scheduledCopies(residentId:$id,date:"2024-02-01"){subscriptionId}}',
    { id: f.resident.id },
  );
  assert.equal(due.data.scheduledCopies.length, 1);
});
test('publication calendar changes cannot silently change active subscription delivery dates', async () => {
  const f = await fixture();
  await api.query(f.cookie, save, { input: f.input });
  const before = (
    await api.query(
      f.cookie,
      '{publications{id name edition kind language dispatch frequency publishingDays anchorDate weekdayPrice weekendPrice procurementNetCost version active}}',
    )
  ).data.publications[0];
  const edited = await api.query(
    f.cookie,
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    { input: { ...before, frequency: 'WEEKLY', publishingDays: [3] } },
  );
  assert.equal(edited.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const priced = await api.query(
    f.cookie,
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    { input: { ...before, weekdayPrice: '9.25' } },
  );
  assert.ok(priced.data?.savePublication, JSON.stringify(priced));
});
test('vacation holds skip copies inclusively and resume automatically with exact effective price', async () => {
  const f = await fixture();
  await api.query(f.cookie, save, { input: f.input });
  const hold = await api.query(
    f.cookie,
    'mutation($input:HoldInput!){setHold(input:$input){id startDate resumeDate}}',
    {
      input: {
        residentId: f.resident.id,
        startDate: '2024-02-01',
        resumeDate: '2024-02-03',
      },
    },
  );
  assert.ok(hold.data?.setHold, JSON.stringify(hold));
  async function due(date: string) {
    return api.query(
      f.cookie,
      'query($id:ID!,$date:String!){scheduledCopies(residentId:$id,date:$date){subscriptionId quantity price ruleId}}',
      { id: f.resident.id, date },
    );
  }
  assert.deepEqual((await due('2024-02-01')).data.scheduledCopies, []);
  const resumed = (await due('2024-02-03')).data.scheduledCopies;
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].price, '12.25');
  const cancelled = await api.query(f.cookie, '{subscriptions{id version}}');
  const sub = cancelled.data.subscriptions[0];
  await api.query(f.cookie, save, {
    input: { ...f.input, ...sub, status: 'CANCELLED' },
  });
  assert.deepEqual((await due('2024-02-04')).data.scheduledCopies, []);
});
test('price rules reject equal precedence overlap while explicit dates override weekday rates', async () => {
  const f = await fixture();
  await api.query(f.cookie, save, { input: f.input });
  const mutation =
    'mutation($input:PriceRuleInput!){savePriceRule(input:$input){id}}';
  const base = {
    publicationId: f.publication.id,
    startDate: '2024-01-01',
    weekdays: [0],
    price: '15.75',
  };
  const permanent = await api.query(f.cookie, mutation, { input: base });
  assert.ok(permanent.data?.savePriceRule, JSON.stringify(permanent));
  const collision = await api.query(f.cookie, mutation, {
    input: { ...base, price: '16.00' },
  });
  assert.equal(collision.errors?.[0].extensions.code, 'CONFLICT');
  const specific = await api.query(f.cookie, mutation, {
    input: {
      publicationId: f.publication.id,
      startDate: '2024-02-04',
      endDate: '2024-02-04',
      weekdays: [],
      price: '20.05',
    },
  });
  assert.ok(specific.data?.savePriceRule);
  const due = await api.query(
    f.cookie,
    'query($id:ID!){scheduledCopies(residentId:$id,date:"2024-02-04"){price ruleId}}',
    { id: f.resident.id },
  );
  assert.deepEqual(due.data.scheduledCopies, [
    { price: '20.05', ruleId: specific.data.savePriceRule.id },
  ]);
});
test('subscription schedule must be a subset of the publication issue calendar', async () => {
  const f = await fixture();
  const weekly = (
    await api.query(
      f.cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Wednesday Magazine',
          edition: 'Kochi',
          kind: 'MAGAZINE',
          language: 'English',
          dispatch: 'EVENING',
          frequency: 'WEEKLY',
          publishingDays: [3],
          weekdayPrice: '20',
          weekendPrice: '20',
        },
      },
    )
  ).data.savePublication;
  const invalid = await api.query(f.cookie, save, {
    input: { ...f.input, publicationId: weekly.id },
  });
  assert.equal(invalid.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const valid = await api.query(f.cookie, save, {
    input: {
      ...f.input,
      publicationId: weekly.id,
      cadence: 'WEEKLY',
      startDate: '2024-01-03',
    },
  });
  assert.ok(valid.data?.saveSubscription, JSON.stringify(valid));
});

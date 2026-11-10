import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
const supplyMutation =
  'mutation($input:SupplyInput!){receiveSupply(input:$input){id quantity netCost totalCost returnDeadline}}';
const returnMutation =
  'mutation($input:ReturnInput!){recordReturn(input:$input){id quantity credit}}';
async function publication(cookie: string) {
  return (
    await api.query(
      cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Regional Supply',
          edition: 'Kochi',
          kind: 'PERIODICAL',
          language: 'Malayalam',
          dispatch: 'EVENING',
          frequency: 'WEEKLY',
          publishingDays: [3],
          weekdayPrice: '8.15',
          weekendPrice: '12.25',
          procurementNetCost: '5.05',
        },
      },
    )
  ).data.savePublication;
}
test('publisher return credits preserve original lot net cost and request retries cannot duplicate supply or returns', async () => {
  const cookie = await api.agency(),
    pub = await publication(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const publisher = await api.query(
    cookie,
    'mutation($input:PublisherInput!){savePublisher(input:$input){id}}',
    {
      input: {
        name: 'Regional Publisher',
        phone: '9876543210',
        returnCutoff: '23:59',
        returnWindowDays: 1,
      },
    },
  );
  assert.ok(publisher.data?.savePublisher, JSON.stringify(publisher));
  const input = {
    requestId: randomUUID(),
    publisherId: publisher.data.savePublisher.id,
    publicationId: pub.id,
    date: today,
    quantity: 10,
  };
  const received = await api.query(cookie, supplyMutation, { input });
  assert.equal(
    received.data?.receiveSupply.totalCost,
    '50.50',
    JSON.stringify(received),
  );
  const retried = await api.query(cookie, supplyMutation, { input });
  assert.equal(retried.data.receiveSupply.id, received.data.receiveSupply.id);
  const before = (
    await api.query(
      cookie,
      '{publications{id name edition kind language dispatch frequency publishingDays weekdayPrice weekendPrice procurementNetCost version active}}',
    )
  ).data.publications[0];
  await api.query(
    cookie,
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    { input: { ...before, procurementNetCost: '99.00' } },
  );
  const returned = {
    requestId: randomUUID(),
    supplyId: received.data.receiveSupply.id,
    quantity: 2,
    reason: 'Unsold',
  };
  const credit = await api.query(cookie, returnMutation, { input: returned });
  assert.equal(
    credit.data?.recordReturn.credit,
    '10.10',
    JSON.stringify(credit),
  );
  const again = await api.query(cookie, returnMutation, { input: returned });
  assert.equal(again.data.recordReturn.id, credit.data.recordReturn.id);
  const excess = await api.query(cookie, returnMutation, {
    input: { ...returned, requestId: randomUUID(), quantity: 9 },
  });
  assert.equal(excess.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const statement = await api.query(
    cookie,
    'query($id:ID!,$month:String!){publisherStatement(publisherId:$id,month:$month){supplied returned supplyCost returnCredit netPayable rows{publicationId dispatch netPayable}}}',
    { id: publisher.data.savePublisher.id, month: today.slice(0, 7) },
  );
  assert.deepEqual(
    statement.data?.publisherStatement,
    {
      supplied: 10,
      returned: 2,
      supplyCost: '50.50',
      returnCredit: '10.10',
      netPayable: '40.40',
      rows: [
        { publicationId: pub.id, dispatch: 'EVENING', netPayable: '40.40' },
      ],
    },
    JSON.stringify(statement),
  );
  const foreign = await api.query(await api.agency(), returnMutation, {
    input: { ...returned, requestId: randomUUID() },
  });
  assert.equal(foreign.errors?.[0].extensions.code, 'NOT_FOUND');
});
test('publisher returns enforce snapshotted local cutoff and exclusive net versus margin pricing', async () => {
  const cookie = await api.agency(),
    pub = await publication(cookie);
  const p = (
    await api.query(
      cookie,
      'mutation($input:PublisherInput!){savePublisher(input:$input){id}}',
      {
        input: {
          name: 'Daily Publisher',
          phone: '9876543210',
          returnCutoff: '12:00',
          returnWindowDays: 0,
        },
      },
    )
  ).data?.savePublisher;
  assert.ok(p, 'Publisher API required');
  const received = await api.query(cookie, supplyMutation, {
    input: {
      requestId: randomUUID(),
      publisherId: p.id,
      publicationId: pub.id,
      date: '2024-01-01',
      quantity: 10,
      listPrice: '8.15',
      marginPercent: '20.00',
    },
  });
  assert.equal(
    received.data?.receiveSupply.netCost,
    '6.52',
    JSON.stringify(received),
  );
  const expired = await api.query(cookie, returnMutation, {
    input: {
      requestId: randomUUID(),
      supplyId: received.data.receiveSupply.id,
      quantity: 1,
      reason: 'Late return',
    },
  });
  assert.equal(expired.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const both = await api.query(cookie, supplyMutation, {
    input: {
      requestId: randomUUID(),
      publisherId: p.id,
      publicationId: pub.id,
      date: '2024-01-01',
      quantity: 10,
      netCost: '5.05',
      listPrice: '8.15',
      marginPercent: '20.00',
    },
  });
  assert.equal(both.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});

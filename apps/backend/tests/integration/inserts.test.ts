import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const publication = (
    await api.query(
      cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Insert Daily',
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
  for (let index = 1; index <= 2; index++) {
    const resident = (
      await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: `Insert Door ${index}`,
            address: `${index} Lotus Lane`,
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: index,
          },
        },
      )
    ).data.saveResident;
    await api.query(
      cookie,
      'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: resident.id,
          publicationId: publication.id,
          cadence: 'DAILY',
          startDate: date,
          weekdays: [],
          quantity: 2,
        },
      },
    );
  }
  return { cookie, route, date };
}
const orderMutation =
  'mutation($input:InsertOrderInput!){saveInsertOrder(input:$input){id status quantity total version}}';
const completeMutation =
  'mutation($input:InsertCompleteInput!){completeInsertOrder(input:$input){id code subtotal tax total proofReference}}';
test('targeted insert counts reach ordered packing slips and require completion proof before one invoice', async () => {
  const f = await fixture();
  const advertiser = await api.query(
    f.cookie,
    'mutation($input:AdvertiserInput!){saveAdvertiser(input:$input){id}}',
    {
      input: {
        name: 'Lotus Stores',
        phone: '9876543210',
        email: 'lotus@example.test',
        billingAddress: 'Market Road',
      },
    },
  );
  assert.ok(advertiser.data?.saveAdvertiser, JSON.stringify(advertiser));
  const input = {
    requestId: randomUUID(),
    advertiserId: advertiser.data.saveAdvertiser.id,
    title: 'Local promotion',
    quantity: 2,
    date: f.date,
    dispatch: 'MORNING',
    unitPrice: '1.25',
    allocations: [{ routeId: f.route.id, quantity: 2 }],
  };
  const order = await api.query(f.cookie, orderMutation, { input });
  assert.equal(
    order.data?.saveInsertOrder.total,
    '2.50',
    JSON.stringify(order),
  );
  const slip = await api.query(
    f.cookie,
    'mutation($date:String!){buildManifest(date:$date,dispatch:MORNING){extraItems{kind sourceOrderId dropOrder quantity}}}',
    { date: f.date },
  );
  assert.deepEqual(slip.data.buildManifest.extraItems, [
    {
      kind: 'INSERT',
      sourceOrderId: order.data.saveInsertOrder.id,
      dropOrder: 1,
      quantity: 1,
    },
    {
      kind: 'INSERT',
      sourceOrderId: order.data.saveInsertOrder.id,
      dropOrder: 2,
      quantity: 1,
    },
  ]);
  const complete = {
    requestId: randomUUID(),
    orderId: order.data.saveInsertOrder.id,
    version: order.data.saveInsertOrder.version,
    proofReference: '',
    noTaxConfirmed: true,
  };
  const missing = await api.query(f.cookie, completeMutation, {
    input: complete,
  });
  assert.equal(missing.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const finished = {
    ...complete,
    requestId: randomUUID(),
    proofReference: 'Signed route receipt DOC-22',
  };
  const invoice = await api.query(f.cookie, completeMutation, {
    input: finished,
  });
  assert.equal(
    invoice.data?.completeInsertOrder.total,
    '2.50',
    JSON.stringify(invoice),
  );
  assert.equal(invoice.data.completeInsertOrder.tax, '0.00');
  assert.match(invoice.data.completeInsertOrder.code, /^ADV-/);
  const retry = await api.query(f.cookie, completeMutation, {
    input: finished,
  });
  assert.equal(
    retry.data.completeInsertOrder.id,
    invoice.data.completeInsertOrder.id,
  );
  const bills = await api.query(f.cookie, '{advertiserInvoices{id total}}');
  assert.equal(bills.data.advertiserInvoices.length, 1);
  const analytics = await api.query(
    f.cookie,
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){routes{routeId advertiserSales} advertiserAllocation{allocatedSubtotal unallocatedSubtotal unsupportedInvoices coverage}}}',
    { input: { month: f.date.slice(0, 7) } },
  );
  assert.ok(analytics.data?.agencyAnalytics, JSON.stringify(analytics));
  assert.equal(
    analytics.data.agencyAnalytics.routes.find(
      (r: { routeId: string }) => r.routeId === f.route.id,
    )?.advertiserSales,
    '2.50',
  );
  assert.deepEqual(analytics.data.agencyAnalytics.advertiserAllocation, {
    allocatedSubtotal: '2.50',
    unallocatedSubtotal: '0.00',
    unsupportedInvoices: '0',
    coverage: 'COMPLETE',
  });

  const foreign = await api.query(
    await api.agency(),
    '{advertisers{id} insertOrders{id} advertiserInvoices{id}}',
  );
  assert.deepEqual(foreign.data, {
    advertisers: [],
    insertOrders: [],
    advertiserInvoices: [],
  });
});
test('insert reservations reject capacity shortfalls and cannot finalize without explicit tax treatment', async () => {
  const f = await fixture();
  const advertiser = (
    await api.query(
      f.cookie,
      'mutation($input:AdvertiserInput!){saveAdvertiser(input:$input){id}}',
      {
        input: {
          name: 'Local Shop',
          phone: '9876543210',
          billingAddress: 'Shop Lane',
        },
      },
    )
  ).data?.saveAdvertiser;
  assert.ok(advertiser, 'Advertiser API required');
  const base = {
    requestId: randomUUID(),
    advertiserId: advertiser.id,
    title: 'Leaflet',
    quantity: 3,
    date: f.date,
    dispatch: 'MORNING',
    unitPrice: '1',
    allocations: [{ routeId: f.route.id, quantity: 3 }],
  };
  const overflow = await api.query(f.cookie, orderMutation, { input: base });
  assert.equal(overflow.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const order = (
    await api.query(f.cookie, orderMutation, {
      input: {
        ...base,
        requestId: randomUUID(),
        quantity: 2,
        allocations: [{ routeId: f.route.id, quantity: 2 }],
      },
    })
  ).data.saveInsertOrder;
  const unconfigured = await api.query(f.cookie, completeMutation, {
    input: {
      requestId: randomUUID(),
      orderId: order.id,
      version: order.version,
      proofReference: 'Route receipt',
      noTaxConfirmed: false,
    },
  });
  assert.equal(unconfigured.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});

test('completed insertion recipients remain recorded when household schedules change', async () => {
  const f = await fixture();
  const advertiser = (
    await api.query(
      f.cookie,
      'mutation($input:AdvertiserInput!){saveAdvertiser(input:$input){id}}',
      {
        input: {
          name: 'Snapshot Shop',
          phone: '9876543210',
          billingAddress: 'Market',
        },
      },
    )
  ).data.saveAdvertiser;
  const order = (
    await api.query(f.cookie, orderMutation, {
      input: {
        requestId: randomUUID(),
        advertiserId: advertiser.id,
        title: 'Snapshot campaign',
        quantity: 1,
        date: f.date,
        dispatch: 'MORNING',
        unitPrice: '1',
        allocations: [{ routeId: f.route.id, quantity: 1 }],
      },
    })
  ).data.saveInsertOrder;
  const manifest =
    'mutation($date:String!){buildManifest(date:$date,dispatch:MORNING){extraItems{sourceOrderId residentId dropOrder}}}';
  const before = (await api.query(f.cookie, manifest, { date: f.date })).data
    .buildManifest.extraItems;
  const completed = await api.query(f.cookie, completeMutation, {
    input: {
      requestId: randomUUID(),
      orderId: order.id,
      version: order.version,
      proofReference: 'Signed snapshot receipt',
      noTaxConfirmed: true,
    },
  });
  assert.ok(completed.data?.completeInsertOrder);
  await api.query(
    f.cookie,
    'mutation($input:HoldInput!){setHold(input:$input){id}}',
    { input: { residentId: before[0].residentId, startDate: f.date } },
  );
  const after = (await api.query(f.cookie, manifest, { date: f.date })).data
    .buildManifest.extraItems;
  assert.deepEqual(after, before);
});
test('an obsolete packing allocation cannot prove a revised insertion campaign', async () => {
  const f = await fixture(),
    agencyId = (await api.query(f.cookie, '{me{agencyId}}')).data.me.agencyId;
  const territory = (await api.query(f.cookie, '{routes{territoryId}}')).data
    .routes[0].territoryId;
  const otherRoute = (
    await api.query(
      f.cookie,
      'mutation($id:ID!){saveRoute(input:{code:"B02",name:"Other",territoryId:$id}){id}}',
      { id: territory },
    )
  ).data.saveRoute;
  const resident = (
    await api.query(
      f.cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Other Recipient',
          address: 'Other Door',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: otherRoute.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const publication = (await api.query(f.cookie, '{publications{id}}')).data
    .publications[0];
  await api.query(
    f.cookie,
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: f.date,
        weekdays: [],
        quantity: 1,
      },
    },
  );
  const advertiser = (
    await api.query(
      f.cookie,
      'mutation($input:AdvertiserInput!){saveAdvertiser(input:$input){id}}',
      {
        input: {
          name: 'Revision Shop',
          phone: '9876543210',
          billingAddress: 'Market',
        },
      },
    )
  ).data.saveAdvertiser;
  const input = {
    requestId: randomUUID(),
    advertiserId: advertiser.id,
    title: 'Revised campaign',
    quantity: 1,
    date: f.date,
    dispatch: 'MORNING',
    unitPrice: '1',
    allocations: [{ routeId: f.route.id, quantity: 1 }],
  };
  const order = (await api.query(f.cookie, orderMutation, { input })).data
    .saveInsertOrder;
  await api.query(
    f.cookie,
    'mutation($date:String!){buildManifest(date:$date,dispatch:MORNING){id}}',
    { date: f.date },
  );
  const changed = (
    await api.query(f.cookie, orderMutation, {
      input: {
        ...input,
        id: order.id,
        version: order.version,
        requestId: randomUUID(),
        allocations: [{ routeId: otherRoute.id, quantity: 1 }],
      },
    })
  ).data.saveInsertOrder;
  assert.ok(changed);
  const previous = new Date(`${f.date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  await withTenant(api.pool, agencyId, async (c) => {
    await c.query('UPDATE daybook.insert_orders SET drop_date=$2 WHERE id=$1', [
      order.id,
      yesterday,
    ]);
    await c.query(
      "UPDATE daybook.manifests SET manifest_date=$1::text::date,payload=jsonb_set(payload,'{date}',to_jsonb($1::text)) WHERE manifest_date=$2",
      [yesterday, f.date],
    );
  });
  const stale = await api.query(f.cookie, completeMutation, {
    input: {
      requestId: randomUUID(),
      orderId: order.id,
      version: changed.version,
      proofReference: 'Old route slip',
      noTaxConfirmed: true,
    },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Calendar Buyer',
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  return { cookie, route, date, resident };
}
const itemMutation =
  'mutation($input:MerchandiseInput!){saveMerchandise(input:$input){id name sku price onHand reserved available version}}';
const orderMutation =
  'mutation($input:MerchandiseOrderInput!){saveMerchandiseOrder(input:$input){id status quantity total version}}';
const reserveMutation =
  'mutation($input:MerchandiseReserveInput!){reserveMerchandise(input:$input){id status version}}';
const fulfilMutation =
  'mutation($input:MerchandiseFulfilInput!){fulfilOrder(input:$input){id status total receiptCode version}}';
test('seasonal preorders reserve stock safely and fulfilment creates one exact charge', async () => {
  const f = await fixture();
  const item = await api.query(f.cookie, itemMutation, {
    input: {
      name: 'Annual Calendar',
      sku: 'CAL27',
      kind: 'CALENDAR',
      price: '99.95',
    },
  });
  assert.ok(item.data?.saveMerchandise, JSON.stringify(item));
  const first = await api.query(f.cookie, orderMutation, {
    input: {
      requestId: randomUUID(),
      residentId: f.resident.id,
      itemId: item.data.saveMerchandise.id,
      quantity: 2,
      date: f.date,
      settlement: 'INVOICE',
    },
  });
  assert.equal(
    first.data?.saveMerchandiseOrder.status,
    'PREORDER',
    JSON.stringify(first),
  );
  const unavailable = await api.query(f.cookie, reserveMutation, {
    input: {
      requestId: randomUUID(),
      orderId: first.data.saveMerchandiseOrder.id,
      version: 1,
    },
  });
  assert.equal(unavailable.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const stockInput = {
    requestId: randomUUID(),
    itemId: item.data.saveMerchandise.id,
    quantity: 2,
    note: 'Publisher stock received',
  };
  const stock = await api.query(
    f.cookie,
    'mutation($input:MerchandiseStockInput!){receiveMerchandiseStock(input:$input){id onHand}}',
    { input: stockInput },
  );
  assert.equal(
    stock.data?.receiveMerchandiseStock.onHand,
    2,
    JSON.stringify(stock),
  );
  await api.query(
    f.cookie,
    'mutation($input:MerchandiseStockInput!){receiveMerchandiseStock(input:$input){id onHand}}',
    { input: stockInput },
  );
  const reserved = await api.query(f.cookie, reserveMutation, {
    input: {
      requestId: randomUUID(),
      orderId: first.data.saveMerchandiseOrder.id,
      version: 1,
    },
  });
  assert.equal(reserved.data?.reserveMerchandise.status, 'RESERVED');
  const slip = await api.query(
    f.cookie,
    'mutation($date:String!){buildManifest(date:$date,dispatch:MORNING){extraItems{sourceOrderId kind quantity residentName name}}}',
    { date: f.date },
  );
  assert.deepEqual(
    slip.data?.buildManifest.extraItems,
    [
      {
        sourceOrderId: first.data.saveMerchandiseOrder.id,
        kind: 'MERCHANDISE',
        quantity: 2,
        residentName: 'Calendar Buyer',
        name: 'Annual Calendar',
      },
    ],
    JSON.stringify(slip),
  );
  const fulfil = {
    requestId: randomUUID(),
    orderId: first.data.saveMerchandiseOrder.id,
    version: reserved.data.reserveMerchandise.version,
  };
  const completed = await api.query(f.cookie, fulfilMutation, {
    input: fulfil,
  });
  assert.equal(
    completed.data?.fulfilOrder.total,
    '199.90',
    JSON.stringify(completed),
  );
  assert.equal(completed.data.fulfilOrder.receiptCode, null);
  const retry = await api.query(f.cookie, fulfilMutation, { input: fulfil });
  assert.equal(retry.data.fulfilOrder.id, completed.data.fulfilOrder.id);
  const summary = await api.query(
    f.cookie,
    '{merchandiseItems{id onHand reserved available} merchandiseCharges{orderId amount settlement}}',
  );
  assert.deepEqual(summary.data.merchandiseItems, [
    { id: item.data.saveMerchandise.id, onHand: 0, reserved: 0, available: 0 },
  ]);
  assert.deepEqual(summary.data.merchandiseCharges, [
    {
      orderId: completed.data.fulfilOrder.id,
      amount: '199.90',
      settlement: 'INVOICE',
    },
  ]);
  await api.query(
    f.cookie,
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
  );
  const billInput = {
    residentId: f.resident.id,
    periodMode: 'CUSTOM',
    periods: [{ from: f.date, to: f.date }],
  };
  const preview = (
    await api.query(
      f.cookie,
      'query($input:BillInput!){previewBill(input:$input){fingerprint currentAmount lines{kind quantity amount}}}',
      { input: billInput },
    )
  ).data.previewBill;
  assert.equal(preview.currentAmount, '199.90');
  assert.deepEqual(preview.lines, [
    { kind: 'MERCHANDISE', quantity: 2, amount: '199.90' },
  ]);
  const billed = await api.query(
    f.cookie,
    'mutation($input:InvoiceInput!){generateInvoice(input:$input){total}}',
    {
      input: {
        ...billInput,
        requestId: randomUUID(),
        previewFingerprint: preview.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    },
  );
  assert.equal(
    billed.data?.generateInvoice.total,
    '199.90',
    JSON.stringify(billed),
  );
  const repeated = (
    await api.query(
      f.cookie,
      'query($input:BillInput!){previewBill(input:$input){currentAmount}}',
      { input: billInput },
    )
  ).data.previewBill;
  assert.equal(repeated.currentAmount, '0.00');
});
test('concurrent reservations cannot overbook stock and cancellation releases exactly once', async () => {
  const f = await fixture();
  const item = (
    await api.query(f.cookie, itemMutation, {
      input: {
        name: 'Festival Special',
        sku: 'FEST',
        kind: 'FESTIVAL',
        price: '25',
      },
    })
  ).data?.saveMerchandise;
  assert.ok(item, 'Merchandise API required');
  await api.query(
    f.cookie,
    'mutation($input:MerchandiseStockInput!){receiveMerchandiseStock(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        itemId: item.id,
        quantity: 1,
        note: 'One copy',
      },
    },
  );
  async function order() {
    return (
      await api.query(f.cookie, orderMutation, {
        input: {
          requestId: randomUUID(),
          residentId: f.resident.id,
          itemId: item.id,
          quantity: 1,
          date: f.date,
          settlement: 'CASH',
        },
      })
    ).data.saveMerchandiseOrder;
  }
  const a = await order(),
    b = await order();
  const results = await Promise.all(
    [a, b].map((o) =>
      api.query(f.cookie, reserveMutation, {
        input: { requestId: randomUUID(), orderId: o.id, version: o.version },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.data?.reserveMerchandise).length, 1);
  const winner = results.find((r) => r.data?.reserveMerchandise)!.data
    .reserveMerchandise;
  const cancel = {
    requestId: randomUUID(),
    orderId: winner.id,
    version: winner.version,
  };
  const cancelled = await api.query(
    f.cookie,
    'mutation($input:MerchandiseReserveInput!){cancelMerchandiseOrder(input:$input){id status}}',
    { input: cancel },
  );
  assert.equal(cancelled.data?.cancelMerchandiseOrder.status, 'CANCELLED');
  await api.query(
    f.cookie,
    'mutation($input:MerchandiseReserveInput!){cancelMerchandiseOrder(input:$input){id status}}',
    { input: cancel },
  );
  const stock = (
    await api.query(f.cookie, '{merchandiseItems{onHand reserved available}}')
  ).data.merchandiseItems[0];
  assert.deepEqual(stock, { onHand: 1, reserved: 0, available: 1 });
});

test('cash fulfilment preserves the preorder price and issues only one confirmed cash receipt', async () => {
  const f = await fixture();
  const item = (
    await api.query(f.cookie, itemMutation, {
      input: {
        name: 'Annual Diary',
        sku: 'DIARY',
        kind: 'DIARY',
        price: '19.95',
      },
    })
  ).data.saveMerchandise;
  await api.query(
    f.cookie,
    'mutation($input:MerchandiseStockInput!){receiveMerchandiseStock(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        itemId: item.id,
        quantity: 1,
        note: 'Diary stock',
      },
    },
  );
  const order = (
    await api.query(f.cookie, orderMutation, {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        itemId: item.id,
        quantity: 1,
        date: f.date,
        settlement: 'CASH',
      },
    })
  ).data.saveMerchandiseOrder;
  const reserved = (
    await api.query(f.cookie, reserveMutation, {
      input: {
        requestId: randomUUID(),
        orderId: order.id,
        version: order.version,
      },
    })
  ).data.reserveMerchandise;
  const current = (await api.query(f.cookie, '{merchandiseItems{id version}}'))
    .data.merchandiseItems[0];
  await api.query(f.cookie, itemMutation, {
    input: {
      ...current,
      name: 'Annual Diary',
      sku: 'DIARY',
      kind: 'DIARY',
      price: '99.95',
    },
  });
  const wrong = await api.query(f.cookie, fulfilMutation, {
    input: {
      requestId: randomUUID(),
      orderId: order.id,
      version: reserved.version,
      cashReceived: '99.95',
    },
  });
  assert.equal(wrong.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const input = {
      requestId: randomUUID(),
      orderId: order.id,
      version: reserved.version,
      cashReceived: '19.95',
    },
    paid = await api.query(f.cookie, fulfilMutation, { input });
  assert.equal(paid.data?.fulfilOrder.total, '19.95', JSON.stringify(paid));
  assert.match(paid.data.fulfilOrder.receiptCode, /^MRC-/);
  const account = await api.query(
    f.cookie,
    'query($id:ID!){residentLedger(residentId:$id){balance entries{kind amount openAmount}}}',
    { id: f.resident.id },
  );
  account.data.residentLedger.entries.sort(
    (a: { kind: string }, b: { kind: string }) => a.kind.localeCompare(b.kind),
  );
  assert.deepEqual(account.data.residentLedger, {
    balance: '0.00',
    entries: [
      { kind: 'MERCHANDISE_CASH', amount: '19.95', openAmount: '0.00' },
      {
        kind: 'MERCHANDISE_CASH_PAYMENT',
        amount: '-19.95',
        openAmount: '0.00',
      },
    ],
  });
  const retry = await api.query(f.cookie, fulfilMutation, { input });
  assert.equal(
    retry.data.fulfilOrder.receiptCode,
    paid.data.fulfilOrder.receiptCode,
  );
  const foreign = await api.query(
    await api.agency(),
    '{merchandiseItems{id} merchandiseOrders{id} merchandiseCharges{id}}',
  );
  assert.deepEqual(foreign.data, {
    merchandiseItems: [],
    merchandiseOrders: [],
    merchandiseCharges: [],
  });
  const profile = (
    await api.query(
      f.cookie,
      '{residents{id name address phone sector routeId dropOrder version}}',
    )
  ).data.residents[0];
  const changed = await api.query(
    f.cookie,
    'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
    { input: { ...profile, address: 'Changed after delivery' } },
  );
  assert.ok(changed.data?.saveResident);
  const packed = await api.query(
    f.cookie,
    'mutation($date:String!){buildManifest(date:$date,dispatch:MORNING){extraItems{address}}}',
    { date: f.date },
  );
  assert.deepEqual(packed.data.buildManifest.extraItems, [
    { address: '12 Lotus Lane' },
  ]);
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());
const record =
  'mutation($input:PaymentInput!){recordPayment(input:$input){id status receiptCode amount method purpose version balance}}';
const reconcile =
  'mutation($input:PaymentReconciliationInput!){reconcilePayment(input:$input){id status receiptCode version balance}}';
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId,
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id depositBalance}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Payment Resident',
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  return { cookie, route, agencyId, today, resident };
}
async function debt(f: Awaited<ReturnType<typeof fixture>>, amount: string) {
  return api.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount,
        date: f.today,
        reason: 'Imported outstanding balance',
      },
    },
  );
}

test('parallel confirmed cash retries produce one receipt and ledger credit; overpayment stays exact account credit', async () => {
  const f = await fixture();
  await debt(f, '100.10');
  await debt(f, '50.25');
  const input = {
    requestId: randomUUID(),
    residentId: f.resident.id,
    purpose: 'ACCOUNT',
    method: 'CASH',
    amount: '50.05',
    date: f.today,
    confirmReceived: true,
    confirmationNote: 'Counted cash received in person',
  };
  const results = await Promise.all([
    api.query(f.cookie, record, { input }),
    api.query(f.cookie, record, { input }),
  ]);
  for (const result of results)
    assert.ok(result.data?.recordPayment, JSON.stringify(result));
  const paid = results[0].data.recordPayment;
  assert.equal(paid.status, 'CONFIRMED');
  assert.equal(paid.balance, '100.30');
  assert.match(paid.receiptCode, /^RCP-/);
  assert.equal(results[1].data.recordPayment.receiptCode, paid.receiptCode);
  const excess = await api.query(f.cookie, record, {
    input: { ...input, requestId: randomUUID(), amount: '200.00' },
  });
  assert.equal(excess.data.recordPayment.balance, '-99.70');
  const account = (
    await api.query(
      f.cookie,
      'query($id:ID!){residentLedger(residentId:$id){balance credit entries{kind amount}}}',
      { id: f.resident.id },
    )
  ).data.residentLedger;
  assert.equal(account.credit, '99.70');
  const historical = (
    await api.query(f.cookie, '{payments{requestId balance}}')
  ).data.payments.find(
    (p: { requestId: string }) => p.requestId === input.requestId,
  );
  assert.equal(
    historical.balance,
    '100.30',
    'A past receipt retains its original confirmed balance',
  );
  assert.equal(
    account.entries.filter((e: { kind: string }) => e.kind === 'PAYMENT')
      .length,
    2,
  );
});

test('unconfirmed digital and cheque funds never settle debt; reconcile the same operation before recording another', async () => {
  const f = await fixture();
  await debt(f, '100.00');
  const input = {
    requestId: randomUUID(),
    residentId: f.resident.id,
    purpose: 'ACCOUNT',
    method: 'UPI',
    amount: '42.00',
    date: f.today,
    confirmReceived: false,
  };
  const pending = await api.query(f.cookie, record, { input });
  assert.equal(
    pending.data?.recordPayment.status,
    'PENDING',
    JSON.stringify(pending),
  );
  assert.equal(pending.data.recordPayment.receiptCode, null);
  assert.equal(pending.data.recordPayment.balance, '100.00');
  const duplicate = await api.query(f.cookie, record, {
    input: { ...input, requestId: randomUUID() },
  });
  assert.equal(duplicate.errors?.[0].extensions.code, 'CONFLICT');
  const lookup = await api.query(
    f.cookie,
    'query($id:ID!){paymentByRequest(requestId:$id){id status}}',
    { id: input.requestId },
  );
  assert.equal(lookup.data.paymentByRequest.id, pending.data.recordPayment.id);
  const confirmation = {
    requestId: randomUUID(),
    paymentId: pending.data.recordPayment.id,
    version: 1,
    outcome: 'CONFIRMED',
    reference: 'UPI00000042',
    evidence: 'Confirmed credit in agency bank statement',
  };
  const cleared = await api.query(f.cookie, reconcile, { input: confirmation });
  assert.equal(
    cleared.data?.reconcilePayment.balance,
    '58.00',
    JSON.stringify(cleared),
  );
  assert.match(cleared.data.reconcilePayment.receiptCode, /^RCP-/);
  const retried = await api.query(f.cookie, reconcile, { input: confirmation });
  assert.equal(
    retried.data.reconcilePayment.receiptCode,
    cleared.data.reconcilePayment.receiptCode,
  );
  const reused = await api.query(f.cookie, record, {
    input: {
      ...input,
      requestId: randomUUID(),
      confirmReceived: true,
      reference: 'UPI00000042',
      confirmationNote: 'Duplicate bank reference',
    },
  });
  assert.equal(reused.errors?.[0].extensions.code, 'CONFLICT');
  const cheque = await api.query(f.cookie, record, {
    input: {
      ...input,
      requestId: randomUUID(),
      method: 'CHEQUE',
      amount: '10.00',
      reference: 'CHQ0001',
    },
  });
  assert.equal(cheque.data.recordPayment.status, 'PENDING');
  const failed = await api.query(f.cookie, reconcile, {
    input: {
      requestId: randomUUID(),
      paymentId: cheque.data.recordPayment.id,
      version: 1,
      outcome: 'FAILED',
      evidence: 'Cheque returned by bank',
    },
  });
  assert.equal(failed.data.reconcilePayment.balance, '58.00');
  assert.equal(failed.data.reconcilePayment.receiptCode, null);
});

test('confirmed channel deposits remain a separate refundable liability and retain receipt metadata', async () => {
  const f = await fixture(),
    input = {
      requestId: randomUUID(),
      residentId: f.resident.id,
      purpose: 'DEPOSIT',
      method: 'BANK',
      amount: '500.25',
      date: f.today,
      reference: 'BANKDEP50025',
      confirmReceived: true,
      confirmationNote: 'Deposit credit verified in agency statement',
    };
  const saved = await api.query(f.cookie, record, { input });
  assert.equal(
    saved.data?.recordPayment.status,
    'CONFIRMED',
    JSON.stringify(saved),
  );
  assert.match(saved.data.recordPayment.receiptCode, /^DEP-/);
  assert.equal(saved.data.recordPayment.balance, '0.00');
  const residents = (
    await api.query(f.cookie, '{residents{id depositBalance}}')
  ).data.residents;
  assert.equal(residents[0].depositBalance, '500.25');
  await api.query(f.cookie, record, { input });
  assert.equal(
    (await api.query(f.cookie, '{residents{depositBalance}}')).data.residents[0]
      .depositBalance,
    '500.25',
  );
  const foreign = await api.query(await api.agency(), '{payments{id}}');
  assert.deepEqual(foreign.data.payments, []);
  await assert.rejects(
    () =>
      withTenant(api.pool, f.agencyId, (c) =>
        c.query('UPDATE daybook.payments SET amount_paise=1 WHERE id=$1', [
          saved.data.recordPayment.id,
        ]),
      ),
    { code: '23514' },
  );
});

test('confirmed payment targeting settles its selected newer invoice before an older invoice', async () => {
  const f = await fixture();
  await api.query(
    f.cookie,
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
  );
  const publication = (
    await api.query(
      f.cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Payment Target Daily',
          edition: 'Kochi',
          kind: 'NEWSPAPER',
          language: 'Malayalam',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '7',
          weekendPrice: '7',
        },
      },
    )
  ).data.savePublication;
  await api.query(
    f.cookie,
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: '2024-01-01',
        weekdays: [],
        quantity: 1,
      },
    },
  );
  const invoices = [];
  for (const date of ['2024-01-01', '2024-01-02']) {
    await api.query(
      f.cookie,
      'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
      { date },
    );
    const input = {
        residentId: f.resident.id,
        periodMode: 'CUSTOM',
        periods: [{ from: date, to: date }],
      },
      p = (
        await api.query(
          f.cookie,
          'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
          { input },
        )
      ).data.previewBill;
    invoices.push(
      (
        await api.query(
          f.cookie,
          'mutation($input:InvoiceInput!){generateInvoice(input:$input){id}}',
          {
            input: {
              ...input,
              requestId: randomUUID(),
              previewFingerprint: p.fingerprint,
            },
          },
        )
      ).data.generateInvoice,
    );
  }
  const result = await api.query(f.cookie, record, {
    input: {
      requestId: randomUUID(),
      residentId: f.resident.id,
      purpose: 'ACCOUNT',
      method: 'CASH',
      amount: '7',
      date: f.today,
      targetInvoiceId: invoices[1].id,
      confirmReceived: true,
      confirmationNote: 'Collected cash for selected invoice',
    },
  });
  assert.equal(
    result.data?.recordPayment.balance,
    '7.00',
    JSON.stringify(result),
  );
  const saved = (await api.query(f.cookie, '{invoices{id remaining status}}'))
    .data.invoices;
  assert.equal(
    saved.find((i: { id: string }) => i.id === invoices[0].id).remaining,
    '7.00',
  );
  assert.equal(
    saved.find((i: { id: string }) => i.id === invoices[1].id).status,
    'PAID',
  );
});

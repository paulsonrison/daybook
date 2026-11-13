import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
async function fixture(deposit = '500.25') {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id version}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Vacating Resident',
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
          openingDeposit: deposit,
        },
      },
    )
  ).data.saveResident;
  await api.query(
    cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '100.00',
        reason: 'Outstanding imported balance',
      },
    },
  );
  const publication = (
    await api.query(
      cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Final Daily',
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
    cookie,
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: today,
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await api.query(
    cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created} saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
    { date: today },
  );
  return { cookie, route, today, resident };
}
const preview =
  'query($input:ClearancePreviewInput!){previewClearance(input:$input){fingerprint finalCharges balanceBeforeOffset depositBalance depositOffset refundDue collectionDue missingDayCount}}';
const close =
  'mutation($input:ClearanceInput!){clearResident(input:$input){id code status refundDue collectionDue depositOffset finalInvoiceId}}';

test('clearance bills final delivered copies, offsets exact deposit, archives service and records refund only when funds leave', async () => {
  const f = await fixture(),
    input = { residentId: f.resident.id, terminationDate: f.today },
    result = await api.query(f.cookie, preview, { input });
  assert.ok(result.data?.previewClearance, JSON.stringify(result));
  const p = result.data.previewClearance;
  assert.equal(p.finalCharges, '7.00');
  assert.equal(p.balanceBeforeOffset, '107.00');
  assert.equal(p.depositOffset, '107.00');
  assert.equal(p.refundDue, '393.25');
  assert.equal(p.collectionDue, '0.00');
  const closeInput = {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: p.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
    closed = await api.query(f.cookie, close, { input: closeInput });
  assert.equal(
    closed.data?.clearResident.status,
    'REFUND_DUE',
    JSON.stringify(closed),
  );
  assert.ok(closed.data.clearResident.finalInvoiceId);
  const repeated = await api.query(f.cookie, close, { input: closeInput });
  assert.equal(repeated.data.clearResident.id, closed.data.clearResident.id);
  const account = (
    await api.query(
      f.cookie,
      'query($id:ID!){residents{id status depositBalance} residentLedger(residentId:$id){balance} scheduledCopies(residentId:$id,date:"2099-01-01"){quantity}}',
      { id: f.resident.id },
    )
  ).data;
  assert.equal(account.residents[0].status, 'CLOSED');
  assert.equal(account.residents[0].depositBalance, '393.25');
  assert.equal(account.residentLedger.balance, '0.00');
  assert.deepEqual(account.scheduledCopies, []);
  const refundInput = {
      requestId: randomUUID(),
      clearanceId: closed.data.clearResident.id,
      amount: '393.25',
      method: 'BANK',
      reference: 'REFUND0001',
      confirmationNote: 'Confirmed refund debit in agency bank statement',
    },
    refund = await api.query(
      f.cookie,
      'mutation($input:ClearanceRefundInput!){confirmClearanceRefund(input:$input){receiptCode amount status}}',
      { input: refundInput },
    );
  assert.equal(
    refund.data?.confirmClearanceRefund.amount,
    '393.25',
    JSON.stringify(refund),
  );
  assert.match(refund.data.confirmClearanceRefund.receiptCode, /^RFD-/);
  assert.equal(refund.data.confirmClearanceRefund.status, 'CONFIRMED');
  const retry = await api.query(
    f.cookie,
    'mutation($input:ClearanceRefundInput!){confirmClearanceRefund(input:$input){receiptCode}}',
    { input: refundInput },
  );
  assert.equal(
    retry.data.confirmClearanceRefund.receiptCode,
    refund.data.confirmClearanceRefund.receiptCode,
  );
  assert.equal(
    (await api.query(f.cookie, '{residents{depositBalance}}')).data.residents[0]
      .depositBalance,
    '0.00',
  );
  const record = (
    await api.query(
      f.cookie,
      'query($id:ID!){clearance(id:$id){status refundDue collectionDue}}',
      { id: closed.data.clearResident.id },
    )
  ).data.clearance;
  assert.deepEqual(record, {
    status: 'CLEARED',
    refundDue: '0.00',
    collectionDue: '0.00',
  });
});

test('clearance rejects stale balances and unresolved payments; insufficient deposit produces a collection notice', async () => {
  const f = await fixture('0.00'),
    input = { residentId: f.resident.id, terminationDate: f.today },
    p = (await api.query(f.cookie, preview, { input })).data.previewClearance;
  const pending = await api.query(
    f.cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){id version}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        purpose: 'ACCOUNT',
        method: 'UPI',
        amount: '10',
        date: f.today,
        confirmReceived: false,
      },
    },
  );
  assert.ok(pending.data?.recordPayment);
  const blocked = await api.query(f.cookie, close, {
    input: {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: p.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(blocked.errors?.[0].extensions.code, 'CONFLICT');
  await api.query(
    f.cookie,
    'mutation($input:PaymentReconciliationInput!){reconcilePayment(input:$input){status}}',
    {
      input: {
        requestId: randomUUID(),
        paymentId: pending.data.recordPayment.id,
        version: 1,
        outcome: 'CONFIRMED',
        reference: 'CLEARUPI001',
        evidence: 'Bank statement confirms receipt',
      },
    },
  );
  const stale = await api.query(f.cookie, close, {
    input: {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: p.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const next = (await api.query(f.cookie, preview, { input })).data
      .previewClearance,
    closed = await api.query(f.cookie, close, {
      input: {
        ...input,
        requestId: randomUUID(),
        previewFingerprint: next.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    });
  assert.equal(closed.data.clearResident.status, 'COLLECTION_DUE');
  assert.equal(closed.data.clearResident.collectionDue, '97.00');
  const forbidden = await api.query(
    await api.agency(),
    'query($id:ID!){clearance(id:$id){id}}',
    { id: closed.data.clearResident.id },
  );
  assert.equal(forbidden.errors?.[0].extensions.code, 'NOT_FOUND');
});

test('clearance refunds both remaining caution deposit and existing exact account credit without a duplicate payout', async () => {
  const f = await fixture(),
    input = { residentId: f.resident.id, terminationDate: f.today };
  await api.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'CREDIT',
        category: 'CORRECTION',
        amount: '150.00',
        reason: 'Confirmed account credit',
      },
    },
  );
  const p = (await api.query(f.cookie, preview, { input })).data
    .previewClearance;
  assert.equal(p.depositOffset, '0.00');
  assert.equal(p.refundDue, '543.25');
  const closed = (
    await api.query(f.cookie, close, {
      input: {
        ...input,
        requestId: randomUUID(),
        previewFingerprint: p.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    })
  ).data.clearResident;
  const refundInput = {
      requestId: randomUUID(),
      clearanceId: closed.id,
      amount: '543.25',
      method: 'CASH',
      confirmationNote: 'Counted full refund returned to departing resident',
    },
    query =
      'mutation($input:ClearanceRefundInput!){confirmClearanceRefund(input:$input){amount receiptCode}}';
  const returned = await api.query(f.cookie, query, { input: refundInput });
  assert.equal(
    returned.data?.confirmClearanceRefund.amount,
    '543.25',
    JSON.stringify(returned),
  );
  const second = await api.query(f.cookie, query, {
    input: { ...refundInput, requestId: randomUUID() },
  });
  assert.equal(second.errors?.[0].extensions.code, 'CONFLICT');
  const account = (
    await api.query(
      f.cookie,
      'query($id:ID!){residentLedger(residentId:$id){balance} residents{depositBalance}}',
      { id: f.resident.id },
    )
  ).data;
  assert.equal(account.residentLedger.balance, '0.00');
  assert.equal(account.residents[0].depositBalance, '0.00');
});

test('refund records cannot be detached from their clearance resident or matching financial movements', async () => {
  const f = await fixture(),
    input = { residentId: f.resident.id, terminationDate: f.today },
    p = (await api.query(f.cookie, preview, { input })).data.previewClearance,
    closed = (
      await api.query(f.cookie, close, {
        input: {
          ...input,
          requestId: randomUUID(),
          previewFingerprint: p.fingerprint,
          acknowledgeUnmarkedDays: true,
        },
      })
    ).data.clearResident;
  const other = (
      await api.query(
        f.cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: 'Other clearance account',
            address: '13 Lotus Lane',
            phone: '9876543211',
            sector: 'Lotus Lane',
            routeId: f.route.id,
            dropOrder: 2,
          },
        },
      )
    ).data.saveResident,
    me = (await api.query(f.cookie, '{me{id agencyId}}')).data.me;
  const { withTenant } = await import('../../src/db/tenant.js');
  const attempts = await Promise.allSettled(
    [f.resident.id, other.id].map((residentId, index) =>
      withTenant(api.pool, me.agencyId, (c) =>
        c.query(
          "INSERT INTO daybook.clearance_refunds(id,agency_id,clearance_id,resident_id,request_id,receipt_code,amount_paise,deposit_paise,account_credit_paise,method,confirmation_evidence,posting_date,created_by) VALUES($1,$2,$3,$4,$5,$6,10000,10000,0,'CASH','Forged detached receipt',$7,$8)",
          [
            randomUUID(),
            me.agencyId,
            closed.id,
            residentId,
            randomUUID(),
            `RFD-FORGED-${index}`,
            f.today,
            me.id,
          ],
        ),
      ),
    ),
  );
  assert.deepEqual(
    attempts.map((r) => r.status),
    ['rejected', 'rejected'],
  );
  assert.deepEqual(
    attempts.map((r) =>
      r.status === 'rejected' ? (r.reason as { code: string }).code : null,
    ),
    ['23514', '23503'],
  );
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import { postEntry } from '../../src/modules/ledger/service.js';
const api = testApi();
after(() => api.pool.end());
const query =
  'query($input:AnalyticsInput!){agencyAnalytics(input:$input){month startDate endDate asOf sales{invoiced cashMerchandise advertiserSubtotal advertiserTax recordedTotal} receipts{account cashAccountAndMerchandise refundableDeposits unclassifiedDeposits} balances{asOfDate outstanding credit overdue}}}';
async function today(cookie: string) {
  return (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today as string;
}

test('account churn uses recorded open-account cohorts and withholds rates when registration history is missing', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const birth = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  birth.setUTCDate(birth.getUTCDate() - 10);
  async function restore(code: string, sequence: number, known = true) {
    const id = randomUUID();
    await withTenant(api.pool, me.agencyId, async (c) => {
      await c.query(
        "INSERT INTO daybook.residents(id,agency_id,code,name,address,phone,sector,route_id,creation_request_id,creation_fingerprint) VALUES($1,$2,$3,$3,'12 Lotus Lane','+919876543210','Lotus Lane',$4,$5,'restored-record')",
        [id, me.agencyId, code, route.id, randomUUID()],
      );
      await c.query(
        "INSERT INTO daybook.route_stops(id,agency_id,route_id,label,door,sequence,resident_id) VALUES($1,$2,$3,$4,'12 Lotus Lane',$5,$6)",
        [randomUUID(), me.agencyId, route.id, code, sequence, id],
      );
      if (known)
        await c.query(
          "INSERT INTO daybook.audit_events(id,agency_id,actor_id,entity_type,entity_id,action,details,created_at) VALUES($1,$2,$3,'resident',$4,'resident.created','{}',$5)",
          [randomUUID(), me.agencyId, me.id, id, birth.toISOString()],
        );
    });
    return id;
  }
  const closing = await restore('RESTORED-1', 1);
  await restore('RESTORED-2', 2);
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  await run('mutation($input:ResidentInput!){saveResident(input:$input){id}}', {
    requestId: randomUUID(),
    name: 'New This Month',
    address: '12 Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 3,
  });
  await run(
    'mutation($input:BillingPolicyInput!){saveBillingPolicy(input:$input){version}}',
    { noTaxConfirmed: true },
  );
  const preview = (
    await run(
      'query($input:ClearancePreviewInput!){previewClearance(input:$input){fingerprint}}',
      { residentId: closing, terminationDate: date },
    )
  ).previewClearance;
  await run(
    'mutation($input:ClearanceInput!){clearResident(input:$input){id}}',
    {
      requestId: randomUUID(),
      residentId: closing,
      terminationDate: date,
      previewFingerprint: preview.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  );
  const details =
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){churn{closedAccounts registrations openAtStart cohortClosures rateBasisPoints coverage missingHistoryCount basis}}}';
  const initial = await api.query(cookie, details, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(initial.data?.agencyAnalytics, JSON.stringify(initial));
  assert.deepEqual(initial.data.agencyAnalytics.churn, {
    closedAccounts: '1',
    registrations: '1',
    openAtStart: '2',
    cohortClosures: '1',
    rateBasisPoints: '5000',
    coverage: 'COMPLETE',
    missingHistoryCount: '0',
    basis: 'RECORDED_OPEN_ACCOUNT_COHORT',
  });
  await restore('MISSING-HISTORY', 4, false);
  const partial = await api.query(cookie, details, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(partial.data?.agencyAnalytics, JSON.stringify(partial));
  assert.deepEqual(partial.data.agencyAnalytics.churn, {
    closedAccounts: '1',
    registrations: null,
    openAtStart: null,
    cohortClosures: null,
    rateBasisPoints: null,
    coverage: 'PARTIAL',
    missingHistoryCount: '1',
    basis: 'RECORDED_OPEN_ACCOUNT_COHORT',
  });
});

test('circulation preserves recorded history after cancellation and counts replacements separately from original copies', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        name: 'Circulation Resident',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    )
  ).saveResident;
  const publication = (
    await run(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        name: 'Circulation Daily',
        edition: 'Main',
        language: 'English',
        kind: 'NEWSPAPER',
        dispatch: 'MORNING',
        frequency: 'DAILY',
        publishingDays: [0, 1, 2, 3, 4, 5, 6],
        weekdayPrice: '8.15',
        weekendPrice: '8.15',
      },
    )
  ).savePublication;
  const input = {
    residentId: resident.id,
    publicationId: publication.id,
    cadence: 'DAILY',
    weekdays: [],
    startDate: yesterday,
    quantity: 2,
  };
  const subscription = (
    await run(
      'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id version}}',
      { ...input, requestId: randomUUID() },
    )
  ).saveSubscription;
  await api.query(
    cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
    { date: yesterday },
  );
  const delivery = (
    await api.query(
      cookie,
      'query($date:String!){deliveryLogs(date:$date){id}}',
      { date: yesterday },
    )
  ).data.deliveryLogs[0];
  const complaint = (
    await run(
      'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
      {
        requestId: randomUUID(),
        deliveryId: delivery.id,
        kind: 'DAMAGED',
        note: 'Recorded damaged original copies',
      },
    )
  ).recordComplaint;
  await run(
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id}}',
    {
      requestId: randomUUID(),
      id: complaint.id,
      version: complaint.version,
      resolution: 'REPLACEMENT',
      note: 'Replacement copies delivered',
      rating: 5,
    },
  );
  const details =
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){circulation{fulfilledCopies chargeableCopies replacementCopies readers subscriptions preparedDays missingDays coverage currentScheduled{asOfDate copies state}byPublication{publicationId name snapshotNames fulfilledCopies readers}trend{month fulfilledCopies preparedDays coverage}}}}';
  const initial = await api.query(cookie, details, {
    input: { month: yesterday.slice(0, 7) },
  });
  assert.ok(initial.data?.agencyAnalytics, JSON.stringify(initial));
  assert.deepEqual(initial.data.agencyAnalytics.circulation.currentScheduled, {
    asOfDate: date,
    copies: '2',
    state: 'COMPLETE',
  });
  await run(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      ...input,
      id: subscription.id,
      version: subscription.version,
      status: 'CANCELLED',
    },
  );
  const result = await api.query(cookie, details, {
    input: { month: yesterday.slice(0, 7) },
  });
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  const report = result.data.agencyAnalytics.circulation;
  assert.equal(report.fulfilledCopies, '2');
  assert.equal(report.chargeableCopies, '2');
  assert.equal(report.replacementCopies, '2');
  assert.equal(report.readers, '1');
  assert.equal(report.subscriptions, '1');
  assert.equal(report.preparedDays, '1');
  assert.ok(BigInt(report.missingDays) > 0n);
  assert.equal(report.coverage, 'PARTIAL');
  assert.deepEqual(report.currentScheduled, {
    asOfDate: date,
    copies: '0',
    state: 'COMPLETE',
  });
  assert.deepEqual(report.byPublication, [
    {
      publicationId: publication.id,
      name: 'Circulation Daily · Main',
      snapshotNames: ['Circulation Daily · Main'],
      fulfilledCopies: '2',
      readers: '1',
    },
  ]);
  assert.equal(report.trend.length, 12);
  assert.equal(
    report.trend.find(
      (row: { month: string }) => row.month === yesterday.slice(0, 7),
    ).fulfilledCopies,
    '2',
  );
  assert.ok(
    report.trend.some(
      (row: { fulfilledCopies: string | null; preparedDays: string }) =>
        row.preparedDays === '0' && row.fulfilledCopies === null,
    ),
  );
});

test('refund analytics count confirmed funds once and separate deposit returns from account-credit refunds and sales', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  await run(
    'mutation($input:BillingPolicyInput!){saveBillingPolicy(input:$input){version}}',
    { noTaxConfirmed: true },
  );
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        name: 'Refund Analytics',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
        openingDeposit: '5.00',
      },
    )
  ).saveResident;
  await run(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      requestId: randomUUID(),
      residentId: resident.id,
      direction: 'CREDIT',
      category: 'OPENING',
      amount: '10.00',
      reason: 'Recorded existing credit',
    },
  );
  const preview = (
    await run(
      'query($input:ClearancePreviewInput!){previewClearance(input:$input){fingerprint refundDue}}',
      { residentId: resident.id, terminationDate: date },
    )
  ).previewClearance;
  assert.equal(preview.refundDue, '15.00');
  const clearance = (
    await run(
      'mutation($input:ClearanceInput!){clearResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        residentId: resident.id,
        terminationDate: date,
        previewFingerprint: preview.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    )
  ).clearResident;
  const details =
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){sales{recordedTotal}receipts{account refundableDeposits}refunds{total cash deposit accountCredit}collectionComparison{numerator denominator basisPoints basis}balances{outstanding credit}}}';
  const before = await api.query(cookie, details, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(before.data?.agencyAnalytics, JSON.stringify(before));
  assert.deepEqual(
    before.data.agencyAnalytics.refunds,
    { total: '0.00', cash: '0.00', deposit: '0.00', accountCredit: '0.00' },
    'A refund due is not an actual outflow',
  );
  const input = {
    requestId: randomUUID(),
    clearanceId: clearance.id,
    amount: '15.00',
    method: 'CASH',
    confirmationNote: 'Confirmed physical funds returned',
  };
  const operation =
    'mutation($input:ClearanceRefundInput!){confirmClearanceRefund(input:$input){id}}';
  const paid = (await run(operation, input)).confirmClearanceRefund;
  assert.equal(
    (await run(operation, input)).confirmClearanceRefund.id,
    paid.id,
  );
  const after = await api.query(cookie, details, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(after.data?.agencyAnalytics, JSON.stringify(after));
  const report = after.data.agencyAnalytics;
  assert.deepEqual(report.refunds, {
    total: '15.00',
    cash: '15.00',
    deposit: '5.00',
    accountCredit: '10.00',
  });
  assert.equal(report.sales.recordedTotal, '0.00');
  assert.deepEqual(report.receipts, {
    account: '0.00',
    refundableDeposits: '5.00',
  });
  assert.deepEqual(report.balances, { outstanding: '0.00', credit: '0.00' });
  assert.deepEqual(report.collectionComparison, {
    numerator: '0.00',
    denominator: '0.00',
    basisPoints: null,
    basis: 'ACCOUNT_RECEIPTS_TO_RESIDENT_INVOICED_SALES',
  });
});

test('current aging includes inactive debt, honors due-date boundaries and discloses unallocated legacy credits', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        name: 'Aging Resident',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    )
  ).saveResident;
  for (const [days, amount] of [
    [0, '5.00'],
    [1, '10.00'],
    [31, '20.00'],
    [61, '30.00'],
    [91, '40.00'],
  ] as const) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - days);
    await run(
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        requestId: randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount,
        date: day.toISOString().slice(0, 10),
        reason: 'Recorded dated debt',
      },
    );
  }
  await run('mutation($input:PaymentInput!){recordPayment(input:$input){id}}', {
    requestId: randomUUID(),
    residentId: resident.id,
    purpose: 'ACCOUNT',
    method: 'CASH',
    amount: '12.00',
    date,
    confirmReceived: true,
    confirmationNote: 'Counted receipt',
  });
  const current = (
    await api.query(cookie, '{residents{id version}}')
  ).data.residents.find((row: { id: string }) => row.id === resident.id);
  await run('mutation($input:ResidentInput!){saveResident(input:$input){id}}', {
    id: resident.id,
    version: current.version,
    name: 'Aging Resident',
    address: '12 Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 1,
    status: 'INACTIVE',
  });
  const agingQuery =
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){balances{outstanding overdue agingState agingGrossUnsettled agingUnallocatedCredit aging{bucket amount}}}}';
  const result = await api.query(cookie, agingQuery, {
    input: { month: '2024-02' },
  });
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  assert.deepEqual(result.data.agencyAnalytics.balances, {
    outstanding: '93.00',
    overdue: '88.00',
    agingState: 'COMPLETE',
    agingGrossUnsettled: '93.00',
    agingUnallocatedCredit: '0.00',
    aging: [
      { bucket: 'NOT_DUE', amount: '5.00' },
      { bucket: 'DAYS_1_30', amount: '10.00' },
      { bucket: 'DAYS_31_60', amount: '20.00' },
      { bucket: 'DAYS_61_90', amount: '30.00' },
      { bucket: 'DAYS_91_PLUS', amount: '28.00' },
    ],
  });
  // Simulate a legacy import with valid entries whose credits were not allocated.
  await withTenant(api.pool, agencyId, async (c) => {
    for (const amountPaise of [10000n, -5000n])
      await postEntry(c, {
        agencyId,
        residentId: resident.id,
        kind: 'ADJUSTMENT',
        sourceKey: `legacy:${randomUUID()}`,
        amountPaise,
        date,
        dueDate: '2024-01-01',
        description: 'Unallocated imported entry',
      });
  });
  const partial = await api.query(cookie, agingQuery, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(partial.data?.agencyAnalytics, JSON.stringify(partial));
  const balances = partial.data.agencyAnalytics.balances;
  assert.equal(balances.outstanding, '143.00');
  assert.equal(balances.agingGrossUnsettled, '193.00');
  assert.equal(balances.agingUnallocatedCredit, '50.00');
  assert.equal(balances.agingState, 'PARTIAL');
  assert.equal(
    balances.overdue,
    null,
    'Do not guess the net overdue amount before credits have been allocated',
  );
});

test('analytics sums invoice revision deltas instead of full versions and keeps current balances separate from the selected month', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  await run(
    'mutation($input:BillingPolicyInput!){saveBillingPolicy(input:$input){version}}',
    { noTaxConfirmed: true },
  );
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        name: 'Invoice Analytics',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    )
  ).saveResident;
  await run(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      requestId: randomUUID(),
      residentId: resident.id,
      direction: 'DEBIT',
      category: 'OPENING',
      amount: '100.00',
      date: previous.toISOString().slice(0, 10),
      reason: 'Opening arrears are not sales',
    },
  );
  const publication = (
    await run(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        name: 'Invoice Source',
        edition: 'Main',
        language: 'English',
        kind: 'NEWSPAPER',
        dispatch: 'MORNING',
        frequency: 'DAILY',
        publishingDays: [0, 1, 2, 3, 4, 5, 6],
        weekdayPrice: '8.15',
        weekendPrice: '8.15',
      },
    )
  ).savePublication;
  await run(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      requestId: randomUUID(),
      residentId: resident.id,
      publicationId: publication.id,
      cadence: 'DAILY',
      weekdays: [],
      startDate: date,
      quantity: 1,
    },
  );
  const marked = await api.query(
    cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
    { date },
  );
  assert.equal(
    marked.data?.markScheduledDeliveries.created,
    1,
    JSON.stringify(marked),
  );
  const previewOperation =
    'query($input:BillInput!){previewBill(input:$input){fingerprint invoiceTotal lines{key}}}';
  const save =
    'mutation($input:InvoiceInput!){generateInvoice(input:$input){id version total}}';
  const base = {
    residentId: resident.id,
    periodMode: 'CUSTOM',
    periods: [{ from: date, to: date }],
    corrections: [],
    adjustments: [],
  };
  const preview = (await run(previewOperation, base)).previewBill;
  const invoice = (
    await run(save, {
      ...base,
      requestId: randomUUID(),
      previewFingerprint: preview.fingerprint,
    })
  ).generateInvoice;
  assert.equal(invoice.total, '8.15');
  const corrected = {
    ...base,
    invoiceId: invoice.id,
    version: invoice.version,
    corrections: [
      {
        key: preview.lines[0].key,
        rate: '7.00',
        reason: 'Reviewed rate correction',
      },
    ],
  };
  const revisedPreview = (await run(previewOperation, corrected)).previewBill;
  const revised = (
    await run(save, {
      ...corrected,
      requestId: randomUUID(),
      previewFingerprint: revisedPreview.fingerprint,
    })
  ).generateInvoice;
  assert.equal(revised.total, '7.00');
  await run('mutation($input:PaymentInput!){recordPayment(input:$input){id}}', {
    requestId: randomUUID(),
    residentId: resident.id,
    purpose: 'ACCOUNT',
    method: 'CASH',
    amount: '5.00',
    date,
    confirmReceived: true,
    confirmationNote: 'Counted receipt',
    targetInvoiceId: invoice.id,
  });
  const details =
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){sales{invoiced recordedTotal}receipts{byMethod{method account refundableDeposits cashMerchandise}}balances{asOfDate outstanding overdue}}}';
  const result = await api.query(cookie, details, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  const report = result.data.agencyAnalytics;
  assert.deepEqual(report.sales, { invoiced: '7.00', recordedTotal: '7.00' });
  assert.deepEqual(report.receipts.byMethod, [
    {
      method: 'CASH',
      account: '5.00',
      refundableDeposits: '0.00',
      cashMerchandise: '0.00',
    },
  ]);
  assert.deepEqual(report.balances, {
    asOfDate: date,
    outstanding: '102.00',
    overdue: '100.00',
  });
  const priorMonth = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  priorMonth.setUTCMonth(priorMonth.getUTCMonth() - 1);
  const prior = await api.query(cookie, query, {
    input: { month: priorMonth.toISOString().slice(0, 7) },
  });
  assert.equal(prior.data?.agencyAnalytics.sales.invoiced, '0.00');
  assert.equal(prior.data?.agencyAnalytics.balances.outstanding, '102.00');
});

test('analytics denies unauthenticated access and rejects invalid or future months', async () => {
  const denied = await api.query('', query, { input: { month: '2024-01' } });
  assert.equal(denied.errors?.[0].extensions.code, 'UNAUTHENTICATED');
  const cookie = await api.agency();
  for (const month of ['2024-13', '2024-1', '9999-12']) {
    const result = await api.query(cookie, query, { input: { month } });
    assert.equal(result.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  }
});

test('empty analytics distinguishes its sales month from current balance date', async () => {
  const cookie = await api.agency(),
    date = await today(cookie);
  const result = await api.query(cookie, query, {
    input: { month: '2024-02' },
  });
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  const report = result.data.agencyAnalytics;
  assert.equal(report.month, '2024-02');
  assert.equal(report.startDate, '2024-02-01');
  assert.equal(report.endDate, '2024-02-29');
  assert.match(report.asOf, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.deepEqual(report.sales, {
    invoiced: '0.00',
    cashMerchandise: '0.00',
    advertiserSubtotal: '0.00',
    advertiserTax: '0.00',
    recordedTotal: '0.00',
  });
  assert.deepEqual(report.receipts, {
    account: '0.00',
    cashAccountAndMerchandise: '0.00',
    refundableDeposits: '0.00',
    unclassifiedDeposits: '0.00',
  });
  assert.deepEqual(report.balances, {
    asOfDate: date,
    outstanding: '0.00',
    credit: '0.00',
    overdue: '0.00',
  });
});

test('analytics keeps large account balances exact, separates credits and deposits, and excludes pending funds and other agencies', async () => {
  const cookie = await api.agency(),
    foreign = await api.agency(),
    route = await api.route(cookie),
    date = await today(cookie);
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  async function resident(
    name: string,
    dropOrder: number,
    openingDeposit = '0.00',
  ) {
    const result = await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name,
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder,
          openingDeposit,
        },
      },
    );
    assert.ok(result.data?.saveResident, JSON.stringify(result));
    return result.data.saveResident.id as string;
  }
  const debit = await resident('Debtor', 1, '7.77'),
    credit = await resident('Creditor', 2);
  for (const [residentId, direction, amount] of [
    [debit, 'DEBIT', '90071992547409.93'],
    [credit, 'CREDIT', '100.00'],
  ]) {
    const result = await api.query(
      cookie,
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId,
          direction,
          category: 'OPENING',
          amount,
          date: yesterday,
          reason: 'Recorded opening balance',
        },
      },
    );
    assert.ok(result.data?.postAdjustment, JSON.stringify(result));
  }
  for (const input of [
    {
      purpose: 'ACCOUNT',
      method: 'CASH',
      amount: '10.05',
      confirmReceived: true,
      confirmationNote: 'Counted account funds',
    },
    {
      purpose: 'DEPOSIT',
      method: 'CASH',
      amount: '7.25',
      confirmReceived: true,
      confirmationNote: 'Counted refundable deposit',
    },
    {
      purpose: 'ACCOUNT',
      method: 'CHEQUE',
      amount: '5.00',
      confirmReceived: false,
      reference: 'ANALYTICS-PENDING',
    },
  ]) {
    const result = await api.query(
      cookie,
      'mutation($input:PaymentInput!){recordPayment(input:$input){id status}}',
      { input: { requestId: randomUUID(), residentId: debit, date, ...input } },
    );
    assert.ok(result.data?.recordPayment, JSON.stringify(result));
  }
  const result = await api.query(cookie, query, {
    input: { month: date.slice(0, 7) },
  });
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  const report = result.data.agencyAnalytics;
  assert.equal(
    report.sales.recordedTotal,
    '0.00',
    'Opening balances and deposits are not sales',
  );
  assert.deepEqual(report.receipts, {
    account: '10.05',
    cashAccountAndMerchandise: '10.05',
    refundableDeposits: '15.02',
    unclassifiedDeposits: '7.77',
  });
  assert.deepEqual(report.balances, {
    asOfDate: date,
    outstanding: '90071992547399.88',
    credit: '100.00',
    overdue: '90071992547399.88',
  });
  const isolated = await api.query(foreign, query, {
    input: { month: date.slice(0, 7) },
  });
  assert.equal(isolated.data?.agencyAnalytics.balances.outstanding, '0.00');
  assert.equal(isolated.data?.agencyAnalytics.receipts.account, '0.00');
});

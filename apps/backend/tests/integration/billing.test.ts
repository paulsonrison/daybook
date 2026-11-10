import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../src/db/tenant.js';
import { postEntry, settleResident } from '../../src/modules/ledger/service.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
const previewQuery =
  'query($input:BillInput!){previewBill(input:$input){fingerprint currentAmount previousBalance paymentsReceived adjustmentsTotal invoiceTotal totalDue missingDayCount lines{key kind description quantity rate amount sourceQuantity sourceRate reason}}}';
const saveMutation =
  'mutation($input:InvoiceInput!){generateInvoice(input:$input){id code version total totalDue remaining status dueDate}}';
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const policy = await api.query(
    cookie,
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){taxTreatment defaultDueDays autoIssue version}}',
  );
  assert.ok(policy.data?.saveBillingPolicy, JSON.stringify(policy));
  assert.equal(policy.data.saveBillingPolicy.autoIssue, false);
  assert.equal(policy.data.saveBillingPolicy.defaultDueDays, 7);
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Bill Resident',
          address: '12 Lotus Lane',
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
          name: 'Billing Daily',
          edition: 'Kochi',
          kind: 'NEWSPAPER',
          language: 'Malayalam',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '7.00',
          weekendPrice: '8.00',
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
    'mutation($input:PriceRuleInput!){savePriceRule(input:$input){id}}',
    {
      input: {
        publicationId: publication.id,
        startDate: '2024-01-06',
        endDate: '2024-01-06',
        weekdays: [],
        price: '9.25',
      },
    },
  );
  for (const date of ['2024-01-01', '2024-01-06'])
    await api.query(
      cookie,
      'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
      { date },
    );
  return {
    cookie,
    agencyId,
    resident,
    publication,
    input: {
      residentId: resident.id,
      periodMode: 'MONTHLY',
      periods: [{ from: '2024-01-01', to: '2024-01-31' }],
      corrections: [],
      adjustments: [],
    },
  };
}
test('invoice posts only new charges, displays arrears and receipts, and retries never duplicate overlapping sources', async () => {
  const f = await fixture();
  const opening = await api.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '240.00',
        date: '2023-12-31',
        reason: 'Imported opening balance',
      },
    },
  );
  assert.ok(opening.data?.postAdjustment, JSON.stringify(opening));
  await withTenant(api.pool, f.agencyId, async (c) => {
    await postEntry(c, {
      agencyId: f.agencyId,
      residentId: f.resident.id,
      kind: 'PAYMENT',
      sourceKey: 'fixture:confirmed-historical-cash',
      amountPaise: -10000n,
      date: '2024-01-15',
      dueDate: '2024-01-15',
      description: 'Confirmed historical receipt',
    });
    await settleResident(c, f.resident.id);
  });
  const preview = await api.query(f.cookie, previewQuery, { input: f.input });
  assert.ok(preview.data?.previewBill, JSON.stringify(preview));
  const bill = preview.data.previewBill;
  assert.equal(bill.currentAmount, '16.25');
  assert.equal(bill.previousBalance, '240.00');
  assert.equal(bill.paymentsReceived, '100.00');
  assert.equal(bill.totalDue, '156.25');
  assert.equal(bill.missingDayCount, 29);
  const input = {
    ...f.input,
    requestId: randomUUID(),
    previewFingerprint: bill.fingerprint,
    acknowledgeUnmarkedDays: true,
  };
  const saved = await api.query(f.cookie, saveMutation, { input });
  assert.equal(
    saved.data?.generateInvoice.total,
    '16.25',
    JSON.stringify(saved),
  );
  const repeated = await Promise.all([
    api.query(f.cookie, saveMutation, { input }),
    api.query(f.cookie, saveMutation, { input }),
  ]);
  assert.ok(
    repeated.every(
      (r) => r.data.generateInvoice.id === saved.data.generateInvoice.id,
    ),
  );
  const account = await api.query(
    f.cookie,
    'query($id:ID!){residentLedger(residentId:$id){balance entries{kind amount}}}',
    { id: f.resident.id },
  );
  assert.equal(account.data.residentLedger.balance, '156.25');
  assert.deepEqual(
    account.data.residentLedger.entries.filter(
      (e: { kind: string }) => e.kind === 'INVOICE',
    ),
    [{ kind: 'INVOICE', amount: '16.25' }],
  );
  const overlapInput = {
      ...f.input,
      periodMode: 'CUSTOM',
      periods: [{ from: '2024-01-01', to: '2024-01-07' }],
    },
    overlap = (await api.query(f.cookie, previewQuery, { input: overlapInput }))
      .data.previewBill;
  assert.equal(overlap.currentAmount, '0.00');
  const duplicate = await api.query(f.cookie, saveMutation, {
    input: {
      ...overlapInput,
      requestId: randomUUID(),
      previewFingerprint: overlap.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(duplicate.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});
test('bill edits preserve source values, post only revision deltas and reject stale or settled edits', async () => {
  const f = await fixture(),
    base = (await api.query(f.cookie, previewQuery, { input: f.input })).data
      .previewBill;
  const weekday = base.lines.find((l: { rate: string }) => l.rate === '7.00'),
    weekend = base.lines.find((l: { rate: string }) => l.rate === '9.25');
  assert.ok(weekday && weekend);
  const adjusted = {
    ...f.input,
    corrections: [
      { key: weekday.key, quantity: 0, reason: 'Recorded missed copy' },
      { key: weekend.key, rate: '10.25', reason: 'Resident agreement' },
    ],
    adjustments: [
      {
        id: randomUUID(),
        kind: 'CREDIT',
        amount: '2.00',
        reason: 'Goodwill credit',
      },
    ],
  };
  const adjustedResult = await api.query(f.cookie, previewQuery, {
    input: adjusted,
  });
  assert.ok(adjustedResult.data?.previewBill, JSON.stringify(adjustedResult));
  const preview = adjustedResult.data.previewBill;
  assert.equal(preview.invoiceTotal, '8.25');
  const stale = await api.query(f.cookie, saveMutation, {
    input: {
      ...adjusted,
      requestId: randomUUID(),
      previewFingerprint: base.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const saved = (
    await api.query(f.cookie, saveMutation, {
      input: {
        ...adjusted,
        requestId: randomUUID(),
        previewFingerprint: preview.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    })
  ).data.generateInvoice;
  const revised = {
    ...adjusted,
    invoiceId: saved.id,
    version: saved.version,
    corrections: [
      adjusted.corrections[0],
      { key: weekend.key, rate: '11.25', reason: 'Corrected agreement' },
    ],
  };
  const nextResult = await api.query(f.cookie, previewQuery, {
    input: revised,
  });
  assert.ok(nextResult.data?.previewBill, JSON.stringify(nextResult));
  const next = nextResult.data.previewBill;
  const changed = await api.query(f.cookie, saveMutation, {
    input: {
      ...revised,
      requestId: randomUUID(),
      previewFingerprint: next.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(
    changed.data?.generateInvoice.total,
    '9.25',
    JSON.stringify(changed),
  );
  assert.equal(changed.data.generateInvoice.version, 2);
  const account = (
    await api.query(
      f.cookie,
      'query($id:ID!){residentLedger(residentId:$id){balance entries{kind amount}}}',
      { id: f.resident.id },
    )
  ).data.residentLedger;
  assert.equal(account.balance, '9.25');
  assert.deepEqual(
    account.entries.filter(
      (e: { kind: string }) => e.kind === 'INVOICE_REVISION',
    ),
    [{ kind: 'INVOICE_REVISION', amount: '1.00' }],
  );
  const sources = (
    await api.query(
      f.cookie,
      '{deliveryLogs(date:"2024-01-01"){quantity price status}}',
    )
  ).data.deliveryLogs;
  assert.deepEqual(sources, [
    { quantity: 1, price: '7.00', status: 'DELIVERED' },
  ]);
  await withTenant(api.pool, f.agencyId, async (c) => {
    await postEntry(c, {
      agencyId: f.agencyId,
      residentId: f.resident.id,
      kind: 'PAYMENT',
      sourceKey: 'fixture:settled',
      amountPaise: -925n,
      date: '2024-02-01',
      dueDate: '2024-02-01',
      description: 'Confirmed settlement',
    });
    await settleResident(c, f.resident.id);
  });
  const paid = (
    await api.query(
      f.cookie,
      'query($id:ID!){invoice(id:$id){status remaining}}',
      { id: saved.id },
    )
  ).data.invoice;
  assert.deepEqual(paid, { status: 'PAID', remaining: '0.00' });
  const locked = await api.query(f.cookie, saveMutation, {
    input: {
      ...revised,
      version: 2,
      requestId: randomUUID(),
      previewFingerprint: next.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(locked.errors?.[0].extensions.code, 'CONFLICT');
  await assert.rejects(
    () =>
      withTenant(api.pool, f.agencyId, (c) =>
        c.query(
          "UPDATE daybook.invoices SET note='Changed after settlement' WHERE id=$1",
          [saved.id],
        ),
      ),
    { code: '23514' },
  );
});
test('closed source cycles are immutable and later financial corrections post in an open period', async () => {
  const f = await fixture();
  const close = await api.query(
    f.cookie,
    'mutation($input:CycleCloseInput!){closeCycle(input:$input){id month autoIssueQueued}}',
    {
      input: {
        requestId: randomUUID(),
        month: '2024-01',
        acknowledgeUnmarkedDays: true,
      },
    },
  );
  assert.ok(close.data?.closeCycle, JSON.stringify(close));
  assert.equal(close.data.closeCycle.autoIssueQueued, 0);
  const log = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-01-01"){id version}}')
  ).data.deliveryLogs[0];
  const locked = await api.query(
    f.cookie,
    'mutation($input:DeliveryOverrideInput!){overrideDelivery(input:$input){id}}',
    {
      input: {
        ...log,
        requestId: randomUUID(),
        status: 'MISSED',
        reason: 'Late correction',
      },
    },
  );
  assert.equal(locked.errors?.[0].extensions.code, 'CONFLICT');
  const wrong = await api.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'CREDIT',
        category: 'CORRECTION',
        amount: '1',
        date: '2024-01-15',
        reason: 'Cannot rewrite closed period',
      },
    },
  );
  assert.equal(wrong.errors?.[0].extensions.code, 'CONFLICT');
  const open = await api.query(
    f.cookie,
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        direction: 'CREDIT',
        category: 'CORRECTION',
        amount: '1',
        reason: 'Current-period goodwill',
      },
    },
  );
  assert.ok(open.data?.postAdjustment, JSON.stringify(open));
  const preview = (await api.query(f.cookie, previewQuery, { input: f.input }))
    .data.previewBill;
  const issued = await api.query(f.cookie, saveMutation, {
    input: {
      ...f.input,
      requestId: randomUUID(),
      previewFingerprint: preview.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(
    issued.data?.generateInvoice.total,
    '16.25',
    JSON.stringify(issued),
  );
  assert.equal(issued.data.generateInvoice.totalDue, '15.25');
  const none = await api.query(
    await api.agency(),
    '{invoices{id} billingCycles{id}}',
  );
  assert.deepEqual(none.data, { invoices: [], billingCycles: [] });
});

test('complaint credit after invoicing uses the charged snapshot and never rewrites billed delivery history', async () => {
  const f = await fixture(),
    base = (await api.query(f.cookie, previewQuery, { input: f.input })).data
      .previewBill;
  const input = {
      ...f.input,
      corrections: [
        {
          key: base.lines.find((l: { rate: string }) => l.rate === '7.00').key,
          rate: '6.25',
          reason: 'Agreed billed rate',
        },
      ],
    },
    preview = (await api.query(f.cookie, previewQuery, { input })).data
      .previewBill;
  const saved = await api.query(f.cookie, saveMutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: preview.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.ok(saved.data?.generateInvoice, JSON.stringify(saved));
  const log = (
    await api.query(
      f.cookie,
      '{deliveryLogs(date:"2024-01-01"){id status price}}',
    )
  ).data.deliveryLogs[0];
  const complaint = (
    await api.query(
      f.cookie,
      'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
      {
        input: {
          requestId: randomUUID(),
          deliveryId: log.id,
          kind: 'MISSED',
          note: 'Resident confirms missed copy',
        },
      },
    )
  ).data.recordComplaint;
  const resolved = await api.query(
    f.cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id credit}}',
    {
      input: {
        ...complaint,
        requestId: randomUUID(),
        resolution: 'CREDIT',
        note: 'Current period correction',
      },
    },
  );
  assert.equal(
    resolved.data?.resolveComplaint.credit,
    '6.25',
    JSON.stringify(resolved),
  );
  const after = (
    await api.query(
      f.cookie,
      '{deliveryLogs(date:"2024-01-01"){id status price}}',
    )
  ).data.deliveryLogs[0];
  assert.deepEqual(after, log);
  const ledger = (
    await api.query(
      f.cookie,
      'query($id:ID!){residentLedger(residentId:$id){balance entries{kind amount}}}',
      { id: f.resident.id },
    )
  ).data.residentLedger;
  assert.equal(ledger.balance, '9.25');
  assert.ok(
    ledger.entries.some(
      (e: { kind: string; amount: string }) =>
        e.kind === 'ADJUSTMENT' && e.amount === '-6.25',
    ),
  );
  const second = (
    await api.query(
      f.cookie,
      'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
      {
        input: {
          requestId: randomUUID(),
          deliveryId: log.id,
          kind: 'MISSED',
          note: 'Duplicate complaint',
        },
      },
    )
  ).data.recordComplaint;
  const duplicate = await api.query(
    f.cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id}}',
    {
      input: {
        ...second,
        requestId: randomUUID(),
        resolution: 'REPLACEMENT',
        note: 'Cannot receive both benefits',
      },
    },
  );
  assert.equal(duplicate.errors?.[0].extensions.code, 'CONFLICT');
});

test('a downward revision reduces its own bill before older outstanding invoices', async () => {
  const f = await fixture();
  async function issue(input: Record<string, unknown>) {
    const p = (await api.query(f.cookie, previewQuery, { input })).data
      .previewBill;
    const r = await api.query(f.cookie, saveMutation, {
      input: {
        ...input,
        requestId: randomUUID(),
        previewFingerprint: p.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    });
    assert.ok(r.data?.generateInvoice, JSON.stringify(r));
    return r.data.generateInvoice;
  }
  const old = await issue({
      ...f.input,
      periodMode: 'CUSTOM',
      periods: [{ from: '2024-01-01', to: '2024-01-01' }],
    }),
    newerInput = {
      ...f.input,
      periodMode: 'CUSTOM',
      periods: [{ from: '2024-01-06', to: '2024-01-06' }],
    },
    newer = await issue(newerInput);
  const line = (
    await api.query(f.cookie, previewQuery, {
      input: { ...newerInput, invoiceId: newer.id, version: 1 },
    })
  ).data.previewBill.lines[0];
  const revised = await issue({
    ...newerInput,
    invoiceId: newer.id,
    version: 1,
    corrections: [
      { key: line.key, rate: '5.25', reason: 'Correct agreed rate' },
    ],
  });
  assert.equal(revised.remaining, '5.25');
  const previous = (
    await api.query(f.cookie, 'query($id:ID!){invoice(id:$id){remaining}}', {
      id: old.id,
    })
  ).data.invoice;
  assert.equal(previous.remaining, '7.00');
});

test('adjacent selected months roundtrip through saved invoice periods and remain editable', async () => {
  const f = await fixture(),
    input = {
      ...f.input,
      periodMode: 'SELECTED_MONTHS',
      periods: [
        { from: '2024-01-01', to: '2024-01-31' },
        { from: '2024-02-01', to: '2024-02-29' },
      ],
    },
    p = (await api.query(f.cookie, previewQuery, { input })).data.previewBill;
  const saved = await api.query(
    f.cookie,
    'mutation($input:InvoiceInput!){generateInvoice(input:$input){id version periods{from to}}}',
    {
      input: {
        ...input,
        requestId: randomUUID(),
        previewFingerprint: p.fingerprint,
        acknowledgeUnmarkedDays: true,
      },
    },
  );
  assert.ok(saved.data?.generateInvoice, JSON.stringify(saved));
  const bill = saved.data.generateInvoice;
  const edited = await api.query(f.cookie, previewQuery, {
    input: {
      ...input,
      invoiceId: bill.id,
      version: bill.version,
      periods: bill.periods,
    },
  });
  assert.ok(edited.data?.previewBill, JSON.stringify(edited));
  assert.equal(edited.data.previewBill.currentAmount, '16.25');
});

test('opt-in cycle closing queues durable per-resident invoices and worker retries do not duplicate them', async () => {
  const f = await fixture();
  await api.query(
    f.cookie,
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true,autoIssue:true,version:1}){version}}',
  );
  await withTenant(api.pool, f.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.delivery_days(agency_id,delivery_date) SELECT $1,day::date FROM generate_series('2024-01-01'::date,'2024-01-31'::date,interval '1 day') day ON CONFLICT DO NOTHING",
      [f.agencyId],
    ),
  );
  const close = await api.query(
    f.cookie,
    'mutation($input:CycleCloseInput!){closeCycle(input:$input){id autoIssueQueued}}',
    { input: { requestId: randomUUID(), month: '2024-01' } },
  );
  assert.equal(
    close.data?.closeCycle.autoIssueQueued,
    1,
    JSON.stringify(close),
  );
  const { runAgencyJobs } = await import('../../src/modules/jobs/service.js');
  const tenant = {
    id: f.agencyId,
    timezone: 'Asia/Kolkata',
    createdAt: new Date().toISOString(),
  };
  await runAgencyJobs(api.pool, tenant, new Date());
  await runAgencyJobs(api.pool, tenant, new Date());
  const bills = await api.query(f.cookie, '{invoices{id total remaining}}');
  assert.equal(bills.data.invoices.length, 1, JSON.stringify(bills));
  assert.equal(bills.data.invoices[0].total, '16.25');
});

test('monthly worker closes the completed source ledger automatically with an immutable audit summary', async () => {
  const f = await fixture(),
    now = new Date(),
    { localClock } = await import('../../src/modules/scheduling/time.js'),
    today = localClock(now, 'Asia/Kolkata').date,
    first = today.slice(0, 7) + '-01',
    end = new Date(Date.parse(first + 'T00:00:00Z') - 86400000)
      .toISOString()
      .slice(0, 10),
    month = end.slice(0, 7);
  await withTenant(api.pool, f.agencyId, async (c) => {
    await c.query(
      "INSERT INTO daybook.delivery_days(agency_id,delivery_date) SELECT $1,day::date FROM generate_series($2::date,$3::date,interval '1 day') day ON CONFLICT DO NOTHING",
      [f.agencyId, month + '-01', end],
    );
    await c.query(
      "INSERT INTO daybook.job_runs(id,agency_id,job_key,kind,run_date,status) VALUES(gen_random_uuid(),$1,$2,'MARK',$3,'SUCCEEDED')",
      [f.agencyId, 'MARK:' + end, end],
    );
  });
  const { runAgencyJobs } = await import('../../src/modules/jobs/service.js');
  await runAgencyJobs(
    api.pool,
    {
      id: f.agencyId,
      timezone: 'Asia/Kolkata',
      createdAt: month + '-01T00:00:00Z',
    },
    now,
  );
  const cycles = (
    await api.query(f.cookie, '{billingCycles{id month autoIssueQueued}}')
  ).data.billingCycles;
  assert.ok(
    cycles.some((c: { month: string }) => c.month === month),
    JSON.stringify(cycles),
  );
  const summary = await withTenant(api.pool, f.agencyId, (c) =>
    c.query(
      "SELECT details FROM daybook.audit_events WHERE entity_type='BILLING_CYCLE' AND actor_kind='SYSTEM'",
    ),
  );
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].details.month, month);
});

test('late holds cannot rewrite already billed automatic delivery rows or break daily preparation', async () => {
  const f = await fixture(),
    today = (await api.query(f.cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  await api.query(
    f.cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
    { date: today },
  );
  const input = {
      ...f.input,
      periodMode: 'CUSTOM',
      periods: [{ from: today, to: today }],
    },
    preview = (await api.query(f.cookie, previewQuery, { input })).data
      .previewBill;
  const saved = await api.query(f.cookie, saveMutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: preview.fingerprint,
    },
  });
  assert.ok(saved.data?.generateInvoice, JSON.stringify(saved));
  await api.query(
    f.cookie,
    'mutation($input:HoldInput!){setHold(input:$input){id}}',
    { input: { residentId: f.resident.id, startDate: today } },
  );
  const marked = await api.query(
    f.cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){total}}',
    { date: today },
  );
  assert.ok(marked.data?.markScheduledDeliveries, JSON.stringify(marked));
  const log = (
    await api.query(
      f.cookie,
      'query($date:String!){deliveryLogs(date:$date){status chargeableQuantity}}',
      { date: today },
    )
  ).data.deliveryLogs[0];
  assert.equal(log.status, 'DELIVERED');
  assert.equal(log.chargeableQuantity, 1);
});

test('automatic first-month completeness starts on the agency creation date', async () => {
  const f = await fixture(),
    { default: pg } = await import('pg'),
    admin = new pg.Pool({
      connectionString: process.env.TEST_ADMIN_DATABASE_URL,
    });
  try {
    await admin.query(
      "UPDATE daybook.agencies SET created_at='2024-01-15T06:00:00Z' WHERE id=$1",
      [f.agencyId],
    );
    await admin.query('DELETE FROM daybook.delivery_days WHERE agency_id=$1', [
      f.agencyId,
    ]);
  } finally {
    await admin.end();
  }
  await api.query(
    f.cookie,
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true,autoIssue:true,version:1}){version}}',
  );
  await withTenant(api.pool, f.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.delivery_days(agency_id,delivery_date) SELECT $1,day::date FROM generate_series('2024-01-15'::date,'2024-01-31'::date,interval '1 day') day",
      [f.agencyId],
    ),
  );
  const { issueAutomaticInvoice } =
    await import('../../src/modules/billing/automatic.js');
  await withTenant(api.pool, f.agencyId, (c) =>
    issueAutomaticInvoice(c, f.agencyId, {
      month: '2024-01',
      residentId: f.resident.id,
    }),
  );
  const bills = (await api.query(f.cookie, '{invoices{id}}')).data.invoices;
  assert.equal(bills.length, 1);
});

test('three months of arrears and a partial collection roll forward without reposting past charges', async () => {
  const f = await fixture();
  for (const date of ['2024-02-01', '2024-03-01', '2024-04-01'])
    await api.query(
      f.cookie,
      'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
      { date },
    );
  async function issue(date: string) {
    const input = {
        ...f.input,
        periodMode: 'CUSTOM',
        periods: [{ from: date, to: date }],
      },
      p = (await api.query(f.cookie, previewQuery, { input })).data.previewBill;
    return api.query(f.cookie, saveMutation, {
      input: {
        ...input,
        requestId: randomUUID(),
        previewFingerprint: p.fingerprint,
      },
    });
  }
  for (const date of ['2024-01-01', '2024-02-01', '2024-03-01'])
    assert.ok((await issue(date)).data?.generateInvoice);
  await withTenant(api.pool, f.agencyId, async (c) => {
    await postEntry(c, {
      agencyId: f.agencyId,
      residentId: f.resident.id,
      kind: 'PAYMENT',
      sourceKey: 'fixture:three-month-partial',
      amountPaise: -1000n,
      date: '2024-03-15',
      dueDate: '2024-03-15',
      description: 'Confirmed partial collection',
    });
    await settleResident(c, f.resident.id);
  });
  const input = {
      ...f.input,
      periods: [{ from: '2024-04-01', to: '2024-04-30' }],
    },
    p = (await api.query(f.cookie, previewQuery, { input })).data.previewBill;
  assert.equal(p.previousBalance, '11.00');
  assert.equal(p.currentAmount, '7.00');
  assert.equal(p.totalDue, '18.00');
  const saved = await api.query(f.cookie, saveMutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      previewFingerprint: p.fingerprint,
      acknowledgeUnmarkedDays: true,
    },
  });
  assert.equal(saved.data.generateInvoice.total, '7.00');
  const account = (
    await api.query(
      f.cookie,
      'query($id:ID!){residentLedger(residentId:$id){balance entries{kind amount}}}',
      { id: f.resident.id },
    )
  ).data.residentLedger;
  assert.equal(account.balance, '18.00');
  assert.equal(
    account.entries.filter((e: { kind: string }) => e.kind === 'INVOICE')
      .length,
    4,
  );
});

test('weekly bills consolidate one-off subscriptions and exclude vacation dates using snapshotted daily prices', async () => {
  const f = await fixture();
  await api.query(
    f.cookie,
    'mutation($input:HoldInput!){setHold(input:$input){id}}',
    {
      input: {
        residentId: f.resident.id,
        startDate: '2024-01-02',
        resumeDate: '2024-01-04',
      },
    },
  );
  const publication = (
    await api.query(
      f.cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'One Off Special',
          edition: 'Kochi',
          kind: 'NEWSPAPER',
          language: 'Malayalam',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '10',
          weekendPrice: '10',
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
        cadence: 'ONCE',
        startDate: '2024-01-05',
        weekdays: [],
        quantity: 1,
      },
    },
  );
  for (const date of [
    '2024-01-02',
    '2024-01-03',
    '2024-01-04',
    '2024-01-05',
    '2024-01-07',
  ])
    await api.query(
      f.cookie,
      'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
      { date },
    );
  const result = await api.query(f.cookie, previewQuery, {
    input: {
      ...f.input,
      periodMode: 'WEEKLY',
      periods: [{ from: '2024-01-01', to: '2024-01-07' }],
    },
  });
  assert.ok(result.data?.previewBill, JSON.stringify(result));
  assert.equal(result.data.previewBill.currentAmount, '48.25');
  assert.equal(result.data.previewBill.missingDayCount, 0);
  assert.ok(
    result.data.previewBill.lines.some(
      (l: { description: string; quantity: number }) =>
        l.description.includes('One Off Special') && l.quantity === 1,
    ),
  );
});

test('saved current-month invoices remain editable after the next calendar day without extending their source period', async () => {
  const f = await fixture(),
    today = (await api.query(f.cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  await api.query(
    f.cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
    { date: today },
  );
  const input = {
      ...f.input,
      periods: [{ from: today.slice(0, 7) + '-01', to: today }],
    },
    p = (await api.query(f.cookie, previewQuery, { input })).data.previewBill,
    saved = (
      await api.query(f.cookie, saveMutation, {
        input: {
          ...input,
          requestId: randomUUID(),
          previewFingerprint: p.fingerprint,
          acknowledgeUnmarkedDays: true,
        },
      })
    ).data.generateInvoice;
  const { buildBill } = await import('../../src/modules/billing/engine.js');
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000),
    result = await withTenant(api.pool, f.agencyId, (c) =>
      buildBill(
        c,
        {
          ...input,
          periodMode: 'MONTHLY',
          invoiceId: saved.id,
          version: saved.version,
        },
        tomorrow,
      ),
    );
  assert.deepEqual(result.preview.periods, input.periods);
});

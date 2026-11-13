import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import pg from 'pg';
const api = testApi();
after(() => api.pool.end());
test('new confirmed cash payment records explicit collector custody atomically and retries without a second classification', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Explicit Collector",staffCode:"EC1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Custody Door',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const input = {
    requestId: randomUUID(),
    residentId: resident.id,
    purpose: 'ACCOUNT',
    method: 'CASH',
    amount: '10',
    date: today,
    confirmReceived: true,
    confirmationNote: 'Staff collector counted cash',
    collectorCustody: 'STAFF',
    collectorStaffId: staffId,
    collectorRouteId: route.id,
  };
  const q = 'mutation($input:PaymentInput!){recordPayment(input:$input){id}}';
  const first = await api.query(cookie, q, { input });
  assert.ok(first.data?.recordPayment, JSON.stringify(first));
  const again = await api.query(cookie, q, { input });
  assert.equal(again.data.recordPayment.id, first.data.recordPayment.id);
  const day = await api.query(
    cookie,
    'query($date:String!){cashDay(date:$date){directCash sources{custody staffId routeId}}}',
    { date: today },
  );
  assert.equal(day.data.cashDay.directCash, '0.00');
  assert.equal(day.data.cashDay.sources[0].custody, 'STAFF');
  assert.equal(day.data.cashDay.sources[0].staffId, staffId);
});
test('the same publisher return is claimed once across handover and standalone entry points', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Returns Staff",staffCode:"RET1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  const publisher = (
    await api.query(
      cookie,
      'mutation{savePublisher(input:{name:"Return Press",phone:"9876543210",returnCutoff:"23:59",returnWindowDays:1}){id}}',
    )
  ).data.savePublisher;
  const publication = (
    await api.query(
      cookie,
      'mutation{savePublication(input:{name:"Return Daily",edition:"Kochi",kind:NEWSPAPER,language:"Malayalam",dispatch:MORNING,frequency:DAILY,publishingDays:[0,1,2,3,4,5,6],weekdayPrice:"8",weekendPrice:"8"}){id}}',
    )
  ).data.savePublication;
  const lot = await api.query(
    cookie,
    'mutation($input:SupplyInput!){receiveSupply(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        publisherId: publisher.id,
        publicationId: publication.id,
        date: today,
        quantity: 10,
        netCost: '6.00',
      },
    },
  );
  assert.ok(lot.data?.receiveSupply, JSON.stringify(lot));
  const input = {
    requestId: randomUUID(),
    supplyId: lot.data.receiveSupply.id,
    quantity: 2,
    reason: 'Unsold originals returned',
  };
  const h = await api.query(
    cookie,
    'mutation($input:HandoverInput!){recordHandover(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        routeId: route.id,
        date: today,
        paymentIds: [],
        actualCash: '0',
        returns: [input],
        signoff: 'Owner received returned originals',
      },
    },
  );
  assert.ok(h.data?.recordHandover, JSON.stringify(h));
  const replay = await api.query(
    cookie,
    'mutation($input:ReturnInput!){recordReturn(input:$input){id}}',
    { input },
  );
  assert.ok(replay.data?.recordReturn, JSON.stringify(replay));
  const lots = await api.query(cookie, '{supplyLots{id returned}}');
  assert.equal(
    lots.data.supplyLots[0].returned,
    2,
    'Cross-entry replay must not return another two copies',
  );
  const duplicateHandover = await api.query(
    cookie,
    'mutation($input:HandoverInput!){recordHandover(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        routeId: route.id,
        date: today,
        paymentIds: [],
        actualCash: '0',
        returns: [input],
        signoff: 'Attempting the same return under another handover',
      },
    },
  );
  assert.ok(
    duplicateHandover.errors,
    'An original return may appear in only one signed handover',
  );
});
test('staff receipt enters drawer only as actual handover; shortage remains agency suspense and signed close is immutable', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const staff = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Collector",staffCode:"COL1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff;
  const today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Cash Door',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const pay = await api.query(
    cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        purpose: 'ACCOUNT',
        method: 'CASH',
        amount: '100.00',
        date: today,
        confirmReceived: true,
        confirmationNote: 'Collected in field',
      },
    },
  );
  assert.ok(pay.data?.recordPayment, JSON.stringify(pay));
  const identity = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const yesterday = new Date(today + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await withTenant(api.pool, identity.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.cash_day_closes(id,agency_id,close_date,opening_paise,counted_paise,bank_paise,expected_paise,variance_paise,snapshot,reason,signoff,created_by) VALUES($1,$2,$3,0,0,0,0,0,'{}','Prior day','Owner',$4)",
      [
        randomUUID(),
        identity.agencyId,
        yesterday.toISOString().slice(0, 10),
        identity.id,
      ],
    ),
  );
  const oldDateParser = pg.types.getTypeParser(1082);
  pg.types.setTypeParser(
    1082,
    (value: string) => new Date(value + 'T00:00:00+05:30'),
  );
  const classify = await api.query(
    cookie,
    'mutation($input:CollectionCustodyInput!){classifyCollection(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        paymentId: pay.data.recordPayment.id,
        custody: 'STAFF',
        staffId: staff.id,
        routeId: route.id,
        reason: 'Field collector confirmed',
      },
    },
  );
  pg.types.setTypeParser(1082, oldDateParser);
  assert.ok(classify.data?.classifyCollection, JSON.stringify(classify));
  const query =
    'query($date:String!){cashDay(date:$date){directCash handoverCash outflow expectedMovement unclassified suspense}}';
  let day = await api.query(cookie, query, { date: today });
  assert.equal(day.data.cashDay.expectedMovement, '0.00');
  const input = {
    requestId: randomUUID(),
    staffId: staff.id,
    routeId: route.id,
    date: today,
    paymentIds: [pay.data.recordPayment.id],
    actualCash: '90.00',
    returns: [],
    signoff: 'Owner counted ninety; shortage held in agency suspense',
  };
  const handover = await api.query(
    cookie,
    'mutation($input:HandoverInput!){recordHandover(input:$input){id expected actual discrepancy}}',
    { input },
  );
  assert.ok(handover.data?.recordHandover, JSON.stringify(handover));
  assert.equal(handover.data.recordHandover.discrepancy, '-10.00');
  const replay = await api.query(
    cookie,
    'mutation($input:HandoverInput!){recordHandover(input:$input){id}}',
    { input },
  );
  assert.equal(replay.data.recordHandover.id, handover.data.recordHandover.id);
  day = await api.query(cookie, query, { date: today });
  assert.equal(day.data.cashDay.handoverCash, '90.00');
  assert.equal(day.data.cashDay.expectedMovement, '90.00');
  assert.equal(day.data.cashDay.suspense, '-10.00');
  const expenseMutation =
    'mutation($input:CashExpenseInput!){recordCashExpense(input:$input){id}}';
  const remittance = {
    requestId: randomUUID(),
    kind: 'LATE_REMITTANCE',
    handoverId: handover.data.recordHandover.id,
    amount: '5',
    reason: 'Owner received five later against signed shortage',
  };
  const received = await api.query(cookie, expenseMutation, {
    input: remittance,
  });
  assert.ok(received.data?.recordCashExpense, JSON.stringify(received));
  const repeated = await api.query(cookie, expenseMutation, {
    input: remittance,
  });
  assert.equal(
    repeated.data.recordCashExpense.id,
    received.data.recordCashExpense.id,
  );
  const excessive = await api.query(cookie, expenseMutation, {
    input: { ...remittance, requestId: randomUUID(), amount: '6' },
  });
  assert.ok(
    excessive.errors,
    'Late remittance cannot exceed the remaining shortage',
  );
  const petty = await api.query(cookie, expenseMutation, {
    input: {
      requestId: randomUUID(),
      kind: 'PETTY',
      amount: '5',
      reason: 'Confirmed route petty expense',
    },
  });
  assert.ok(petty.data?.recordCashExpense, JSON.stringify(petty));
  day = await api.query(cookie, query, { date: today });
  assert.equal(day.data.cashDay.handoverCash, '95.00');
  assert.equal(day.data.cashDay.outflow, '5.00');
  assert.equal(day.data.cashDay.expectedMovement, '90.00');
  assert.equal(day.data.cashDay.suspense, '-5.00');
  const close = await api.query(
    cookie,
    'mutation($input:CashCloseInput!){closeCashDay(input:$input){id expected counted variance}}',
    {
      input: {
        requestId: randomUUID(),
        date: today,
        opening: '0',
        counted: '90.00',
        bankDeposit: '0',
        reason: 'Short handover separately held in suspense',
        signoff: 'Owner counted and signed',
      },
    },
  );
  assert.ok(close.data?.closeCashDay, JSON.stringify(close));
  assert.equal(close.data.closeCashDay.variance, '0.00');
  const history = await api.query(
    cookie,
    '{cashHistory{handovers{id expected actual discrepancy returnedCopies} closes{id expected counted variance}}}',
  );
  assert.ok(history.data?.cashHistory, JSON.stringify(history));
  assert.equal(history.data.cashHistory.handovers[0].actual, '90.00');
  assert.equal(history.data.cashHistory.closes[0].variance, '0.00');
  const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const actorId = (await api.query(cookie, '{me{id}}')).data.me.id;
  const tomorrowDate = new Date(today + 'T00:00:00Z');
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  await withTenant(api.pool, agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.cash_expenses(id,agency_id,posting_date,kind,amount_paise,handover_id,reason,created_by) VALUES($1,$2,$3,'LATE_REMITTANCE',500,$4,'Following day remittance',$5)",
      [
        randomUUID(),
        agencyId,
        tomorrowDate.toISOString().slice(0, 10),
        handover.data.recordHandover.id,
        actorId,
      ],
    ),
  );
  const historical = await api.query(cookie, query, { date: today });
  assert.equal(
    historical.data.cashDay.suspense,
    '-5.00',
    'Future cash may not alter signed historical suspense',
  );
  const late = await api.query(
    cookie,
    'mutation($input:CashExpenseInput!){recordCashExpense(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        amount: '1',
        kind: 'PETTY',
        reason: 'After signoff',
      },
    },
  );
  assert.ok(
    late.errors,
    'Closed drawer must reject further current-day movements',
  );
  const afterClose = await api.query(
    cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        purpose: 'ACCOUNT',
        method: 'CASH',
        amount: '10.00',
        date: today,
        confirmReceived: true,
        confirmationNote: 'Late cash after signed close',
      },
    },
  );
  assert.ok(
    afterClose.errors,
    'A signed close must also guard cash from the resident payment API',
  );
  const digitalDeposit = await api.query(
    cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){id status}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        purpose: 'DEPOSIT',
        method: 'UPI',
        amount: '10.00',
        date: today,
        reference: 'UPI-AFTER-CASH-CLOSE',
        confirmReceived: true,
        confirmationNote: 'UPI deposit independently verified by owner',
      },
    },
  );
  assert.ok(digitalDeposit.data?.recordPayment, JSON.stringify(digitalDeposit));
  const other = await api.agency();
  const forged = await api.query(
    other,
    'mutation($input:CollectionCustodyInput!){classifyCollection(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        paymentId: pay.data.recordPayment.id,
        custody: 'AGENCY',
        reason: 'Forged classification',
      },
    },
  );
  assert.ok(forged.errors);
});

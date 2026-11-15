import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { withTenant } from '../../src/db/tenant.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());

test('delivery cost provenance captures a known current-date rate once and never invents historical costs', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today as string;
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
        name: 'Provenance Resident',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    )
  ).saveResident;
  const pubInput = {
    name: 'Known Cost',
    edition: 'Main',
    language: 'English',
    kind: 'NEWSPAPER',
    dispatch: 'MORNING',
    frequency: 'DAILY',
    publishingDays: [0, 1, 2, 3, 4, 5, 6],
    weekdayPrice: '8.15',
    weekendPrice: '8.15',
    procurementNetCost: '2.00',
  };
  const publication = (
    await run(
      'mutation($input:PublicationInput!){savePublication(input:$input){id version}}',
      pubInput,
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
      startDate: yesterday,
      quantity: 1,
    },
  );
  async function mark(date: string) {
    const result = await api.query(
      cookie,
      'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
      { date },
    );
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data.markScheduledDeliveries.created;
  }
  async function costs(tenant = agencyId) {
    return withTenant(
      api.pool,
      tenant,
      async (c) =>
        (
          await c.query(
            "SELECT id,to_char(delivery_date,'YYYY-MM-DD') AS date,procurement_unit_paise::text AS cost,procurement_basis AS basis,procurement_recorded_at IS NOT NULL AS recorded FROM daybook.delivery_logs ORDER BY delivery_date,publication_name",
          )
        ).rows,
    );
  }
  assert.equal(await mark(date), 1);
  const initial = (await costs())[0];
  assert.equal(initial.cost, '200');
  assert.equal(initial.basis, 'PUBLICATION_AT_PREPARATION');
  assert.equal(initial.recorded, true);
  await run(
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    {
      ...pubInput,
      id: publication.id,
      version: publication.version,
      procurementNetCost: '9.00',
    },
  );
  assert.equal(await mark(date), 0);
  assert.equal((await costs())[0].cost, '200');
  await assert.rejects(
    withTenant(api.pool, agencyId, (c) =>
      c.query(
        'UPDATE daybook.delivery_logs SET procurement_unit_paise=999 WHERE id=$1',
        [initial.id],
      ),
    ),
    (error: unknown) => (error as { code: string }).code === '23514',
  );
  assert.equal(await mark(yesterday), 1);
  const historical = (await costs()).find((row) => row.date === yesterday)!;
  assert.equal(historical.cost, null);
  assert.equal(historical.basis, 'UNRECORDED');
  assert.equal(historical.recorded, false);
  for (const [name, cost] of [
    ['Unknown Cost', null],
    ['Known Zero Cost', '0.00'],
  ] as const) {
    const extra = (
      await run(
        'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
        { ...pubInput, name, procurementNetCost: cost },
      )
    ).savePublication;
    await run(
      'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
      {
        requestId: randomUUID(),
        residentId: resident.id,
        publicationId: extra.id,
        cadence: 'DAILY',
        weekdays: [],
        startDate: date,
        quantity: 1,
      },
    );
  }
  assert.equal(await mark(date), 2);
  const rows = await withTenant(
    api.pool,
    agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT publication_name,procurement_unit_paise::text AS cost,procurement_basis AS basis FROM daybook.delivery_logs WHERE delivery_date=$1',
          [date],
        )
      ).rows,
  );
  assert.deepEqual(
    rows.find((row) => row.publication_name.startsWith('Known Zero Cost')),
    {
      publication_name: 'Known Zero Cost · Main',
      cost: '0',
      basis: 'PUBLICATION_AT_PREPARATION',
    },
  );
  assert.deepEqual(
    rows.find((row) => row.publication_name.startsWith('Unknown Cost')),
    {
      publication_name: 'Unknown Cost · Main',
      cost: null,
      basis: 'UNRECORDED',
    },
  );
  const analytics = await api.query(
    cookie,
    `query($input:AnalyticsInput!){agencyAnalytics(input:$input){routes{routeId snapshotNames chargeableRetail procurementEstimate missingCostCopies fulfilledCopies procurementCoverage postedPayroll payrollCopiesWithoutPostedCost payrollCoverage contributionBeforeShared contributionCoverage replacementCopies}}}`,
    { input: { month: date.slice(0, 7) } },
  );
  assert.ok(analytics.data?.agencyAnalytics, JSON.stringify(analytics));
  assert.deepEqual(analytics.data.agencyAnalytics.routes, [
    {
      routeId: route.id,
      snapshotNames: ['Lotus'],
      chargeableRetail: '32.60',
      procurementEstimate: '2.00',
      missingCostCopies: '2',
      fulfilledCopies: '4',
      procurementCoverage: 'PARTIAL',
      postedPayroll: '0.00',
      payrollCopiesWithoutPostedCost: '4',
      payrollCoverage: 'UNAVAILABLE',
      contributionBeforeShared: '30.60',
      contributionCoverage: 'PARTIAL',
      replacementCopies: '0',
    },
  ]);
  const foreign = await api.agency(),
    other = (await api.query(foreign, '{me{agencyId}}')).data.me.agencyId;
  assert.deepEqual(await costs(other), []);
});

test('damaged and credited original copies keep route contribution partial even when fulfilled copies have complete cost evidence', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today;
  async function run(operation: string, input: Record<string, unknown>) {
    const result = await api.query(cookie, operation, { input });
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const staff = (
    await run('mutation($input:StaffInput!){saveStaff(input:$input){id}}', {
      name: 'Route Cost Staff',
      staffCode: 'RCS',
      phone: '9876543210',
      status: 'ACTIVE',
    })
  ).saveStaff;
  const publication = (
    await run(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        name: 'Route Cost Daily',
        edition: 'Main',
        language: 'English',
        kind: 'NEWSPAPER',
        dispatch: 'MORNING',
        frequency: 'DAILY',
        publishingDays: [0, 1, 2, 3, 4, 5, 6],
        weekdayPrice: '8.00',
        weekendPrice: '8.00',
        procurementNetCost: '2.00',
      },
    )
  ).savePublication;
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        requestId: randomUUID(),
        name: 'Cost Resident',
        address: '12 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    )
  ).saveResident;
  for (let index = 0; index < 3; index++) {
    // Separate same-title publications give three independent original delivery records.
    const pub =
      index === 0
        ? publication
        : (
            await run(
              'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
              {
                name: 'Exception Daily ' + index,
                edition: 'Main',
                language: 'English',
                kind: 'NEWSPAPER',
                dispatch: 'MORNING',
                frequency: 'DAILY',
                publishingDays: [0, 1, 2, 3, 4, 5, 6],
                weekdayPrice: '8.00',
                weekendPrice: '8.00',
                procurementNetCost: '2.00',
              },
            )
          ).savePublication;
    await run(
      'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
      {
        requestId: randomUUID(),
        residentId: resident.id,
        publicationId: pub.id,
        cadence: 'DAILY',
        weekdays: [],
        startDate: date,
        quantity: 1,
      },
    );
  }
  const marked = await api.query(
    cookie,
    'mutation($date:String!){markScheduledDeliveries(date:$date){created}}',
    { date },
  );
  assert.equal(marked.data?.markScheduledDeliveries.created, 3);
  await withTenant(api.pool, me.agencyId, async (c) => {
    const rows = (
      await c.query<{ id: string }>(
        'SELECT id FROM daybook.delivery_logs ORDER BY publication_name',
      )
    ).rows;
    await c.query('UPDATE daybook.delivery_logs SET staff_id=$1', [staff.id]);
    for (const [index, status] of [
      [1, 'DAMAGED'],
      [2, 'CREDITED'],
    ] as const)
      await c.query(
        "UPDATE daybook.delivery_logs SET status=$2,chargeable_quantity=0,source='COMPLAINT' WHERE id=$1",
        [rows[index].id, status],
      );
    const slip = randomUUID(),
      snapshot = {
        rules: [
          {
            start: date,
            end: null,
            employmentStart: date,
            employmentEnd: null,
            copy: '0',
            route: '0',
          },
        ],
        attendance: [],
        deliveries: [{ id: rows[0].id, date, quantity: 1, route: route.id }],
        claimedDeliveries: [rows[0].id],
        salary: '0.00',
        commission: '0.00',
        routeAllowance: '0.00',
        adjustment: '0.00',
        reimbursement: '0.00',
        advance: '0.00',
        net: '0.00',
      };
    await c.query(
      "INSERT INTO daybook.payslips(id,agency_id,staff_id,month,code,snapshot,net_paise,created_by) VALUES($1,$2,$3,$4,'RESTORED-COST', $5,0,$6)",
      [slip, me.agencyId, staff.id, date.slice(0, 7) + '-01', snapshot, me.id],
    );
    await c.query(
      'INSERT INTO daybook.payroll_delivery_claims(agency_id,delivery_id,payslip_id) VALUES($1,$2,$3)',
      [me.agencyId, rows[0].id, slip],
    );
  });
  const result = await api.query(
    cookie,
    'query($input:AnalyticsInput!){agencyAnalytics(input:$input){routes{fulfilledCopies procurementCoverage payrollCoverage contributionCoverage exceptionCopiesWithoutAttributedCost}}}',
    { input: { month: date.slice(0, 7) } },
  );
  assert.ok(result.data?.agencyAnalytics, JSON.stringify(result));
  assert.deepEqual(result.data.agencyAnalytics.routes, [
    {
      fulfilledCopies: '1',
      procurementCoverage: 'COMPLETE',
      payrollCoverage: 'COMPLETE',
      contributionCoverage: 'PARTIAL',
      exceptionCopiesWithoutAttributedCost: '2',
    },
  ]);
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { runAgencyJobs } from '../../src/modules/jobs/service.js';
const api = testApi();
after(() => api.pool.end());
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const publication = (
    await api.query(
      cookie,
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Delivery Daily',
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
  const residentIds: string[] = [];
  for (let index = 1; index <= 3; index++) {
    const resident = (
      await api.query(
        cookie,
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: `Door ${index}`,
            address: `${index} Lotus Lane`,
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: index,
          },
        },
      )
    ).data.saveResident;
    residentIds.push(resident.id);
    const sub = await api.query(
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
          quantity: index,
        },
      },
    );
    assert.ok(sub.data?.saveSubscription, JSON.stringify(sub));
  }
  return { cookie, route, publication, residentIds };
}
const mark =
  'mutation($date:String!){markScheduledDeliveries(date:$date){created total}}';
const manifest =
  'mutation($date:String!,$dispatch:DispatchTime!){buildManifest(date:$date,dispatch:$dispatch){id date dispatch totalCopies rows{residentId dropOrder quantity staffId} publications{publicationId name copies}}}';
test('midnight and 04:00 tenant jobs are catch-up safe and cannot duplicate deliveries or manifests', async () => {
  const f = await fixture(),
    agencyId = (await api.query(f.cookie, '{me{agencyId}}')).data.me.agencyId;
  const tenant = {
    id: agencyId,
    timezone: 'Asia/Kolkata',
    createdAt: '2024-02-01T00:00:00+05:30',
  };
  await runAgencyJobs(api.pool, tenant, new Date('2024-02-01T00:30:00+05:30'));
  const early = await api.query(
    f.cookie,
    '{deliveryLogs(date:"2024-02-01"){id} manifests(date:"2024-02-01"){id}}',
  );
  assert.equal(early.data.deliveryLogs.length, 3);
  assert.equal(early.data.manifests.length, 0);
  await Promise.all([
    runAgencyJobs(api.pool, tenant, new Date('2024-02-01T04:01:00+05:30')),
    runAgencyJobs(api.pool, tenant, new Date('2024-02-01T04:01:00+05:30')),
  ]);
  const cutoff = await api.query(
    f.cookie,
    '{deliveryLogs(date:"2024-02-01"){id} manifests(date:"2024-02-01"){id totalCopies}}',
  );
  assert.equal(cutoff.data.deliveryLogs.length, 3);
  assert.equal(cutoff.data.manifests.length, 2);
  assert.equal(
    cutoff.data.manifests.reduce(
      (sum: number, m: { totalCopies: number }) => sum + m.totalCopies,
      0,
    ),
    6,
  );
});
test('dated delivery marking and manifest counts are retry-safe and exclude holidays and holds', async () => {
  const f = await fixture();
  await api.query(
    f.cookie,
    'mutation($input:HoldInput!){setHold(input:$input){id}}',
    {
      input: {
        residentId: f.residentIds[1],
        startDate: '2024-02-01',
        resumeDate: '2024-02-02',
      },
    },
  );
  const marked = await api.query(f.cookie, mark, { date: '2024-02-01' });
  assert.deepEqual(
    marked.data?.markScheduledDeliveries,
    { created: 2, total: 2 },
    JSON.stringify(marked),
  );
  const retry = await api.query(f.cookie, mark, { date: '2024-02-01' });
  assert.deepEqual(retry.data.markScheduledDeliveries, {
    created: 0,
    total: 2,
  });
  const slip = await api.query(f.cookie, manifest, {
    date: '2024-02-01',
    dispatch: 'MORNING',
  });
  assert.equal(slip.data?.buildManifest.totalCopies, 4, JSON.stringify(slip));
  assert.deepEqual(
    slip.data.buildManifest.rows.map((r: { dropOrder: number }) => r.dropOrder),
    [1, 3],
  );
  assert.equal(slip.data.buildManifest.publications[0].copies, 4);
  const again = await api.query(f.cookie, manifest, {
    date: '2024-02-01',
    dispatch: 'MORNING',
  });
  assert.equal(again.data.buildManifest.id, slip.data.buildManifest.id);
  const holiday = await api.query(
    f.cookie,
    'mutation($input:PressHolidayInput!){savePressHoliday(input:$input){id}}',
    {
      input: {
        publicationId: f.publication.id,
        date: '2024-02-02',
        reason: 'Press closed',
      },
    },
  );
  assert.ok(holiday.data?.savePressHoliday, JSON.stringify(holiday));
  const skipped = await api.query(f.cookie, mark, { date: '2024-02-02' });
  assert.deepEqual(skipped.data.markScheduledDeliveries, {
    created: 0,
    total: 0,
  });
});
test('temporary split allocation covers every route drop once and expires without changing permanent assignment', async () => {
  const f = await fixture();
  await api.query(f.cookie, mark, { date: '2024-02-01' });
  async function staff(code: string) {
    return (
      await api.query(
        f.cookie,
        'mutation($input:StaffInput!){saveStaff(input:$input){id}}',
        {
          input: {
            name: code,
            staffCode: code,
            phone: '9876543210',
            status: 'ACTIVE',
          },
        },
      )
    ).data.saveStaff.id;
  }
  const first = await staff('SUB1'),
    second = await staff('SUB2');
  const input = {
    routeId: f.route.id,
    startDate: '2024-02-01',
    endDate: '2024-02-02',
    reason: 'Regular staff absent',
    allocations: [
      { staffId: first, fromDrop: 1, toDrop: 1 },
      { staffId: second, fromDrop: 2, toDrop: 99999 },
    ],
  };
  const split = await api.query(
    f.cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
    { input },
  );
  assert.ok(split.data?.assignSubstitutes, JSON.stringify(split));
  const missing = await api.query(
    f.cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
    {
      input: {
        ...input,
        startDate: '2024-02-03',
        endDate: '2024-02-03',
        allocations: [{ staffId: first, fromDrop: 1, toDrop: 1 }],
      },
    },
  );
  assert.equal(missing.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const during = (
    await api.query(f.cookie, manifest, {
      date: '2024-02-01',
      dispatch: 'MORNING',
    })
  ).data.buildManifest;
  assert.deepEqual(
    during.rows.map((r: { staffId: string }) => r.staffId),
    [first, second, second],
  );
  const actual = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-01"){staffId}}')
  ).data.deliveryLogs;
  assert.deepEqual(
    actual.map((r: { staffId: string }) => r.staffId),
    [first, second, second],
  );
  const saved = (
    await api.query(f.cookie, '{substituteAssignments{id version}}')
  ).data.substituteAssignments[0];
  const narrowed = await api.query(
    f.cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id version}}',
    { input: { ...input, ...saved, startDate: '2024-02-02' } },
  );
  assert.ok(narrowed.data?.assignSubstitutes, JSON.stringify(narrowed));
  const restored = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-01"){staffId}}')
  ).data.deliveryLogs;
  assert.deepEqual(
    restored.map((r: { staffId: string | null }) => r.staffId),
    [null, null, null],
  );
  await api.query(f.cookie, mark, { date: '2024-02-02' });
  const cancelled = await api.query(
    f.cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
    {
      input: {
        ...input,
        ...narrowed.data.assignSubstitutes,
        startDate: '2024-02-02',
        active: false,
      },
    },
  );
  assert.ok(cancelled.data?.assignSubstitutes);
  const cancelledLogs = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-02"){staffId}}')
  ).data.deliveryLogs;
  assert.deepEqual(
    cancelledLogs.map((r: { staffId: string | null }) => r.staffId),
    [null, null, null],
  );
  const after = (
    await api.query(f.cookie, manifest, {
      date: '2024-02-03',
      dispatch: 'MORNING',
    })
  ).data.buildManifest;
  assert.deepEqual(
    after.rows.map((r: { staffId: string | null }) => r.staffId),
    [null, null, null],
  );
});
test('delivery overrides and complaint resolutions are versioned and cannot issue two replacements', async () => {
  const f = await fixture();
  await api.query(f.cookie, mark, { date: '2024-02-01' });
  const log = (
    await api.query(
      f.cookie,
      '{deliveryLogs(date:"2024-02-01"){id version status}}',
    )
  ).data.deliveryLogs[0];
  const changed = await api.query(
    f.cookie,
    'mutation($input:DeliveryOverrideInput!){overrideDelivery(input:$input){id version status}}',
    {
      input: {
        id: log.id,
        version: log.version,
        status: 'DAMAGED',
        reason: 'Wet paper',
        requestId: randomUUID(),
      },
    },
  );
  assert.equal(
    changed.data?.overrideDelivery.status,
    'DAMAGED',
    JSON.stringify(changed),
  );
  const complaint = await api.query(
    f.cookie,
    'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version status}}',
    {
      input: {
        deliveryId: log.id,
        kind: 'DAMAGED',
        note: 'Wet paper',
        requestId: randomUUID(),
      },
    },
  );
  assert.ok(complaint.data?.recordComplaint);
  const resolution = {
    id: complaint.data.recordComplaint.id,
    version: complaint.data.recordComplaint.version,
    resolution: 'REPLACEMENT',
    note: 'Replacement dispatched',
    requestId: randomUUID(),
  };
  const resolved = await api.query(
    f.cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id status replacementCopies}}',
    { input: resolution },
  );
  assert.equal(
    resolved.data?.resolveComplaint.replacementCopies,
    1,
    JSON.stringify(resolved),
  );
  const retry = await api.query(
    f.cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id status replacementCopies}}',
    { input: resolution },
  );
  assert.equal(retry.data?.resolveComplaint.replacementCopies, 1);
  const other = await api.agency();
  const foreign = await api.query(
    other,
    '{deliveryLogs(date:"2024-02-01"){id} complaints{id}}',
  );
  assert.deepEqual(foreign.data, { deliveryLogs: [], complaints: [] });
});

test('historical delivery logs and packing snapshots survive later subscription cancellation', async () => {
  const f = await fixture();
  const original = (
    await api.query(f.cookie, manifest, {
      date: '2024-02-01',
      dispatch: 'MORNING',
    })
  ).data.buildManifest;
  const subs = (
    await api.query(
      f.cookie,
      '{subscriptions{id residentId publicationId cadence startDate endDate weekdays quantity version}}',
    )
  ).data.subscriptions;
  for (const sub of subs) {
    const cancelled = await api.query(
      f.cookie,
      'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
      { input: { ...sub, status: 'CANCELLED' } },
    );
    assert.ok(cancelled.data?.saveSubscription, JSON.stringify(cancelled));
  }
  const rerun = await api.query(f.cookie, mark, { date: '2024-02-01' });
  assert.equal(rerun.data.markScheduledDeliveries.total, 3);
  const rebuilt = (
    await api.query(f.cookie, manifest, {
      date: '2024-02-01',
      dispatch: 'MORNING',
    })
  ).data.buildManifest;
  assert.equal(rebuilt.id, original.id);
  assert.equal(rebuilt.totalCopies, 6);
  assert.equal(rebuilt.rows.length, 3);
});

test('distinct complaint requests cannot repeat benefits after an intervening delivery status change', async () => {
  const f = await fixture();
  await api.query(f.cookie, mark, { date: '2024-02-01' });
  const delivery = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-01"){id version}}')
  ).data.deliveryLogs[0];
  async function complain() {
    return (
      await api.query(
        f.cookie,
        'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
        {
          input: {
            requestId: randomUUID(),
            deliveryId: delivery.id,
            kind: 'MISSED',
            note: 'Missed paper',
          },
        },
      )
    ).data.recordComplaint;
  }
  async function resolve(c: { id: string; version: number }) {
    return api.query(
      f.cookie,
      'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id status}}',
      {
        input: {
          ...c,
          requestId: randomUUID(),
          resolution: 'REPLACEMENT',
          note: 'Replacement dispatched',
        },
      },
    );
  }
  assert.ok((await resolve(await complain())).data?.resolveComplaint);
  const current = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-01"){id version}}')
  ).data.deliveryLogs[0];
  await api.query(
    f.cookie,
    'mutation($input:DeliveryOverrideInput!){overrideDelivery(input:$input){id}}',
    {
      input: {
        ...current,
        requestId: randomUUID(),
        status: 'DELIVERED',
        reason: 'Confirmed',
      },
    },
  );
  const second = await resolve(await complain());
  assert.equal(second.errors?.[0].extensions.code, 'CONFLICT');
});

test('dashboard reports measured complaint outcomes and recorded resident feedback without inventing ratings', async () => {
  const f = await fixture();
  await api.query(f.cookie, mark, { date: '2024-02-01' });
  const empty = await api.query(
    f.cookie,
    '{deliveryMetrics{openComplaints totalComplaints satisfactionAverage failedJobs}}',
  );
  assert.deepEqual(
    empty.data?.deliveryMetrics,
    {
      openComplaints: 0,
      totalComplaints: 0,
      satisfactionAverage: null,
      failedJobs: 0,
    },
    JSON.stringify(empty),
  );
  const log = (
    await api.query(f.cookie, '{deliveryLogs(date:"2024-02-01"){id}}')
  ).data.deliveryLogs[0];
  const complaint = (
    await api.query(
      f.cookie,
      'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
      {
        input: {
          requestId: randomUUID(),
          deliveryId: log.id,
          kind: 'DAMAGED',
          note: 'Damaged paper',
        },
      },
    )
  ).data.recordComplaint;
  const resolved = await api.query(
    f.cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id}}',
    {
      input: {
        ...complaint,
        requestId: randomUUID(),
        resolution: 'REPLACEMENT',
        note: 'Replacement delivered',
        rating: 4,
      },
    },
  );
  assert.ok(resolved.data?.resolveComplaint, JSON.stringify(resolved));
  const metrics = await api.query(
    f.cookie,
    '{deliveryMetrics{openComplaints totalComplaints resolvedComplaints satisfactionAverage staffErrors{staffId errors deliveries}}}',
  );
  assert.equal(metrics.data.deliveryMetrics.openComplaints, 0);
  assert.equal(metrics.data.deliveryMetrics.totalComplaints, 1);
  assert.equal(metrics.data.deliveryMetrics.resolvedComplaints, 1);
  assert.equal(metrics.data.deliveryMetrics.satisfactionAverage, 4);
  assert.deepEqual(metrics.data.deliveryMetrics.staffErrors, [
    { staffId: null, errors: 1, deliveries: 3 },
  ]);
});
test('dispatch count warning compares measured copies with the prior seven prepared dispatches', async () => {
  const f = await fixture();
  for (const date of ['2024-02-01', '2024-02-02', '2024-02-03'])
    await api.query(f.cookie, manifest, { date, dispatch: 'MORNING' });
  for (const residentId of f.residentIds.slice(0, 2))
    await api.query(
      f.cookie,
      'mutation($input:HoldInput!){setHold(input:$input){id}}',
      {
        input: {
          residentId,
          startDate: '2024-02-04',
          resumeDate: '2024-02-05',
        },
      },
    );
  const result = await api.query(
    f.cookie,
    'mutation{buildManifest(date:"2024-02-04",dispatch:MORNING){totalCopies averageCopies deviation}}',
  );
  assert.deepEqual(
    result.data?.buildManifest,
    { totalCopies: 3, averageCopies: 6, deviation: true },
    JSON.stringify(result),
  );
});

test('an active dated substitute must be reassigned before becoming unavailable', async () => {
  const f = await fixture(),
    date = (await api.query(f.cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const person = (
    await api.query(
      f.cookie,
      'mutation($input:StaffInput!){saveStaff(input:$input){id version}}',
      {
        input: {
          name: 'Temporary Courier',
          staffCode: 'TEMP',
          phone: '9876543210',
          status: 'ACTIVE',
        },
      },
    )
  ).data.saveStaff;
  const assigned = await api.query(
    f.cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
    {
      input: {
        routeId: f.route.id,
        startDate: date,
        endDate: date,
        reason: 'Emergency cover',
        allocations: [{ staffId: person.id, fromDrop: 1, toDrop: 99999 }],
      },
    },
  );
  assert.ok(assigned.data?.assignSubstitutes);
  const inactive = await api.query(
    f.cookie,
    'mutation($input:StaffInput!){saveStaff(input:$input){id}}',
    {
      input: {
        ...person,
        name: 'Temporary Courier',
        staffCode: 'TEMP',
        phone: '9876543210',
        status: 'INACTIVE',
      },
    },
  );
  assert.equal(inactive.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});

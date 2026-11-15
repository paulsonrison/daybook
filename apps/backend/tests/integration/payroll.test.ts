import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());
test('pay-rule creation rejects contradictory tenure ends and calculation rejects conflicting preconfigured boundaries', async () => {
  const cookie = await api.agency(),
    staffId = (
      await api.query(
        cookie,
        'mutation{saveStaff(input:{name:"Consistent Tenure",staffCode:"CT1",phone:"9876543210",status:ACTIVE}){id}}',
      )
    ).data.saveStaff.id;
  const input = {
    requestId: randomUUID(),
    staffId,
    startDate: '2026-01-01',
    endDate: '2026-01-15',
    employmentStart: '2026-01-01',
    employmentEnd: '2026-01-20',
    mode: 'SALARY',
    monthlySalary: '100',
    copyRate: '0',
    routeAllowance: '0',
    proration: 'CALENDAR_DAYS',
  };
  const mutation =
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}';
  const a = await api.query(cookie, mutation, { input });
  assert.ok(a.data?.savePayRule, JSON.stringify(a));
  const conflicting = await api.query(cookie, mutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      startDate: '2026-01-16',
      endDate: '2026-01-31',
      employmentEnd: '2026-01-31',
    },
  });
  assert.ok(
    conflicting.errors,
    'Rate changes may not silently extend the same employment tenure',
  );
  const valid = await api.query(cookie, mutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      startDate: '2026-01-16',
      endDate: '2026-01-20',
    },
  });
  assert.ok(valid.data?.savePayRule, JSON.stringify(valid));
  const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  await withTenant(api.pool, agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.pay_rules(id,agency_id,staff_id,start_date,end_date,employment_start,employment_end,mode,monthly_paise,copy_paise,route_paise,proration) VALUES($1,$2,$3,'2026-02-01','2026-02-20','2026-01-01','2026-02-20','SALARY',10000,0,0,'CALENDAR_DAYS')",
      [randomUUID(), agencyId, staffId],
    ),
  );
  const p = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){salary}}',
    { staff: staffId },
  );
  assert.ok(
    p.errors,
    'Conflicting preconfigured boundaries must be resolved explicitly, never silently pick the earliest',
  );
});
test('final employment bounds every pay segment and fixed monthly salary can end midmonth without automatic proration', async () => {
  const cookie = await api.agency(),
    today = '2026-01-20',
    month = '2026-01',
    first = month + '-01';
  for (const fixed of [false, true]) {
    const staffId = (
      await api.query(
        cookie,
        `mutation{saveStaff(input:{name:"Final ${fixed}",staffCode:"FINAL${fixed}",phone:"9876543210",status:ACTIVE}){id}}`,
      )
    ).data.saveStaff.id;
    let lastId = '',
      firstId = '';
    const segments = fixed
      ? [[first, null, '100']]
      : [
          [first, month + '-05', '3000'],
          [month + '-06', null, '3300'],
        ];
    for (const [startDate, endDate, salary] of segments) {
      const r = await api.query(
        cookie,
        'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            staffId,
            startDate,
            endDate,
            employmentStart: first,
            mode: 'SALARY',
            monthlySalary: salary,
            copyRate: '0',
            routeAllowance: '0',
            proration: fixed ? 'UNPRORATED' : 'CALENDAR_DAYS',
          },
        },
      );
      assert.ok(r.data?.savePayRule, JSON.stringify(r));
      lastId = r.data.savePayRule.id;
      firstId ||= lastId;
    }
    const end = await api.query(
      cookie,
      'mutation($input:EndPayRuleInput!){endPayRule(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          ruleId: lastId,
          endDate: today,
          endEmployment: true,
          reason: 'Employment actually ended today',
        },
      },
    );
    assert.ok(end.data?.endPayRule, JSON.stringify(end));
    if (!fixed) {
      const conflict = await api.query(
        cookie,
        'mutation($input:EndPayRuleInput!){endPayRule(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            ruleId: firstId,
            endDate: month + '-05',
            endEmployment: true,
            reason: 'Conflicting earlier employment end',
          },
        },
      );
      assert.ok(
        conflict.errors,
        'A confirmed employment end must apply consistently to every pay segment',
      );
    }
    const p = await api.query(
      cookie,
      'query($staff:ID!,$month:String!){payrollPreview(staffId:$staff,month:$month){fingerprint salary}}',
      { staff: staffId, month },
    );
    assert.ok(p.data?.payrollPreview, JSON.stringify(p));
    if (fixed) assert.equal(p.data.payrollPreview.salary, '100.00');
    const post = await api.query(
      cookie,
      'mutation($input:PayslipInput!){postPayslip(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          staffId,
          month,
          fingerprint: p.data.payrollPreview.fingerprint,
          acknowledgeMissing: true,
        },
      },
    );
    assert.ok(post.data?.postPayslip, JSON.stringify(post));
  }
  const report = await api.query(
    cookie,
    'query{agencyAnalytics(input:{month:"2026-01"}){payroll{postedExpense unallocatedExpense attributableRouteExpense actualPayouts unsupportedPayslips coverage}}}',
  );
  assert.ok(report.data?.agencyAnalytics, JSON.stringify(report));
  // All pay in this fixture is salary; neither attendance nor a missing delivery run invents a route cost.
  assert.equal(
    report.data.agencyAnalytics.payroll.attributableRouteExpense,
    '0.00',
  );
  assert.equal(report.data.agencyAnalytics.payroll.actualPayouts, '0.00');
  assert.equal(
    report.data.agencyAnalytics.payroll.unallocatedExpense,
    report.data.agencyAnalytics.payroll.postedExpense,
  );
  assert.equal(report.data.agencyAnalytics.payroll.unsupportedPayslips, '0');
  assert.equal(report.data.agencyAnalytics.payroll.coverage, 'COMPLETE');
});
test('former staff can receive a current-period correction without inventing employment or rewriting the final payslip', async () => {
  const cookie = await api.agency(),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Former Staff",staffCode:"EX1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  await api.query(
    cookie,
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        employmentStart: '2026-01-01',
        employmentEnd: '2026-01-31',
        mode: 'SALARY',
        monthlySalary: '100',
        copyRate: '0',
        routeAllowance: '0',
        proration: 'CALENDAR_DAYS',
      },
    },
  );
  const pq =
    'query($staff:ID!,$month:String!){payrollPreview(staffId:$staff,month:$month){fingerprint salary adjustment net}}';
  const january = (
    await api.query(cookie, pq, { staff: staffId, month: '2026-01' })
  ).data.payrollPreview;
  const final = await api.query(
    cookie,
    'mutation($input:PayslipInput!){postPayslip(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        month: '2026-01',
        fingerprint: january.fingerprint,
        acknowledgeMissing: true,
      },
    },
  );
  assert.ok(final.data?.postPayslip, JSON.stringify(final));
  await api.query(
    cookie,
    'mutation($input:PayrollAdjustmentInput!){recordPayrollAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        direction: 'CREDIT',
        amount: '25',
        reason: 'Late approved commission earned before departure',
      },
    },
  );
  const current = await api.query(cookie, pq, {
    staff: staffId,
    month: today.slice(0, 7),
  });
  assert.ok(current.data?.payrollPreview, JSON.stringify(current));
  assert.equal(current.data.payrollPreview.salary, '0.00');
  assert.equal(current.data.payrollPreview.net, '25.00');
  const posted = await api.query(
    cookie,
    'mutation($input:PayslipInput!){postPayslip(input:$input){id net}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        month: today.slice(0, 7),
        fingerprint: current.data.payrollPreview.fingerprint,
        acknowledgeMissing: false,
      },
    },
  );
  assert.ok(posted.data?.postPayslip, JSON.stringify(posted));
});
test('final employment does not permit posting future payroll and an uncovered employment interval is unknown pay', async () => {
  const cookie = await api.agency();
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Final Staff",staffCode:"FIN1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  await api.query(
    cookie,
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        startDate: '2026-01-15',
        employmentStart: '2026-01-01',
        employmentEnd: '2026-01-31',
        mode: 'SALARY',
        monthlySalary: '100',
        copyRate: '0',
        routeAllowance: '0',
        proration: 'CALENDAR_DAYS',
      },
    },
  );
  const gap = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){salary}}',
    { staff: staffId },
  );
  assert.ok(
    gap.errors,
    'The first fourteen employed days have no pay rule; do not silently price them at zero',
  );
  const p = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2030-01"){fingerprint}}',
    { staff: staffId },
  );
  assert.ok(p.data?.payrollPreview, JSON.stringify(p));
  const post = await api.query(
    cookie,
    'mutation($input:PayslipInput!){postPayslip(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        month: '2030-01',
        fingerprint: p.data.payrollPreview.fingerprint,
        acknowledgeMissing: true,
      },
    },
  );
  assert.ok(
    post.errors,
    'Past final employment must not unlock future payroll months',
  );
});
test('reasoned current payroll correction is visible separately from wages and preserves the original posted period', async () => {
  const cookie = await api.agency(),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Correction Staff",staffCode:"COR1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  await api.query(
    cookie,
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        startDate: '2026-01-01',
        employmentStart: '2026-01-01',
        mode: 'SALARY',
        monthlySalary: '100',
        copyRate: '0',
        routeAllowance: '0',
        proration: 'CALENDAR_DAYS',
      },
    },
  );
  const input = {
    requestId: randomUUID(),
    staffId,
    direction: 'CREDIT',
    amount: '25.00',
    reason: 'Approved late commission correction from earlier posted month',
  };
  const result = await api.query(
    cookie,
    'mutation($input:PayrollAdjustmentInput!){recordPayrollAdjustment(input:$input){id}}',
    { input },
  );
  assert.ok(result.data?.recordPayrollAdjustment, JSON.stringify(result));
  const p = await api.query(
    cookie,
    'query($staff:ID!,$month:String!){payrollPreview(staffId:$staff,month:$month){salary adjustment net}}',
    { staff: staffId, month: today.slice(0, 7) },
  );
  assert.equal(p.data.payrollPreview.salary, '100.00');
  assert.equal(p.data.payrollPreview.adjustment, '25.00');
  assert.equal(p.data.payrollPreview.net, '125.00');
  const records = await api.query(
    cookie,
    'query($staff:ID!){payrollRecords(staffId:$staff){rules{id startDate} attendance{id} funds{id} adjustments{id amount}}}',
    { staff: staffId },
  );
  assert.ok(records.data?.payrollRecords, JSON.stringify(records));
  assert.equal(records.data.payrollRecords.adjustments[0].amount, '25.00');
});
test('substitute earns original delivered copies once, replacement earns no extra and advances carry beyond one payslip', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const staffIds: string[] = [];
  for (const code of ['PERM', 'SUB'])
    staffIds.push(
      (
        await api.query(
          cookie,
          `mutation{saveStaff(input:{name:"${code}",staffCode:"${code}",phone:"9876543210",status:ACTIVE}){id}}`,
        )
      ).data.saveStaff.id,
    );
  const routes = (await api.query(cookie, '{routes{id version territoryId}}'))
    .data.routes;
  const assigned = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
    {
      input: {
        id: route.id,
        version: routes[0].version,
        territoryId: routes[0].territoryId,
        code: 'R01',
        name: 'Lotus',
        staffId: staffIds[0],
      },
    },
  );
  assert.ok(assigned.data?.saveRoute, JSON.stringify(assigned));
  const publication = (
    await api.query(
      cookie,
      'mutation{savePublication(input:{name:"Commission Daily",edition:"Kochi",kind:NEWSPAPER,language:"Malayalam",dispatch:MORNING,frequency:DAILY,publishingDays:[0,1,2,3,4,5,6],weekdayPrice:"8",weekendPrice:"8"}){id}}',
    )
  ).data.savePublication;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Commission Door',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
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
        startDate: '2026-01-01',
        weekdays: [],
        quantity: 3,
      },
    },
  );
  const sub = await api.query(
    cookie,
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
    {
      input: {
        routeId: route.id,
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        reason: 'Cover permanent staff leave',
        allocations: [{ staffId: staffIds[1], fromDrop: 1, toDrop: 99999 }],
      },
    },
  );
  assert.ok(sub.data?.assignSubstitutes, JSON.stringify(sub));
  await api.query(
    cookie,
    'mutation{markScheduledDeliveries(date:"2026-01-01"){total}}',
  );
  const logs = (
    await api.query(cookie, '{deliveryLogs(date:"2026-01-01"){id staffId}}')
  ).data.deliveryLogs;
  assert.equal(logs[0].staffId, staffIds[1]);
  const complaint = await api.query(
    cookie,
    'mutation($input:ComplaintInput!){recordComplaint(input:$input){id version}}',
    {
      input: {
        requestId: randomUUID(),
        deliveryId: logs[0].id,
        kind: 'DAMAGED',
        note: 'Original damaged copy replaced',
      },
    },
  );
  const resolution = await api.query(
    cookie,
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        id: complaint.data.recordComplaint.id,
        version: complaint.data.recordComplaint.version,
        resolution: 'REPLACEMENT',
        note: 'Original copies replaced',
      },
    },
  );
  assert.ok(resolution.data?.resolveComplaint, JSON.stringify(resolution));
  for (const staffId of staffIds)
    await api.query(
      cookie,
      'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          staffId,
          startDate: '2026-01-01',
          employmentStart: '2026-01-01',
          mode: 'PER_COPY',
          monthlySalary: '0',
          copyRate: '0.75',
          routeAllowance: '10',
          proration: 'CALENDAR_DAYS',
        },
      },
    );
  const attendance = await api.query(
    cookie,
    'mutation($input:AttendanceInput!){recordAttendance(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId: staffIds[1],
        date: '2026-01-01',
        status: 'PRESENT',
        note: 'Substitute worked the route',
      },
    },
  );
  assert.ok(attendance.data?.recordAttendance, JSON.stringify(attendance));
  const previewQuery =
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){fingerprint commission routeAllowance advance net}}';
  const permanent = await api.query(cookie, previewQuery, {
    staff: staffIds[0],
  });
  assert.equal(permanent.data.payrollPreview.commission, '0.00');
  await api.query(
    cookie,
    'mutation($input:StaffFundsInput!){recordStaffFunds(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId: staffIds[1],
        date: '2026-01-01',
        kind: 'ADVANCE',
        amount: '20',
        method: 'CASH',
        confirmReceived: true,
        evidence: 'Advance disbursed before work',
      },
    },
  );
  const p = (await api.query(cookie, previewQuery, { staff: staffIds[1] })).data
    .payrollPreview;
  assert.equal(p.commission, '2.25');
  assert.equal(p.advance, '12.25');
  assert.equal(p.routeAllowance, '10.00');
  assert.equal(p.net, '0.00');
  const posted = await api.query(
    cookie,
    'mutation($input:PayslipInput!){postPayslip(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId: staffIds[1],
        month: '2026-01',
        fingerprint: p.fingerprint,
        acknowledgeMissing: true,
      },
    },
  );
  assert.ok(posted.data?.postPayslip, JSON.stringify(posted));
  const analytic = await api.query(
    cookie,
    'query{agencyAnalytics(input:{month:"2026-01"}){routes{routeId postedPayroll payrollCopiesWithoutPostedCost payrollCoverage} payroll{postedExpense unallocatedExpense attributableRouteExpense actualPayouts}}}',
  );
  assert.ok(analytic.data?.agencyAnalytics, JSON.stringify(analytic));
  assert.deepEqual(analytic.data.agencyAnalytics.routes, [
    {
      routeId: route.id,
      postedPayroll: '12.25',
      payrollCopiesWithoutPostedCost: '0',
      payrollCoverage: 'COMPLETE',
    },
  ]);
  assert.deepEqual(analytic.data.agencyAnalytics.payroll, {
    postedExpense: '12.25',
    unallocatedExpense: '0.00',
    attributableRouteExpense: '12.25',
    actualPayouts: '0.00',
  });
  const balances = await api.query(
    cookie,
    'query($staff:ID!){payrollRecords(staffId:$staff){funds{remaining}}}',
    { staff: staffIds[1] },
  );
  assert.equal(balances.data.payrollRecords.funds[0].remaining, '7.75');
  const next = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-02"){advance net}}',
    { staff: staffIds[1] },
  );
  assert.equal(next.data.payrollPreview.advance, '0.00');
});

test('calendar salary preserves paid leave, deducts unpaid leave and claims advances once without treating a posted slip as paid', async () => {
  const cookie = await api.agency();
  const staff = await api.query(
    cookie,
    'mutation{saveStaff(input:{name:"Salary Staff",staffCode:"PAY1",phone:"9876543210",status:ACTIVE}){id}}',
  );
  assert.ok(staff.data?.saveStaff, JSON.stringify(staff));
  const staffId = staff.data.saveStaff.id;
  const rule = await api.query(
    cookie,
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        startDate: '2026-01-01',
        employmentStart: '2026-01-01',
        mode: 'SALARY',
        monthlySalary: '3100.00',
        copyRate: '0',
        routeAllowance: '0',
        proration: 'CALENDAR_DAYS',
      },
    },
  );
  assert.ok(rule.data?.savePayRule, JSON.stringify(rule));
  for (const [date, status] of [
    ['2026-01-02', 'PAID_LEAVE'],
    ['2026-01-03', 'UNPAID_LEAVE'],
  ]) {
    const r = await api.query(
      cookie,
      'mutation($input:AttendanceInput!){recordAttendance(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          staffId,
          date,
          status,
          note: 'Owner attendance record',
        },
      },
    );
    assert.ok(r.data?.recordAttendance, JSON.stringify(r));
  }
  for (const [kind, amount] of [
    ['ADVANCE', '500.00'],
    ['REIMBURSEMENT', '75.00'],
  ]) {
    const r = await api.query(
      cookie,
      'mutation($input:StaffFundsInput!){recordStaffFunds(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          staffId,
          date: '2026-01-05',
          kind,
          amount,
          method: 'CASH',
          confirmReceived: kind === 'ADVANCE',
          approveExpense: kind === 'REIMBURSEMENT',
          evidence:
            kind === 'ADVANCE'
              ? 'Cash advance counted by owner'
              : 'Unpaid expense claim approved by owner',
        },
      },
    );
    assert.ok(r.data?.recordStaffFunds, JSON.stringify(r));
  }
  const preview = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){fingerprint salary commission routeAllowance advance reimbursement net missingDays}}',
    { staff: staffId },
  );
  assert.ok(preview.data?.payrollPreview, JSON.stringify(preview));
  const p = preview.data.payrollPreview;
  assert.equal(p.salary, '3000.00');
  assert.equal(p.advance, '500.00');
  assert.equal(p.reimbursement, '75.00');
  assert.equal(p.net, '2575.00');
  assert.equal(p.missingDays, 29);
  const input = {
    requestId: randomUUID(),
    staffId,
    month: '2026-01',
    fingerprint: p.fingerprint,
    acknowledgeMissing: true,
  };
  const mutation =
    'mutation($input:PayslipInput!){postPayslip(input:$input){id net paid snapshot}}';
  const changed = await api.query(
    cookie,
    'mutation($input:AttendanceInput!){recordAttendance(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        date: '2026-01-04',
        status: 'PRESENT',
        note: 'Attendance verified after original preview',
      },
    },
  );
  assert.ok(changed.data?.recordAttendance, JSON.stringify(changed));
  const stale = await api.query(cookie, mutation, { input });
  assert.ok(
    stale.errors,
    'A changed attendance source must invalidate the original payroll preview',
  );
  const refreshed = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){fingerprint}}',
    { staff: staffId },
  );
  input.fingerprint = refreshed.data.payrollPreview.fingerprint;
  const first = await api.query(cookie, mutation, { input });
  assert.ok(first.data?.postPayslip, JSON.stringify(first));
  assert.equal(first.data.postPayslip.paid, false);
  const lockedAttendance = await api.query(
    cookie,
    'mutation($input:AttendanceInput!){recordAttendance(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        date: '2026-01-04',
        status: 'ABSENT',
        note: 'Attempting to overwrite posted attendance',
      },
    },
  );
  assert.ok(lockedAttendance.errors);
  const again = await api.query(cookie, mutation, { input });
  assert.equal(again.data.postPayslip.id, first.data.postPayslip.id);
  const payout = await api.query(
    cookie,
    'mutation($input:PayrollPayoutInput!){recordPayrollPayout(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        payslipId: first.data.postPayslip.id,
        method: 'CASH',
        confirmReceived: true,
        evidence: 'Owner counted full salary paid',
      },
    },
  );
  assert.ok(payout.data?.recordPayrollPayout, JSON.stringify(payout));
  const paidReplay = await api.query(cookie, mutation, { input });
  assert.equal(
    paidReplay.data.postPayslip.paid,
    true,
    'Replaying posted payslip must show its actual confirmed payout status',
  );
  const next = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-02"){advance reimbursement}}',
    { staff: staffId },
  );
  assert.equal(next.data.payrollPreview.advance, '0.00');
  assert.equal(next.data.payrollPreview.reimbursement, '0.00');
  const other = await api.agency();
  const leak = await api.query(
    other,
    'query($staff:ID!){payslips(staffId:$staff){id}}',
    { staff: staffId },
  );
  assert.equal(leak.data?.payslips?.length ?? 0, 0);
});

test('owner can end an open-ended rule; missing preparation is explicit and prevents unacknowledged payroll posting', async () => {
  const cookie = await api.agency();
  const staffId = (
    await api.query(
      cookie,
      'mutation{saveStaff(input:{name:"Commission Staff",staffCode:"PAY2",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff.id;
  const rule = await api.query(
    cookie,
    'mutation($input:PayRuleInput!){savePayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        startDate: '2026-01-01',
        employmentStart: '2026-01-01',
        mode: 'PER_COPY',
        monthlySalary: '0',
        copyRate: '0.75',
        routeAllowance: '0',
        proration: 'CALENDAR_DAYS',
      },
    },
  );
  assert.ok(rule.data?.savePayRule, JSON.stringify(rule));
  const end = await api.query(
    cookie,
    'mutation($input:EndPayRuleInput!){endPayRule(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        ruleId: rule.data.savePayRule.id,
        endDate: '2026-01-31',
        reason: 'Owner confirms employment ended',
        endEmployment: true,
      },
    },
  );
  assert.ok(end.data?.endPayRule, JSON.stringify(end));
  const rules = await api.query(
    cookie,
    'query($staff:ID!){payrollRecords(staffId:$staff){rules{employmentEnd}}}',
    { staff: staffId },
  );
  assert.equal(rules.data.payrollRecords.rules[0].employmentEnd, '2026-01-31');
  const p = await api.query(
    cookie,
    'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){fingerprint missingPreparedDays}}',
    { staff: staffId },
  );
  assert.ok(p.data?.payrollPreview, JSON.stringify(p));
  assert.equal(p.data.payrollPreview.missingPreparedDays, 31);
  const result = await api.query(
    cookie,
    'mutation($input:PayslipInput!){postPayslip(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        staffId,
        month: '2026-01',
        fingerprint: p.data.payrollPreview.fingerprint,
        acknowledgeMissing: false,
      },
    },
  );
  assert.ok(result.errors);
});

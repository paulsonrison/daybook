import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('recovered return handover clears its draft so the originals cannot be submitted a second time', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
      page,
      baseURL!,
      `return-recovery-${crypto.randomUUID()}@example.test`,
    ),
    today = (await f.query('{deliveryMetrics{today}}')).data.deliveryMetrics
      .today;
  const staff = (
    await f.query(
      'mutation{saveStaff(input:{name:"Return Collector",staffCode:"RC1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff;
  const publisher = (
    await f.query(
      'mutation{savePublisher(input:{name:"Return Press",phone:"9876543210",returnCutoff:"23:59",returnWindowDays:1}){id}}',
    )
  ).data.savePublisher;
  const publication = (
    await f.query(
      'mutation{savePublication(input:{name:"Recovery Daily",edition:"Kochi",kind:NEWSPAPER,language:"Malayalam",dispatch:MORNING,frequency:DAILY,publishingDays:[0,1,2,3,4,5,6],weekdayPrice:"8",weekendPrice:"8"}){id}}',
    )
  ).data.savePublication;
  const lot = (
    await f.query(
      'mutation($input:SupplyInput!){receiveSupply(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          publisherId: publisher.id,
          publicationId: publication.id,
          date: today,
          quantity: 10,
          netCost: '6',
        },
      },
    )
  ).data.receiveSupply;
  await page.goto('/cash');
  await page.getByLabel('Handover staff').selectOption(staff.id);
  await page.getByLabel('Handover route').selectOption(f.route.id);
  await page
    .getByLabel('Returned publication lot (optional)')
    .selectOption(lot.id);
  await page.getByLabel('Actual cash received').fill('0');
  await page.getByLabel('Original copies returned').fill('2');
  await page
    .getByLabel('Return reason', { exact: false })
    .fill('Unsold originals');
  await page
    .getByLabel('Handover sign-off')
    .fill('Owner received two originals');
  let lost = true;
  await page.route('**/api/graphql', async (route) => {
    if (
      route.request().postDataJSON()?.query?.includes('recordHandover') &&
      lost
    ) {
      lost = false;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page
    .getByRole('button', { name: 'Sign handover', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check original operation', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel('Returned publication lot (optional)'),
  ).toHaveValue('');
  const lots = await f.query('{supplyLots{returned}}');
  expect(lots.data.supplyLots[0].returned).toBe(2);
});
test('failed cash date change does not expose the previous date as an editable register', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `cashdate-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/cash');
  await expect(
    page.getByRole('button', { name: 'Sign cash close', exact: true }),
  ).toBeVisible();
  await page.route('**/api/graphql', async (route) => {
    if (route.request().postDataJSON()?.query?.includes('cashDay'))
      await route.fulfill({
        json: { errors: [{ message: 'Selected date unavailable' }] },
      });
    else await route.continue();
  });
  await page.getByLabel('Cash register date').fill('2026-01-01');
  await expect(
    page.getByText('Selected date unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign cash close', exact: true }),
  ).toHaveCount(0);
});
test('staff selection remains fixed while its payroll calculation is in flight', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `preview-${crypto.randomUUID()}@example.test`,
  );
  const staff = (
    await f.query(
      'mutation{saveStaff(input:{name:"Preview Staff",staffCode:"PR1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff;
  await page.goto('/payroll');
  await page.getByLabel('Staff member', { exact: true }).selectOption(staff.id);
  await page.getByLabel('Payroll month').fill('2026-01');
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/graphql', async (route) => {
    if (route.request().postDataJSON()?.query?.includes('payrollPreview')) {
      await gate;
      await route.continue();
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Calculate pay', exact: true })
    .click();
  try {
    await expect(
      page.getByLabel('Staff member', { exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
});
test('recovered salary advance cannot be submitted again without an explicit new entry', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `advance-${crypto.randomUUID()}@example.test`,
  );
  const staff = (
    await f.query(
      'mutation{saveStaff(input:{name:"Recovery Staff",staffCode:"REC1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff;
  await page.goto('/payroll');
  await page.getByLabel('Staff member', { exact: true }).selectOption(staff.id);
  await page.getByLabel('Advance amount').fill('25');
  await page.getByLabel('I confirm the advance was actually disbursed').check();
  await page
    .getByLabel('Advance confirmation evidence')
    .fill('Counted cash advance');
  let lost = true;
  const ids: string[] = [];
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.query?.includes('recordStaffFunds')) {
      ids.push(body.variables.input.requestId);
      if (lost) {
        lost = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page
    .getByRole('button', { name: 'Record advance', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check original operation', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record advance', exact: true }),
  ).toBeDisabled();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});
test('failed cash submission retains unrelated closing and outflow drafts', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `drafts-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/cash');
  await page.getByLabel('Opening cash').fill('123.45');
  await page.getByLabel('Counted drawer cash').fill('123.45');
  await page.getByLabel('Cash outflow amount').fill('0');
  await page
    .getByLabel('Cash outflow reason')
    .fill('Invalid amount retained for correction');
  await page
    .getByRole('button', { name: 'Record cash outflow', exact: true })
    .click();
  await expect(
    page.getByText('Cash records need attention', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Opening cash')).toHaveValue('123.45');
  await expect(page.getByLabel('Cash outflow reason')).toHaveValue(
    'Invalid amount retained for correction',
  );
});
test('owner configures salary, previews an unpaid payslip, records handover and signs the exact drawer count', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `staffcash-${crypto.randomUUID()}@example.test`,
  );
  const staff = (
    await f.query(
      'mutation{saveStaff(input:{name:"Pay Collector",staffCode:"PC1",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).data.saveStaff;
  await page.goto('/payroll');
  await expect(
    page.getByRole('heading', { name: 'Staff pay & attendance', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Staff member', { exact: true }).selectOption(staff.id);
  await page.getByLabel('Rule starts').fill('2026-01-01');
  await page.getByLabel('Employment starts').fill('2026-01-01');
  await page.getByLabel('Monthly salary').fill('3100.00');
  await page
    .getByRole('button', { name: 'Save pay rule', exact: true })
    .click();
  await expect(
    page.getByText('Operation recorded', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Payroll month').fill('2026-01');
  await page
    .getByRole('button', { name: 'Calculate pay', exact: true })
    .click();
  await expect(page.getByTestId('payroll-net')).toContainText('3,100.00');
  await page
    .getByLabel('I reviewed missing attendance and preparation')
    .check();
  await page.getByRole('button', { name: 'Post payslip', exact: true }).click();
  await expect(
    page.getByText('Awaiting payout', { exact: true }),
  ).toBeVisible();
  const today = (await f.query('{deliveryMetrics{today}}')).data.deliveryMetrics
    .today;
  const payment = (
    await f.query(
      'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          residentId: f.residents[0].id,
          purpose: 'ACCOUNT',
          method: 'CASH',
          amount: '100',
          date: today,
          confirmReceived: true,
          confirmationNote: 'Field cash confirmed',
        },
      },
    )
  ).data.recordPayment;
  await f.query(
    'mutation($input:CollectionCustodyInput!){classifyCollection(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        paymentId: payment.id,
        custody: 'STAFF',
        staffId: staff.id,
        routeId: f.route.id,
        reason: 'Explicit collector custody',
      },
    },
  );
  await page.goto('/cash');
  await expect(
    page.getByRole('heading', { name: 'Cash handover & closing', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Handover staff').selectOption(staff.id);
  await page.getByLabel('Handover route').selectOption(f.route.id);
  await page.getByLabel('Actual cash received').fill('90');
  await page
    .getByLabel('Handover sign-off')
    .fill('Owner counted ninety; ten held in agency suspense');
  await page
    .getByRole('button', { name: 'Sign handover', exact: true })
    .click();
  await expect(page.getByTestId('cash-movement')).toContainText('90.00');
  await page.getByLabel('Opening cash').fill('0');
  await page.getByLabel('Counted drawer cash').fill('90');
  await page.getByLabel('Bank deposit at closing').fill('0');
  await page
    .getByLabel('Closing reason')
    .fill('Shortage memo remains separate');
  await page.getByLabel('Closing sign-off').fill('Owner counted and signed');
  await page
    .getByRole('button', { name: 'Sign cash close', exact: true })
    .click();
  await expect(
    page.getByText('Cash day signed', { exact: true }),
  ).toBeVisible();
});

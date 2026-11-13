import { test, expect } from '@playwright/test';
test('agent records partial and full funds, reconciles pending UPI, and clears a refundable resident account', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Payment Browser',
      name: 'Owner',
      email: 'payment-browser@example.test',
      password: 'Payment browser password 123',
    },
  });
  async function query(query: string, variables: Record<string, unknown> = {}) {
    return (
      await page.request.post('/api/graphql', {
        headers: { origin },
        data: { query, variables },
      })
    ).json();
  }
  const today = (await query('{deliveryMetrics{today}}')).data.deliveryMetrics
      .today,
    territory = (
      await query(
        'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus"]}){id}}',
      )
    ).data.saveTerritory,
    route = (
      await query(
        'mutation($id:ID!){saveRoute(input:{code:"P01",name:"Lotus",territoryId:$id}){id}}',
        { id: territory.id },
      )
    ).data.saveRoute;
  const resident = (
    await query(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          name: 'Payment Resident',
          address: '12 Lotus',
          phone: '9876543210',
          routeId: route.id,
          sector: 'Lotus',
          dropOrder: 1,
          openingDeposit: '500.25',
        },
      },
    )
  ).data.saveResident;
  const publication = (
    await query(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Payment Daily',
          edition: 'Kochi',
          language: 'Malayalam',
          kind: 'NEWSPAPER',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '7',
          weekendPrice: '7',
        },
      },
    )
  ).data.savePublication;
  await query(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: today,
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await query(
    'mutation($date:String!){markScheduledDeliveries(date:$date){created} saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
    { date: today },
  );
  const billInput = {
      residentId: resident.id,
      periodMode: 'CUSTOM',
      periods: [{ from: today, to: today }],
    },
    preview = (
      await query(
        'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
        { input: billInput },
      )
    ).data.previewBill;
  await query(
    'mutation($input:InvoiceInput!){generateInvoice(input:$input){id}}',
    {
      input: {
        ...billInput,
        requestId: crypto.randomUUID(),
        previewFingerprint: preview.fingerprint,
      },
    },
  );
  await page.goto('/payments');
  await expect(
    page.getByRole('heading', { name: 'Payments & accounts', exact: true }),
  ).toBeVisible();
  async function cash(amount: string) {
    await page.getByLabel('Payment amount').fill(amount);
    await page
      .getByLabel('I confirmed these funds were received', { exact: true })
      .check();
    await page
      .getByLabel('Confirmation evidence')
      .fill('Counted cash received in person');
    await page
      .getByRole('button', { name: 'Record payment', exact: true })
      .click();
  }
  await cash('3.00');
  await expect(
    page.getByRole('heading', {
      name: 'Partial payment recorded',
      exact: true,
    }),
  ).toBeVisible();
  await cash('4.00');
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  const earlierReceipt = page.getByRole('button', {
    name: 'View receipt RCP-0001',
    exact: true,
  });
  await expect(earlierReceipt).toBeVisible();
  await earlierReceipt.click();
  await expect(
    page.getByRole('heading', {
      name: 'Partial payment recorded',
      exact: true,
    }),
  ).toBeVisible();
  await query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'CORRECTION',
        amount: '20',
        reason: 'Additional agreed account charge',
      },
    },
  );
  await page.reload();
  await page.getByLabel('Payment method', { exact: true }).selectOption('UPI');
  await page.getByLabel('Payment amount').fill('20.00');
  await page
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(
    page.getByText('Payment pending confirmation', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Reconcile payment/ }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Transaction reference', { exact: true })
    .fill('BROWSERUPI20');
  await page
    .getByRole('dialog')
    .getByLabel('Reconciliation evidence')
    .fill('Verified in agency bank statement');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm reconciliation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Prepare account clearance', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Calculate clearance', exact: true })
    .click();
  await expect(
    page.getByText('Refund due ₹500.25', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Archive account and apply deposit',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Account archived', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Record confirmed refund', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Refund method', { exact: true })
    .selectOption('BANK');
  await page
    .getByRole('dialog')
    .getByLabel('Refund reference', { exact: true })
    .fill('BROWSERREFUND50025');
  await page
    .getByRole('dialog')
    .getByLabel('Refund confirmation evidence')
    .fill('Verified refund debit in bank statement');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm funds returned', exact: true })
    .click();
  await expect(
    page.getByText('Refund recorded', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record payment', exact: true }),
  ).toBeEnabled();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('heading', { name: 'Refund receipt', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'CORRECTION',
        amount: '5.00',
        reason: 'Late agreed account charge',
      },
    },
  );
  await cash('5.00');
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record payment', exact: true }),
  ).toBeEnabled();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Refund receipt', exact: true }),
  ).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.reload();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
});

test('unconfirmed cash receipt survives refresh and resolves the original request without a second receipt or stale paid state', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Recovery Browser',
      name: 'Owner',
      email: 'payment-recovery@example.test',
      password: 'Payment recovery password 123',
    },
  });
  async function query(query: string, variables: Record<string, unknown> = {}) {
    return (
      await page.request.post('/api/graphql', {
        headers: { origin },
        data: { query, variables },
      })
    ).json();
  }
  const territory = (
      await query(
        'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus"]}){id}}',
      )
    ).data.saveTerritory,
    route = (
      await query(
        'mutation($id:ID!){saveRoute(input:{code:"U01",name:"Lotus",territoryId:$id}){id}}',
        { id: territory.id },
      )
    ).data.saveRoute,
    resident = (
      await query(
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: crypto.randomUUID(),
            name: 'Recovery Resident',
            address: '12 Lotus',
            phone: '9876543210',
            routeId: route.id,
            sector: 'Lotus',
            dropOrder: 1,
          },
        },
      )
    ).data.saveResident;
  async function debt(amount: string) {
    await query(
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          residentId: resident.id,
          direction: 'DEBIT',
          category: 'OPENING',
          amount,
          reason: 'Imported outstanding balance',
        },
      },
    );
  }
  await debt('12.00');
  await page.goto('/payments');
  async function cash(amount: string) {
    await page.getByLabel('Payment amount').fill(amount);
    await page
      .getByLabel('I confirmed these funds were received', { exact: true })
      .check();
    await page
      .getByLabel('Confirmation evidence')
      .fill('Cash counted in person');
    await page
      .getByRole('button', { name: 'Record payment', exact: true })
      .click();
  }
  await cash('12.00');
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  await debt('6.00');
  let loseReply = true;
  const requestIds: string[] = [];
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.query?.includes('recordPayment')) {
      requestIds.push(body.variables.input.requestId);
      if (loseReply) {
        loseReply = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await cash('6.00');
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record payment', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check original operation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).toBeVisible();
  assertSameRequest();
  function assertSameRequest() {
    expect(requestIds.length).toBe(2);
    expect(new Set(requestIds).size).toBe(1);
  }
  const payments = (await query('{payments{id receiptCode status amount}}'))
    .data.payments;
  expect(payments).toHaveLength(2);
  expect(
    payments.filter((p: { amount: string }) => p.amount === '6.00'),
  ).toHaveLength(1);
  await expect(page.getByLabel('Payment amount')).toHaveValue('');
});

test('empty account selection remains recoverable', async ({
  page,
  baseURL,
}) => {
  const { financialBrowser } = await import('./financial-support');
  const f = await financialBrowser(
    page,
    baseURL!,
    'empty-selection@example.test',
  );
  await page.goto('/payments');
  await expect(page.getByLabel('Payment amount')).toBeVisible();
  const select = page.getByLabel('Resident account', { exact: true });
  await select.selectOption('');
  await expect(select).toBeEnabled();
  await select.selectOption(f.residents[0].id);
  await expect(page.getByLabel('Payment amount')).toBeVisible();
});

test('payment recording fails safely before sending funds data when its recovery record cannot be retained', async ({
  page,
  baseURL,
}) => {
  const { financialBrowser } = await import('./financial-support');
  const f = await financialBrowser(
    page,
    baseURL!,
    'recovery-storage-failure@example.test',
  );
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('daybook:financial-operation:'))
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/payments');
  await page.getByLabel('Payment amount').fill('5.00');
  await page
    .getByLabel('I confirmed these funds were received', { exact: true })
    .check();
  await page.getByLabel('Confirmation evidence').fill('Cash counted in person');
  await page
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Payment recorded', exact: true }),
  ).not.toBeVisible();
  const records = (await f.query('{payments{id}}')).data.payments;
  expect(records).toHaveLength(0);
  await expect(page.getByText(/cannot retain.*recovery record/i)).toBeVisible();
  await expect(page.getByLabel('Payment amount')).toHaveValue('5.00');
});

test('unreadable recovery records keep account history read-only instead of allowing a fresh payment', async ({
  page,
  baseURL,
}) => {
  const { financialBrowser } = await import('./financial-support');
  const f = await financialBrowser(
    page,
    baseURL!,
    'recovery-read-failure@example.test',
  );
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('daybook:financial-operation:'))
        throw new DOMException('Storage unavailable', 'SecurityError');
      return original.call(this, key);
    };
  });
  await page.goto('/payments');
  await expect(page.getByLabel('Payment amount')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record payment', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Payment history', exact: true }),
  ).toBeVisible();
  const records = (await f.query('{payments{id}}')).data.payments;
  expect(records).toHaveLength(0);
});

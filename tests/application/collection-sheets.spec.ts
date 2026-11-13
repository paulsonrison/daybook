import { test, expect } from '@playwright/test';
test('owner configures payment identity, prints a real route QR sheet and records a partial field collection', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Field Collection Browser',
      name: 'Owner',
      email: 'field-collection@example.test',
      password: 'Field collection password 123',
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
        'mutation($id:ID!){saveRoute(input:{code:"C01",name:"Lotus",territoryId:$id}){id}}',
        { id: territory.id },
      )
    ).data.saveRoute,
    resident = (
      await query(
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: crypto.randomUUID(),
            name: 'Field Resident',
            address: '12 Lotus',
            phone: '9876543210',
            routeId: route.id,
            sector: 'Lotus',
            dropOrder: 1,
          },
        },
      )
    ).data.saveResident;
  await query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '20.05',
        reason: 'Imported field collection balance',
      },
    },
  );
  await page.goto('/collection-sheets');
  await expect(
    page.getByRole('heading', { name: 'Route collection sheets', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Agency UPI address').fill('synthetic-field@upi');
  await page.getByLabel('Payee name').fill('Synthetic Field Agency');
  await page
    .getByLabel('I confirm this UPI address belongs to my agency', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: 'Save payment identity', exact: true })
    .click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page
    .getByLabel('Collection route', { exact: true })
    .selectOption(route.id);
  await page
    .getByRole('button', { name: 'Generate collection sheet', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: 'UPI QR for Field Resident' }),
  ).toBeVisible();
  await page.getByLabel('Agency UPI address').fill('synthetic-updated@upi');
  await page
    .getByLabel('I confirm this UPI address belongs to my agency', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: 'Save payment identity', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: 'UPI QR for Field Resident' }),
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Generate collection sheet', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: 'UPI QR for Field Resident' }),
  ).toBeVisible();
  await page.getByLabel('Collect from Field Resident', { exact: true }).check();
  await page.getByLabel('Collected amount for Field Resident').fill('10.00');
  await page
    .getByLabel('Field collection confirmation evidence')
    .fill('Counted cash on returned collection sheet');
  await page
    .getByLabel('I confirmed selected funds were received', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Record selected collections', exact: true })
    .click();
  await expect(
    page.getByText('1 collection recorded', { exact: true }),
  ).toBeVisible();
  const balance = (
    await query('query($id:ID!){residentLedger(residentId:$id){balance}}', {
      id: resident.id,
    })
  ).data.residentLedger.balance;
  expect(balance).toBe('10.05');
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('img', { name: 'UPI QR for Field Resident' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Record selected collections',
      exact: true,
    }),
  ).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('partial collection batch failure preserves all unsubmitted values and identifies the failed row', async ({
  page,
  baseURL,
}) => {
  const { financialBrowser } = await import('./financial-support');
  const f = await financialBrowser(
    page,
    baseURL!,
    'batch-retention@example.test',
    ['Field One', 'Field Two'],
  );
  await page.goto('/collection-sheets');
  await page
    .getByLabel('Collection route', { exact: true })
    .selectOption(f.route.id);
  await page
    .getByRole('button', { name: 'Generate collection sheet', exact: true })
    .click();
  await page.getByLabel('Collect from Field One', { exact: true }).check();
  await page.getByLabel('Collect from Field Two', { exact: true }).check();
  await page.getByLabel('Collected amount for Field One').fill('10.00');
  await page.getByLabel('Collected amount for Field Two').fill('7.25');
  await page.getByLabel('Collection method for Field Two').selectOption('BANK');
  await page
    .getByLabel('I confirmed selected funds were received', { exact: true })
    .check();
  await page
    .getByLabel('Field collection confirmation evidence')
    .fill('Counted cash and reviewed returned field entries');
  await page
    .getByRole('button', { name: 'Record selected collections', exact: true })
    .click();
  await expect(
    page.getByText('1 collection recorded', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Collected amount for Field Two')).toHaveValue(
    '7.25',
  );
  await expect(page.getByLabel('Collection method for Field Two')).toHaveValue(
    'BANK',
  );
  await expect(
    page.getByLabel('Collect from Field Two', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByText('Field Two collection not confirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Collection reference for Field Two')
    .fill('RETAINEDBANK725');
  await page
    .getByRole('button', { name: 'Record selected collections', exact: true })
    .click();
  await expect(
    page.getByLabel('Collect from Field Two', { exact: true }),
  ).not.toBeChecked();
  const account = (
    await f.query('query($id:ID!){residentLedger(residentId:$id){balance}}', {
      id: f.residents[1].id,
    })
  ).data.residentLedger;
  expect(account.balance).toBe('12.80');
});

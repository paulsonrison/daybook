import { test, expect } from '@playwright/test';
test('agent prepares a bill, reviews corrections, saves it and reopens its locked source snapshot', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Billing Browser',
      name: 'Owner',
      email: 'billing-browser@example.test',
      password: 'Billing browser password 123',
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
  ).data.saveTerritory;
  const route = (
    await query(
      'mutation($id:ID!){saveRoute(input:{code:"B01",name:"Lotus",territoryId:$id}){id}}',
      { id: territory.id },
    )
  ).data.saveRoute;
  const resident = (
    await query(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          name: 'Billing Resident',
          address: '12 Lotus',
          phone: '9876543210',
          routeId: route.id,
          sector: 'Lotus',
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const publication = (
    await query(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Billing Daily',
          edition: 'Kochi',
          language: 'Malayalam',
          kind: 'NEWSPAPER',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '7.00',
          weekendPrice: '8.00',
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
        startDate: '2024-01-01',
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await query(
    'mutation{markScheduledDeliveries(date:"2024-01-01"){created} saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
  );
  await page.goto('/collections');
  await expect(
    page.getByRole('heading', { name: 'Collections', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Prepare bill for Billing Resident' })
    .click();
  await page.getByLabel('From date', { exact: true }).fill('2024-01-01');
  await page.getByLabel('To date', { exact: true }).fill('2024-01-01');
  await page.getByRole('button', { name: 'Recalculate bill' }).click();
  await expect(page.getByText('₹7.00', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Rate for Billing Daily').fill('6.25');
  await page
    .getByLabel('Reason for Billing Daily')
    .fill('Agreed rate correction');
  await page.getByRole('button', { name: 'Recalculate bill' }).click();
  await expect(page.getByText('₹6.25', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add credit or surcharge' }).click();
  await page.getByLabel('Adjustment amount 1', { exact: true }).fill('1.00');
  await page
    .getByLabel('Adjustment reason 1', { exact: true })
    .fill('Goodwill credit');
  await page.getByRole('button', { name: 'Recalculate bill' }).click();
  await expect(page.getByText('₹5.25', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save bill', exact: true }).click();
  await expect(page.getByText('Bill saved', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit bill', exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('table', { name: 'Collection run-sheet', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('table', {
      name: 'Publication and delivery details',
      exact: true,
    }),
  ).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.reload();
  await page
    .getByRole('button', { name: /Open DB-/ })
    .first()
    .click();
  await expect(page.getByText('₹5.25', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit bill', exact: true }).click();
  await expect(
    page.getByLabel('Adjustment amount 1', { exact: true }),
  ).toHaveValue('1.00');
});

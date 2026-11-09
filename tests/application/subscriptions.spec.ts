import { test, expect } from '@playwright/test';
test('agent assigns publication, sets vacation and configures effective price', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!,
    request = page.request;
  await request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Subscription Browser',
      name: 'Owner',
      email: 'subscription-browser@example.test',
      password: 'Subscription browser password 123',
    },
  });
  async function query(query: string, variables: Record<string, unknown> = {}) {
    return (
      await request.post('/api/graphql', {
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
      'mutation($id:ID!){saveRoute(input:{code:"S01",name:"Lotus",territoryId:$id}){id}}',
      { id: territory.id },
    )
  ).data.saveRoute;
  const resident = (
    await query(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          name: 'Subscription Resident',
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
          name: 'Morning Daily',
          edition: 'Kochi',
          language: 'Malayalam',
          kind: 'NEWSPAPER',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '8.15',
          weekendPrice: '12.25',
        },
      },
    )
  ).data.savePublication;
  await page.goto('/residents');
  await expect(
    page.getByRole('button', { name: 'Manage subscriptions', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Manage subscriptions', exact: true })
    .click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel(/^Publication/).selectOption(publication.id);
  await panel.getByLabel(/^Delivery cadence/).selectOption('WEEKDAYS');
  await panel.getByLabel(/^Subscription start/).fill('2024-01-01');
  await panel.getByRole('checkbox', { name: 'Monday', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'Wednesday', exact: true }).check();
  await panel
    .getByRole('button', { name: 'Save subscription', exact: true })
    .click();
  await expect(
    panel.getByRole('row').filter({ hasText: 'Morning Daily' }),
  ).toContainText('WEEKDAYS');
  await panel.getByLabel(/^Pause start/).fill('2024-02-01');
  await panel.getByLabel(/^Resume date/).fill('2024-02-10');
  await panel
    .getByRole('button', { name: 'Save vacation hold', exact: true })
    .click();
  await expect(
    panel.getByRole('listitem').filter({ hasText: '2024-02-01 → 2024-02-10' }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Close subscriptions', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Publications & pricing', exact: true })
    .click();
  await page.getByRole('button', { name: 'Price rules', exact: true }).click();
  const prices = page.getByRole('dialog');
  await prices.getByLabel(/^Effective from/).fill('2024-02-01');
  await prices.getByLabel(/^Effective through/).fill('2024-02-29');
  await prices.getByLabel(/^Override price/).fill('15.75');
  await prices
    .getByRole('button', { name: 'Save price rule', exact: true })
    .click();
  await expect(
    prices.getByRole('row').filter({ hasText: '2024-02-01' }),
  ).toContainText('₹15.75');
  const held = await query(
    'query($id:ID!){scheduledCopies(residentId:$id,date:"2024-02-05"){price}}',
    { id: resident.id },
  );
  expect(held.data.scheduledCopies).toEqual([]);
  const resumed = await query(
    'query($id:ID!){scheduledCopies(residentId:$id,date:"2024-02-12"){price}}',
    { id: resident.id },
  );
  expect(resumed.data.scheduledCopies).toEqual([{ price: '15.75' }]);
});

import { test, expect } from '@playwright/test';
test('agent generates a packing slip and records a field delivery exception', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!,
    request = page.request;
  await request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Delivery Browser',
      name: 'Owner',
      email: 'delivery-browser@example.test',
      password: 'Delivery browser password 123',
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
      'mutation($id:ID!){saveRoute(input:{code:"D01",name:"Lotus",territoryId:$id}){id}}',
      { id: territory.id },
    )
  ).data.saveRoute;
  const resident = (
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
  const publication = (
    await query(
      'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
      {
        input: {
          name: 'Field Daily',
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
  const subscription = await query(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: '2024-01-01',
        weekdays: [],
        quantity: 2,
      },
    },
  );
  expect(subscription.data?.saveSubscription).toBeTruthy();
  await page.goto('/delivery');
  await expect(
    page.getByRole('heading', { name: 'Daily delivery log', exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Delivery date/).fill('2024-02-01');
  await page
    .getByRole('button', { name: 'Generate dispatch', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Publisher pickup indent' }),
  ).toContainText('Field Daily');
  await expect(
    page.getByRole('region', { name: 'Publisher pickup indent' }),
  ).toContainText('2');
  const card = page.getByRole('article').filter({ hasText: 'Field Resident' });
  await card.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: 260,
    clientY: 300,
  });
  await card.dispatchEvent('pointerup', {
    pointerType: 'touch',
    clientX: 120,
    clientY: 305,
  });
  await expect(
    page.getByRole('dialog', { name: 'Flag damaged delivery' }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page.getByRole('button', { name: 'Mark missed', exact: true }).click();
  await expect(
    page.getByRole('article').filter({ hasText: 'Field Resident' }),
  ).toContainText('MISSED');
  await page
    .getByRole('button', { name: 'Log complaint', exact: true })
    .click();
  const complaint = page.getByRole('dialog');
  await complaint
    .getByLabel(/^Complaint details/)
    .fill('Resident reported missed delivery');
  await complaint
    .getByRole('button', { name: 'Save complaint', exact: true })
    .click();
  await expect(complaint).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Delivery complaints' }),
  ).toContainText('Field Resident');
  await page
    .getByRole('button', { name: 'Resolve complaint', exact: true })
    .click();
  const resolution = page.getByRole('dialog');
  await resolution
    .getByLabel('Resolution', { exact: true })
    .selectOption('REPLACEMENT');
  await resolution
    .getByLabel(/^Resolution note/)
    .fill('Replacement dispatched');
  await resolution
    .getByRole('button', { name: 'Save resolution', exact: true })
    .click();
  await expect(resolution).not.toBeVisible();
  await expect(
    page.getByRole('article').filter({ hasText: 'Field Resident' }),
  ).toContainText('REPLACED');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Field theme', { exact: true }).selectOption('dark');
  await expect(page.locator('.delivery-field')).toHaveAttribute(
    'data-db-mode',
    'dark',
  );
  const action = page.getByRole('button', {
    name: 'Log complaint',
    exact: true,
  });
  const box = await action.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await page.reload();
  await page.getByLabel(/^Delivery date/).fill('2024-02-01');
  await expect(
    page.getByRole('article').filter({ hasText: 'Field Resident' }),
  ).toContainText('REPLACED');
});

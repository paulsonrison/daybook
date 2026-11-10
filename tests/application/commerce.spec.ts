import { test, expect, type Page } from '@playwright/test';
async function setup(page: Page, origin: string, email: string) {
  const request = page.request;
  await request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Commerce Browser',
      name: 'Owner',
      email,
      password: 'Commerce browser password 123',
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
  const today = (await query('{deliveryMetrics{today}}')).data.deliveryMetrics
    .today;
  const territory = (
    await query(
      'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus"]}){id}}',
    )
  ).data.saveTerritory;
  const route = (
    await query(
      'mutation($id:ID!){saveRoute(input:{code:"C01",name:"Lotus",territoryId:$id}){id}}',
      { id: territory.id },
    )
  ).data.saveRoute;
  const resident = (
    await query(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          name: 'Commerce Resident',
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
          name: 'Commerce Daily',
          edition: 'Kochi',
          language: 'Malayalam',
          kind: 'NEWSPAPER',
          dispatch: 'MORNING',
          frequency: 'DAILY',
          publishingDays: [0, 1, 2, 3, 4, 5, 6],
          weekdayPrice: '8.15',
          weekendPrice: '12.25',
          procurementNetCost: '5.05',
        },
      },
    )
  ).data.savePublication;
  return { today, route, resident, publication, query };
}
test('owner receives publisher supply, returns copies and views exact reconciliation', async ({
  page,
  baseURL,
}) => {
  const f = await setup(page, baseURL!, 'publisher-browser@example.test');
  await page.goto('/publishers');
  await expect(
    page.getByRole('heading', { name: 'Publishers & returns', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Add publisher', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Publisher name/).fill('Daily Publisher');
  await dialog.getByLabel(/^Phone/).fill('9876543210');
  await dialog.getByLabel(/^Return cutoff/).fill('23:59');
  await dialog.getByLabel(/^Return window days/).fill('1');
  await dialog
    .getByRole('button', { name: 'Save publisher', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Receive supply', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(/^Publisher(?: \*)?$/)
    .selectOption({ label: 'Daily Publisher' });
  await dialog
    .getByLabel(/^Publication(?: \*)?$/)
    .selectOption(f.publication.id);
  await dialog.getByLabel(/^Received copies/).fill('10');
  await dialog
    .getByRole('button', { name: 'Save supply', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Publisher supply lots' }),
  ).toContainText('₹50.50');
  await page
    .getByRole('button', { name: 'Record return', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Returned copies/).fill('2');
  await dialog.getByLabel(/^Return reason/).fill('Unsold');
  await dialog
    .getByRole('button', { name: 'Save return', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByLabel('Statement publisher', { exact: true })
    .selectOption({ label: 'Daily Publisher' });
  await page
    .getByRole('button', { name: 'View statement', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Publisher reconciliation' }),
  ).toContainText('₹40.40');
});
test('owner reserves seasonal stock and confirms one invoice charge with packing details', async ({
  page,
  baseURL,
}) => {
  const f = await setup(page, baseURL!, 'stock-browser@example.test');
  await page.goto('/inventory');
  await expect(
    page.getByRole('heading', { name: 'Seasonal stock', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Add seasonal item', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Item name/).fill('Annual Calendar');
  await dialog.getByLabel(/^Stock code/).fill('CAL27');
  await dialog.getByLabel(/^Retail price/).fill('99.95');
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Receive stock', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Received quantity/).fill('2');
  await dialog.getByLabel(/^Stock receipt note/).fill('Publisher stock');
  await dialog
    .getByRole('button', { name: 'Save stock receipt', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'New preorder', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Resident(?: \*)?$/).selectOption(f.resident.id);
  await dialog
    .getByLabel(/^Seasonal item(?: \*)?$/)
    .selectOption({ label: 'Annual Calendar' });
  await dialog.getByLabel(/^Order quantity/).fill('2');
  await dialog
    .getByRole('button', { name: 'Save preorder', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Reserve stock', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Seasonal preorders' }),
  ).toContainText('RESERVED');
  await page
    .getByRole('button', { name: 'Confirm delivery', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Confirm fulfilment', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Seasonal charges' }),
  ).toContainText('₹199.90');
  await page
    .getByRole('link', { name: 'Daily delivery log', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Generate dispatch', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Additional depot items' }),
  ).toContainText('Annual Calendar');
});
test('owner schedules targeted leaflets and issues an advertiser invoice after recorded proof', async ({
  page,
  baseURL,
}) => {
  const f = await setup(page, baseURL!, 'insert-browser@example.test');
  await f.query(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.resident.id,
        publicationId: f.publication.id,
        cadence: 'DAILY',
        startDate: f.today,
        weekdays: [],
        quantity: 2,
      },
    },
  );
  await page.goto('/advertisers');
  await expect(
    page.getByRole('heading', { name: 'Advertisers & inserts', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Add advertiser', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Advertiser name/).fill('Local Store');
  await dialog.getByLabel(/^Phone/).fill('9876543210');
  await dialog.getByLabel(/^Billing address/).fill('Market Road');
  await dialog
    .getByRole('button', { name: 'Save advertiser', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Schedule insert', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(/^Advertiser(?: \*)?$/)
    .selectOption({ label: 'Local Store' });
  await dialog.getByLabel(/^Campaign title/).fill('Local promotion');
  await dialog.getByLabel(/^Price per insert/).fill('1.25');
  await dialog.getByLabel(/^Target route 1(?: \*)?$/).selectOption(f.route.id);
  await dialog
    .getByRole('button', { name: 'Save insert order', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Complete and invoice', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(/^Completion proof reference/)
    .fill('Signed slip DOC-22');
  await dialog
    .getByRole('checkbox', { name: 'Confirm no tax applies', exact: true })
    .check();
  await dialog
    .getByRole('button', { name: 'Issue advertiser invoice', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Advertiser invoices' }),
  ).toContainText('₹1.25');
  await expect(
    page.getByRole('region', { name: 'Advertiser invoices' }),
  ).toContainText('DOC-22');
});

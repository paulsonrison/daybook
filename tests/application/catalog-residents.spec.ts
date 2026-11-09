import { test, expect } from '@playwright/test';
test('owner creates regional publication and resident with an exact refundable deposit', async ({
  page,
  baseURL,
}) => {
  const request = page.request,
    origin = baseURL!;
  expect(
    (
      await request.post(`${origin}/api/auth/register`, {
        headers: { origin },
        data: {
          agencyName: 'Catalog Browser Agency',
          name: 'Catalog Owner',
          email: 'catalog-browser@example.test',
          password: 'Catalog browser password 123',
        },
      })
    ).status(),
  ).toBe(201);
  async function query(query: string, variables: Record<string, unknown> = {}) {
    return (
      await request.post(`${origin}/api/graphql`, {
        headers: { origin },
        data: { query, variables },
      })
    ).json();
  }
  const t = await query(
    'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus Lane"]}){id}}',
  );
  const r = await query(
    'mutation($id:ID!){saveRoute(input:{code:"R01",name:"Morning Lotus",territoryId:$id,stops:[]}){id}}',
    { id: t.data.saveTerritory.id },
  );
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Publications & pricing', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Publications & pricing', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add publication', exact: true })
    .click();
  const publication = page.getByRole('dialog');
  await publication.getByLabel(/^Publication name/).fill('Regional Weekly');
  await publication.getByLabel(/^Edition/).fill('Kochi');
  await publication.getByLabel(/^Publication type/).selectOption('PERIODICAL');
  await publication.getByLabel(/^Language/).fill('Malayalam');
  await publication.getByLabel(/^Dispatch/).selectOption('EVENING');
  await publication.getByLabel(/^Publishing frequency/).selectOption('WEEKLY');
  for (const day of [
    'Sunday',
    'Monday',
    'Tuesday',
    'Thursday',
    'Friday',
    'Saturday',
  ])
    await publication
      .getByRole('checkbox', { name: day, exact: true })
      .uncheck();
  await publication
    .getByRole('checkbox', { name: 'Wednesday', exact: true })
    .check();
  await publication.getByLabel(/^Weekday price/).fill('8.15');
  await publication.getByLabel(/^Weekend price/).fill('12.25');
  await publication.getByLabel(/^Procurement net cost/).fill('5.05');
  await publication
    .getByRole('button', { name: 'Save publication', exact: true })
    .click();
  await expect(publication).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Regional Weekly' }),
  ).toContainText('₹8.15');
  await page
    .getByRole('link', { name: 'Residents & subscriptions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add resident', exact: true }).click();
  const resident = page.getByRole('dialog');
  await resident.getByLabel(/^Resident name/).fill('Anitha Nair');
  await resident.getByLabel(/^Delivery address/).fill('12, Lotus Lane');
  await resident.getByLabel(/^Phone/).fill('9876543210');
  await resident
    .getByLabel(/^Delivery route/)
    .selectOption(r.data.saveRoute.id);
  await resident.getByLabel(/^Sector/).selectOption('Lotus Lane');
  await resident.getByLabel(/^Opening deposit/).fill('500.25');
  await resident
    .getByRole('button', { name: 'Save resident', exact: true })
    .click();
  await expect(resident).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Anitha Nair' }),
  ).toContainText('₹500.25');
  await page.reload();
  await page
    .getByRole('button', { name: 'Edit resident', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Delivery address/)
    .fill('12A, Lotus Lane');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save resident', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Anitha Nair' }),
  ).toContainText('12A, Lotus Lane');
  await page
    .getByRole('link', { name: 'Routes & delivery', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit route', exact: true }).click();
  const linked = page.getByRole('dialog');
  await expect(linked.getByLabel(/^Delivery point 1/)).toHaveJSProperty(
    'readOnly',
    true,
  );
  await expect(linked.getByLabel(/^Door \/ address 1/)).toHaveValue(
    '12A, Lotus Lane',
  );
  await expect(
    linked.getByRole('button', { name: 'Remove point 1', exact: true }),
  ).toBeDisabled();
  await linked.getByRole('button', { name: 'Cancel', exact: true }).click();
  const routeNow = (
    await query(
      '{routes{id code name territoryId version stops{id label door sequence}}}',
    )
  ).data.routes[0];
  await query('mutation($input:RouteInput!){saveRoute(input:$input){id}}', {
    input: {
      ...routeNow,
      stops: [
        ...routeNow.stops,
        { label: 'Existing point', door: '20 Lotus Lane', sequence: 2 },
      ],
    },
  });
  await page
    .getByRole('link', { name: 'Residents & subscriptions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add resident', exact: true }).click();
  const second = page.getByRole('dialog');
  await second.getByLabel(/^Resident name/).fill('Existing Resident');
  await second.getByLabel(/^Delivery address/).fill('20 Lotus Lane');
  await second.getByLabel(/^Phone/).fill('9876543211');
  await second.getByLabel(/^Delivery route/).selectOption(r.data.saveRoute.id);
  await second.getByLabel(/^Sector/).selectOption('Lotus Lane');
  await second
    .getByLabel(/^Existing delivery point/)
    .selectOption({ label: '2 · Existing point · 20 Lotus Lane' });
  await second
    .getByRole('button', { name: 'Save resident', exact: true })
    .click();
  await expect(second).not.toBeVisible();
  const final = (await query('{routes{stops{residentId}}}')).data.routes[0]
    .stops;
  expect(final).toHaveLength(2);
  expect(
    final.every((s: { residentId: string | null }) => Boolean(s.residentId)),
  ).toBe(true);
});

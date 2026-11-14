import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';

test('communication preferences keep explicit consent and locale after refresh; a contact click logs only an attempt', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `communications-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/communications');
  await expect(
    page.getByRole('heading', { name: 'Communications', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('WhatsApp not configured', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await page
    .getByLabel('Preferred message language', { exact: true })
    .selectOption('ml');
  await page.getByLabel('Allow WhatsApp messages', { exact: true }).check();
  await page
    .getByLabel('Resident explicitly agreed to the selected channels', {
      exact: true,
    })
    .check();
  await page
    .getByLabel(/^Consent evidence/)
    .fill('Resident asked for Malayalam WhatsApp bills');
  await page
    .getByRole('button', { name: 'Save contact preferences', exact: true })
    .click();
  await expect(
    page.getByText('Contact preferences saved', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await expect(
    page.getByLabel('Preferred message language', { exact: true }),
  ).toHaveValue('ml');
  await expect(
    page.getByLabel('Allow WhatsApp messages', { exact: true }),
  ).toBeChecked();
  const call = page.getByRole('link', { name: 'Call', exact: true });
  await expect(call).toHaveAttribute('href', /^tel:\+91/);
  await call.evaluate((element) =>
    element.addEventListener('click', (event) => event.preventDefault()),
  );
  await call.click();
  await expect(
    page.getByText('Contact attempt recorded', { exact: true }),
  ).toBeVisible();
  const history = await f.query(
    'query($id:ID!){communicationHistory(residentId:$id){attempts{outcome}messages{status}}}',
    { id: f.residents[0].id },
  );
  expect(history.data.communicationHistory.attempts).toEqual([
    { outcome: 'ATTEMPTED' },
  ]);
  expect(history.data.communicationHistory.messages).toEqual([]);
});

test('unconfirmed contact attempts survive switching and refresh while later clicks log independently', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `contact-recovery-${crypto.randomUUID()}@example.test`,
    ['First Contact', 'Second Contact'],
  );
  const ids: string[] = [];
  let dropFirst = true;
  await page.route('**/api/graphql', async (route) => {
    const data = route.request().postDataJSON();
    if (data.query.includes('recordContactAttempt')) {
      ids.push(data.variables.input.requestId);
      if (dropFirst) {
        dropFirst = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.goto('/communications');
  const resident = page.getByLabel('Resident', { exact: true });
  await resident.selectOption(f.residents[0].id);
  async function clickCall() {
    const call = page.getByRole('link', { name: 'Call', exact: true });
    await call.evaluate((element) =>
      element.addEventListener('click', (event) => event.preventDefault()),
    );
    await call.click();
  }
  await clickCall();
  await expect(
    page.getByText('Contact attempt could not be recorded', { exact: true }),
  ).toBeVisible();
  await resident.selectOption(f.residents[1].id);
  await resident.selectOption(f.residents[0].id);
  await expect(
    page.getByRole('button', {
      name: 'Retry recording this attempt',
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await expect(
    page.getByRole('button', {
      name: 'Retry recording this attempt',
      exact: true,
    }),
  ).toBeVisible();
  await clickCall();
  await expect.poll(() => ids.length).toBe(2);
  await page
    .getByRole('button', { name: 'Retry recording this attempt', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Retry recording this attempt',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(ids).toHaveLength(3);
  expect(ids[2]).toBe(ids[0]);
  expect(ids[1]).not.toBe(ids[0]);
  const history = await f.query(
    'query($id:ID!){communicationHistory(residentId:$id){attempts{id}}}',
    { id: f.residents[0].id },
  );
  expect(history.data.communicationHistory.attempts).toHaveLength(2);
});

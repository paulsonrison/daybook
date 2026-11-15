import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('assistant retains the question when AI is unavailable and renders synthetic provider text safely', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `assistant-ui-${crypto.randomUUID()}@example.test`,
    ['Assistant Resident'],
  );
  let ready = false;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.query?.includes('askAssistant')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            askAssistant: ready
              ? {
                  status: 'READY',
                  answer: '<script>unsafe()</script>',
                  facts: JSON.stringify({
                    month: '2026-11',
                    balanceAsOf: '2026-11-15',
                    outstanding: '90071992547409.93',
                    credit: '0.00',
                    overdue: null,
                    recordedSales: '0.00',
                    accountReceipts: '0.00',
                    cashReceipts: '0.00',
                    scheduledCopies: '0',
                    supplyPurchases: '0.00',
                    supplyReturnCredits: '0.00',
                    netSupplyPurchases: '0.00',
                  }),
                  asOf: '2026-11-15T00:00:00Z',
                }
              : {
                  status: 'NOT_CONFIGURED',
                  answer: null,
                  facts: null,
                  asOf: null,
                },
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/assistant');
  await expect(
    page.getByRole('heading', { name: 'Agency assistant', exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Your question/).fill('Summarize my arrears');
  await page
    .getByRole('button', { name: 'Ask assistant', exact: true })
    .click();
  await expect(
    page.getByText('AI is not configured.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Your question/)).toHaveValue(
    'Summarize my arrears',
  );
  await expect(page.getByTestId('assistant-verified-facts')).toHaveCount(0);
  ready = true;
  await page
    .getByRole('button', { name: 'Ask assistant', exact: true })
    .click();
  await expect(page.getByTestId('assistant-verified-facts')).toContainText(
    '9,00,71,99,25,47,409.93',
  );
  await expect(
    page.getByText('<script>unsafe()</script>', { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator('script')
      .evaluateAll((nodes) =>
        nodes.some((node) => node.textContent === 'unsafe()'),
      ),
  ).toBe(false);
});

test('assistant controls switch to Malayalam and Hindi while retaining the draft question', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `assistant-native-${crypto.randomUUID()}@example.test`,
    ['Native Assistant Resident'],
  );
  await page.goto('/assistant');
  await page.getByLabel(/^Your question/).fill('Original draft question');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('ml');
  await expect(
    page.getByRole('heading', { name: 'ഏജൻസി സഹായി', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^നിങ്ങളുടെ ചോദ്യം/)).toHaveValue(
    'Original draft question',
  );
  await page.getByLabel('ഇന്റർഫേസ് ഭാഷ', { exact: true }).selectOption('hi');
  await expect(
    page.getByRole('heading', { name: 'एजेंसी सहायक', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^आपका प्रश्न/)).toHaveValue(
    'Original draft question',
  );
});

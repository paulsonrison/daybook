import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('agency analytics shows recorded money, missing-source coverage, month boundaries and current balance dates', async ({
  page,
  baseURL,
}) => {
  const { query } = await financialBrowser(
    page,
    baseURL!,
    `analytics-${crypto.randomUUID()}@example.test`,
    ['Original Analytics Resident'],
  );
  const date = (await query('{deliveryMetrics{today}}')).data.deliveryMetrics
    .today;
  await page.goto('/analytics');
  await expect(
    page.getByRole('heading', { name: 'Agency analytics', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Report month', { exact: true })).toHaveValue(
    date.slice(0, 7),
  );
  await expect(page.getByTestId('analytics-outstanding')).toContainText(
    '20.05',
  );
  await expect(
    page.getByText('Recorded sources are incomplete.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Route contribution before shared expenses',
      exact: true,
    }),
  ).toBeVisible();
  const previousSnapshot = await page
    .getByText(/^Report source snapshot:/)
    .textContent();
  await page
    .getByRole('button', { name: 'Refresh reports', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Report source snapshot:/)).not.toHaveText(
    previousSnapshot!,
  );
  await page.getByLabel('Report month', { exact: true }).fill('2024-02');
  await expect(
    page.getByText('2024-02-01 → 2024-02-29', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('analytics-outstanding')).toContainText(
    '20.05',
  );
  await expect(
    page.getByText(`Current balances as of ${date}`, { exact: true }).first(),
  ).toBeVisible();
});

test('analytics language changes preserve source month and exact balances on a compact screen', async ({
  page,
  baseURL,
}) => {
  const { query } = await financialBrowser(
    page,
    baseURL!,
    `analytics-native-${crypto.randomUUID()}@example.test`,
    ['Original Native Analytics'],
  );
  const date = (await query('{deliveryMetrics{today}}')).data.deliveryMetrics
    .today;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/analytics');
  await expect(page.getByTestId('analytics-outstanding')).toContainText(
    '20.05',
  );
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('ml');
  await expect(
    page.getByRole('heading', { name: 'ഏജൻസി വിശകലനം', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('റിപ്പോർട്ട് മാസം', { exact: true }),
  ).toHaveValue(date.slice(0, 7));
  await expect(
    page.getByText('രേഖപ്പെടുത്തിയ ഉറവിടങ്ങൾ അപൂർണ്ണമാണ്.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('ഇന്റർഫേസ് ഭാഷ', { exact: true }).selectOption('hi');
  await expect(
    page.getByRole('heading', { name: 'एजेंसी विश्लेषण', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('रिपोर्ट का महीना', { exact: true }),
  ).toHaveValue(date.slice(0, 7));
  await expect(page.getByTestId('analytics-outstanding')).toContainText(
    '20.05',
  );
  await expect(
    page.getByRole('heading', {
      name: 'साझा खर्चों से पहले मार्ग का योगदान',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Recorded sources are incomplete.', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'एजेंसी विश्लेषण', exact: true }),
  ).toBeVisible();
  const bounds = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
});

test('an unavailable analytics read shows recovery instead of fabricated zero totals', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `analytics-retry-${crypto.randomUUID()}@example.test`,
    ['Recovery Analytics'],
  );
  let failures = 1;
  await page.route('**/api/graphql', async (route) => {
    const request = route.request().postDataJSON();
    if (request?.query?.includes('agencyAnalytics') && failures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary report read failure' }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/analytics');
  await expect(
    page.getByRole('heading', { name: 'Analytics unavailable', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('analytics-outstanding')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('analytics-outstanding')).toContainText(
    '20.05',
  );
  await expect(
    page.getByRole('heading', { name: 'Analytics unavailable', exact: true }),
  ).toHaveCount(0);
});

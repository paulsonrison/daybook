import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';

test('downloaded deliveries can be updated offline and acknowledged after reconnection', async ({
  page,
  context,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `field-delivery-${crypto.randomUUID()}@example.test`,
    ['Delivery Resident'],
  );
  const result = await f.query(
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    {
      input: {
        name: 'Offline Daily',
        edition: 'Kochi',
        kind: 'NEWSPAPER',
        language: 'English',
        dispatch: 'MORNING',
        frequency: 'DAILY',
        publishingDays: [0, 1, 2, 3, 4, 5, 6],
        weekdayPrice: '8.15',
        weekendPrice: '8.15',
      },
    },
  );
  expect(result.errors).toBeUndefined();
  await f.query(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.residents[0].id,
        publicationId: result.data.savePublication.id,
        cadence: 'DAILY',
        startDate: '2024-01-01',
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await f.query('mutation{markScheduledDeliveries(date:"2024-02-01"){total}}');
  await page.goto('/field.html');
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await page.getByLabel('Delivery date', { exact: true }).fill('2024-02-01');
  await page.getByRole('button', { name: 'Download route' }).click();
  await expect(
    page.getByText('Delivery Resident', { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel(/^Delivery evidence for/).fill('Door was closed');
  await page.getByRole('button', { name: 'Missed', exact: true }).click();
  await expect(
    page.getByText('Pending DELIVERY · MISSED', { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync pending entries' }).click();
  await expect(
    page.getByText('Confirmed DELIVERY · MISSED', { exact: true }),
  ).toBeVisible();
  const logs = await f.query(
    '{deliveryLogs(date:"2024-02-01"){status reason}}',
  );
  expect(logs.data.deliveryLogs).toEqual([
    { status: 'MISSED', reason: 'Door was closed' },
  ]);
});

test('a delayed old session check cannot unlock customer data after an account-change signal', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `field-race-${crypto.randomUUID()}@example.test`,
    ['Private Old Resident'],
  );
  await page.goto('/field.html');
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await page.getByRole('button', { name: 'Download route' }).click();
  await expect(
    page.getByText('Private Old Resident', { exact: true }),
  ).toBeVisible();
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await requested;
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'DAYBOOK_ACCOUNT_CHANGED' },
      }),
    ),
  );
  release();
  await expect(page.locator('#notice')).toHaveText(
    /Account changed|Account verified/,
  );
  await expect(
    page.getByText('Private Old Resident', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Verify account' }),
  ).toBeVisible();
});

test('successful logout locks other field tabs even when worker storage cleanup fails', async ({
  page,
  context,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `field-storage-${crypto.randomUUID()}@example.test`,
    ['Private Storage Resident'],
  );
  await page.goto('/field.html');
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await page.getByRole('button', { name: 'Download route' }).click();
  await expect(
    page.getByText('Private Storage Resident', { exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.serviceWorkers()[0].evaluate(() => {
    IDBDatabase.prototype.transaction = function () {
      throw new Error('Synthetic device storage failure');
    };
  });
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  });
  await expect(
    page.getByText('Private Storage Resident', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Verify account' }),
  ).toBeVisible();
});

test('PWA installs a private-cache-free shell and preserves pending cash across offline reload and reconnect', async ({
  page,
  context,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `field-${crypto.randomUUID()}@example.test`,
    ['Offline Resident'],
  );
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({
    name: 'Daybook',
    display: 'standalone',
  });
  await page.goto('/field.html');
  await expect(
    page.getByRole('heading', { name: 'Field workspace' }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await page.getByRole('button', { name: 'Download route' }).click();
  await expect(
    page.getByText('Offline Resident', { exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.getByLabel('Cash amount for Offline Resident').fill('10.05');
  await page
    .getByLabel('Cash evidence for Offline Resident')
    .fill('Actual cash received');
  await page.getByRole('button', { name: 'Save pending cash' }).click();
  await expect(
    page.getByText('Pending CASH · 10.05', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Reconnect to verify your account/),
  ).toBeVisible();
  await expect(page.getByText('Offline Resident', { exact: true })).toHaveCount(
    0,
  );
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Verify account' }).click();
  await expect(
    page.getByText('Pending CASH · 10.05', { exact: true }),
  ).toBeVisible();
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.getByRole('button', { name: 'Sync pending entries' }).click();
  await expect(
    page.getByRole('button', { name: 'Verify account' }),
  ).toBeVisible();
  await expect(
    page.getByText('Pending CASH · 10.05', { exact: true }),
  ).toHaveCount(0);
  await page.unroute('**/api/auth/me');
  await page.getByRole('button', { name: 'Verify account' }).click();
  await expect(
    page.getByText('Pending CASH · 10.05', { exact: true }),
  ).toBeVisible();
  let lostAcknowledgement = false;
  await page.route('**/api/graphql', async (route) => {
    if (
      !lostAcknowledgement &&
      route.request().postDataJSON()?.query?.includes('syncFieldAction')
    ) {
      lostAcknowledgement = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Sync pending entries' }).click();
  await expect(
    page.getByRole('button', { name: 'Sync pending entries' }),
  ).toBeEnabled();
  await expect(
    page.getByText('Pending CASH · 10.05', { exact: true }),
  ).toBeVisible();
  expect(lostAcknowledgement).toBeTruthy();
  await page.getByRole('button', { name: 'Sync pending entries' }).click();
  await expect(page.getByText(/Confirmed CASH/)).toBeVisible();
  const payments = await page.request.post('/api/graphql', {
    headers: { origin: baseURL! },
    data: { query: '{payments{amount status}}' },
  });
  expect((await payments.json()).data.payments).toEqual([
    { amount: '10.05', status: 'CONFIRMED' },
  ]);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (n) =>
          (await (await caches.open(n)).keys()).map(
            (r) => new URL(r.url).pathname,
          ),
        ),
      )
    ).flat();
  });
  expect(cached).toContain('/field.html');
  expect(
    cached.some(
      (p) =>
        p.includes('/api/') || p.includes('/documents/') || p.includes('_rsc'),
    ),
  ).toBeFalsy();
});

test('field conflicts retain the proposal and account changes clear local data', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `field-conflict-${crypto.randomUUID()}@example.test`,
    ['Conflict Resident'],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/field.html');
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await page.getByRole('button', { name: 'Download route' }).click();
  await page.getByLabel('Cash amount for Conflict Resident').fill('4.25');
  await page
    .getByLabel('Cash evidence for Conflict Resident')
    .fill('Counted notes at door');
  await page.getByRole('button', { name: 'Save pending cash' }).click();
  await f.query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.residents[0].id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '2.00',
        reason: 'Concurrent adjustment',
      },
    },
  );
  await page.getByRole('button', { name: 'Sync pending entries' }).click();
  await expect(page.getByText(/Needs review/)).toBeVisible();
  await expect(
    page.getByText('Pending CASH · 4.25', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: '.cache/pwa-mobile.png', fullPage: true });
  await page.request.post('/api/auth/logout', {
    headers: { origin: baseURL! },
    data: {},
  });
  await financialBrowser(
    page,
    baseURL!,
    `field-other-${crypto.randomUUID()}@example.test`,
    ['New Account Resident'],
  );
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }),
  ).toContainText('Lotus');
  await expect(
    page.getByText('Conflict Resident', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Pending CASH · 4.25', { exact: true }),
  ).toHaveCount(0);
});

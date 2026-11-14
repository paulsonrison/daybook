import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('overdue dashboard alert opens credit controls and one-click service suspension preserves truthful notification status', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
      page,
      baseURL!,
      'credit-controls-browser@example.test',
    ),
    today = (await f.query('{deliveryMetrics{today}}')).data.deliveryMetrics
      .today,
    date = new Date(Date.parse(today + 'T00:00:00Z') - 60 * 86400000)
      .toISOString()
      .slice(0, 10);
  await f.query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.residents[0].id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '100.05',
        date,
        reason: 'Imported sixty-day overdue balance',
      },
    },
  );
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Review overdue accounts', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Credit control', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Suspend service for Review Resident',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Service suspended. Hold notice: not configured.', {
      exact: true,
    }),
  ).toBeVisible();
  const resident = (await f.query('{residents{id status}}')).data.residents[0];
  expect(resident.status).toBe('SUSPENDED');
  await expect(
    page.getByText('Credit hold recorded', { exact: true }),
  ).toBeVisible();
});

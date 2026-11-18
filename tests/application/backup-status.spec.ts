import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('backup protection shows independent copy health and preserves an explicit unconfigured or unavailable state', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `backup-${crypto.randomUUID()}@example.test`,
  );
  let state: 'PARTIAL' | 'READY' | 'NOT_CONFIGURED' | 'ERROR' = 'PARTIAL';
  await page.route('**/api/operations/backups', async (route) => {
    if (state === 'ERROR')
      return route.fulfill({ status: 503, json: { state: 'UNAVAILABLE' } });
    if (state === 'NOT_CONFIGURED')
      return route.fulfill({ json: { state: 'NOT_CONFIGURED' } });
    return route.fulfill({
      json: {
        state: 'READY',
        protected: state === 'READY',
        checkedAt: '2026-11-18T02:22:00Z',
        destinations: [
          {
            name: 'neon',
            healthy: true,
            configured: true,
            verifiedAt: '2026-11-18T02:22:00Z',
          },
          {
            name: 'b2',
            healthy: state === 'READY',
            configured: true,
            verifiedAt: state === 'READY' ? '2026-11-18T02:22:00Z' : null,
          },
        ],
      },
    });
  });
  await page.goto('/settings/appearance');
  const card = page.getByRole('region', {
    name: 'Backup protection',
    exact: true,
  });
  await expect(
    card.getByText('Protection needs attention', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('Neon', { exact: true })).toBeVisible();
  await expect(card.getByText('Backblaze B2', { exact: true })).toBeVisible();
  await expect(
    card.getByText('No verified copy', { exact: true }),
  ).toBeVisible();
  state = 'READY';
  await card
    .getByRole('button', { name: 'Refresh backup status', exact: true })
    .click();
  await expect(
    card.getByText('Two recent verified copies', { exact: true }),
  ).toBeVisible();
  state = 'NOT_CONFIGURED';
  await card
    .getByRole('button', { name: 'Refresh backup status', exact: true })
    .click();
  await expect(
    card.getByText('Automatic backups are not configured.', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText('Two recent verified copies', { exact: true }),
  ).toHaveCount(0);
  state = 'ERROR';
  await card
    .getByRole('button', { name: 'Refresh backup status', exact: true })
    .click();
  await expect(
    card.getByText('Backup status could not be checked.', { exact: true }),
  ).toBeVisible();
});

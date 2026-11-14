import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('messaging settings persist reminder controls and explicitly confirmed approved templates', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `messaging-settings-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/settings/communications');
  await expect(
    page.getByRole('heading', { name: 'Messaging settings', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Enable overdue reminders', { exact: true }).check();
  await page.getByLabel(/^Reminder frequency \(days\)/).fill('7');
  await page.getByLabel(/^Minimum cooldown \(hours\)/).fill('24');
  await page
    .getByRole('button', { name: 'Add approved template', exact: true })
    .click();
  await page
    .getByLabel('Template language', { exact: true })
    .selectOption('ml');
  await page.getByLabel(/^Provider template name/).fill('resident_invoice_ml');
  await page.getByLabel('QR image header', { exact: true }).check();
  await page
    .getByLabel(
      'I confirmed these templates are approved in the provider account',
      { exact: true },
    )
    .check();
  await page
    .getByRole('button', { name: 'Save messaging settings', exact: true })
    .click();
  await expect(
    page.getByText('Messaging settings saved', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel('Enable overdue reminders', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel('Template language', { exact: true }),
  ).toHaveValue('ml');
  await expect(page.getByLabel(/^Provider template name/)).toHaveValue(
    'resident_invoice_ml',
  );
  await expect(
    page.getByLabel('QR image header', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel(
      'I confirmed these templates are approved in the provider account',
      { exact: true },
    ),
  ).not.toBeChecked();
});

import { test, expect } from '@playwright/test';
test('owner configures territory, staff, route order and sees persisted dashboard counts', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create an agency', exact: true })
    .click();
  await page.getByLabel(/^Agency name/).fill('Route Browser Agency');
  await page.getByLabel(/^Your name/).fill('Route Owner');
  await page.getByLabel(/^Email address/).fill('routes-browser@example.test');
  await page.getByLabel(/^Password/).fill('Route browser password 123');
  await page
    .getByRole('button', { name: 'Create agency', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add territory', exact: true })
    .click();
  const territory = page.getByRole('dialog');
  await territory.getByLabel(/^Territory name/).focus();
  await page.keyboard.press('Tab');
  await expect(territory.getByLabel(/^Locality/)).toBeFocused();
  await territory.getByLabel(/^Territory name/).fill('Central Kochi');
  await territory.getByLabel(/^Locality/).fill('Kochi');
  await territory.getByLabel(/^PIN codes/).fill('682020');
  await territory.getByLabel(/^Sector boundaries/).fill('Lotus Lane');
  await territory
    .getByRole('button', { name: 'Save territory', exact: true })
    .click();
  await expect(territory).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Central Kochi' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Staff & payroll', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add staff', exact: true }).click();
  const person = page.getByRole('dialog');
  await person.getByLabel(/^Staff name/).fill('Biju');
  await person.getByLabel(/^Staff ID/).fill('DB01');
  await person.getByLabel(/^Phone/).fill('9876543210');
  await person.getByRole('button', { name: 'Save staff', exact: true }).click();
  await expect(person).not.toBeVisible();
  await page
    .getByRole('link', { name: 'Routes & delivery', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add route', exact: true }).click();
  const route = page.getByRole('dialog');
  await route.getByLabel(/^Route code/).fill('R01');
  await route.getByLabel(/^Route name/).fill('Morning Lotus');
  await route.getByLabel(/^Territory/).selectOption({ label: 'Central Kochi' });
  await route.getByLabel(/^Assigned staff/).selectOption({ label: 'Biju' });
  await route
    .getByRole('button', { name: 'Add delivery point', exact: true })
    .click();
  await route.getByLabel(/^Delivery point 1/).fill('Anitha');
  await route.getByLabel(/^Door \/ address 1/).fill('12, Lotus Lane');
  await route
    .getByRole('button', { name: 'Add delivery point', exact: true })
    .click();
  await route.getByLabel(/^Delivery point 2/).fill('Leela');
  await route.getByLabel(/^Door \/ address 2/).fill('14, Lotus Lane');
  await route
    .locator('.agency-stop-editor')
    .nth(1)
    .getByRole('button', { name: 'Move up', exact: true })
    .click();
  await route.getByRole('button', { name: 'Save route', exact: true }).click();
  await expect(route).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('row').filter({ hasText: 'Morning Lotus' }),
  ).toContainText('Biju');
  await page
    .getByLabel('Search records', { exact: true })
    .fill('14, Lotus Lane');
  await expect(
    page.getByRole('row').filter({ hasText: 'Morning Lotus' }),
  ).toBeVisible();
  await page.getByLabel('Search records', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Edit route', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByLabel(/^Delivery point 1/),
  ).toHaveValue('Leela');
  await expect(
    page.getByRole('dialog').getByLabel(/^Delivery point 2/),
  ).toHaveValue('Anitha');
  await page
    .getByRole('dialog')
    .getByLabel(/^Route name/)
    .fill('Morning Lotus updated');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save route', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(
    page.getByText('1 active territory', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('1 active staff member', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 active route', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add territory', exact: true })
    .click();
  const failedForm = page.getByRole('dialog');
  await failedForm.getByLabel(/^Territory name/).fill('Preserved draft');
  await failedForm.getByLabel(/^Locality/).fill('Kochi');
  await failedForm.getByLabel(/^PIN codes/).fill('682020');
  await failedForm.getByLabel(/^Sector boundaries/).fill('Different sector');
  await page.route('**/api/graphql', (route) => route.abort('failed'));
  await failedForm
    .getByRole('button', { name: 'Save territory', exact: true })
    .click();
  await expect(failedForm.getByRole('alert')).toContainText(
    'The request could not be confirmed',
  );
  await expect(failedForm.getByLabel(/^Territory name/)).toHaveValue(
    'Preserved draft',
  );
  await page.unroute('**/api/graphql');
  await failedForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Staff & payroll', exact: true })
    .click();
  await page
    .getByLabel('Search records', { exact: true })
    .fill('no-matching-staff');
  await expect(
    page.getByText('No matching records', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search records', { exact: true }).fill('DB01');
  await expect(page.getByRole('row').filter({ hasText: 'Biju' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit staff', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Status', { exact: true })
    .selectOption('INACTIVE');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save staff', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Reassign active routes',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Routes & delivery', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit route', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Assigned staff/)
    .selectOption({ label: 'Unassigned' });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save route', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('link', { name: 'Staff & payroll', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit staff', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Status', { exact: true })
    .selectOption('INACTIVE');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save staff', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('INACTIVE');
  await expect(page.getByRole('row').filter({ hasText: 'Biju' })).toContainText(
    'Inactive',
  );
});

import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('appearance choices and profile language survive refresh and an unconfirmed save reuses its original request', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `appearance-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/settings/appearance');
  await expect(
    page.getByRole('heading', { name: 'Appearance', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Nord', exact: true }).click();
  await page
    .getByLabel('Operational layout', { exact: true })
    .selectOption('CARDS');
  const ids: string[] = [];
  let lose = true;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('saveAgentPreferences')) {
      ids.push(body.variables.input.requestId);
      if (lose) {
        lose = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page
    .getByRole('button', { name: 'Save appearance preferences', exact: true })
    .click();
  await expect(
    page.getByText('Preference save unconfirmed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Check original preference save',
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Check original preference save',
      exact: true,
    })
    .click();
  await expect(page.locator('[data-db-agent-preferences]')).toHaveAttribute(
    'data-db-mode',
    'dark',
  );
  await expect(page.locator('[data-db-agent-preferences]')).toHaveAttribute(
    'data-db-scheme',
    'nord',
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await page
    .getByLabel('Operational layout', { exact: true })
    .selectOption('ROUTE');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('ml');
  await expect(
    page.getByText('Preferences saved', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Operational layout', { exact: true }),
  ).toHaveValue('ROUTE');
  await page.reload();
  await expect(
    page.getByLabel('Interface language', { exact: true }),
  ).toHaveValue('ml');
  await expect(
    page.getByLabel('Operational layout', { exact: true }),
  ).toHaveValue('CARDS');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Daybook', exact: true }),
  ).toBeVisible();
  await financialBrowser(
    page,
    baseURL!,
    `appearance-other-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/settings/appearance');
  await expect(
    page.getByLabel('Interface language', { exact: true }),
  ).toHaveValue('en');
  await expect(
    page.getByLabel('Operational layout', { exact: true }),
  ).toHaveValue('TABLE');
  await expect(page.locator('[data-db-agent-preferences]')).toHaveAttribute(
    'data-db-mode',
    'light',
  );
  await expect(page.locator('[data-db-agent-preferences]')).toHaveAttribute(
    'data-db-scheme',
    'teal',
  );
});

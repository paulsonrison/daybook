import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('saved language renders native console labels after switching and reloading', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `native-console-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/settings/appearance');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('ml');
  await expect(
    page.getByRole('heading', { name: 'രൂപഭാവം', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'പുറത്തുകടക്കുക', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-db-agent-preferences]')).toHaveAttribute(
    'lang',
    'ml',
  );
  await page.getByLabel('ഇന്റർഫേസ് ഭാഷ', { exact: true }).selectOption('hi');
  await expect(
    page.getByRole('heading', { name: 'दिखावट', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('सहेजने से पहले अक्षर का आकार, दूरी और रंग जाँचें।', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Review your reading size, spacing and colors before saving.',
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel('इंटरफ़ेस की भाषा', { exact: true }),
  ).toHaveValue('hi');
  await expect(
    page.getByRole('button', { name: 'साइन आउट करें', exact: true }),
  ).toBeVisible();
});
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
    page.getByText('ക്രമീകരണങ്ങൾ സേവ് ചെയ്തു', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('പ്രവർത്തന വിന്യാസം', { exact: true }),
  ).toHaveValue('ROUTE');
  await page.reload();
  await expect(page.getByLabel('ഇന്റർഫേസ് ഭാഷ', { exact: true })).toHaveValue(
    'ml',
  );
  await expect(
    page.getByLabel('പ്രവർത്തന വിന്യാസം', { exact: true }),
  ).toHaveValue('CARDS');
  await page
    .getByRole('button', { name: 'പുറത്തുകടക്കുക', exact: true })
    .click();
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

import { test, expect } from '@playwright/test';

test('shared bill presentation accepts serializable data from a Next server page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/ui/server-presentation');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Server presentation example' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Example publication');
  await expect(
    page.getByText('Example resident', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

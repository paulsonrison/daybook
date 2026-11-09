import { test, expect } from '@playwright/test';

test('agent creates agency, refreshes session, logs out and signs back in', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create an agency', exact: true })
    .click();
  await page.getByLabel(/^Agency name/).fill('Browser Agency');
  await page.getByLabel(/^Your name/).fill('Browser Agent');
  await page.getByLabel(/^Email address/).fill('browser@example.test');
  await page.getByLabel(/^Password/).fill('Browser test password 123');
  await page
    .getByRole('button', { name: 'Create agency', exact: true })
    .click();
  await expect(page.getByLabel('Current agency', { exact: true })).toHaveText(
    'Browser Agency',
  );
  await page.reload();
  await expect(page.getByLabel('Current agency', { exact: true })).toHaveText(
    'Browser Agency',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Daybook', exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Email address/).fill('browser@example.test');
  await page.getByLabel(/^Password/).fill('Wrong password value 123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Unable to continue' }),
  ).toContainText('Email or password is incorrect');
  await page.getByLabel(/^Password/).fill('Browser test password 123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Current agency', { exact: true })).toHaveText(
    'Browser Agency',
  );
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'daybook_session')?.httpOnly).toBe(
    true,
  );
});

test('same-origin proxy refuses an untrusted authentication submission', async ({
  request,
}) => {
  const response = await request.post('/api/auth/register', {
    headers: { origin: 'https://untrusted.example' },
    data: {
      agencyName: 'Denied',
      name: 'Denied',
      email: 'denied@example.test',
      password: 'Denied test password 123',
    },
  });
  expect(response.status()).toBe(403);
});

test('public authentication proxy stops an oversized chunked body before consuming it all', async () => {
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (chunks++ < 100) controller.enqueue(new Uint8Array(8192).fill(65));
      else controller.close();
    },
  });
  const response = await fetch(
    `${process.env.TEST_APP_URL}/api/auth/register`,
    {
      method: 'POST',
      headers: {
        origin: process.env.TEST_APP_URL!,
        'content-type': 'application/json',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' },
  );
  expect(response.status).toBe(413);
  await response.text();
  expect(chunks).toBeLessThan(100);
});

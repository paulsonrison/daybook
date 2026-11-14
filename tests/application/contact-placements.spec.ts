import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';

test('resident history loads older attempts and messages independently', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `resident-history-pages-${crypto.randomUUID()}@example.test`,
  );
  const attempts = Array.from({ length: 205 }, (_, index) => ({
    id: crypto.randomUUID(),
    channel: 'CALL',
    outcome: 'ATTEMPTED',
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
  }));
  const messages = Array.from({ length: 205 }, (_, index) => ({
    id: crypto.randomUUID(),
    kind: 'INVOICE',
    channel: 'SMS',
    status: 'FAILED',
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
  }));
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('communicationHistory')) {
      const older = Boolean(body.variables.cursor),
        isAttempts = body.query.includes('attemptsBefore:');
      if (older)
        expect(body.variables.cursor.id).toBe(
          isAttempts ? attempts[199].id : messages[199].id,
        );
      await route.fulfill({
        json: {
          data: {
            communicationHistory: {
              attempts:
                older && isAttempts
                  ? attempts.slice(200)
                  : attempts.slice(0, 200),
              messages:
                older && !isAttempts
                  ? messages.slice(200)
                  : messages.slice(0, 200),
              attemptsHasMore: !(older && isAttempts),
              messagesHasMore: !(older && !isAttempts),
            },
          },
        },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/communications');
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await expect(page.locator('main li')).toHaveCount(400);
  await page
    .getByRole('button', { name: 'Load older contact attempts', exact: true })
    .click();
  await expect(page.locator('main li')).toHaveCount(405);
  await expect(
    page.getByRole('button', {
      name: 'Load older contact attempts',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Load older resident messages', exact: true })
    .click();
  await expect(page.locator('main li')).toHaveCount(410);
  await expect(
    page.getByRole('button', {
      name: 'Load older resident messages',
      exact: true,
    }),
  ).toHaveCount(0);
});
test('resident contact actions retain failed attempt IDs and use native links', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `profile-contact-${crypto.randomUUID()}@example.test`,
  );
  const ids: string[] = [];
  let fail = true;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('recordContactAttempt')) {
      ids.push(body.variables.input.requestId);
      if (fail) {
        fail = false;
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.goto('/residents');
  await page
    .getByRole('button', { name: 'Contact Review Resident', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Call Review Resident', exact: true }),
  ).toHaveAttribute('href', /^tel:\+/);
  await expect(
    page.getByRole('link', { name: 'WhatsApp Review Resident', exact: true }),
  ).toHaveAttribute('href', /^https:\/\/wa.me\//);
  const call = page.getByRole('link', {
    name: 'Call Review Resident',
    exact: true,
  });
  // Keep the synthetic test from handing control to an installed phone app.
  await call.evaluate((element) =>
    element.addEventListener('click', (event) => event.preventDefault()),
  );
  await call.click();
  await expect(
    page.getByText('Contact attempt unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Retry original contact attempt',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Contact attempt recorded', { exact: true }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

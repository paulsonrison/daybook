import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('manual reminder controls preserve an honest unconfigured outcome', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `manual-reminder-${crypto.randomUUID()}@example.test`,
  );
  const adjustment = await f.query(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.residents[0].id,
        direction: 'DEBIT',
        category: 'OPENING',
        date: '2026-11-01',
        amount: '1.00',
        reason: 'Synthetic overdue manual reminder',
      },
    },
  );
  expect(adjustment.errors).toBeUndefined();
  await page.goto('/communications');
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await page
    .getByLabel('Reminder channel', { exact: true })
    .selectOption('SMS');
  await page
    .getByLabel('Preferred message language', { exact: true })
    .selectOption('hi');
  await page
    .getByRole('textbox', { name: /^Consent evidence/ })
    .fill('Unsaved resident consent discussion');
  await page
    .getByRole('button', { name: 'Prepare overdue reminder', exact: true })
    .click();
  await expect(
    page.getByText('Reminder status: Not configured', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Preferred message language', { exact: true }),
  ).toHaveValue('hi');
  await expect(
    page.getByRole('textbox', { name: /^Consent evidence/ }),
  ).toHaveValue('Unsaved resident consent discussion');
  const history = await f.query(
    'query($id:ID!){communicationHistory(residentId:$id){messages{kind status}}}',
    { id: f.residents[0].id },
  );
  expect(history.data.communicationHistory.messages).toEqual([
    { kind: 'REMINDER', status: 'NOT_CONFIGURED' },
  ]);
});

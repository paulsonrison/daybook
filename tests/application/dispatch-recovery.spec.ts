import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';

test('older dispatch history remains browseable until explicitly refreshed', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `dispatch-pages-${crypto.randomUUID()}@example.test`,
  );
  const records = Array.from({ length: 201 }, (_, index) => ({
    id: crypto.randomUUID(),
    residentId: f.residents[0].id,
    invoiceId: null,
    kind: 'INVOICE',
    channel: 'SMS',
    recipient: '+919876543210',
    providerMessageId: null,
    status: index === 0 ? 'ACCEPTED' : 'FAILED',
    reason: null,
    attempts: 1,
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
  }));
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('dispatchHistory')) {
      expect(body.variables.input.beforeId).toBe(records[199].id);
      await route.fulfill({
        json: {
          data: { dispatchHistory: { items: [records[200]], hasMore: false } },
        },
      });
      return;
    }
    if (body.query.includes('messageDispatches')) {
      await route.fulfill({
        json: { data: { messageDispatches: records.slice(0, 200) } },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/communications/documents');
  await page
    .getByRole('button', { name: 'Load older dispatches', exact: true })
    .click();
  const snapshot = page.getByText(
    'Older history is a recorded snapshot. Refresh dispatch history to return to automatic status updates.',
    { exact: true },
  );
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByRole('button', { name: 'Load older dispatches', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Refresh dispatch history', exact: true })
    .click();
  await expect(snapshot).toHaveCount(0);
});

test('owner uncertainty decisions preserve their original request after a lost response and distinguish verification from delivery', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `resolution-ui-${crypto.randomUUID()}@example.test`,
  );
  let status = 'UNKNOWN';
  const ids: string[] = [];
  let lose = true;
  const record = {
    id: crypto.randomUUID(),
    residentId: f.residents[0].id,
    invoiceId: null,
    kind: 'INVOICE',
    channel: 'SMS',
    recipient: '+919876543210',
    providerMessageId: null,
    reason: 'SUBMISSION_UNCERTAIN',
    attempts: 1,
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('resolveMessageUncertainty')) {
      ids.push(body.variables.input.requestId);
      expect(body.variables.input.evidence).toBe(
        'Checked synthetic provider account',
      );
      status = 'OWNER_ACCEPTED';
      if (lose) {
        lose = false;
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        json: { data: { resolveMessageUncertainty: { ...record, status } } },
      });
      return;
    }
    if (body.query.includes('messageResolutions')) {
      await route.fulfill({ json: { data: { messageResolutions: [] } } });
      return;
    }
    if (body.query.includes('messageDispatches')) {
      await route.fulfill({
        json: { data: { messageDispatches: [{ ...record, status }] } },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/communications/documents');
  await page
    .getByRole('button', { name: 'Review uncertain outcome', exact: true })
    .click();
  await expect(page.getByText('+919876543210', { exact: true })).toBeVisible();
  await page
    .getByLabel('Owner decision', { exact: true })
    .selectOption('CONFIRMED_ACCEPTED');
  await page
    .getByRole('textbox', { name: /^Verification evidence/ })
    .fill('Checked synthetic provider account');
  await page
    .getByRole('textbox', { name: /^Provider reference/ })
    .fill('synthetic-owner-reference');
  await expect(
    page.getByRole('button', { name: 'Record owner decision', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      'I checked this recipient and the supporting provider evidence',
      { exact: true },
    )
    .check();
  await page
    .getByRole('button', { name: 'Record owner decision', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check original operation', exact: true })
    .click();
  await expect(
    page.getByText('Acceptance verified by owner', { exact: true }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(
    page.getByText('Owner verification does not confirm delivery.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('a recovered invoice batch clears only its original submitted selection', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `batch-recovery-${crypto.randomUUID()}@example.test`,
  );
  async function run(query: string, variables: Record<string, unknown> = {}) {
    const response = await f.query(query, variables);
    expect(response.errors, JSON.stringify(response)).toBeUndefined();
    return response.data;
  }
  const today = (await run('{deliveryMetrics{today}}')).deliveryMetrics.today;
  await run(
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version}saveCollectionSettings(input:{upiId:"recovery@upi",payeeName:"Financial Review Browser",confirmOwnership:true}){version}}',
  );
  const bill = {
    residentId: f.residents[0].id,
    periodMode: 'CUSTOM',
    periods: [{ from: today, to: today }],
    adjustments: [
      {
        id: crypto.randomUUID(),
        kind: 'SURCHARGE',
        amount: '3.00',
        reason: 'Synthetic recovery invoice',
      },
    ],
  };
  const preview = (
    await run(
      'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
      { input: bill },
    )
  ).previewBill;
  const invoice = (
    await run(
      'mutation($input:InvoiceInput!){generateInvoice(input:$input){id}}',
      {
        input: {
          ...bill,
          requestId: crypto.randomUUID(),
          previewFingerprint: preview.fingerprint,
          acknowledgeUnmarkedDays: true,
        },
      },
    )
  ).generateInvoice;
  const document = (
    await run(
      'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          kind: 'INVOICE',
          sourceId: invoice.id,
          locale: 'en',
        },
      },
    )
  ).prepareDocument;
  await run(
    'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
    { input: { requestId: crypto.randomUUID(), documentId: document.id } },
  );
  await run(
    'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){id}}',
    { input: { requestId: crypto.randomUUID(), documentId: document.id } },
  );
  const ids: string[] = [];
  let loseFirst = true;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('queueInvoiceMessages')) {
      ids.push(body.variables.input.requestId);
      if (loseFirst) {
        loseFirst = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.goto('/communications/documents');
  await page
    .getByLabel('Financial record', { exact: true })
    .selectOption(invoice.id);
  await page
    .getByRole('button', { name: 'Add invoice to batch', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Queue selected invoices', exact: true })
    .click();
  await expect(
    page.getByText('Original operation unconfirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Check original operation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Prepare new document', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Queue selected invoices', exact: true }),
  ).toBeDisabled();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect((await run('{messageDispatches{id}}')).messageDispatches).toHaveLength(
    1,
  );
});

test('recorded accepted messages refresh through delivered and read without a page reload', async ({
  page,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `delivery-status-view-${crypto.randomUUID()}@example.test`,
  );
  let status = 'ACCEPTED';
  const record = {
    id: crypto.randomUUID(),
    residentId: f.residents[0].id,
    invoiceId: crypto.randomUUID(),
    kind: 'INVOICE',
    channel: 'WHATSAPP',
    reason: null,
    attempts: 1,
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('messageDispatches')) {
      await route.fulfill({
        json: { data: { messageDispatches: [{ ...record, status }] } },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/communications/documents');
  await expect(
    page.getByText('Accepted by provider', { exact: true }),
  ).toBeVisible();
  status = 'DELIVERED';
  await expect(page.getByText('Delivered', { exact: true })).toBeVisible({
    timeout: 12000,
  });
  status = 'READ';
  await expect(page.getByText('Read', { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(
    page.getByRole('button', { name: 'Refresh dispatch history', exact: true }),
  ).toBeVisible();
});

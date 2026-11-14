import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('owner prepares and shares an invoice PDF, reviews its QR, and sees an unconfigured message batch honestly', async ({
  page,
  request,
  baseURL,
}) => {
  const f = await financialBrowser(
    page,
    baseURL!,
    `document-dispatch-${crypto.randomUUID()}@example.test`,
  );
  const today = (await f.query('{deliveryMetrics{today}}')).data.deliveryMetrics
    .today;
  await f.query(
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version}saveCollectionSettings(input:{upiId:"browser@upi",payeeName:"Financial Review Browser",confirmOwnership:true}){version}}',
  );
  await f.query(
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        residentId: f.residents[0].id,
        version: 0,
        locale: 'en',
        whatsapp: false,
        sms: true,
        confirmedConsent: true,
        evidence: 'Explicit synthetic bill consent',
      },
    },
  );
  const bill = {
    residentId: f.residents[0].id,
    periodMode: 'CUSTOM',
    periods: [{ from: today, to: today }],
    adjustments: [
      {
        id: crypto.randomUUID(),
        kind: 'SURCHARGE',
        amount: '7.25',
        reason: 'Synthetic invoice charge',
      },
    ],
  };
  const preview = (
    await f.query(
      'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
      { input: bill },
    )
  ).data.previewBill;
  const invoice = (
    await f.query(
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
  ).data.generateInvoice;
  await page.goto('/communications/documents');
  await expect(
    page.getByRole('heading', { name: 'Documents and dispatch', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Resident', { exact: true })
    .selectOption(f.residents[0].id);
  await page
    .getByLabel('Financial record', { exact: true })
    .selectOption(invoice.id);
  await page
    .getByRole('button', { name: 'Prepare new document', exact: true })
    .click();
  await expect(
    page.getByText('Document snapshot prepared', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  await expect(page.getByText('PDF ready', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'UPI payment QR', exact: true }),
  ).toBeVisible();
  const ownerPath = await page
    .getByRole('link', { name: 'Download PDF', exact: true })
    .getAttribute('href');
  const pdf = await page.request.get(ownerPath!);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page
    .getByRole('button', { name: 'Create share link', exact: true })
    .click();
  const publicUrl = await page
    .getByRole('link', { name: 'Open shared document', exact: true })
    .getAttribute('href');
  expect((await request.get(publicUrl!)).status()).toBe(200);
  await page
    .getByRole('button', { name: 'Add invoice to batch', exact: true })
    .click();
  await page.getByLabel('Message channel', { exact: true }).selectOption('SMS');
  await expect(page.getByText('₹27.30', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Queue selected invoices', exact: true })
    .click();
  await expect(
    page.getByText('Provider not configured', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Revoke link 1', exact: true })
    .click();
  await expect
    .poll(async () => (await request.get(publicUrl!)).status())
    .toBe(404);
});

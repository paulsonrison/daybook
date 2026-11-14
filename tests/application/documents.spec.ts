import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';
test('owner downloads a genuine receipt through the app and an anonymous expiring link stops after revocation', async ({
  page,
  request,
  baseURL,
}) => {
  const f = await financialBrowser(
      page,
      baseURL!,
      `documents-${crypto.randomUUID()}@example.test`,
    ),
    today = (await f.query('{deliveryMetrics{today}}')).data.deliveryMetrics
      .today;
  const payment = (
    await f.query(
      'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          residentId: f.residents[0].id,
          purpose: 'ACCOUNT',
          method: 'CASH',
          amount: '5.25',
          date: today,
          confirmReceived: true,
          confirmationNote: 'Owner confirmed cash for receipt',
        },
      },
    )
  ).data.recordPayment;
  const doc = (
    await f.query(
      'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          kind: 'PAYMENT_RECEIPT',
          sourceId: payment.id,
          locale: 'hi',
        },
      },
    )
  ).data.prepareDocument;
  const generated = await f.query(
    'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
    { input: { requestId: crypto.randomUUID(), documentId: doc.id } },
  );
  expect(generated.data.generateDocument.status).toBe('READY');
  const download = await page.request.get('/api/documents/owner/' + doc.id);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('application/pdf');
  expect((await download.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await download.body()).toString('latin1')).toContain(
    'NotoSansDevanagari',
  );
  const linked = await f.query(
    'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){id url}}',
    {
      input: {
        requestId: crypto.randomUUID(),
        documentId: doc.id,
        expiryDays: 7,
      },
    },
  );
  expect(linked.data?.createDocumentLink, JSON.stringify(linked)).toBeTruthy();
  const link = linked.data.createDocumentLink;
  const publicFile = await request.get(link.url);
  expect(publicFile.status()).toBe(200);
  expect(publicFile.headers()['cache-control']).toContain('no-store');
  expect((await publicFile.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await f.query(
    'mutation($input:RevokeDocumentLinkInput!){revokeDocumentLink(input:$input){id}}',
    { input: { requestId: crypto.randomUUID(), linkId: link.id } },
  );
  expect((await request.get(link.url)).status()).toBe(404);
});

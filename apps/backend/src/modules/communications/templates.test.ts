import assert from 'node:assert/strict';
import test from 'node:test';

test('financial message templates preserve exact money in English, Malayalam and Hindi', async () => {
  const path = './templates.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(
    module?.noticeText,
    'Localized financial message templates must exist',
  );
  for (const locale of ['en', 'ml', 'hi']) {
    for (const kind of ['INVOICE', 'REMINDER', 'CREDIT_HOLD']) {
      const text = module.noticeText(kind, locale, {
        agency: 'Lotus Agency',
        resident: 'Asha',
        amount: '90071992547409.93',
        reference: 'INV-123',
        documentUrl: 'https://daybook.example/document',
        paymentUrl: 'upi://pay?pa=synthetic%40upi',
      });
      assert.ok(text.includes('Lotus Agency'));
      assert.ok(text.includes('Asha'));
      assert.ok(text.includes('₹9,00,71,99,25,47,409.93'));
      assert.ok(text.includes('https://daybook.example/document'));
      assert.ok(text.includes('upi://pay?pa=synthetic%40upi'));
      if (locale === 'ml') assert.match(text, /[\u0d00-\u0d7f]/);
      if (locale === 'hi') assert.match(text, /[\u0900-\u097f]/);
    }
  }
  assert.throws(() => module.noticeText('INVOICE', 'fr', {}), /supported/);
});

test('approved WhatsApp template settings require matching languages and a fixed parameter contract', async () => {
  const path = './templates.js';
  const module = await import(path);
  assert.ok(module.approvedTemplate, 'Approved template validation must exist');
  const settings = module.approvedTemplate({
    kind: 'INVOICE',
    locale: 'hi',
    name: 'monthly_invoice',
    language: 'hi',
    qrHeader: true,
  });
  assert.deepEqual(settings, {
    kind: 'INVOICE',
    locale: 'hi',
    name: 'monthly_invoice',
    language: 'hi',
    qrHeader: true,
  });
  assert.throws(
    () => module.approvedTemplate({ ...settings, language: 'en_US' }),
    /language/,
  );
  assert.throws(
    () => module.approvedTemplate({ ...settings, name: '../template' }),
    /name/,
  );
  const values = {
    agency: 'Lotus Agency',
    resident: 'Asha',
    amount: '100.50',
    reference: 'INV-123',
    documentUrl: 'https://daybook.example/document',
    paymentUrl: 'upi://pay?pa=synthetic%40upi',
  };
  assert.throws(() => module.providerTemplate(settings, values), /QR/);
  const template = module.providerTemplate(
    settings,
    values,
    'https://daybook.example/qr.png',
  );
  assert.deepEqual(template, {
    name: 'monthly_invoice',
    language: 'hi',
    parameters: [
      'Asha',
      'Lotus Agency',
      'INV-123',
      '₹100.50',
      values.documentUrl,
      values.paymentUrl,
    ],
    qrUrl: 'https://daybook.example/qr.png',
  });
});

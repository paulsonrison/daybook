import { test, expect } from '@playwright/test';
import { financialBrowser } from './financial-support';

test('native subscription and price panels retain weekday indices, original identities and exact prices', async ({
  page,
  baseURL,
}) => {
  const { query } = await financialBrowser(
    page,
    baseURL!,
    `native-subscription-${crypto.randomUUID()}@example.test`,
    ['Original Subscriber'],
  );
  const result = await query(
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
    {
      input: {
        name: 'Original Publication',
        edition: 'Original Edition',
        language: 'English',
        kind: 'NEWSPAPER',
        dispatch: 'MORNING',
        frequency: 'DAILY',
        publishingDays: [0, 1, 2, 3, 4, 5, 6],
        weekdayPrice: '8.15',
        weekendPrice: '12.25',
      },
    },
  );
  const publicationId = result.data.savePublication.id;
  await page.goto('/residents');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('hi');
  await page
    .getByRole('button', { name: 'सदस्यताएँ प्रबंधित करें', exact: true })
    .click();
  const panel = page.getByRole('dialog');
  await expect(
    panel.getByRole('heading', {
      name: 'Original Subscriber · सदस्यताएँ',
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByLabel('प्रकाशन', { exact: false })
    .selectOption(publicationId);
  await panel
    .getByLabel('वितरण की आवृत्ति', { exact: true })
    .selectOption('WEEKDAYS');
  await panel
    .getByLabel('सदस्यता शुरू होने की तिथि', { exact: false })
    .fill('2024-01-01');
  await panel.getByRole('checkbox', { name: 'सोमवार', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'बुधवार', exact: true }).check();
  await panel
    .getByRole('button', { name: 'सदस्यता सहेजें', exact: true })
    .click();
  await expect(
    panel.getByRole('row').filter({ hasText: 'Original Publication' }),
  ).toContainText('चुने हुए सप्ताह के दिन');
  const subscriptions = await query(
    '{subscriptions{publicationId cadence weekdays}}',
  );
  expect(subscriptions.data.subscriptions).toEqual([
    { publicationId, cadence: 'WEEKDAYS', weekdays: [1, 3] },
  ]);
  await panel
    .getByRole('button', { name: 'सदस्यताएँ बंद करें', exact: true })
    .click();
  await page.goto('/publications');
  await page.getByRole('button', { name: 'मूल्य नियम', exact: true }).click();
  await expect(
    panel.getByRole('heading', {
      name: 'Original Publication · मूल्य नियम',
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByLabel('लागू होने की तिथि', { exact: false })
    .fill('2024-01-01');
  await panel.getByLabel('विशेष मूल्य', { exact: false }).fill('9.75');
  await panel.getByRole('checkbox', { name: 'सोमवार', exact: true }).check();
  await panel
    .getByRole('button', { name: 'मूल्य नियम सहेजें', exact: true })
    .click();
  await expect(panel.getByRole('table')).toContainText('₹9.75');
  const prices = await query('{priceRules{publicationId price weekdays}}');
  expect(prices.data.priceRules).toEqual([
    { publicationId, price: '9.75', weekdays: [1] },
  ]);
});

test('publication editor translates choices while saving original publication data and protocol values', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `native-publication-${crypto.randomUUID()}@example.test`,
  );
  await page.goto('/publications');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('hi');
  await page
    .getByRole('button', { name: 'प्रकाशन जोड़ें', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'प्रकाशन जोड़ें', exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel('प्रकाशन का नाम', { exact: false })
    .fill('Original Publication');
  await dialog.getByLabel('संस्करण', { exact: false }).fill('Original Edition');
  await expect(
    dialog.getByLabel('प्रकाशन का प्रकार', { exact: true }),
  ).toHaveValue('NEWSPAPER');
  await dialog.getByLabel('प्रेषण', { exact: true }).selectOption('EVENING');
  await expect(
    dialog.getByLabel('प्रकाशन की आवृत्ति', { exact: true }),
  ).toHaveValue('DAILY');
  await dialog.getByLabel('कार्यदिवस का मूल्य', { exact: false }).fill('3.55');
  await dialog.getByLabel('सप्ताहांत का मूल्य', { exact: false }).fill('3.55');
  await dialog
    .getByRole('button', { name: 'प्रकाशन सहेजें', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Original Publication' });
  await expect(row).toContainText('Original Edition');
  await expect(row).toContainText('दैनिक · शाम');
  await expect(row).toContainText('₹3.55');
  await page.getByLabel('रिकॉर्ड खोजें', { exact: true }).fill('शाम');
  await expect(row).toBeVisible();
});

test('resident editor keeps an invalid draft and displays native validation without saving it', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `native-editor-${crypto.randomUUID()}@example.test`,
    ['Editor Original'],
  );
  await page.goto('/residents');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('hi');
  await page
    .getByRole('button', { name: 'निवासी संपादित करें', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'निवासी संपादित करें', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('निवासी का नाम', { exact: false }),
  ).toHaveValue('Editor Original');
  await dialog
    .getByLabel('निवासी का नाम', { exact: false })
    .fill('Unsaved original draft');
  await dialog.getByLabel('फ़ोन', { exact: false }).fill('invalid');
  await dialog
    .getByRole('button', { name: 'निवासी सहेजें', exact: true })
    .click();
  await expect(
    dialog.getByText('देश कोड के साथ मान्य फ़ोन नंबर भरें।', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('निवासी का नाम', { exact: false }),
  ).toHaveValue('Unsaved original draft');
  await dialog.getByRole('button', { name: 'रद्द करें', exact: true }).click();
  await expect(
    page.getByText('Editor Original', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Unsaved original draft', { exact: true }),
  ).toHaveCount(0);
});

test('resident directory uses the selected language while preserving customer records', async ({
  page,
  baseURL,
}) => {
  await financialBrowser(
    page,
    baseURL!,
    `native-directory-${crypto.randomUUID()}@example.test`,
    ['Original Resident'],
  );
  await page.goto('/residents');
  await page
    .getByLabel('Interface language', { exact: true })
    .selectOption('hi');
  await expect(
    page.getByRole('heading', { name: 'निवासी और सदस्यताएँ', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'वितरण का पता', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('रिकॉर्ड खोजें', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Original Resident', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'Original Resident' })
      .getByRole('cell')
      .nth(1),
  ).toContainText('1 Lotus');
  await page
    .getByLabel('रिकॉर्ड खोजें', { exact: true })
    .fill('unmatched-resident');
  await expect(
    page.getByRole('heading', {
      name: 'मेल खाते रिकॉर्ड नहीं मिले',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('रिकॉर्ड खोजें', { exact: true }).fill('');
  await expect(
    page.getByText('Original Resident', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'निवासी और सदस्यताएँ', exact: true }),
  ).toBeVisible();
  await page.getByLabel('इंटरफ़ेस की भाषा', { exact: true }).selectOption('ml');
  await expect(
    page.getByRole('heading', {
      name: 'താമസക്കാരും സബ്‌സ്‌ക്രിപ്ഷനുകളും',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Original Resident', { exact: true }),
  ).toBeVisible();
});

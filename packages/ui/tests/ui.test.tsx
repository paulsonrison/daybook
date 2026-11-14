import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
test('persisted preference values stay within the shared theme contract and reject corrupt values', async () => {
  const feature = await import('../src/preferences.js').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    },
  );
  assert.ok(
    feature?.validatePreferences,
    'Shared preference validation must exist',
  );
  const { colorSchemes, fonts } = await import('../src/tokens');
  assert.deepEqual(
    [...feature.preferenceSchemes].sort(),
    Object.keys(colorSchemes).sort(),
  );
  assert.deepEqual(
    [...feature.preferenceFonts].sort(),
    Object.keys(fonts).sort(),
  );
  assert.deepEqual(feature.defaultPreferences.typography, defaultTypography);
  assert.deepEqual(
    feature.validatePreferences(feature.defaultPreferences),
    feature.defaultPreferences,
  );
  assert.throws(() =>
    feature.validatePreferences({
      ...feature.defaultPreferences,
      locale: 'ar',
    }),
  );
  assert.throws(() =>
    feature.validatePreferences({
      ...feature.defaultPreferences,
      typography: { ...feature.defaultPreferences.typography, size: NaN },
    }),
  );
  assert.throws(() =>
    feature.validatePreferences({
      ...feature.defaultPreferences,
      typography: { ...feature.defaultPreferences.typography, lineHeight: 9 },
    }),
  );
});
import {
  Button,
  Field,
  Select,
  DataTable,
  PaymentConfirmation,
  BarChart,
  RecoveryPanel,
  recoveryPresets,
  pageWindow,
  formatMoney,
  validateDateRange,
  typographyVariables,
  defaultTypography,
} from '../src';

test('contact actions use immediate safe links and distinguish unavailable contact details', async () => {
  const path = '../src/index.ts';
  const ui = await import(path);
  assert.ok(ui.ContactActions, 'Reusable contact actions must exist');
  const ContactActions = ui.ContactActions;
  const html = renderToStaticMarkup(
    <ContactActions
      tel="tel:+919876543210"
      whatsapp="https://wa.me/919876543210?text=Hello"
    />,
  );
  assert.match(html, /href="tel:\+919876543210"/);
  assert.match(html, /href="https:\/\/wa.me\/919876543210\?text=Hello"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Delivered|Message sent/);
  const unsafe = renderToStaticMarkup(
    <ContactActions
      tel="javascript:alert(1)"
      whatsapp="https://wa.me.attacker.example/123"
    />,
  );
  assert.doesNotMatch(unsafe, /href=/);
  assert.match(unsafe, /Contact unavailable/);
});

test('decimal money strings render every paisa without floating-point conversion', () => {
  assert.equal(formatMoney('90071992547409.93'), '₹9,00,71,99,25,47,409.93');
  assert.equal(formatMoney('-0.50'), '-₹0.50');
  assert.equal(formatMoney('0.00'), '₹0.00');
  assert.equal(formatMoney('missing'), '—');
});

test('filtered and failed tables do not claim that the dataset is empty', () => {
  for (const state of ['no-results', 'error'] as const) {
    const html = renderToStaticMarkup(
      <DataTable
        rows={[]}
        columns={[]}
        rowKey={() => 'unused'}
        caption="Staff"
        state={state}
        emptyTitle="No staff profiles yet"
        emptyAction={<Button>Add first staff</Button>}
      />,
    );
    assert.doesNotMatch(html, /No staff profiles yet|Add first staff/);
    assert.match(
      html,
      state === 'no-results' ? /No matching records/ : /Records unavailable/,
    );
  }
});

test('removed and invalid pages clamp safely; an empty list has no fictitious first row', () => {
  assert.deepEqual(pageWindow(326, 99, 5), {
    current: 66,
    pages: 66,
    start: 326,
    end: 326,
    total: 326,
  });
  assert.deepEqual(pageWindow(0, -1, 0), {
    current: 1,
    pages: 1,
    start: 0,
    end: 0,
    total: 0,
  });
  assert.equal(pageWindow(3, NaN, Infinity).current, 1);
});
test('missing money remains unknown while confirmed zero is formatted', () => {
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney(NaN), '—');
  assert.equal(formatMoney(0), '₹0.00');
});
test('billing periods reject reversed, impossible and future dates, including leap-year boundaries', () => {
  assert.match(validateDateRange('2026-11-02', '2026-11-01')!, /on or before/);
  assert.equal(
    validateDateRange('2026-02-29', '2026-03-01'),
    'Enter valid dates.',
  );
  assert.equal(validateDateRange('2028-02-29', '2028-03-01'), undefined);
  assert.match(
    validateDateRange('2026-11-01', '2026-12-01', '2026-11-09')!,
    /Future/,
  );
  assert.match(validateDateRange('', '')!, /Choose/);
});
test('an in-flight submit remains disabled and announces its loading state', () => {
  const html = renderToStaticMarkup(
    <Button loading loadingLabel="Recording…">
      Mark as paid
    </Button>,
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Recording…/);
  assert.doesNotMatch(html, />Mark as paid</);
});
test('field errors are linked to their control and preserve entered data', () => {
  const html = renderToStaticMarkup(
    <Field
      id="quantity"
      label="Delivered copies"
      value="-1"
      error="Enter a whole number from 0 to 30."
      readOnly
    />,
  );
  assert.match(html, /for="quantity"/);
  assert.match(html, /aria-describedby="quantity-error"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /value="-1"/);
});
test('a temporarily missing select option retains the current selection', () => {
  const html = renderToStaticMarkup(
    <Select
      label="Route"
      value="R01"
      options={[]}
      state="error"
      onChange={() => {}}
    />,
  );
  assert.match(html, /value="R01" selected=""/);
  assert.match(html, /selection is preserved/);
});
test('an unknown payment cannot display a receipt, a paid badge, or a second payment action', () => {
  const html = renderToStaticMarkup(
    <PaymentConfirmation
      status="unknown"
      amount={661}
      invoice="DB-2026-1048"
      onCheckStatus={() => {}}
      onReceipt={() => {}}
      onNext={() => {}}
    />,
  );
  assert.match(html, /Check payment status/);
  assert.doesNotMatch(
    html,
    /Payment recorded|Print receipt|Move to next|No payment was recorded/,
  );
});
test('partial receipts preserve the remaining balance and do not say paid', () => {
  const html = renderToStaticMarkup(
    <PaymentConfirmation
      status="partial"
      amount={200}
      remaining={461}
      invoice="DB-2026-1048"
    />,
  );
  assert.match(html, /₹200.00/);
  assert.match(html, /₹461.00/);
  assert.doesNotMatch(html, />Paid</);
});
test('missing chart data is not rendered as a zero-value chart', () => {
  const missing = renderToStaticMarkup(
    <BarChart title="Collections" data={[{ label: 'Nov', value: null }]} />,
  );
  const zero = renderToStaticMarkup(
    <BarChart title="Collections" data={[{ label: 'Nov', value: 0 }]} />,
  );
  assert.match(missing, /No collection history/);
  assert.doesNotMatch(missing, /role="img"/);
  assert.match(zero, /role="img"/);
  assert.match(zero, /Nov: 0/);
});
test('a partially loaded table retains its records and recovery action', () => {
  const html = renderToStaticMarkup(
    <DataTable
      caption="Residents"
      state="partial"
      rows={[{ id: '1', name: 'Anitha' }]}
      rowKey={(row) => row.id}
      columns={[{ key: 'name', header: 'Resident', render: (row) => row.name }]}
      onRetry={() => {}}
    />,
  );
  assert.match(html, /Anitha/);
  assert.match(html, /Retry table/);
  assert.match(html, /not finalized/);
});
test('all 24 exported recovery scenarios have usable messages; uncertain payments remain uncertain', () => {
  assert.equal(recoveryPresets.length, 24);
  assert.equal(new Set(recoveryPresets.map((item) => item.id)).size, 24);
  for (const preset of recoveryPresets) {
    assert.ok(preset.title, preset.name);
    assert.ok(preset.description, preset.name);
  }
  const html = renderToStaticMarkup(
    <RecoveryPanel scenario="16" onAction={() => {}} />,
  );
  assert.match(html, /may already be recorded/);
  assert.match(html, /Check payment status/);
  assert.doesNotMatch(html, /No payment recorded/);
});
test('invalid typography values cannot corrupt the entire interface; unavailable italic uses a real fallback', () => {
  assert.equal(
    (typographyVariables({ size: NaN }) as Record<string, unknown>)[
      '--db-reading-size'
    ],
    '14px',
  );
  assert.equal(
    (typographyVariables({ size: 100 }) as Record<string, unknown>)[
      '--db-reading-size'
    ],
    '24px',
  );
  assert.match(
    String(
      (
        typographyVariables({ family: 'manrope', style: 'italic' }) as Record<
          string,
          unknown
        >
      )['--db-font-family'],
    ),
    /Inter/,
  );
});
test('every extracted vector is local, has a reserved viewport, and preserves source geometry', () => {
  const sourceRoot = path.resolve('../../docs/design/figma/main');
  const sources = readdirSync(sourceRoot)
    .filter((name) => name.endsWith('.svg'))
    .map((name) => readFileSync(path.join(sourceRoot, name), 'utf8'));
  const assetRoot = path.resolve('src/assets/icons');
  const assets = readdirSync(assetRoot).filter((name) => name.endsWith('.svg'));
  assert.equal(assets.length, 39);
  for (const name of assets) {
    const svg = readFileSync(path.join(assetRoot, name), 'utf8');
    assert.match(
      svg,
      /<svg[^>]*width="\d+"[^>]*height="\d+"[^>]*viewBox="[^"]+"/,
      name,
    );
    assert.doesNotMatch(svg, /<script|(?:href|src)="https?:/i, name);
    for (const match of svg.matchAll(/\bd="([^"]+)"/g))
      assert.ok(
        sources.some((source) => source.includes(`d="${match[1]}"`)),
        `${name}: changed path`,
      );
    for (const match of svg.matchAll(/url\(#([^)]+)\)/g))
      assert.ok(
        svg.includes(`id="${match[1]}"`),
        `${name}: missing ${match[1]}`,
      );
  }
});

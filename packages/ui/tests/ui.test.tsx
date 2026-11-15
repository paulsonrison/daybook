import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

test('field loading and selection recovery localize defaults while preserving values and supplied labels', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { Field, Select, SearchField } =
    await import('../src/components/fields');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <Field label="Custom field" value="Original text" readOnly loading />
      <Select
        label="Custom selection"
        value="original-id"
        state="error"
        options={[]}
        onRetry={() => {}}
        onChange={() => {}}
      />
      <SearchField
        label="Customer search"
        value="Original query"
        onValueChange={() => {}}
        state="error"
        onRetry={() => {}}
      />
    </I18nProvider>,
  );
  assert.match(html, /सहेजा गया मान लोड हो रहा है/);
  assert.match(html, /विकल्प लोड नहीं हुए/);
  assert.match(html, /खोज सुरक्षित है/);
  assert.match(html, /original-id/);
  assert.match(html, /Original query/);
  assert.match(html, /Custom selection/);
  assert.doesNotMatch(
    html,
    /Loading saved value|Couldn’t load options|>Retry</,
  );
});

test('translated payment presentations distinguish uncertain and confirmed records', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { PaymentConfirmation, NextRecord } =
    await import('../src/components/billing');
  const unknown = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <PaymentConfirmation
        status="unknown"
        amount="200.00"
        invoice="INV-1"
        onCheckStatus={() => {}}
        onReceipt={() => {}}
      />
    </I18nProvider>,
  );
  assert.match(unknown, /भुगतान की पुष्टि नहीं हुई/);
  assert.match(unknown, /भुगतान पहले से दर्ज हो सकता है/);
  assert.doesNotMatch(unknown, /रसीद प्रिंट करें/);
  const confirmed = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <PaymentConfirmation
        status="partial"
        amount="200.00"
        remaining="461.00"
        invoice="INV-1"
        receipt="RECEIPT-1"
        description="Customer proof"
        onReceipt={() => {}}
      />
      <NextRecord context="Route R01" state="end" skipped={2} />
    </I18nProvider>,
  );
  assert.match(confirmed, /आंशिक भुगतान दर्ज हुआ/);
  assert.match(confirmed, /Customer proof/);
  assert.match(confirmed, /RECEIPT-1/);
  assert.match(confirmed, /2 छोड़े गए खातों का भुगतान बाकी है/);
});

test('bill summary translates owned labels and retains supplied names and exact amounts', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { BillSummary } = await import('../src/components/billing');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <BillSummary
        resident={{
          name: 'Original resident',
          reference: 'REF-1',
          address: 'Original address',
        }}
        invoice="INV-1"
        period="2026-11"
        issued="2026-11-01"
        due="2026-11-15"
        status="Saved"
        lines={[
          {
            id: '1',
            publication: 'Original publication',
            quantity: null,
            rate: null,
            amount: '9007199254740993.01',
          },
        ]}
        totals={[]}
      />
    </I18nProvider>,
  );
  assert.match(html, /प्रकाशन और वितरण का विवरण/);
  assert.match(html, /दर आवश्यक है/);
  assert.match(html, /अनुपलब्ध/);
  assert.match(html, /Original resident/);
  assert.match(html, /Original publication/);
  assert.match(html, /9007199254740993\.01/);
  assert.doesNotMatch(html, /Bill to|Publication \/ delivery|Rate required/);
});

test('workflow and pending buttons translate owned labels while preserving explicit labels', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { Button, WorkflowButton } = await import('../src/components/button');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <WorkflowButton action="generate" />
      <Button loading>Save</Button>
      <Button loading loadingLabel="Keep original label">
        Save
      </Button>
    </I18nProvider>,
  );
  assert.match(html, /बिल बनाएँ/);
  assert.match(html, /लोड हो रहा है/);
  assert.match(html, /Keep original label/);
  assert.doesNotMatch(html, /Generate bill|Loading…/);
});

test('table recovery and pagination localize owned text without translating records or captions', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { DataTable, Pagination } =
    await import('../src/components/data-table');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <DataTable
        caption="Customer dataset"
        rows={[{ id: '1', name: 'Original customer' }]}
        rowKey={(row) => row.id}
        columns={[
          { key: 'name', header: 'Custom header', render: (row) => row.name },
        ]}
        state="partial"
        onRetry={() => {}}
      />
      <Pagination total={30} page={2} pageSize={10} onPageChange={() => {}} />
    </I18nProvider>,
  );
  assert.match(html, /तालिका फिर लोड करें/);
  assert.match(html, /11–20/);
  assert.match(html, /पिछला/);
  assert.match(html, /अगला/);
  assert.match(html, /Customer dataset/);
  assert.match(html, /Original customer/);
  assert.match(html, /Custom header/);
  assert.doesNotMatch(html, /Retry table|Showing|Previous/);
});

test('every recovery preset has explicit native title, description and action translations', async () => {
  const { recoveryPresets } = await import('../src/components/recovery');
  const { hasTranslation, translate } = await import('../src/messages.js');
  for (const locale of ['ml', 'hi'] as const)
    for (const preset of recoveryPresets)
      for (const text of [
        preset.title,
        preset.description,
        ...preset.actions,
      ]) {
        assert.ok(
          hasTranslation(locale, text),
          `${locale}: ${preset.id}: ${text}`,
        );
        assert.notEqual(
          translate(locale, text),
          text,
          `${locale}: ${preset.id}: untranslated copy`,
        );
      }
});

test('payment recovery preserves uncertainty in native defaults and leaves custom content unchanged', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { RecoveryPanel } = await import('../src/components/recovery');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <RecoveryPanel scenario="16" onAction={() => {}} />
      <RecoveryPanel
        scenario="16"
        title="Customer title"
        description="Custom proof reference"
        actionLabels={['Custom action']}
      />
    </I18nProvider>,
  );
  assert.match(html, /भुगतान पहले से दर्ज हो सकता है/);
  assert.match(html, /भुगतान की स्थिति जाँचें/);
  assert.match(html, /Customer title/);
  assert.match(html, /Custom proof reference/);
  assert.match(html, /Custom action/);
  assert.doesNotMatch(html, /We’re checking this payment/);
});

test('shared loading and missing states localize owned defaults while preserving supplied data', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { DataState, LoadingIndicator, Notification, TableSkeleton } =
    await import('../src/components/feedback');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <DataState kind="missing" onRetry={() => {}} />
      <LoadingIndicator />
      <TableSkeleton />
      <Notification title="Resident Custom Name" onDismiss={() => {}} />
      <DataState
        kind="empty"
        title="Customer free text"
        description="Keep this exact"
      />
    </I18nProvider>,
  );
  assert.match(html, /पृष्ठ नहीं मिला/);
  assert.match(html, /फिर कोशिश करें/);
  assert.match(html, /सूचना हटाएँ/);
  assert.match(html, /Resident Custom Name/);
  assert.match(html, /Customer free text/);
  assert.match(html, /Keep this exact/);
  assert.doesNotMatch(
    html,
    /Loading…|Loading records…|Page not found|Dismiss notification/,
  );
});

test('appearance controls localize labels, choices and recovery without changing selected values', async () => {
  const { I18nProvider } = await import('../src/i18n-context');
  const { TypographyControls, DisplayModePicker, ColorSchemePicker } =
    await import('../src/components/preferences');
  const html = renderToStaticMarkup(
    <I18nProvider locale="hi">
      <DisplayModePicker value="dark" onChange={() => {}} />
      <ColorSchemePicker value="teal" onChange={() => {}} />
      <TypographyControls status="save-error" onChange={() => {}} />
    </I18nProvider>,
  );
  assert.match(html, /प्रदर्शन मोड/);
  assert.match(html, /गहरा/);
  assert.match(html, /अक्षर का वज़न/);
  assert.match(html, /पसंद सहेजी नहीं गई/);
  assert.doesNotMatch(
    html,
    />Selected<|>Custom reading size<|>Preferences were not saved</,
  );
  assert.match(html, /value="400" selected/);
});
test('message catalogues resolve native text and parameters without confusing fallback with coverage', async () => {
  const feature = await import('../src/messages.js').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    },
  );
  assert.ok(feature?.translate, 'Shared message catalogues must exist');
  assert.equal(feature.translate('en', 'Save'), 'Save');
  assert.equal(feature.translate('ml', 'Save'), 'സേവ് ചെയ്യുക');
  assert.equal(feature.translate('hi', 'Save'), 'सहेजें');
  assert.equal(
    feature.translate('ml', '{p0} copies', { p0: 12 }),
    '12 പകർപ്പുകൾ',
  );
  assert.equal(feature.hasTranslation('ml', 'An unregistered message'), false);
  assert.equal(
    feature.translate('ml', 'An unregistered message'),
    'An unregistered message',
  );
  assert.throws(() => feature.translate('hi', '{p0} copies'));
});
test('rendered operational messages retain exact interpolated data when localized', async () => {
  const feature = await import('../src/messages.js');
  assert.ok(
    feature.translateRendered,
    'Already rendered validation and status messages need safe localization',
  );
  assert.equal(
    feature.translateRendered('ml', '7 jobs await retry or investigation.'),
    '7 ജോലികൾ വീണ്ടും ശ്രമിക്കാനോ പരിശോധിക്കാനോ കാത്തിരിക്കുന്നു.',
  );
  assert.equal(
    feature.translateRendered('hi', '<Resident> collection not confirmed'),
    '<Resident> की वसूली की पुष्टि नहीं हुई',
  );
  assert.equal(
    feature.translateRendered('ml', '{p0} collection not confirmed'),
    '{p0} പണപ്പിരിവ് സ്ഥിരീകരിച്ചിട്ടില്ല',
  );
  assert.equal(
    feature.translateRendered('en', '  7 jobs await retry or investigation.  '),
    '  7 jobs await retry or investigation.  ',
  );
  assert.equal(
    feature.translateRendered('ml', 'Unknown user text {x}'),
    'Unknown user text {x}',
  );
});
test('locale providers keep rendered messages isolated and escape interpolated user text', async () => {
  const feature = await import('../src/i18n-context').catch(
    (error: NodeJS.ErrnoException) => {
      if (
        ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code ?? '')
      )
        return null;
      throw error;
    },
  );
  assert.ok(feature?.I18nProvider, 'Scoped locale rendering must exist');
  function Sample() {
    const { t } = feature!.useI18n();
    return (
      <p>
        {t('Save')} · {t('{p0} copies', { p0: '<img src=x>' })}
      </p>
    );
  }
  const results = await Promise.all(
    ['ml', 'hi', 'en'].map((locale) =>
      Promise.resolve(
        renderToStaticMarkup(
          <feature.I18nProvider locale={locale as 'en' | 'ml' | 'hi'}>
            <Sample />
          </feature.I18nProvider>,
        ),
      ),
    ),
  );
  assert.ok(results[0].includes('സേവ് ചെയ്യുക'));
  assert.ok(results[1].includes('सहेजें'));
  assert.ok(results[2].includes('Save'));
  assert.ok(
    results.every(
      (html) => html.includes('&lt;img src=x&gt;') && !html.includes('<img'),
    ),
  );
});
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

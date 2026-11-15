import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
test('monthly workbook is genuine XLSX with native text, exact money and untrusted text cells rather than formulas', async () => {
  const feature = await import('./workbook.js').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    },
  );
  assert.ok(
    feature?.writeReportWorkbook,
    'A bounded genuine XLSX report writer must exist',
  );
  const snapshot = {
    version: 1 as const,
    title: 'മാസവിൽപ്പന റിപ്പോർട്ട്',
    meta: [],
    reference: 'REPORT-1',
    kind: 'SALES' as const,
    locale: 'ml' as const,
    agencyName: 'Original Agency',
    month: '2026-01',
    generatedAt: '2026-02-01T00:00:00.000Z',
    balanceAsOf: '2026-02-01',
    notes: ['രേഖപ്പെടുത്തിയ വിവരങ്ങൾ'],
    sections: [
      {
        title: 'വിൽപ്പന',
        columns: ['വിവരണം', 'തുക'],
        rows: [
          ['=HYPERLINK("https://example.test","x")', '9007199254740993.93'],
          ['+SUM(1,2)', '-1.00'],
          ['@Original Customer', '0.00'],
        ],
      },
    ],
  };
  const buffer = await feature.writeReportWorkbook(snapshot);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const files = unzipSync(buffer);
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['xl/workbook.xml']);
  const xml = Object.entries(files)
    .filter(([name]) => name.endsWith('.xml'))
    .map(([, value]) => strFromU8(value))
    .join('\n');
  assert.match(xml, /വിൽപ്പന/);
  assert.match(xml, /9007199254740993.93/);
  assert.match(xml, /HYPERLINK/);
  assert.match(xml, /@Original Customer/);
  assert.doesNotMatch(xml, /<f(?:[ >])/);
  assert.match(xml, /<(?:t|v)[ >]/);
  const decode = (value: string) =>
    value
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  const shared = [
    ...strFromU8(files['xl/sharedStrings.xml']).matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((match) =>
    [...match[1].matchAll(/<t(?:[^>]*)>([\s\S]*?)<\/t>/g)]
      .map((value) => decode(value[1]))
      .join(''),
  );
  const sheet = strFromU8(files['xl/worksheets/sheet2.xml']);
  const read = (reference: string) => {
    const cell = new RegExp(
      '<c[^>]*r="' + reference + '"[^>]*>([\\s\\S]*?)<\\/c>',
    ).exec(sheet);
    assert.ok(cell);
    const index = /<v>(\d+)<\/v>/.exec(cell[1]);
    assert.ok(index);
    return shared[Number(index[1])];
  };
  assert.equal(read('A3'), '=HYPERLINK("https://example.test","x")');
  assert.equal(read('B3'), '9007199254740993.93');
  assert.equal(read('A4'), '+SUM(1,2)');
});

test('report output refuses unsupported dimensions rather than silently truncating rows or cells', async () => {
  const feature = await import('./workbook.js').catch(() => null);
  assert.ok(feature?.writeReportWorkbook);
  const snapshot = {
    version: 1 as const,
    title: 'മാസവിൽപ്പന റിപ്പോർട്ട്',
    meta: [],
    reference: 'REPORT-LIMIT',
    kind: 'OPERATIONS' as const,
    locale: 'en' as const,
    agencyName: 'Agency',
    month: '2026-01',
    generatedAt: '2026-02-01T00:00:00Z',
    balanceAsOf: '2026-02-01',
    notes: [],
    sections: [
      {
        title: 'Rows',
        columns: ['Value'],
        rows: Array.from({ length: 10001 }, () => ['record']),
      },
    ],
  };
  await assert.rejects(feature.writeReportWorkbook(snapshot), /report/i);
  snapshot.sections[0].rows = [['x'.repeat(32768)]];
  await assert.rejects(feature.writeReportWorkbook(snapshot), /report/i);
  snapshot.sections[0].rows = [['one', 'extra']];
  await assert.rejects(feature.writeReportWorkbook(snapshot), /report/i);
});

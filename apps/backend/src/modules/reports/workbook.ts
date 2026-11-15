import writeXlsxFile, {
  type Cell,
  type SheetData,
} from 'write-excel-file/node';
import { assertReportBounds, type AgencyReportSnapshot } from './model.js';
/** Exact amounts and all customer supplied content remain string cells, never formulas or imprecise Excel numbers. */
export async function writeReportWorkbook(snapshot: AgencyReportSnapshot) {
  assertReportBounds(snapshot);
  const cell = (value: string, bold = false): Cell => ({
    type: String,
    value,
    fontWeight: bold ? 'bold' : undefined,
  });
  const sheets = [
    {
      name: '00',
      data: [
        [cell(snapshot.title, true)],
        [cell(snapshot.agencyName)],
        [cell(snapshot.reference)],
        ...snapshot.meta.map((row) => [cell(row.label, true), cell(row.value)]),
        ...snapshot.notes.map((note) => [cell(note)]),
      ] as SheetData,
    },
    ...snapshot.sections.map((section, index) => ({
      name: String(index + 1).padStart(2, '0'),
      data: [
        [cell(section.title, true)],
        section.columns.map((label) => cell(label, true)),
        ...section.rows.map((row) => row.map((value) => cell(value))),
      ] as SheetData,
    })),
  ];
  const buffer = await writeXlsxFile(sheets, {
    fontFamily:
      snapshot.locale === 'ml'
        ? 'Noto Sans Malayalam'
        : snapshot.locale === 'hi'
          ? 'Noto Sans Devanagari'
          : 'Inter',
    fontSize: 11,
  }).toBuffer();
  if (buffer.length > 10485760)
    throw new Error('Report workbook exceeds the supported file size limit.');
  return buffer;
}

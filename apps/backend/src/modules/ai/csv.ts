import { parse } from 'csv-parse/sync';
export interface DecodedTable {
  columns: string[];
  rows: string[][];
  evidence: { reference: string; text: string }[];
}
/** Coordinates address the decoded table, not physical lines (quoted CSV cells may span lines). */
export function decodeCsv(bytes: Uint8Array): DecodedTable {
  if (bytes.length > 1048576)
    throw new Error('CSV upload exceeds the supported 1 MiB limit.');
  let records: string[][];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error();
    records = parse(text, {
      bom: true,
      cast: false,
      cast_date: false,
      skip_empty_lines: true,
      max_record_size: 32768,
      relax_column_count: false,
      skip_records_with_error: false,
      on_record: (record: string[], context: { records: number }) => {
        if (context.records > 2001 || record.length > 30) throw new Error();
        return record;
      },
    }) as string[][];
  } catch {
    throw new Error(
      'CSV could not be read. Use UTF-8, consistent columns, at most 2,000 data rows and 32 KiB per record.',
    );
  }
  if (records.length < 2 || records[0].every((value) => !value.trim()))
    throw new Error('CSV requires a header and at least one data row.');
  const [columns, ...rows] = records;
  const evidence = rows.flatMap((row, index) =>
    row.map((text, column) => ({
      reference: `CSV!${column < 26 ? String.fromCharCode(65 + column) : `A${String.fromCharCode(65 + column - 26)}`}${index + 2}`,
      text,
    })),
  );
  return { columns, rows, evidence };
}

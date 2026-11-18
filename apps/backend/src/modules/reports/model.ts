import type { AgencyReportSnapshot } from '@daybook/ui/reports';
export type { AgencyReportSnapshot } from '@daybook/ui/reports';
export function assertReportArtifactSize(byteLength: number) {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 100 ||
    byteLength > 10485760
  )
    throw new Error(
      'Report artifact is outside the supported file size limit.',
    );
}
/** Reject the entire report at its public limits; never quietly truncate a comprehensive export. */
export function assertReportBounds(snapshot: AgencyReportSnapshot) {
  if (
    snapshot.version !== 1 ||
    !['OPERATIONS', 'SALES', 'TAX'].includes(snapshot.kind) ||
    !['en', 'ml', 'hi'].includes(snapshot.locale) ||
    snapshot.sections.length < 1 ||
    snapshot.sections.length > 30
  )
    throw new Error('Report structure is unsupported.');
  let rows = 0;
  const text = (value: string) => {
    if (typeof value !== 'string' || value.length > 32767)
      throw new Error('Report cell exceeds the supported text limit.');
  };
  for (const value of [
    snapshot.title,
    snapshot.agencyName,
    snapshot.reference,
    ...snapshot.notes,
  ])
    text(value);
  for (const row of snapshot.meta) {
    text(row.label);
    text(row.value);
  }
  for (const section of snapshot.sections) {
    text(section.title);
    if (!section.columns.length || section.columns.length > 20)
      throw new Error('Report column limit exceeded.');
    section.columns.forEach(text);
    rows += section.rows.length;
    if (rows > 10000)
      throw new Error('Report exceeds the supported 10,000-row limit.');
    for (const row of section.rows) {
      if (row.length !== section.columns.length)
        throw new Error('Report row does not match its columns.');
      row.forEach(text);
    }
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 2097152)
    throw new Error('Report exceeds the supported snapshot size limit.');
}

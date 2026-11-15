export interface AgencyReportSnapshot {
  version: 1;
  kind: 'OPERATIONS' | 'SALES' | 'TAX';
  locale: 'en' | 'ml' | 'hi';
  reference: string;
  title: string;
  agencyName: string;
  month: string;
  generatedAt: string;
  balanceAsOf: string;
  meta: readonly { label: string; value: string }[];
  notes: readonly string[];
  sections: readonly {
    title: string;
    columns: readonly string[];
    rows: readonly (readonly string[])[];
  }[];
}
export function renderAgencyReport(snapshot: AgencyReportSnapshot): string;

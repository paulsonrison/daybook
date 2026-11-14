export interface FinancialDocumentModel {
  locale: 'en' | 'ml' | 'hi';
  kind: string;
  title: string;
  agencyName: string;
  reference: string;
  preparedAt: string;
  subject: { name: string; reference: string; address: string };
  meta: readonly { label: string; value: string }[];
  columns: readonly [string, string, string, string];
  lines: readonly {
    description: string;
    quantity: string | number | null;
    rate: string | null;
    amount: string;
  }[];
  totals: readonly { label: string; amount: string }[];
  note: string;
  footer: string;
  qrDataUrl?: string | null;
  upiUri?: string | null;
}
/** Escaped, script-free markup using the shared UI's document classes and exact currency formatter. */
export function renderFinancialDocument(model: FinancialDocumentModel): string;

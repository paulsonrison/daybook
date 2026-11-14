export type DocumentKind =
  'INVOICE' | 'PAYMENT_RECEIPT' | 'PAYSLIP' | 'CLEARANCE_REFUND';
export interface DocumentSource {
  id: string;
  kind: DocumentKind;
  title: string;
  date: string;
  version: number;
}
export interface DocumentContext {
  source: DocumentSource;
  kind: DocumentKind;
  locale: string;
  residentId: string;
  staffId: string;
  partyName: string;
}
export interface FinancialDocument {
  id: string;
  kind: string;
  sourceId: string;
  sourceVersion: number;
  locale: string;
  status: string;
  filename: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  snapshot: string;
}
export interface SharedDocumentLink {
  id: string;
  documentId: string;
  status: string;
  urlStatus: string;
  url: string | null;
  expiresAt: string;
  createdAt: string;
}
export interface InvoiceCandidate {
  invoiceId: string;
  version: number;
  documentId: string;
  linkId: string;
  residentId: string;
  residentName: string;
  reference: string;
  amount: string;
  expiresAt: string;
  locale: string;
}
export interface MessageDispatch {
  documentId?: string | null;
  documentStatus?: string | null;
  recipient: string;
  providerMessageId: string | null;
  id: string;
  residentId: string;
  invoiceId: string | null;
  kind: string;
  channel: string;
  status: string;
  reason: string | null;
  attempts: number;
  createdAt: string;
}
export const documentLanguages = [
  { value: 'en', label: 'English' },
  { value: 'ml', label: 'മലയാളം' },
  { value: 'hi', label: 'हिन्दी' },
];

import type { BillingPeriod } from './periods.js';
export type BillingMode = 'MONTHLY' | 'WEEKLY' | 'CUSTOM' | 'SELECTED_MONTHS';
export interface BillCorrection {
  key: string;
  quantity?: number | null;
  rate?: string | null;
  reason?: string | null;
  deliveryQuantities?: { deliveryId: string; quantity: number }[];
}
export interface BillAdjustment {
  id: string;
  kind: 'CREDIT' | 'SURCHARGE';
  amount: string;
  reason: string;
}
export interface BillInput {
  residentId: string;
  periodMode: BillingMode;
  periods: BillingPeriod[];
  invoiceId?: string | null;
  version?: number | null;
  corrections?: BillCorrection[];
  adjustments?: BillAdjustment[];
  note?: string | null;
}
export interface InvoiceInput extends BillInput {
  requestId: string;
  previewFingerprint: string;
  acknowledgeUnmarkedDays?: boolean;
}
export interface BillingPolicy {
  taxTreatment: 'UNCONFIGURED' | 'NO_TAX' | 'CONFIGURED';
  defaultDueDays: number;
  autoIssue: boolean;
  version: number;
}
export interface BillLine {
  key: string;
  kind: 'DELIVERY' | 'MERCHANDISE' | 'ADJUSTMENT';
  description: string;
  quantity: number;
  sourceQuantity: number;
  rate: string;
  sourceRate: string;
  amount: string;
  reason: string | null;
  from: string | null;
  to: string | null;
  deliveryItems: {
    id: string;
    date: string;
    quantity: number;
    sourceQuantity: number;
    status: string;
  }[];
}
export interface BillPreview {
  fingerprint: string;
  resident: {
    id: string;
    name: string;
    code: string;
    address: string;
    routeId: string;
    routeName: string;
    dropOrder: number;
  };
  periodMode: BillingMode;
  periods: BillingPeriod[];
  issuedDate: string;
  dueDate: string;
  lines: BillLine[];
  corrections: BillCorrection[];
  adjustments: BillAdjustment[];
  note: string;
  currentAmount: string;
  adjustmentsTotal: string;
  invoiceTotal: string;
  previousBalance: string;
  paymentsReceived: string;
  totalDue: string;
  accountCredit: string;
  tax: string | null;
  taxTreatment: string;
  canIssue: boolean;
  missingDayCount: number;
  missingDays: string[];
}
export interface InvoicePayload {
  preview: BillPreview;
  inputs: BillInput;
  deliveryBindings: { deliveryId: string; quantity: number; rate: string }[];
  merchandiseIds: string[];
  acknowledgeUnmarkedDays: boolean;
}
export interface InvoiceHeader {
  id: string;
  residentId: string;
  code: string;
  residentName: string;
  residentCode: string;
  address: string;
  routeId: string;
  routeName: string;
  dropOrder: number;
  periodMode: BillingMode;
  periods: BillingPeriod[];
  issuedDate: string;
  dueDate: string;
  totalPaise: bigint;
  state: string;
  version: number;
  note: string;
  remainingPaise: bigint;
  locked: boolean;
}
export interface InvoiceView extends BillPreview {
  id: string;
  code: string;
  version: number;
  total: string;
  remaining: string;
  status: string;
  locked: boolean;
  accountBalance: string;
  revisions: { version: number; total: string; createdAt: string }[];
}
export interface DeliverySource {
  id: string;
  publicationId: string;
  description: string;
  date: string;
  quantity: number;
  chargeableQuantity: number;
  pricePaise: bigint;
  version: number;
  claimedInvoiceId: string | null;
  status: string;
}
export interface MerchandiseSource {
  id: string;
  description: string;
  date: string;
  quantity: number;
  unitPaise: bigint;
  amountPaise: bigint;
  claimedInvoiceId: string | null;
}

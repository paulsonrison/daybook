import { makeAutoObservable } from 'mobx';
import type { Payment, Sheet } from './store';
export interface FieldDraft {
  selected: boolean;
  amount: string;
  method: string;
  reference: string;
  requestId: string;
}
interface Outcome {
  status: string;
  receiptCode?: string | null;
  error?: string;
}
/** Entry drafts survive refreshed balances and regenerated QR sheets. */
export class FieldCollectionDrafts {
  drafts: Record<string, FieldDraft> = {};
  outcomes: Record<string, Outcome> = {};
  evidence = '';
  confirmed = false;
  busy = false;
  needsRefresh = false;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  prepare(sheet: Sheet) {
    for (const row of sheet.rows)
      if (!this.drafts[row.residentId])
        this.drafts[row.residentId] = {
          selected: false,
          amount: row.balance,
          method: 'CASH',
          reference: '',
          requestId: crypto.randomUUID(),
        };
    this.needsRefresh = false;
  }
  reset(sheet: Sheet) {
    for (const row of sheet.rows) {
      delete this.drafts[row.residentId];
      delete this.outcomes[row.residentId];
    }
    this.evidence = '';
    this.confirmed = false;
    this.prepare(sheet);
  }
  change(id: string, key: keyof FieldDraft, value: string | boolean) {
    this.drafts[id] = { ...this.drafts[id], [key]: value };
    if (this.outcomes[id]?.status === 'ERROR') delete this.outcomes[id];
  }
  setEvidence(value: string) {
    this.evidence = value;
  }
  setConfirmed(value: boolean) {
    this.confirmed = value;
  }
  setBusy(value: boolean) {
    this.busy = value;
  }
  completed(id: string) {
    return ['CONFIRMED', 'PENDING', 'FAILED'].includes(
      this.outcomes[id]?.status ?? '',
    );
  }
  failed(id: string, error: string, unknown: boolean) {
    this.outcomes[id] = { status: unknown ? 'UNKNOWN' : 'ERROR', error };
    if (unknown) this.needsRefresh = true;
  }
  recorded(id: string, payment: Payment) {
    this.outcomes[id] = {
      status: payment.status,
      receiptCode: payment.receiptCode,
    };
    this.drafts[id] = { ...this.drafts[id], selected: false };
    this.needsRefresh = true;
  }
  observePayment(payment: Payment) {
    const entry = Object.entries(this.drafts).find(
      ([, draft]) => draft.requestId === payment.requestId,
    );
    if (entry && this.outcomes[entry[0]]?.status === 'UNKNOWN')
      this.recorded(entry[0], payment);
  }
}

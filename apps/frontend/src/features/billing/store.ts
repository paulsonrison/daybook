'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest, UnconfirmedRequestError } from '@/lib/graphql/client';
export interface Resident {
  id: string;
  name: string;
  code: string;
  routeId: string;
  dropOrder: number | null;
  status: string;
}
export interface Correction {
  key: string;
  rate?: string;
  quantity?: number;
  reason?: string;
  deliveryQuantities?: { deliveryId: string; quantity: number }[];
}
export interface Bill {
  adjustments: { id: string; kind: string; amount: string; reason: string }[];
  fingerprint: string;
  resident: { id: string; name: string; code: string; address: string };
  periodMode: string;
  periods: { from: string; to: string }[];
  issuedDate: string;
  dueDate: string;
  lines: {
    key: string;
    kind: string;
    description: string;
    quantity: number;
    rate: string;
    amount: string;
    reason: string | null;
    deliveryItems: {
      id: string;
      date: string;
      quantity: number;
      sourceQuantity: number;
      status: string;
    }[];
  }[];
  note: string;
  currentAmount: string;
  adjustmentsTotal: string;
  invoiceTotal: string;
  previousBalance: string;
  paymentsReceived: string;
  totalDue: string;
  accountCredit: string;
  taxTreatment: string;
  canIssue: boolean;
  missingDayCount: number;
  missingDays: string[];
  id?: string;
  code?: string;
  version?: number;
  remaining?: string;
  status?: string;
  locked?: boolean;
}
const fields =
  'adjustments{id kind amount reason} fingerprint resident{id name code address} periodMode periods{from to} issuedDate dueDate lines{key kind description quantity rate amount reason deliveryItems{id date quantity sourceQuantity status}} note currentAmount adjustmentsTotal invoiceTotal previousBalance paymentsReceived totalDue accountCredit taxTreatment canIssue missingDayCount missingDays';
const invoiceFields = `${fields} id code version remaining status locked`;
export class BillingStore {
  residents: Resident[] = [];
  routes: { id: string; name: string }[] = [];
  invoices: Bill[] = [];
  today = '';
  policy = {
    taxTreatment: 'UNCONFIGURED',
    defaultDueDays: 7,
    autoIssue: false,
    version: 0,
  };
  state = 'loading';
  error = '';
  busy = false;
  notice = '';
  bill: Bill | null = null;
  residentId = '';
  from = '';
  to = '';
  mode = 'CUSTOM';
  selectedMonths = '';
  corrections: Correction[] = [];
  adjustments: { id: string; kind: string; amount: string; reason: string }[] =
    [];
  note = '';
  acknowledged = false;
  dirty = true;
  editing = false;
  pending: Record<string, unknown> | null = null;
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  dispose() {
    this.generation++;
  }
  async load() {
    const generation = ++this.generation;
    this.state = 'loading';
    try {
      const data = await graphqlRequest<{
        residents: Resident[];
        routes: { id: string; name: string }[];
        invoices: Bill[];
        deliveryMetrics: { today: string };
        billingPolicy: {
          taxTreatment: string;
          defaultDueDays: number;
          autoIssue: boolean;
          version: number;
        };
      }>(
        `{residents{id name code routeId dropOrder status} routes{id name} invoices{${invoiceFields}} deliveryMetrics{today} billingPolicy{taxTreatment defaultDueDays autoIssue version}}`,
      );
      runInAction(() => {
        if (generation !== this.generation) return;
        Object.assign(this, {
          residents: data.residents,
          routes: data.routes,
          invoices: data.invoices,
          today: data.deliveryMetrics.today,
          policy: data.billingPolicy,
          state: 'ready',
        });
      });
    } catch (e) {
      runInAction(() => {
        if (generation === this.generation) {
          this.error = (e as Error).message;
          this.state = 'error';
        }
      });
    }
  }
  prepare(id: string) {
    if (this.pending) return;
    this.residentId = id;
    this.from = this.today.slice(0, 7) + '-01';
    this.to = this.today;
    this.mode = 'CUSTOM';
    this.corrections = [];
    this.adjustments = [];
    this.note = '';
    this.bill = null;
    this.editing = true;
    this.dirty = true;
    this.acknowledged = false;
    this.error = '';
    this.notice = '';
  }
  open(bill: Bill) {
    if (this.pending) return;
    this.bill = bill;
    this.residentId = bill.resident.id;
    this.editing = false;
    this.dirty = false;
    this.error = '';
    this.notice = '';
  }
  edit() {
    if (!this.bill || this.bill.locked) return;
    this.editing = true;
    this.mode = this.bill.periodMode;
    this.from = this.bill.periods[0].from;
    this.to = this.bill.periods.at(-1)!.to;
    this.note = this.bill.note;
    this.adjustments = this.bill.adjustments.map((a) => ({ ...a }));
    this.corrections = this.bill.lines
      .filter((l) => l.kind === 'DELIVERY')
      .map((l) => ({
        key: l.key,
        quantity: l.quantity,
        rate: l.rate,
        reason: l.reason ?? undefined,
        deliveryQuantities: l.deliveryItems.map((d) => ({
          deliveryId: d.id,
          quantity: d.quantity,
        })),
      }));
    this.dirty = false;
  }
  change() {
    this.dirty = true;
    this.error = '';
    this.notice = '';
  }
  correct(key: string, update: Partial<Correction>) {
    const correction = this.corrections.find((c) => c.key === key);
    if (!correction) {
      this.corrections.push({ key, ...update });
    } else Object.assign(correction, update);
    this.change();
  }
  input() {
    return {
      residentId: this.residentId,
      periodMode: this.mode,
      periods: this.bill?.id
        ? this.bill.periods
        : this.mode === 'SELECTED_MONTHS'
          ? this.selectedMonths.split(',').map((raw) => {
              const month = raw.trim();
              if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
                throw new Error(
                  'Enter past months as YYYY-MM, separated by commas.',
                );
              const [year, number] = month.split('-').map(Number);
              return {
                from: month + '-01',
                to: new Date(Date.UTC(year, number, 0))
                  .toISOString()
                  .slice(0, 10),
              };
            })
          : [{ from: this.from, to: this.to }],
      invoiceId: this.bill?.id ?? null,
      version: this.bill?.version ?? null,
      corrections: this.corrections,
      adjustments: this.adjustments,
      note: this.note,
    };
  }
  async recalculate() {
    this.busy = true;
    this.error = '';
    try {
      const result = await graphqlRequest<{ previewBill: Bill }>(
        `query($input:BillInput!){previewBill(input:$input){${fields}}}`,
        { input: this.input() },
      );
      runInAction(() => {
        const old = this.bill;
        this.bill = {
          ...result.previewBill,
          id: old?.id,
          code: old?.code,
          version: old?.version,
        };
        this.dirty = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
        this.dirty = true;
      });
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
  async save() {
    if (!this.bill || this.dirty) return;
    this.pending ??= {
      ...this.input(),
      requestId: crypto.randomUUID(),
      previewFingerprint: this.bill.fingerprint,
      acknowledgeUnmarkedDays: this.acknowledged,
    };
    this.busy = true;
    this.error = '';
    try {
      const result = await graphqlRequest<{ generateInvoice: Bill }>(
        `mutation($input:InvoiceInput!){generateInvoice(input:$input){${invoiceFields}}}`,
        { input: this.pending },
      );
      runInAction(() => {
        this.bill = result.generateInvoice;
        this.editing = false;
        this.pending = null;
        this.notice = 'Bill saved';
        this.invoices = this.invoices
          .filter((b) => b.id !== result.generateInvoice.id)
          .concat(result.generateInvoice);
      });
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
        if (!(e instanceof UnconfirmedRequestError)) {
          this.pending = null;
          this.dirty = true;
        }
      });
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
  async confirmNoTax() {
    this.busy = true;
    this.error = '';
    try {
      const r = await graphqlRequest<{
        saveBillingPolicy: {
          taxTreatment: string;
          defaultDueDays: number;
          autoIssue: boolean;
          version: number;
        };
      }>(
        'mutation($input:BillingPolicyInput!){saveBillingPolicy(input:$input){taxTreatment defaultDueDays autoIssue version}}',
        { input: { noTaxConfirmed: true, version: this.policy.version } },
      );
      runInAction(() => {
        this.policy = r.saveBillingPolicy;
        this.change();
      });
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
      });
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
}

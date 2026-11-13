'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest, UnconfirmedRequestError } from '@/lib/graphql/client';
export interface Person {
  id: string;
  name: string;
  code: string;
  status: string;
  depositBalance: string;
  version: number;
  routeId: string;
  dropOrder: number;
}
export interface Payment {
  id: string;
  residentId: string;
  requestId: string;
  purpose: string;
  method: string;
  amount: string;
  date: string;
  reference: string | null;
  targetInvoiceId: string | null;
  status: string;
  receiptCode: string | null;
  confirmationEvidence: string;
  confirmedAt: string | null;
  postingDate: string | null;
  version: number;
  balance: string;
  confirmationSource: string | null;
}
export interface Clearance {
  id: string;
  residentId: string;
  code: string;
  terminationDate: string;
  finalInvoiceId: string | null;
  depositOffset: string;
  refundDue: string;
  collectionDue: string;
  status: string;
}
export interface ClearancePreview {
  fingerprint: string;
  residentId: string;
  terminationDate: string;
  finalCharges: string;
  balanceBeforeOffset: string;
  depositBalance: string;
  depositOffset: string;
  refundDue: string;
  collectionDue: string;
  missingDayCount: number;
  unresolvedPayments: number;
}
export interface Risk {
  residentId: string;
  name: string;
  code: string;
  status: string;
  version: number;
  routeName: string;
  balance: string;
  overdueAmount: string;
  overdueDays: number;
  highRisk: boolean;
}
export interface CreditPolicy {
  maxOverdueAmount: string | null;
  maxOverdueDays: number | null;
  enabled: boolean;
  version: number;
}
export interface SheetRow {
  residentId: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  door: string | null;
  sequence: number;
  balance: string;
  overdueAmount: string;
  overdueDays: number;
  upiUri: string | null;
  qrDataUrl: string | null;
}
export interface Sheet {
  fingerprint: string;
  routeId: string;
  routeName: string;
  date: string;
  qrStatus: string;
  rows: SheetRow[];
}
export type Operation =
  | 'record'
  | 'reconcile'
  | 'clear'
  | 'refund'
  | 'suspend'
  | 'payRule'
  | 'endPayRule'
  | 'attendance'
  | 'staffFunds'
  | 'payslip'
  | 'payrollPayout'
  | 'custody'
  | 'handover'
  | 'cashExpense'
  | 'cashClose'
  | 'payrollAdjustment';
interface Envelope {
  kind: Operation;
  input: Record<string, unknown>;
  residentId: string;
}
const paymentFields =
  'id residentId requestId purpose method amount date reference targetInvoiceId status receiptCode confirmationEvidence confirmedAt postingDate version balance confirmationSource';
const clearanceFields =
  'id residentId code terminationDate finalInvoiceId depositOffset refundDue collectionDue status';
const mutations: Record<
  Operation,
  { name: string; type: string; fields: string }
> = {
  record: {
    name: 'recordPayment',
    type: 'PaymentInput',
    fields: paymentFields,
  },
  reconcile: {
    name: 'reconcilePayment',
    type: 'PaymentReconciliationInput',
    fields: paymentFields,
  },
  clear: {
    name: 'clearResident',
    type: 'ClearanceInput',
    fields: clearanceFields,
  },
  refund: {
    name: 'confirmClearanceRefund',
    type: 'ClearanceRefundInput',
    fields: 'id receiptCode amount status',
  },
  payrollAdjustment: {
    name: 'recordPayrollAdjustment',
    type: 'PayrollAdjustmentInput',
    fields: 'id',
  },
  payRule: { name: 'savePayRule', type: 'PayRuleInput', fields: 'id' },
  endPayRule: { name: 'endPayRule', type: 'EndPayRuleInput', fields: 'id' },
  attendance: {
    name: 'recordAttendance',
    type: 'AttendanceInput',
    fields: 'id',
  },
  staffFunds: {
    name: 'recordStaffFunds',
    type: 'StaffFundsInput',
    fields: 'id',
  },
  payslip: { name: 'postPayslip', type: 'PayslipInput', fields: 'id' },
  payrollPayout: {
    name: 'recordPayrollPayout',
    type: 'PayrollPayoutInput',
    fields: 'id',
  },
  custody: {
    name: 'classifyCollection',
    type: 'CollectionCustodyInput',
    fields: 'id',
  },
  handover: { name: 'recordHandover', type: 'HandoverInput', fields: 'id' },
  cashExpense: {
    name: 'recordCashExpense',
    type: 'CashExpenseInput',
    fields: 'id',
  },
  cashClose: { name: 'closeCashDay', type: 'CashCloseInput', fields: 'id' },
  suspend: {
    name: 'suspendForCredit',
    type: 'CreditSuspensionInput',
    fields: 'residentId status notificationStatus',
  },
};
export class PaymentsStore {
  agencyId = '';
  agencyName = '';
  residents: Person[] = [];
  routes: { id: string; name: string; active: boolean }[] = [];
  staffCollectors: { id: string; name: string; status: string }[] = [];
  today = '';
  selectedResidentId = '';
  state = 'loading';
  residentState = 'loading';
  error = '';
  notice = '';
  lastCompletedRequestId = '';
  busy = false;
  pending: Envelope | null = null;
  recoveryUnavailable = false;
  payments: Payment[] = [];
  invoices: {
    id: string;
    code: string;
    remaining: string;
    status: string;
    version: number;
  }[] = [];
  ledger: {
    balance: string;
    credit: string;
    entries: {
      id: string;
      kind: string;
      amount: string;
      date: string;
      description: string;
    }[];
  } = { balance: '0.00', credit: '0.00', entries: [] };
  clearance: Clearance | null = null;
  preview: ClearancePreview | null = null;
  lastPayment: Payment | null = null;
  lastRefund: { receiptCode: string; amount: string } | null = null;
  risks: Risk[] = [];
  policy: CreditPolicy = {
    maxOverdueAmount: null,
    maxOverdueDays: 60,
    enabled: true,
    version: 0,
  };
  settings: {
    upiId: string | null;
    payeeName: string | null;
    version: number;
  } = { upiId: null, payeeName: null, version: 0 };
  sheet: Sheet | null = null;
  sheetBusy = false;
  sheetError = '';
  private generation = 0;
  private selectionGeneration = 0;
  private sheetGeneration = 0;
  private preparedSheetInput: {
    routeId: string;
    fromDrop: number;
    toDrop: number;
  } | null = null;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  get person() {
    return this.residents.find((r) => r.id === this.selectedResidentId);
  }
  get readingLocked() {
    return this.busy || Boolean(this.pending) || this.residentState !== 'ready';
  }
  get locked() {
    return this.readingLocked || this.recoveryUnavailable;
  }
  dispose() {
    this.generation++;
    this.selectionGeneration++;
    this.sheetGeneration++;
  }
  private pendingKey() {
    return `daybook:financial-operation:${this.agencyId}`;
  }
  private persist() {
    if (!this.agencyId) return false;
    try {
      if (this.pending)
        sessionStorage.setItem(this.pendingKey(), JSON.stringify(this.pending));
      else sessionStorage.removeItem(this.pendingKey());
      return true;
    } catch {
      this.error = this.pending
        ? 'This browser cannot retain its recovery record. Your new financial action was not submitted; your entries are preserved.'
        : 'The previous recovery record could not be cleared. Checking the same original operation again is safe.';
      return false;
    }
  }
  async load() {
    const generation = ++this.generation;
    const initial = this.state !== 'ready';
    if (initial) this.state = 'loading';
    try {
      const data = await graphqlRequest<{
        me: { agencyId: string; agency: { name: string } };
        residents: Person[];
        staff: PaymentsStore['staffCollectors'];
        routes: PaymentsStore['routes'];
        deliveryMetrics: { today: string };
        creditRiskSummary: { accounts: Risk[] };
        creditPolicy: CreditPolicy;
        collectionSettings: PaymentsStore['settings'];
      }>(
        `{me{agencyId agency{name}} residents{id name code status depositBalance version routeId dropOrder} routes{id name active} staff{id name status} deliveryMetrics{today} creditRiskSummary{accounts{residentId name code status version routeName balance overdueAmount overdueDays highRisk}} creditPolicy{maxOverdueAmount maxOverdueDays enabled version} collectionSettings{upiId payeeName version}}`,
      );
      runInAction(() => {
        if (generation !== this.generation) return;
        this.agencyId = data.me.agencyId;
        this.agencyName = data.me.agency.name;
        this.residents = data.residents;
        this.routes = data.routes;
        this.staffCollectors = data.staff;
        this.today = data.deliveryMetrics.today;
        this.risks = data.creditRiskSummary.accounts;
        this.policy = data.creditPolicy;
        this.settings = data.collectionSettings;
        if (initial) {
          try {
            const saved = sessionStorage.getItem(this.pendingKey());
            if (saved) {
              const value = JSON.parse(saved) as Envelope;
              if (
                value &&
                Object.hasOwn(mutations, value.kind) &&
                typeof value.input === 'object' &&
                value.input &&
                typeof value.input.requestId === 'string' &&
                (data.residents.some((r) => r.id === value.residentId) ||
                  (value.residentId === '' &&
                    ![
                      'record',
                      'reconcile',
                      'clear',
                      'refund',
                      'suspend',
                    ].includes(value.kind)))
              )
                this.pending = value;
              else throw new Error('Invalid recovery record');
            }
          } catch {
            this.recoveryUnavailable = true;
            this.error =
              'A previous recovery record could not be read. Review existing receipts before recording funds.';
          }
        }
        if (!this.selectedResidentId) {
          const requested = new URLSearchParams(window.location.search).get(
            'resident',
          );
          this.selectedResidentId =
            this.pending?.residentId ??
            data.residents.find((r) => r.id === requested)?.id ??
            data.residents[0]?.id ??
            '';
        }
        this.state = 'ready';
        if (!this.selectedResidentId) this.residentState = 'ready';
      });
      if (generation === this.generation && this.selectedResidentId)
        await this.loadResident();
    } catch (e) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.error = (e as Error).message;
        if (initial) this.state = 'error';
      });
    }
  }
  async selectResident(id: string) {
    if (this.readingLocked) return;
    this.selectedResidentId = id;
    this.lastPayment = null;
    this.lastRefund = null;
    this.preview = null;
    this.error = '';
    this.notice = '';
    await this.loadResident();
  }
  viewReceipt(payment: Payment) {
    if (this.readingLocked || payment.residentId !== this.selectedResidentId)
      return;
    this.lastPayment = payment;
    this.lastRefund = null;
    this.notice = '';
  }
  async loadResident() {
    this.residentState = 'loading';
    const generation = ++this.selectionGeneration,
      id = this.selectedResidentId;
    if (!id) {
      this.payments = [];
      this.invoices = [];
      this.clearance = null;
      this.residentState = 'ready';
      return;
    }
    try {
      const data = await graphqlRequest<{
        payments: Payment[];
        invoices: PaymentsStore['invoices'];
        residentLedger: PaymentsStore['ledger'];
        clearanceForResident: Clearance | null;
      }>(
        `query($id:ID!){payments(residentId:$id){${paymentFields}} invoices(residentId:$id){id code remaining status version} residentLedger(residentId:$id){balance credit entries{id kind amount date description}} clearanceForResident(residentId:$id){${clearanceFields}}}`,
        { id },
      );
      runInAction(() => {
        if (
          generation !== this.selectionGeneration ||
          id !== this.selectedResidentId
        )
          return;
        this.payments = data.payments;
        this.invoices = data.invoices;
        this.ledger = data.residentLedger;
        this.clearance = data.clearanceForResident;
        this.residentState = 'ready';
      });
    } catch (e) {
      runInAction(() => {
        if (generation === this.selectionGeneration) {
          this.error = (e as Error).message;
          this.residentState = 'error';
        }
      });
    }
  }
  async execute(
    kind: Operation,
    input: Record<string, unknown>,
    residentId = this.selectedResidentId,
    retry = false,
  ): Promise<boolean> {
    if (this.busy) return false;
    if (this.recoveryUnavailable && !retry) {
      this.error =
        'Restore access to the original recovery record before starting a new financial action.';
      return false;
    }
    if (this.pending && !retry) {
      this.error =
        'Resolve the original operation before starting another financial action.';
      return false;
    }
    this.lastPayment = null;
    this.lastRefund = null;
    this.pending ??= {
      kind,
      input: JSON.parse(JSON.stringify(input)),
      residentId,
    };
    if (!this.persist() && !retry) {
      this.pending = null;
      return false;
    }
    const original = this.pending,
      operation = mutations[original.kind];
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      const data = await graphqlRequest<
          Record<
            string,
            | Payment
            | Clearance
            | {
                receiptCode: string;
                amount: string;
                notificationStatus?: string;
              }
          >
        >(
          `mutation($input:${operation.type}!){${operation.name}(input:$input){${operation.fields}}}`,
          { input: original.input },
        ),
        result = data[operation.name];
      runInAction(() => {
        this.selectedResidentId = original.residentId;
        this.lastCompletedRequestId = String(original.input.requestId);
        this.pending = null;
        this.persist();
        if (original.kind === 'record' || original.kind === 'reconcile') {
          this.lastPayment = result as Payment;
          this.notice =
            this.lastPayment.status === 'PENDING'
              ? 'Payment pending confirmation'
              : this.lastPayment.status === 'FAILED'
                ? 'Payment marked failed'
                : 'Receipt recorded';
        } else if (original.kind === 'clear') {
          this.clearance = result as Clearance;
          this.preview = null;
          this.notice = 'Account archived';
        } else if (original.kind === 'refund') {
          this.lastRefund = result as { receiptCode: string; amount: string };
          this.notice = 'Refund recorded';
        } else
          this.notice =
            original.kind === 'suspend'
              ? 'Service suspended. WhatsApp is not configured.'
              : 'Operation recorded';
      });
      await this.load();
      return true;
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
        if (!(e instanceof UnconfirmedRequestError)) {
          this.pending = null;
          this.persist();
        }
      });
      return false;
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
  async retryOriginal() {
    if (this.pending)
      await this.execute(
        this.pending.kind,
        this.pending.input,
        this.pending.residentId,
        true,
      );
  }
  async calculateClearance(date: string) {
    if (this.locked) return;
    this.busy = true;
    this.error = '';
    try {
      const data = await graphqlRequest<{ previewClearance: ClearancePreview }>(
        'query($input:ClearancePreviewInput!){previewClearance(input:$input){fingerprint residentId terminationDate finalCharges balanceBeforeOffset depositBalance depositOffset refundDue collectionDue missingDayCount unresolvedPayments}}',
        {
          input: { residentId: this.selectedResidentId, terminationDate: date },
        },
      );
      runInAction(() => {
        this.preview = data.previewClearance;
      });
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
        this.preview = null;
      });
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
  async savePolicy(input: Record<string, unknown>) {
    return this.configure(
      'saveCreditPolicy',
      'CreditPolicyInput',
      'maxOverdueAmount maxOverdueDays enabled version',
      { ...input, version: this.policy.version },
    );
  }
  async saveUpi(input: Record<string, unknown>) {
    if (this.locked) return false;
    this.sheetGeneration++;
    this.sheet = null;
    this.sheetBusy = false;
    this.preparedSheetInput = null;
    return this.configure(
      'saveCollectionSettings',
      'CollectionSettingsInput',
      'upiId payeeName version',
      { ...input, version: this.settings.version },
    );
  }
  private async configure(
    name: string,
    type: string,
    fields: string,
    input: Record<string, unknown>,
  ) {
    if (this.locked) return false;
    this.busy = true;
    this.error = '';
    try {
      await graphqlRequest(
        `mutation($input:${type}!){${name}(input:$input){${fields}}}`,
        { input },
      );
      runInAction(() => {
        this.notice = 'Settings saved';
      });
      await this.load();
      return true;
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error).message;
      });
      return false;
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
  async buildSheet(routeId: string, fromDrop = 1, toDrop = 99999) {
    if (this.locked || this.sheetBusy) return false;
    const generation = ++this.sheetGeneration;
    this.sheetBusy = true;
    this.sheetError = '';
    try {
      const result = await graphqlRequest<{ buildCollectionSheet: Sheet }>(
        'query($input:CollectionSheetInput!){buildCollectionSheet(input:$input){fingerprint routeId routeName date qrStatus rows{residentId name code phone address door sequence balance overdueAmount overdueDays upiUri qrDataUrl}}}',
        { input: { routeId, fromDrop, toDrop } },
      );
      runInAction(() => {
        if (generation !== this.sheetGeneration) return;
        this.sheet = result.buildCollectionSheet;
        this.preparedSheetInput = { routeId, fromDrop, toDrop };
      });
      return generation === this.sheetGeneration;
    } catch (e) {
      runInAction(() => {
        if (generation === this.sheetGeneration)
          this.sheetError = (e as Error).message;
      });
      return false;
    } finally {
      runInAction(() => {
        if (generation === this.sheetGeneration) this.sheetBusy = false;
      });
    }
  }
  async refreshSheet() {
    const input = this.preparedSheetInput;
    return input
      ? this.buildSheet(input.routeId, input.fromDrop, input.toDrop)
      : false;
  }
}

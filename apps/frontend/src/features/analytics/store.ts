'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
export type Coverage = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
export interface AnalyticsReport {
  month: string;
  startDate: string;
  endDate: string;
  asOf: string;
  sales: {
    invoiced: string;
    cashMerchandise: string;
    advertiserSubtotal: string;
    advertiserTax: string;
    recordedTotal: string;
  };
  receipts: {
    account: string;
    cashAccountAndMerchandise: string;
    refundableDeposits: string;
    unclassifiedDeposits: string;
    byMethod: {
      method: string;
      account: string;
      refundableDeposits: string;
      cashMerchandise: string;
    }[];
  };
  balances: {
    asOfDate: string;
    outstanding: string;
    credit: string;
    overdue: string | null;
    unsettledOverdue: string;
    agingState: Coverage;
    agingGrossUnsettled: string;
    agingUnallocatedCredit: string;
    aging: { bucket: string; amount: string }[];
  };
  collectionComparison: {
    numerator: string;
    denominator: string;
    basisPoints: string | null;
    basis: string;
  };
  circulation: {
    fulfilledCopies: string | null;
    chargeableCopies: string | null;
    replacementCopies: string | null;
    readers: string | null;
    subscriptions: string | null;
    preparedDays: string;
    elapsedDays: string;
    missingDays: string;
    coverage: Coverage;
    currentScheduled: {
      asOfDate: string;
      copies: string | null;
      state: Coverage;
      reason: string | null;
    };
    byPublication: {
      publicationId: string;
      name: string;
      snapshotNames: string[];
      fulfilledCopies: string;
      readers: string;
    }[];
    trend: {
      month: string;
      fulfilledCopies: string | null;
      coverage: Coverage;
      preparedDays: string;
      elapsedDays: string;
      missingDays: string;
    }[];
  };
  churn: {
    closedAccounts: string;
    registrations: string | null;
    openAtStart: string | null;
    cohortClosures: string | null;
    rateBasisPoints: string | null;
    coverage: Coverage;
    missingHistoryCount: string;
    basis: string;
  };
  routes: {
    routeId: string;
    snapshotNames: string[];
    chargeableRetail: string;
    advertiserSales: string;
    procurementEstimate: string;
    missingCostCopies: string;
    fulfilledCopies: string;
    procurementCoverage: Coverage;
    postedPayroll: string;
    payrollCopiesWithoutPostedCost: string;
    payrollCoverage: Coverage;
    replacementCopies: string;
    exceptionCopiesWithoutAttributedCost: string;
    contributionBeforeShared: string;
    contributionCoverage: Coverage;
  }[];
  payroll: {
    postedExpense: string | null;
    knownPostedExpense: string;
    unallocatedExpense: string | null;
    attributableRouteExpense: string;
    actualPayouts: string;
    postedPayslips: string;
    unsupportedPayslips: string;
    coverage: Coverage;
  };
  advertiserAllocation: {
    allocatedSubtotal: string;
    unallocatedSubtotal: string;
    unsupportedInvoices: string;
    coverage: Coverage;
  };
  agencyCosts: {
    supplyPurchases: string;
    supplyReturnCredits: string;
    netSupplyPurchases: string;
    allocationBasis: string;
  };
  refunds: {
    total: string;
    cash: string;
    deposit: string;
    accountCredit: string;
  };
}
const query = `query($input:AnalyticsInput!){agencyAnalytics(input:$input){month startDate endDate asOf
 sales{invoiced cashMerchandise advertiserSubtotal advertiserTax recordedTotal}
 receipts{account cashAccountAndMerchandise refundableDeposits unclassifiedDeposits byMethod{method account refundableDeposits cashMerchandise}}
 balances{asOfDate outstanding credit overdue unsettledOverdue agingState agingGrossUnsettled agingUnallocatedCredit aging{bucket amount}}
 collectionComparison{numerator denominator basisPoints basis}
 circulation{fulfilledCopies chargeableCopies replacementCopies readers subscriptions preparedDays elapsedDays missingDays coverage currentScheduled{asOfDate copies state reason}byPublication{publicationId name snapshotNames fulfilledCopies readers}trend{month fulfilledCopies coverage preparedDays elapsedDays missingDays}}
 churn{closedAccounts registrations openAtStart cohortClosures rateBasisPoints coverage missingHistoryCount basis}
 routes{routeId snapshotNames chargeableRetail advertiserSales procurementEstimate missingCostCopies fulfilledCopies procurementCoverage postedPayroll payrollCopiesWithoutPostedCost payrollCoverage replacementCopies exceptionCopiesWithoutAttributedCost contributionBeforeShared contributionCoverage}
 payroll{postedExpense knownPostedExpense unallocatedExpense attributableRouteExpense actualPayouts postedPayslips unsupportedPayslips coverage}
 advertiserAllocation{allocatedSubtotal unallocatedSubtotal unsupportedInvoices coverage}
 agencyCosts{supplyPurchases supplyReturnCredits netSupplyPurchases allocationBasis}
 refunds{total cash deposit accountCredit}}}`;
export class AnalyticsStore {
  today = '';
  month = '';
  report: AnalyticsReport | null = null;
  state: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  async initialize() {
    const generation = ++this.generation;
    this.state = 'loading';
    this.error = '';
    try {
      const result = await graphqlRequest<{
        deliveryMetrics: { today: string };
      }>('{deliveryMetrics{today}}');
      if (generation !== this.generation) return;
      runInAction(() => {
        this.today = result.deliveryMetrics.today;
      });
      await this.load(this.today.slice(0, 7));
    } catch (error) {
      this.failed(error, generation);
    }
  }
  async load(month = this.month) {
    const generation = ++this.generation;
    this.month = month;
    this.report = null;
    this.error = '';
    this.state = 'loading';
    try {
      const result = await graphqlRequest<{ agencyAnalytics: AnalyticsReport }>(
        query,
        { input: { month } },
      );
      runInAction(() => {
        if (generation !== this.generation) return;
        this.report = result.agencyAnalytics;
        this.state = 'ready';
      });
    } catch (error) {
      this.failed(error, generation);
    }
  }
  private failed(error: unknown, generation: number) {
    runInAction(() => {
      if (generation !== this.generation) return;
      this.error =
        error instanceof Error ? error.message : 'Unable to load analytics.';
      this.state = 'error';
    });
  }
  retry() {
    return this.today ? this.load() : this.initialize();
  }
  dispose() {
    this.generation++;
    this.report = null;
  }
}

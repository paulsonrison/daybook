import type { RequestContext } from '../context.js';
import { agencyAnalytics } from './service.js';
export const analyticsTypeDefs = `
input AnalyticsInput {month:String!}
type AnalyticsSales {invoiced:String!,cashMerchandise:String!,advertiserSubtotal:String!,advertiserTax:String!,recordedTotal:String!}
type AnalyticsReceiptMethod {method:String!,account:String!,refundableDeposits:String!,cashMerchandise:String!}
type AnalyticsReceipts {account:String!,cashAccountAndMerchandise:String!,refundableDeposits:String!,unclassifiedDeposits:String!,byMethod:[AnalyticsReceiptMethod!]!}
enum AnalyticsCoverage {COMPLETE PARTIAL UNAVAILABLE}
type AnalyticsAgingBucket {bucket:String!,amount:String!}
type AnalyticsBalances {asOfDate:String!,outstanding:String!,credit:String!,overdue:String,unsettledOverdue:String!,agingState:AnalyticsCoverage!,agingGrossUnsettled:String!,agingUnallocatedCredit:String!,aging:[AnalyticsAgingBucket!]!}
type AnalyticsRefunds {total:String!,cash:String!,deposit:String!,accountCredit:String!}
type AnalyticsReceiptComparison {numerator:String!,denominator:String!,basisPoints:String,basis:String!}
type AnalyticsScheduledCopies {asOfDate:String!,copies:String,state:AnalyticsCoverage!,reason:String}
type AnalyticsPublicationReadership {publicationId:ID!,name:String!,snapshotNames:[String!]!,fulfilledCopies:String!,readers:String!}
type AnalyticsCirculationMonth {month:String!,fulfilledCopies:String,preparedDays:String!,elapsedDays:String!,missingDays:String!,coverage:AnalyticsCoverage!}
type AnalyticsCirculation {fulfilledCopies:String,chargeableCopies:String,replacementCopies:String,readers:String,subscriptions:String,preparedDays:String!,elapsedDays:String!,missingDays:String!,coverage:AnalyticsCoverage!,currentScheduled:AnalyticsScheduledCopies!,byPublication:[AnalyticsPublicationReadership!]!,trend:[AnalyticsCirculationMonth!]!}
type AnalyticsChurn {closedAccounts:String!,registrations:String,openAtStart:String,cohortClosures:String,rateBasisPoints:String,coverage:AnalyticsCoverage!,missingHistoryCount:String!,basis:String!}
type AnalyticsRoute {exceptionCopiesWithoutAttributedCost:String!,contributionBeforeShared:String!,contributionCoverage:AnalyticsCoverage!,replacementCopies:String!,advertiserSales:String!,postedPayroll:String!,payrollCopiesWithoutPostedCost:String!,payrollCoverage:AnalyticsCoverage!,routeId:ID!,snapshotNames:[String!]!,chargeableRetail:String!,procurementEstimate:String!,missingCostCopies:String!,fulfilledCopies:String!,procurementCoverage:AnalyticsCoverage!}
type AnalyticsPayroll {postedExpense:String,unallocatedExpense:String,knownPostedExpense:String!,attributableRouteExpense:String!,actualPayouts:String!,postedPayslips:String!,unsupportedPayslips:String!,coverage:AnalyticsCoverage!}
type AnalyticsAdvertiserAllocation {allocatedSubtotal:String!,unallocatedSubtotal:String!,unsupportedInvoices:String!,coverage:AnalyticsCoverage!}
type AnalyticsAgencyCosts {supplyPurchases:String!,supplyReturnCredits:String!,netSupplyPurchases:String!,allocationBasis:String!}
type AgencyAnalytics {agencyCosts:AnalyticsAgencyCosts!,advertiserAllocation:AnalyticsAdvertiserAllocation!,payroll:AnalyticsPayroll!,routes:[AnalyticsRoute!]!,month:String!,startDate:String!,endDate:String!,asOf:String!,sales:AnalyticsSales!,receipts:AnalyticsReceipts!,balances:AnalyticsBalances!,refunds:AnalyticsRefunds!,collectionComparison:AnalyticsReceiptComparison!,circulation:AnalyticsCirculation!,churn:AnalyticsChurn!}
extend type Query {agencyAnalytics(input:AnalyticsInput!):AgencyAnalytics!}
`;
export const analyticsResolvers = {
  Query: {
    agencyAnalytics: (
      _root: unknown,
      args: { input: { month: string } },
      ctx: RequestContext,
    ) => agencyAnalytics(ctx, args.input),
  },
};

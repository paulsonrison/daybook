import type { RequestContext } from '../context.js';
import type { BillInput, InvoiceInput } from './model.js';
import {
  billingPolicy,
  saveBillingPolicy,
  previewBill,
  generateInvoice,
  invoice,
  invoices,
} from './service.js';
const fields = `adjustments:[BillAdjustment!]!,fingerprint:String!,resident:BillResident!,periodMode:String!,periods:[BillingPeriod!]!,issuedDate:String!,dueDate:String!,lines:[BillLine!]!,note:String!,currentAmount:String!,adjustmentsTotal:String!,invoiceTotal:String!,previousBalance:String!,paymentsReceived:String!,totalDue:String!,accountCredit:String!,tax:String,taxTreatment:String!,canIssue:Boolean!,missingDayCount:Int!,missingDays:[String!]!`;
const inputs = `residentId:ID!,periodMode:String!,periods:[BillingPeriodInput!]!,invoiceId:ID,version:Int,corrections:[BillCorrectionInput!],adjustments:[BillAdjustmentInput!],note:String`;
export const billingTypeDefs = `
type BillAdjustment {id:ID!,kind:String!,amount:String!,reason:String!}
type BillingPeriod {from:String!,to:String!}
input BillingPeriodInput {from:String!,to:String!}
type BillResident {id:ID!,name:String!,code:String!,address:String!,routeId:ID!,routeName:String!,dropOrder:Int!}
type BillDeliveryItem {id:ID!,date:String!,quantity:Int!,sourceQuantity:Int!,status:String!}
type BillLine {key:String!,kind:String!,description:String!,quantity:Int!,sourceQuantity:Int!,rate:String!,sourceRate:String!,amount:String!,reason:String,from:String,to:String,deliveryItems:[BillDeliveryItem!]!}
input DeliveryQuantityInput {deliveryId:ID!,quantity:Int!}
input BillCorrectionInput {key:String!,quantity:Int,rate:String,reason:String,deliveryQuantities:[DeliveryQuantityInput!]}
input BillAdjustmentInput {id:ID!,kind:String!,amount:String!,reason:String!}
input BillInput {${inputs}}
input InvoiceInput {${inputs},requestId:ID!,previewFingerprint:String!,acknowledgeUnmarkedDays:Boolean}
type BillPreview {${fields}}
type InvoiceRevision {version:Int!,total:String!,createdAt:String!}
type Invoice {${fields},id:ID!,code:String!,version:Int!,total:String!,remaining:String!,status:String!,locked:Boolean!,accountBalance:String!,revisions:[InvoiceRevision!]!}
type BillingPolicy {taxTreatment:String!,defaultDueDays:Int!,autoIssue:Boolean!,version:Int!}
input BillingPolicyInput {noTaxConfirmed:Boolean!,defaultDueDays:Int,autoIssue:Boolean,version:Int}
extend type Query {billingPolicy:BillingPolicy!,previewBill(input:BillInput!):BillPreview!,invoice(id:ID!):Invoice!,invoices(residentId:ID):[Invoice!]!}
extend type Mutation {saveBillingPolicy(input:BillingPolicyInput!):BillingPolicy!,generateInvoice(input:InvoiceInput!):Invoice!}
`;
export const billingResolvers = {
  Query: {
    billingPolicy: (_r: unknown, _a: unknown, c: RequestContext) =>
      billingPolicy(c),
    previewBill: (_r: unknown, a: { input: BillInput }, c: RequestContext) =>
      previewBill(c, a.input),
    invoice: (_r: unknown, a: { id: string }, c: RequestContext) =>
      invoice(c, a.id),
    invoices: (_r: unknown, a: { residentId?: string }, c: RequestContext) =>
      invoices(c, a.residentId),
  },
  Mutation: {
    saveBillingPolicy: (
      _r: unknown,
      a: { input: Parameters<typeof saveBillingPolicy>[1] },
      c: RequestContext,
    ) => saveBillingPolicy(c, a.input),
    generateInvoice: (
      _r: unknown,
      a: { input: InvoiceInput },
      c: RequestContext,
    ) => generateInvoice(c, a.input),
  },
};

import type { RequestContext } from '../context.js';
import {
  payments,
  paymentByRequest,
  recordPayment,
  reconcilePayment,
  type PaymentInput,
  type ReconciliationInput,
} from './service.js';
export const paymentTypeDefs = `
type Payment {id:ID!,residentId:ID!,requestId:ID!,purpose:String!,method:String!,amount:String!,date:String!,reference:String,targetInvoiceId:ID,status:String!,receiptCode:String,confirmationEvidence:String!,confirmedAt:String,postingDate:String,version:Int!,balance:String!,confirmationSource:String}
input PaymentInput {requestId:ID!,residentId:ID!,purpose:String!,method:String!,amount:String!,date:String!,reference:String,targetInvoiceId:ID,confirmReceived:Boolean!,confirmationNote:String}
input PaymentReconciliationInput {requestId:ID!,paymentId:ID!,version:Int!,outcome:String!,reference:String,evidence:String!}
extend type Query {payments(residentId:ID):[Payment!]!,paymentByRequest(requestId:ID!):Payment}
extend type Mutation {recordPayment(input:PaymentInput!):Payment!,reconcilePayment(input:PaymentReconciliationInput!):Payment!}
`;
export const paymentResolvers = {
  Query: {
    payments: (_r: unknown, a: { residentId?: string }, c: RequestContext) =>
      payments(c, a.residentId),
    paymentByRequest: (
      _r: unknown,
      a: { requestId: string },
      c: RequestContext,
    ) => paymentByRequest(c, a.requestId),
  },
  Mutation: {
    recordPayment: (
      _r: unknown,
      a: { input: PaymentInput },
      c: RequestContext,
    ) => recordPayment(c, a.input),
    reconcilePayment: (
      _r: unknown,
      a: { input: ReconciliationInput },
      c: RequestContext,
    ) => reconcilePayment(c, a.input),
  },
};

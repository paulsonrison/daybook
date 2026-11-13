import type { RequestContext } from '../context.js';
import {
  previewClearance,
  clearResident,
  clearance,
  clearanceForResident,
  confirmClearanceRefund,
} from './service.js';
export const clearanceTypeDefs = `
type ClearancePreview {fingerprint:String!,residentId:ID!,terminationDate:String!,finalCharges:String!,balanceBeforeOffset:String!,depositBalance:String!,depositOffset:String!,refundDue:String!,collectionDue:String!,missingDayCount:Int!,missingDays:[String!]!,unresolvedPayments:Int!,cancelledOrders:Int!}
input ClearancePreviewInput {residentId:ID!,terminationDate:String!}
input ClearanceInput {residentId:ID!,terminationDate:String!,requestId:ID!,previewFingerprint:String!,acknowledgeUnmarkedDays:Boolean}
type Clearance {id:ID!,residentId:ID!,code:String!,terminationDate:String!,finalInvoiceId:ID,depositOffset:String!,refundDue:String!,collectionDue:String!,status:String!,snapshot:ClearancePreview!}
input ClearanceRefundInput {requestId:ID!,clearanceId:ID!,amount:String!,method:String!,reference:String,confirmationNote:String!}
type ClearanceRefund {id:ID!,receiptCode:String!,amount:String!,status:String!}
extend type Query {previewClearance(input:ClearancePreviewInput!):ClearancePreview!,clearance(id:ID!):Clearance!,clearanceForResident(residentId:ID!):Clearance}
extend type Mutation {clearResident(input:ClearanceInput!):Clearance!,confirmClearanceRefund(input:ClearanceRefundInput!):ClearanceRefund!}
`;
export const clearanceResolvers = {
  Query: {
    clearanceForResident: (
      _r: unknown,
      a: { residentId: string },
      c: RequestContext,
    ) => clearanceForResident(c, a.residentId),
    previewClearance: (
      _r: unknown,
      a: { input: Parameters<typeof previewClearance>[1] },
      c: RequestContext,
    ) => previewClearance(c, a.input),
    clearance: (_r: unknown, a: { id: string }, c: RequestContext) =>
      clearance(c, a.id),
  },
  Mutation: {
    clearResident: (
      _r: unknown,
      a: { input: Parameters<typeof clearResident>[1] },
      c: RequestContext,
    ) => clearResident(c, a.input),
    confirmClearanceRefund: (
      _r: unknown,
      a: { input: Parameters<typeof confirmClearanceRefund>[1] },
      c: RequestContext,
    ) => confirmClearanceRefund(c, a.input),
  },
};

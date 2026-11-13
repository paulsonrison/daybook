import type { RequestContext } from '../context.js';
import {
  cashDay,
  cashHistory,
  classifyCollection,
  recordHandover,
  recordCashExpense,
  closeCashDay,
  type CustodyInput,
  type HandoverInput,
  type ExpenseInput,
  type CloseInput,
} from './service.js';
export const cashTypeDefs = `
type CollectionSource {kind:String!,id:ID!,receiptCode:String,amount:String!,method:String!,date:String!,custodyId:ID,custody:String,staffId:ID,routeId:ID,claimed:Boolean!}
type CashDay {date:String!,directCash:String!,handoverCash:String!,outflow:String!,expectedMovement:String!,suspense:String!,unclassified:Int!,unhanded:Int!,sources:[CollectionSource!]!,closedId:ID}
type Handover {id:ID!,expected:String!,actual:String!,discrepancy:String!}
type HandoverHistory {id:ID!,staffId:ID!,routeId:ID!,date:String!,postingDate:String!,expected:String!,actual:String!,discrepancy:String!,outstanding:String!,returnedCopies:Int!,signoff:String!}
type CashCloseHistory {id:ID!,date:String!,opening:String!,expected:String!,counted:String!,bankDeposit:String!,variance:String!,reason:String!,signoff:String!}
type CashMovementHistory {id:ID!,date:String!,kind:String!,amount:String!,handoverId:ID,reason:String!}
type CashHistory {handovers:[HandoverHistory!]!,closes:[CashCloseHistory!]!,movements:[CashMovementHistory!]!}
type CashClose {id:ID!,expected:String!,counted:String!,variance:String!}
input CollectionCustodyInput {requestId:ID!,paymentId:ID,sourceKind:String,sourceId:ID,custody:String!,staffId:ID,routeId:ID,reason:String!}
input HandoverReturnInput {requestId:ID!,supplyId:ID!,quantity:Int!,reason:String!}
input HandoverInput {requestId:ID!,staffId:ID!,routeId:ID!,date:String!,paymentIds:[ID!]!,custodyIds:[ID!],actualCash:String!,returns:[HandoverReturnInput!]!,signoff:String!}
input CashExpenseInput {requestId:ID!,amount:String!,kind:String!,handoverId:ID,reason:String!}
input CashCloseInput {requestId:ID!,date:String!,opening:String!,counted:String!,bankDeposit:String!,reason:String!,signoff:String!}
extend type Query {cashHistory:CashHistory!,cashDay(date:String!):CashDay!}
extend type Mutation {classifyCollection(input:CollectionCustodyInput!):PayrollRecord!,recordHandover(input:HandoverInput!):Handover!,recordCashExpense(input:CashExpenseInput!):PayrollRecord!,closeCashDay(input:CashCloseInput!):CashClose!}
`;
export const cashResolvers = {
  Query: {
    cashHistory: (_r: unknown, _a: unknown, c: RequestContext) =>
      cashHistory(c),
    cashDay: (_r: unknown, a: { date: string }, c: RequestContext) =>
      cashDay(c, a.date),
  },
  Mutation: {
    classifyCollection: (
      _r: unknown,
      a: { input: CustodyInput },
      c: RequestContext,
    ) => classifyCollection(c, a.input),
    recordHandover: (
      _r: unknown,
      a: { input: HandoverInput },
      c: RequestContext,
    ) => recordHandover(c, a.input),
    recordCashExpense: (
      _r: unknown,
      a: { input: ExpenseInput },
      c: RequestContext,
    ) => recordCashExpense(c, a.input),
    closeCashDay: (_r: unknown, a: { input: CloseInput }, c: RequestContext) =>
      closeCashDay(c, a.input),
  },
};

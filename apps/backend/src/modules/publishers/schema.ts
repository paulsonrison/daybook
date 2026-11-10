import type { RequestContext } from '../context.js';
import {
  publishers,
  savePublisher,
  supplyLots,
  supplyReturns,
  receiveSupply,
  recordReturn,
  publisherStatement,
  type PublisherInput,
  type SupplyInput,
  type ReturnInput,
} from './service.js';
export const publisherTypeDefs = `
type Publisher {id:ID!,name:String!,phone:String!,returnCutoff:String!,returnWindowDays:Int!,active:Boolean!,version:Int!}
input PublisherInput {id:ID,version:Int,name:String!,phone:String!,returnCutoff:String!,returnWindowDays:Int!,active:Boolean}
type SupplyLot {id:ID!,publisherId:ID!,publicationId:ID!,date:String!,quantity:Int!,publicationName:String!,dispatch:DispatchTime!,netCost:String!,totalCost:String!,returnDeadline:String!,returned:Int!}
input SupplyInput {requestId:ID!,publisherId:ID!,publicationId:ID!,date:String!,quantity:Int!,netCost:String,listPrice:String,marginPercent:String}
type SupplyReturn {id:ID!,supplyId:ID!,quantity:Int!,reason:String!,credit:String!,date:String!}
input ReturnInput {requestId:ID!,supplyId:ID!,quantity:Int!,reason:String!}
type PublisherStatementRow {publicationId:ID!,name:String!,dispatch:DispatchTime!,supplied:Int!,returned:Int!,supplyCost:String!,returnCredit:String!,netPayable:String!}
type PublisherStatement {publisherId:ID!,month:String!,supplied:Int!,returned:Int!,supplyCost:String!,returnCredit:String!,netPayable:String!,rows:[PublisherStatementRow!]!}
extend type Query {publishers:[Publisher!]!,supplyLots:[SupplyLot!]!,supplyReturns:[SupplyReturn!]!,publisherStatement(publisherId:ID!,month:String!):PublisherStatement!}
extend type Mutation {savePublisher(input:PublisherInput!):Publisher!,receiveSupply(input:SupplyInput!):SupplyLot!,recordReturn(input:ReturnInput!):SupplyReturn!}
`;
export const publisherResolvers = {
  Query: {
    publishers: (_r: unknown, _a: unknown, c: RequestContext) => publishers(c),
    supplyLots: (_r: unknown, _a: unknown, c: RequestContext) => supplyLots(c),
    supplyReturns: (_r: unknown, _a: unknown, c: RequestContext) =>
      supplyReturns(c),
    publisherStatement: (
      _r: unknown,
      a: { publisherId: string; month: string },
      c: RequestContext,
    ) => publisherStatement(c, a.publisherId, a.month),
  },
  Mutation: {
    savePublisher: (
      _r: unknown,
      a: { input: PublisherInput },
      c: RequestContext,
    ) => savePublisher(c, a.input),
    receiveSupply: (
      _r: unknown,
      a: { input: SupplyInput },
      c: RequestContext,
    ) => receiveSupply(c, a.input),
    recordReturn: (_r: unknown, a: { input: ReturnInput }, c: RequestContext) =>
      recordReturn(c, a.input),
  },
};

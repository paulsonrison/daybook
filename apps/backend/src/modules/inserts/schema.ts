import type { RequestContext } from '../context.js';
import {
  advertisers,
  insertOrders,
  advertiserInvoices,
  saveAdvertiser,
  saveInsertOrder,
  cancelInsertOrder,
  completeInsertOrder,
  type AdvertiserInput,
  type InsertOrderInput,
  type InsertActionInput,
  type InsertCompleteInput,
} from './service.js';
export const insertTypeDefs = `
type Advertiser {id:ID!,name:String!,phone:String!,email:String,billingAddress:String!,active:Boolean!,version:Int!}
input AdvertiserInput {id:ID,version:Int,name:String!,phone:String!,email:String,billingAddress:String!,active:Boolean}
type InsertAllocation {routeId:ID!,quantity:Int!}
input InsertAllocationInput {routeId:ID!,quantity:Int!}
type InsertOrder {id:ID!,advertiserId:ID!,title:String!,quantity:Int!,date:String!,dispatch:DispatchTime!,unitPrice:String!,total:String!,status:String!,version:Int!,allocations:[InsertAllocation!]!}
input InsertOrderInput {requestId:ID!,id:ID,version:Int,advertiserId:ID!,title:String!,quantity:Int!,date:String!,dispatch:DispatchTime!,unitPrice:String!,allocations:[InsertAllocationInput!]!}
input InsertActionInput {requestId:ID!,orderId:ID!,version:Int!}
input InsertCompleteInput {requestId:ID!,orderId:ID!,version:Int!,proofReference:String!,noTaxConfirmed:Boolean!}
type AdvertiserInvoice {id:ID!,orderId:ID!,advertiserId:ID!,code:String!,advertiserName:String!,billingAddress:String!,subtotal:String!,tax:String!,total:String!,proofReference:String!,date:String!}
extend type Query {advertisers:[Advertiser!]!,insertOrders:[InsertOrder!]!,advertiserInvoices:[AdvertiserInvoice!]!}
extend type Mutation {saveAdvertiser(input:AdvertiserInput!):Advertiser!,saveInsertOrder(input:InsertOrderInput!):InsertOrder!,cancelInsertOrder(input:InsertActionInput!):InsertOrder!,completeInsertOrder(input:InsertCompleteInput!):AdvertiserInvoice!}
`;
export const insertResolvers = {
  Query: {
    advertisers: (_r: unknown, _a: unknown, c: RequestContext) =>
      advertisers(c),
    insertOrders: (_r: unknown, _a: unknown, c: RequestContext) =>
      insertOrders(c),
    advertiserInvoices: (_r: unknown, _a: unknown, c: RequestContext) =>
      advertiserInvoices(c),
  },
  Mutation: {
    saveAdvertiser: (
      _r: unknown,
      a: { input: AdvertiserInput },
      c: RequestContext,
    ) => saveAdvertiser(c, a.input),
    saveInsertOrder: (
      _r: unknown,
      a: { input: InsertOrderInput },
      c: RequestContext,
    ) => saveInsertOrder(c, a.input),
    cancelInsertOrder: (
      _r: unknown,
      a: { input: InsertActionInput },
      c: RequestContext,
    ) => cancelInsertOrder(c, a.input),
    completeInsertOrder: (
      _r: unknown,
      a: { input: InsertCompleteInput },
      c: RequestContext,
    ) => completeInsertOrder(c, a.input),
  },
};

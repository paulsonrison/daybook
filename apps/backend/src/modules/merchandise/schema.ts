import type { RequestContext } from '../context.js';
import {
  merchandiseItems,
  merchandiseOrders,
  merchandiseCharges,
  saveMerchandise,
  receiveMerchandiseStock,
  saveMerchandiseOrder,
  reserveMerchandise,
  cancelMerchandiseOrder,
  fulfilOrder,
  type MerchandiseInput,
  type MerchandiseStockInput,
  type MerchandiseOrderInput,
  type MerchandiseReserveInput,
  type MerchandiseFulfilInput,
} from './service.js';
export const merchandiseTypeDefs = `
type MerchandiseItem {id:ID!,name:String!,sku:String!,kind:String!,price:String!,onHand:Int!,reserved:Int!,available:Int!,active:Boolean!,version:Int!}
input MerchandiseInput {id:ID,version:Int,name:String!,sku:String!,kind:String!,price:String!,active:Boolean}
input MerchandiseStockInput {requestId:ID!,itemId:ID!,quantity:Int!,note:String!}
type MerchandiseOrder {id:ID!,residentId:ID!,itemId:ID!,name:String!,quantity:Int!,date:String!,dispatch:DispatchTime!,unitPrice:String!,total:String!,settlement:String!,status:String!,version:Int!,receiptCode:String}
input MerchandiseOrderInput {requestId:ID!,residentId:ID!,itemId:ID!,quantity:Int!,date:String!,dispatch:DispatchTime,settlement:String!}
input MerchandiseReserveInput {requestId:ID!,orderId:ID!,version:Int!}
input MerchandiseFulfilInput {requestId:ID!,orderId:ID!,version:Int!,cashReceived:String}
type MerchandiseCharge {id:ID!,orderId:ID!,residentId:ID!,amount:String!,settlement:String!,receiptCode:String,date:String!}
type ManifestExtraItem {kind:String!,sourceOrderId:ID!,residentId:ID!,name:String!,residentName:String!,address:String!,routeId:ID!,routeName:String!,staffId:ID,staffName:String,dropOrder:Int!,quantity:Int!}
extend type Manifest {extraItems:[ManifestExtraItem!]!,extraWarnings:[String!]!}
extend type Query {merchandiseItems:[MerchandiseItem!]!,merchandiseOrders:[MerchandiseOrder!]!,merchandiseCharges:[MerchandiseCharge!]!}
extend type Mutation {saveMerchandise(input:MerchandiseInput!):MerchandiseItem!,receiveMerchandiseStock(input:MerchandiseStockInput!):MerchandiseItem!,saveMerchandiseOrder(input:MerchandiseOrderInput!):MerchandiseOrder!,reserveMerchandise(input:MerchandiseReserveInput!):MerchandiseOrder!,cancelMerchandiseOrder(input:MerchandiseReserveInput!):MerchandiseOrder!,fulfilOrder(input:MerchandiseFulfilInput!):MerchandiseOrder!}
`;
export const merchandiseResolvers = {
  Query: {
    merchandiseItems: (_r: unknown, _a: unknown, c: RequestContext) =>
      merchandiseItems(c),
    merchandiseOrders: (_r: unknown, _a: unknown, c: RequestContext) =>
      merchandiseOrders(c),
    merchandiseCharges: (_r: unknown, _a: unknown, c: RequestContext) =>
      merchandiseCharges(c),
  },
  Mutation: {
    saveMerchandise: (
      _r: unknown,
      a: { input: MerchandiseInput },
      c: RequestContext,
    ) => saveMerchandise(c, a.input),
    receiveMerchandiseStock: (
      _r: unknown,
      a: { input: MerchandiseStockInput },
      c: RequestContext,
    ) => receiveMerchandiseStock(c, a.input),
    saveMerchandiseOrder: (
      _r: unknown,
      a: { input: MerchandiseOrderInput },
      c: RequestContext,
    ) => saveMerchandiseOrder(c, a.input),
    reserveMerchandise: (
      _r: unknown,
      a: { input: MerchandiseReserveInput },
      c: RequestContext,
    ) => reserveMerchandise(c, a.input),
    cancelMerchandiseOrder: (
      _r: unknown,
      a: { input: MerchandiseReserveInput },
      c: RequestContext,
    ) => cancelMerchandiseOrder(c, a.input),
    fulfilOrder: (
      _r: unknown,
      a: { input: MerchandiseFulfilInput },
      c: RequestContext,
    ) => fulfilOrder(c, a.input),
  },
};

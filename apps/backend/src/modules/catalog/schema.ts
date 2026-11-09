import type { RequestContext } from '../context.js';
import {
  publications,
  savePublication,
  type PublicationInput,
} from '../publications/service.js';
import {
  residents,
  saveResident,
  type ResidentInput,
} from '../residents/service.js';
import { recordDeposit } from '../deposits/service.js';
export const catalogTypeDefs = `
enum PublicationKind {NEWSPAPER MAGAZINE PERIODICAL SUPPLEMENT}
enum DispatchTime {MORNING EVENING}
enum PublicationFrequency {DAILY WEEKLY FORTNIGHTLY MONTHLY YEARLY}
type Publication {id:ID!,name:String!,edition:String!,kind:PublicationKind!,language:String!,dispatch:DispatchTime!,frequency:PublicationFrequency!,publishingDays:[Int!]!,anchorDate:String,weekdayPrice:String!,weekendPrice:String!,procurementNetCost:String,version:Int!,active:Boolean!}
input PublicationInput {id:ID,version:Int,name:String!,edition:String!,kind:PublicationKind!,language:String!,dispatch:DispatchTime!,frequency:PublicationFrequency!,publishingDays:[Int!]!,anchorDate:String,weekdayPrice:String!,weekendPrice:String!,procurementNetCost:String,active:Boolean}
type Resident {id:ID!,code:String!,name:String!,address:String!,phone:String!,sector:String!,routeId:ID!,dropOrder:Int!,status:String!,depositBalance:String!,version:Int!}
input ResidentInput {id:ID,version:Int,requestId:ID,name:String!,address:String!,phone:String!,sector:String!,routeId:ID!,dropOrder:Int!,status:String,openingDeposit:String,stopId:ID}
type DepositReceipt {id:ID!,residentId:ID!,receiptCode:String!,amount:String!,balance:String!}
input DepositInput {residentId:ID!,requestId:ID!,amount:String!}
extend type Query {publications:[Publication!]!,residents:[Resident!]!}
extend type Mutation {savePublication(input:PublicationInput!):Publication!,saveResident(input:ResidentInput!):Resident!,recordDeposit(input:DepositInput!):DepositReceipt!}
`;
export const catalogResolvers = {
  Query: {
    publications: (_r: unknown, _a: unknown, c: RequestContext) =>
      publications(c),
    residents: (_r: unknown, _a: unknown, c: RequestContext) => residents(c),
  },
  Mutation: {
    savePublication: (
      _r: unknown,
      a: { input: PublicationInput },
      c: RequestContext,
    ) => savePublication(c, a.input),
    saveResident: (
      _r: unknown,
      a: { input: ResidentInput },
      c: RequestContext,
    ) => saveResident(c, a.input),
    recordDeposit: (
      _r: unknown,
      a: { input: { residentId: string; requestId: string; amount: string } },
      c: RequestContext,
    ) => recordDeposit(c, a.input),
  },
};

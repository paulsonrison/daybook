import type { RequestContext } from '../context.js';
import {
  creditPolicy,
  saveCreditPolicy,
  creditRiskSummary,
  suspendForCredit,
} from './service.js';
import {
  collectionSettings,
  saveCollectionSettings,
  buildCollectionSheet,
} from '../reports/collection.js';
export const creditTypeDefs = `
type CreditPolicy {maxOverdueAmount:String,maxOverdueDays:Int,enabled:Boolean!,version:Int!}
input CreditPolicyInput {maxOverdueAmount:String,maxOverdueDays:Int,enabled:Boolean,version:Int}
type CreditRiskAccount {residentId:ID!,name:String!,code:String!,phone:String!,status:String!,version:Int!,routeId:ID!,routeName:String!,sequence:Int,balance:String!,overdueAmount:String!,oldestDueDate:String,overdueDays:Int!,exceedsAmount:Boolean!,exceedsDays:Boolean!,highRisk:Boolean!}
type CreditRiskSummary {today:String!,policy:CreditPolicy!,accounts:[CreditRiskAccount!]!,highRiskCount:Int!}
input CreditSuspensionInput {requestId:ID!,residentId:ID!,version:Int!,reason:String!}
type CreditSuspension {residentId:ID!,status:String!,notificationStatus:String!}
type CollectionSettings {upiId:String,payeeName:String,version:Int!}
input CollectionSettingsInput {upiId:String!,payeeName:String!,confirmOwnership:Boolean!,version:Int}
input CollectionSheetInput {routeId:ID!,fromDrop:Int,toDrop:Int}
type CollectionSheetRow {residentId:ID!,name:String!,code:String!,phone:String!,address:String!,door:String,sequence:Int!,balance:String!,overdueAmount:String!,overdueDays:Int!,oldestDueDate:String,upiUri:String,qrDataUrl:String}
type CollectionSheet {fingerprint:String!,routeId:ID!,routeName:String!,date:String!,qrStatus:String!,rows:[CollectionSheetRow!]!}
extend type Query {creditPolicy:CreditPolicy!,creditRiskSummary:CreditRiskSummary!,collectionSettings:CollectionSettings!,buildCollectionSheet(input:CollectionSheetInput!):CollectionSheet!}
extend type Mutation {saveCreditPolicy(input:CreditPolicyInput!):CreditPolicy!,suspendForCredit(input:CreditSuspensionInput!):CreditSuspension!,saveCollectionSettings(input:CollectionSettingsInput!):CollectionSettings!}
`;
export const creditResolvers = {
  Query: {
    creditPolicy: (_r: unknown, _a: unknown, c: RequestContext) =>
      creditPolicy(c),
    creditRiskSummary: (_r: unknown, _a: unknown, c: RequestContext) =>
      creditRiskSummary(c),
    collectionSettings: (_r: unknown, _a: unknown, c: RequestContext) =>
      collectionSettings(c),
    buildCollectionSheet: (
      _r: unknown,
      a: { input: Parameters<typeof buildCollectionSheet>[1] },
      c: RequestContext,
    ) => buildCollectionSheet(c, a.input),
  },
  Mutation: {
    saveCreditPolicy: (
      _r: unknown,
      a: { input: Parameters<typeof saveCreditPolicy>[1] },
      c: RequestContext,
    ) => saveCreditPolicy(c, a.input),
    suspendForCredit: (
      _r: unknown,
      a: { input: Parameters<typeof suspendForCredit>[1] },
      c: RequestContext,
    ) => suspendForCredit(c, a.input),
    saveCollectionSettings: (
      _r: unknown,
      a: { input: Parameters<typeof saveCollectionSettings>[1] },
      c: RequestContext,
    ) => saveCollectionSettings(c, a.input),
  },
};

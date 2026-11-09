import type { RequestContext } from '../context.js';
import {
  subscriptions,
  saveSubscription,
  type SubscriptionInput,
} from './service.js';
import { holds, setHold, type HoldInput } from './holds.js';
import {
  priceRules,
  savePriceRule,
  type PriceInput,
} from '../pricing/service.js';
import { scheduledCopies } from '../scheduling/service.js';
export const subscriptionTypeDefs = `
enum Cadence {DAILY WEEKDAYS SUNDAY ONCE WEEKLY FORTNIGHTLY MONTHLY YEARLY}
enum SubscriptionStatus {ACTIVE PAUSED CANCELLED}
type Subscription {id:ID!,residentId:ID!,publicationId:ID!,cadence:Cadence!,startDate:String!,endDate:String,weekdays:[Int!]!,quantity:Int!,status:SubscriptionStatus!,version:Int!}
input SubscriptionInput {id:ID,version:Int,requestId:ID,residentId:ID!,publicationId:ID!,cadence:Cadence!,startDate:String!,endDate:String,weekdays:[Int!]!,quantity:Int!,status:SubscriptionStatus}
type Hold {id:ID!,residentId:ID!,subscriptionId:ID,startDate:String!,resumeDate:String,active:Boolean!,version:Int!}
input HoldInput {id:ID,version:Int,residentId:ID!,subscriptionId:ID,startDate:String!,resumeDate:String,active:Boolean}
type PriceRule {id:ID!,publicationId:ID!,startDate:String!,endDate:String,weekdays:[Int!]!,price:String!,active:Boolean!,version:Int!}
input PriceRuleInput {id:ID,version:Int,publicationId:ID!,startDate:String!,endDate:String,weekdays:[Int!]!,price:String!,active:Boolean}
type ScheduledCopy {subscriptionId:ID!,residentId:ID!,publicationId:ID!,routeId:ID!,dropOrder:Int!,dispatch:DispatchTime!,quantity:Int!,price:String!,ruleId:ID}
extend type Query {subscriptions(residentId:ID):[Subscription!]!,holds(residentId:ID):[Hold!]!,priceRules(publicationId:ID):[PriceRule!]!,scheduledCopies(residentId:ID,date:String!):[ScheduledCopy!]!}
extend type Mutation {saveSubscription(input:SubscriptionInput!):Subscription!,setHold(input:HoldInput!):Hold!,savePriceRule(input:PriceRuleInput!):PriceRule!}
`;
export const subscriptionResolvers = {
  Query: {
    subscriptions: (
      _r: unknown,
      a: { residentId?: string },
      c: RequestContext,
    ) => subscriptions(c, a.residentId),
    holds: (_r: unknown, a: { residentId?: string }, c: RequestContext) =>
      holds(c, a.residentId),
    priceRules: (
      _r: unknown,
      a: { publicationId?: string },
      c: RequestContext,
    ) => priceRules(c, a.publicationId),
    scheduledCopies: (
      _r: unknown,
      a: { residentId?: string; date: string },
      c: RequestContext,
    ) => scheduledCopies(c, a.date, a.residentId),
  },
  Mutation: {
    saveSubscription: (
      _r: unknown,
      a: { input: SubscriptionInput },
      c: RequestContext,
    ) => saveSubscription(c, a.input),
    setHold: (_r: unknown, a: { input: HoldInput }, c: RequestContext) =>
      setHold(c, a.input),
    savePriceRule: (_r: unknown, a: { input: PriceInput }, c: RequestContext) =>
      savePriceRule(c, a.input),
  },
};

import type { RequestContext } from '../context.js';
import { deliveryMetrics } from './metrics.js';
import { buildManifest, manifests } from '../manifests/service.js';
import {
  assignSubstitutes,
  substituteAssignments,
  type SubstituteInput,
} from '../substitutions/service.js';
import {
  complaints,
  recordComplaint,
  resolveComplaint,
  type ComplaintInput,
  type ComplaintResolutionInput,
} from '../complaints/service.js';
import {
  deliveryLogs,
  markScheduledDeliveries,
  overrideDelivery,
  pressHolidays,
  savePressHoliday,
  type DeliveryOverrideInput,
  type PressHolidayInput,
} from './service.js';
export const deliveryTypeDefs = `
enum DeliveryStatus {DELIVERED MISSED DAMAGED REPLACED CREDITED SKIPPED}
type DeliveryLog {id:ID!,subscriptionId:ID!,residentId:ID!,publicationId:ID!,routeId:ID!,staffId:ID,date:String!,dispatch:DispatchTime!,dropOrder:Int!,residentName:String!,address:String!,publicationName:String!,routeName:String!,staffName:String,quantity:Int!,price:String!,ruleId:ID,status:DeliveryStatus!,source:String!,reason:String,chargeableQuantity:Int!,version:Int!}
type MarkResult {created:Int!,total:Int!}
input DeliveryOverrideInput {id:ID!,version:Int!,status:DeliveryStatus!,reason:String!,requestId:ID!}
type PressHoliday {id:ID!,publicationId:ID!,date:String!,reason:String!,active:Boolean!,version:Int!}
input PressHolidayInput {id:ID,version:Int,publicationId:ID!,date:String!,reason:String!,active:Boolean}
type SubstituteAllocation {staffId:ID!,fromDrop:Int!,toDrop:Int!}
input SubstituteAllocationInput {staffId:ID!,fromDrop:Int!,toDrop:Int!}
type SubstituteAssignment {id:ID!,routeId:ID!,startDate:String!,endDate:String!,reason:String!,active:Boolean!,version:Int!,allocations:[SubstituteAllocation!]!}
input SubstituteInput {id:ID,version:Int,routeId:ID!,startDate:String!,endDate:String!,reason:String!,active:Boolean,allocations:[SubstituteAllocationInput!]!}
type ManifestRow {residentId:ID!,publicationId:ID!,subscriptionId:ID!,routeId:ID!,staffId:ID,residentName:String!,address:String!,publicationName:String!,routeName:String!,staffName:String,dropOrder:Int!,quantity:Int!,price:String!}
type PublicationCount {publicationId:ID!,name:String!,copies:Int!}
type Manifest {id:ID!,date:String!,dispatch:DispatchTime!,totalCopies:Int!,rows:[ManifestRow!]!,publications:[PublicationCount!]!,averageCopies:Float,deviation:Boolean!,version:Int!}
type Complaint {id:ID!,deliveryId:ID!,kind:String!,note:String!,status:String!,resolutionNote:String,replacementCopies:Int!,credit:String!,version:Int!,residentName:String!,routeName:String!,staffId:ID,staffName:String}
input ComplaintInput {requestId:ID!,deliveryId:ID!,kind:String!,note:String!}
input ComplaintResolutionInput {requestId:ID!,id:ID!,version:Int!,resolution:String!,note:String!,rating:Int}
type StaffErrorMetric {staffId:ID,name:String!,errors:Int!,deliveries:Int!}
type DeliveryMetrics {openComplaints:Int!,resolvedComplaints:Int!,totalComplaints:Int!,satisfactionAverage:Float,staffErrors:[StaffErrorMetric!]!,failedJobs:Int!,lastAutomaticRun:String,today:String!,timezone:String!}
extend type Query {deliveryMetrics:DeliveryMetrics!}
extend type Query {deliveryLogs(date:String!,routeId:ID):[DeliveryLog!]!,pressHolidays:[PressHoliday!]!,substituteAssignments:[SubstituteAssignment!]!,manifests(date:String):[Manifest!]!,complaints:[Complaint!]!}
extend type Mutation {markScheduledDeliveries(date:String!):MarkResult!,overrideDelivery(input:DeliveryOverrideInput!):DeliveryLog!,savePressHoliday(input:PressHolidayInput!):PressHoliday!,assignSubstitutes(input:SubstituteInput!):SubstituteAssignment!,buildManifest(date:String!,dispatch:DispatchTime!):Manifest!,recordComplaint(input:ComplaintInput!):Complaint!,resolveComplaint(input:ComplaintResolutionInput!):Complaint!}
`;
export const deliveryResolvers = {
  Query: {
    deliveryMetrics: (_r: unknown, _a: unknown, c: RequestContext) =>
      deliveryMetrics(c),
    deliveryLogs: (
      _r: unknown,
      a: { date: string; routeId?: string },
      c: RequestContext,
    ) => deliveryLogs(c, a.date, a.routeId),
    pressHolidays: (_r: unknown, _a: unknown, c: RequestContext) =>
      pressHolidays(c),
    substituteAssignments: (_r: unknown, _a: unknown, c: RequestContext) =>
      substituteAssignments(c),
    manifests: (_r: unknown, a: { date?: string }, c: RequestContext) =>
      manifests(c, a.date),
    complaints: (_r: unknown, _a: unknown, c: RequestContext) => complaints(c),
  },
  Mutation: {
    markScheduledDeliveries: (
      _r: unknown,
      a: { date: string },
      c: RequestContext,
    ) => markScheduledDeliveries(c, a.date),
    overrideDelivery: (
      _r: unknown,
      a: { input: DeliveryOverrideInput },
      c: RequestContext,
    ) => overrideDelivery(c, a.input),
    savePressHoliday: (
      _r: unknown,
      a: { input: PressHolidayInput },
      c: RequestContext,
    ) => savePressHoliday(c, a.input),
    assignSubstitutes: (
      _r: unknown,
      a: { input: SubstituteInput },
      c: RequestContext,
    ) => assignSubstitutes(c, a.input),
    buildManifest: (
      _r: unknown,
      a: { date: string; dispatch: string },
      c: RequestContext,
    ) => buildManifest(c, a.date, a.dispatch),
    recordComplaint: (
      _r: unknown,
      a: { input: ComplaintInput },
      c: RequestContext,
    ) => recordComplaint(c, a.input),
    resolveComplaint: (
      _r: unknown,
      a: { input: ComplaintResolutionInput },
      c: RequestContext,
    ) => resolveComplaint(c, a.input),
  },
};

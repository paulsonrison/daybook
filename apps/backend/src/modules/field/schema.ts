import type { RequestContext } from '../context.js';
import {
  fieldSnapshot,
  syncFieldAction,
  type FieldActionInput,
} from './service.js';
export const fieldTypeDefs = `
type FieldResident {id:ID!,name:String!,address:String!,balance:String!,cashVersion:String!}
type FieldSnapshot {agencyId:ID!,agentId:ID!,date:String!,routeName:String!,downloadedAt:String!,residents:[FieldResident!]!,deliveries:[DeliveryLog!]!}
type FieldActionResult {requestId:ID!,kind:String!,status:String!,receiptCode:String}
input FieldActionInput {requestId:ID!,agencyId:ID!,agentId:ID!,kind:String!,recordId:ID!,expectedVersion:String!,occurredAt:String!,reason:String!,status:String,amount:String,date:String}
extend type Query {fieldSnapshot(date:String!,routeId:ID!):FieldSnapshot!}
extend type Mutation {syncFieldAction(input:FieldActionInput!):FieldActionResult!}
`;
export const fieldResolvers = {
  Query: {
    fieldSnapshot: (
      _r: unknown,
      a: { date: string; routeId: string },
      c: RequestContext,
    ) => fieldSnapshot(c, a.date, a.routeId),
  },
  Mutation: {
    syncFieldAction: (
      _r: unknown,
      a: { input: FieldActionInput },
      c: RequestContext,
    ) => syncFieldAction(c, a.input),
  },
};

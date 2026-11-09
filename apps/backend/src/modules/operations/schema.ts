import { agencyRead, type RequestContext } from '../context.js';
import {
  territories,
  saveTerritory,
  type TerritoryInput,
} from '../territories/service.js';
import { staff, saveStaff, type StaffInput } from '../staff/service.js';
import { routes, saveRoute, type RouteInput } from '../routes/service.js';

export const operationsTypeDefs = `
type Territory {id:ID!,name:String!,locality:String!,pinCodes:[String!]!,sectors:[String!]!,active:Boolean!,version:Int!}
enum StaffStatus {ACTIVE ON_LEAVE INACTIVE}
type Staff {id:ID!,name:String!,staffCode:String!,phone:String!,status:StaffStatus!,version:Int!,assignedSectors:[String!]!}
type RouteStop {id:ID!,label:String!,door:String!,sequence:Int!}
type Route {id:ID!,code:String!,name:String!,territoryId:ID!,staffId:ID,staffName:String,active:Boolean!,version:Int!,stops:[RouteStop!]!}
type OperationsSummary {territories:Int!,activeStaff:Int!,activeRoutes:Int!}
type AuditEvent {id:ID!,action:String!,entityType:String!,entityId:ID!,actorId:ID!,createdAt:String!}
input TerritoryInput {id:ID,version:Int,name:String!,locality:String!,pinCodes:[String!]!,sectors:[String!]!,active:Boolean,overlapReason:String}
input StaffInput {id:ID,version:Int,name:String!,staffCode:String!,phone:String!,status:StaffStatus!}
input RouteStopInput {id:ID,label:String!,door:String!,sequence:Int!}
input RouteInput {id:ID,version:Int,code:String!,name:String!,territoryId:ID!,staffId:ID,active:Boolean,stops:[RouteStopInput!]}
extend type Query {territories:[Territory!]!,staff:[Staff!]!,routes:[Route!]!,operationsSummary:OperationsSummary!,auditEvents:[AuditEvent!]!}
type Mutation {saveTerritory(input:TerritoryInput!):Territory!,saveStaff(input:StaffInput!):Staff!,saveRoute(input:RouteInput!):Route!}
`;
export const operationsResolvers = {
  Query: {
    territories: (_root: unknown, _args: unknown, ctx: RequestContext) =>
      territories(ctx),
    staff: (_root: unknown, _args: unknown, ctx: RequestContext) => staff(ctx),
    routes: (_root: unknown, _args: unknown, ctx: RequestContext) =>
      routes(ctx),
    operationsSummary: (_root: unknown, _args: unknown, ctx: RequestContext) =>
      agencyRead(ctx, async (client) => {
        const { rows } = await client.query(
          'SELECT (SELECT count(*)::integer FROM daybook.territories WHERE active) AS territories,(SELECT count(*)::integer FROM daybook.staff WHERE status=\'ACTIVE\') AS "activeStaff",(SELECT count(*)::integer FROM daybook.routes WHERE active) AS "activeRoutes"',
        );
        return rows[0];
      }),
    auditEvents: (_root: unknown, _args: unknown, ctx: RequestContext) =>
      agencyRead(ctx, async (client) =>
        (
          await client.query(
            'SELECT id,action,entity_type AS "entityType",entity_id AS "entityId",actor_id AS "actorId",created_at AS "createdAt" FROM daybook.audit_events ORDER BY created_at DESC,id LIMIT 200',
          )
        ).rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      ),
  },
  Mutation: {
    saveTerritory: (
      _root: unknown,
      args: { input: TerritoryInput },
      ctx: RequestContext,
    ) => saveTerritory(ctx, args.input),
    saveStaff: (
      _root: unknown,
      args: { input: StaffInput },
      ctx: RequestContext,
    ) => saveStaff(ctx, args.input),
    saveRoute: (
      _root: unknown,
      args: { input: RouteInput },
      ctx: RequestContext,
    ) => saveRoute(ctx, args.input),
  },
};

import type { RequestContext } from '../context.js';
import {
  agentPreferences,
  saveAgentPreferences,
  type AgentPreferencesInput,
} from './service.js';
export const preferenceTypeDefs = `
type AgentTypography {family:String!,size:Int!,weight:Int!,style:String!,lineHeight:Float!}
type AgentPreferences {version:Int!,locale:String!,mode:String!,scheme:String!,layout:String!,typography:AgentTypography!}
input AgentPreferencesInput {requestId:ID!,version:Int!,locale:String!,mode:String!,scheme:String!,layout:String!,fontFamily:String!,fontSize:Int!,fontWeight:Int!,fontStyle:String!,lineHeight:Float!}
extend type Query {agentPreferences:AgentPreferences!}
extend type Mutation {saveAgentPreferences(input:AgentPreferencesInput!):AgentPreferences!}
`;
export const preferenceResolvers = {
  Query: {
    agentPreferences: (_r: unknown, _a: unknown, c: RequestContext) =>
      agentPreferences(c),
  },
  Mutation: {
    saveAgentPreferences: (
      _r: unknown,
      a: { input: AgentPreferencesInput },
      c: RequestContext,
    ) => saveAgentPreferences(c, a.input),
  },
};

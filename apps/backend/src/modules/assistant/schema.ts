import type { RequestContext } from '../context.js';
import { askAssistant } from './service.js';
export const assistantTypeDefs = `input AssistantInput{question:String!,month:String} type AssistantReply{status:String!,answer:String,facts:String,asOf:String} extend type Mutation{askAssistant(input:AssistantInput!):AssistantReply!}`;
export const assistantResolvers = {
  Mutation: {
    askAssistant: (
      _root: unknown,
      args: { input: { question: string; month?: string | null } },
      ctx: RequestContext,
    ) => askAssistant(ctx, args.input),
  },
};

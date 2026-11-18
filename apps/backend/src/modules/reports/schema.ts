import type { RequestContext } from '../context.js';
import { agencyReport, generateReport, prepareReport } from './service.js';

export const reportTypeDefs = `
input ExportReportInput { requestId: ID!, kind: String!, month: String!, locale: String! }
input GenerateReportInput { requestId: ID!, reportId: ID!, format: String! }
type ReportArtifact { format: String!, status: String!, sha256: String, byteLength: Int }
type AgencyReport { id: ID!, kind: String!, month: String!, locale: String!, snapshotHash: String!, createdAt: String!, artifacts: [ReportArtifact!]! }
type GenerateReportResult { id: ID!, artifacts: [ReportArtifact!]! }
extend type Query { agencyReport(id: ID!): AgencyReport! }
extend type Mutation { exportReport(input: ExportReportInput!): AgencyReport!, generateReport(input: GenerateReportInput!): GenerateReportResult! }
`;

export const reportResolvers = {
  Query: {
    agencyReport: (_root: unknown, args: { id: string }, ctx: RequestContext) =>
      agencyReport(ctx, args.id),
  },
  Mutation: {
    exportReport: (
      _root: unknown,
      args: { input: Parameters<typeof prepareReport>[1] },
      ctx: RequestContext,
    ) => prepareReport(ctx, args.input),
    generateReport: (
      _root: unknown,
      args: { input: Parameters<typeof generateReport>[1] },
      ctx: RequestContext,
    ) => generateReport(ctx, args.input),
  },
};

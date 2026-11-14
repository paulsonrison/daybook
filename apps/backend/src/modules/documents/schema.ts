import { requireAgent, type RequestContext } from '../context.js';
import { documentSources, type DocumentSourcesInput } from './sources.js';
import {
  createDocumentLink,
  revokeDocumentLink,
  documentLinks,
  publicDocumentStatus,
  type DocumentLinkInput,
  type RevokeDocumentLinkInput,
} from './links.js';
import {
  document,
  documents,
  prepareDocument,
  generateDocument,
  type PrepareDocumentInput,
  type GenerateDocumentInput,
} from './service.js';
export const documentTypeDefs = `
type DocumentSource {id:ID!,kind:String!,title:String!,date:String!,version:Int!}
type DocumentSourcePage {items:[DocumentSource!]!,hasMore:Boolean!}
input DocumentSourcesInput {kind:String!,residentId:ID,staffId:ID,from:String,to:String,beforeDate:String,beforeId:ID}
extend type Query {documentSources(input:DocumentSourcesInput!):DocumentSourcePage!}
type DocumentLink {id:ID!,documentId:ID!,status:String!,urlStatus:String!,url:String,expiresAt:String!,createdAt:String!}
input DocumentLinkInput {requestId:ID!,documentId:ID!,expiryDays:Int}
input RevokeDocumentLinkInput {requestId:ID!,linkId:ID!}
type FinancialDocument {id:ID!,kind:String!,sourceId:ID!,sourceVersion:Int!,locale:String!,status:String!,snapshot:String!,snapshotHash:String!,filename:String!,byteLength:Int!,sha256:String,lastError:String,attempts:Int!,createdAt:String!}
input PrepareDocumentInput {requestId:ID!,kind:String!,sourceId:ID!,sourceVersion:Int,locale:String!}
input GenerateDocumentInput {requestId:ID!,documentId:ID!}
extend type Query {publicDocumentStatus:String!,documentLinks(documentId:ID!):[DocumentLink!]!,document(id:ID!):FinancialDocument!,documents(sourceId:ID):[FinancialDocument!]!}
extend type Mutation {createDocumentLink(input:DocumentLinkInput!):DocumentLink!,revokeDocumentLink(input:RevokeDocumentLinkInput!):DocumentLink!,prepareDocument(input:PrepareDocumentInput!):FinancialDocument!,generateDocument(input:GenerateDocumentInput!):FinancialDocument!}
`;
export const documentResolvers = {
  Query: {
    documentSources: (
      _r: unknown,
      a: { input: DocumentSourcesInput },
      c: RequestContext,
    ) => documentSources(c, a.input),
    publicDocumentStatus: (_r: unknown, _a: unknown, c: RequestContext) => {
      requireAgent(c);
      return publicDocumentStatus();
    },
    documentLinks: (
      _r: unknown,
      a: { documentId: string },
      c: RequestContext,
    ) => documentLinks(c, a.documentId),
    document: (_r: unknown, a: { id: string }, c: RequestContext) =>
      document(c, a.id),
    documents: (_r: unknown, a: { sourceId?: string }, c: RequestContext) =>
      documents(c, a.sourceId),
  },
  Mutation: {
    createDocumentLink: (
      _r: unknown,
      a: { input: DocumentLinkInput },
      c: RequestContext,
    ) => createDocumentLink(c, a.input),
    revokeDocumentLink: (
      _r: unknown,
      a: { input: RevokeDocumentLinkInput },
      c: RequestContext,
    ) => revokeDocumentLink(c, a.input),
    prepareDocument: (
      _r: unknown,
      a: { input: PrepareDocumentInput },
      c: RequestContext,
    ) => prepareDocument(c, a.input),
    generateDocument: (
      _r: unknown,
      a: { input: GenerateDocumentInput },
      c: RequestContext,
    ) => generateDocument(c, a.input),
  },
};

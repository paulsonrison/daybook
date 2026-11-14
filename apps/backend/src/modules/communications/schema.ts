import type { RequestContext } from '../context.js';
import { queueReminder, type QueueReminderInput } from './account-notices.js';
import {
  resolveMessageUncertainty,
  messageResolutions,
  type MessageResolutionInput,
} from './resolutions.js';
import {
  queueInvoiceMessages,
  messageDispatches,
  messageDispatchStatuses,
  dispatchHistory,
  type DispatchHistoryInput,
  type InvoiceMessageBatchInput,
} from './dispatch.js';
import {
  communicationSettings,
  saveCommunicationSettings,
  contactPreference,
  saveContactPreference,
  contactLinks,
  recordContactAttempt,
  communicationHistory,
  type CommunicationSettingsInput,
  type ContactPreferenceInput,
  type ContactAttemptInput,
  type CommunicationCursor,
} from './service.js';
export const communicationTypeDefs = `
input QueueReminderInput {requestId:ID!,residentId:ID!,channel:String!}
extend type Mutation {queueReminder(input:QueueReminderInput!):MessageDispatch!}
type MessageDispatch {id:ID!,residentId:ID!,invoiceId:ID,documentId:ID,documentStatus:String,kind:String!,channel:String!,recipient:String!,providerMessageId:String,status:String!,reason:String,attempts:Int!,createdAt:String!}
input DispatchHistoryInput {residentId:ID,status:String,beforeCreatedAt:String,beforeId:ID}
type DispatchHistoryPage {items:[MessageDispatch!]!,hasMore:Boolean!}
extend type Query {dispatchHistory(input:DispatchHistoryInput!):DispatchHistoryPage!}
type MessageResolution {id:ID!,messageId:ID!,decision:String!,evidence:String!,providerReference:String,agentName:String!,createdAt:String!}
input MessageResolutionInput {requestId:ID!,messageId:ID!,decision:String!,evidence:String!,providerReference:String,confirmedEvidence:Boolean!}
extend type Query {messageResolutions(messageId:ID!):[MessageResolution!]!}
extend type Mutation {resolveMessageUncertainty(input:MessageResolutionInput!):MessageDispatch!}
input InvoiceMessageItemInput {invoiceId:ID!,version:Int!,documentId:ID,linkId:ID}
input InvoiceMessageBatchInput {requestId:ID!,channel:String!,items:[InvoiceMessageItemInput!]!}
extend type Query {messageDispatches:[MessageDispatch!]!,messageDispatchStatuses(ids:[ID!]!):[MessageDispatch!]!}
extend type Mutation {queueInvoiceMessages(input:InvoiceMessageBatchInput!):[MessageDispatch!]!}
type ApprovedMessageTemplate {kind:String!,locale:String!,name:String!,language:String!,qrHeader:Boolean!}
input ApprovedMessageTemplateInput {kind:String!,locale:String!,name:String!,language:String!,qrHeader:Boolean!}
type CommunicationSettings {version:Int!,remindersEnabled:Boolean!,frequencyDays:Int!,cooldownHours:Int!,reminderChannel:String!,whatsappStatus:String!,smsStatus:String!,templates:[ApprovedMessageTemplate!]!}
type ContactPreference {residentId:ID!,locale:String!,whatsapp:Boolean!,sms:Boolean!,phoneSnapshot:String,evidence:String!,version:Int!,updatedAt:String,needsConsentRenewal:Boolean!}
type ContactLinks {tel:String!,whatsapp:String!}
type ContactAttempt {id:ID!,channel:String,outcome:String!,createdAt:String}
type CommunicationMessage {id:ID!,kind:String!,channel:String!,status:String!,createdAt:String!}
input CommunicationCursorInput {id:ID!,createdAt:String!}
type CommunicationHistory {attempts:[ContactAttempt!]!,messages:[CommunicationMessage!]!,attemptsHasMore:Boolean!,messagesHasMore:Boolean!}
input CommunicationSettingsInput {requestId:ID!,version:Int!,remindersEnabled:Boolean!,frequencyDays:Int!,cooldownHours:Int!,reminderChannel:String!,templates:[ApprovedMessageTemplateInput!],confirmTemplatesApproved:Boolean}
input ContactPreferenceInput {requestId:ID!,residentId:ID!,version:Int!,locale:String!,whatsapp:Boolean!,sms:Boolean!,confirmedConsent:Boolean!,evidence:String!}
input ContactAttemptInput {requestId:ID!,residentId:ID!,channel:String!}
extend type Query {communicationSettings:CommunicationSettings!,contactPreference(residentId:ID!):ContactPreference!,contactLinks(residentId:ID!):ContactLinks!,communicationHistory(residentId:ID!,attemptsBefore:CommunicationCursorInput,messagesBefore:CommunicationCursorInput):CommunicationHistory!}
extend type Mutation {saveCommunicationSettings(input:CommunicationSettingsInput!):CommunicationSettings!,saveContactPreference(input:ContactPreferenceInput!):ContactPreference!,recordContactAttempt(input:ContactAttemptInput!):ContactAttempt!}
`;
export const communicationResolvers = {
  Query: {
    dispatchHistory: (
      _r: unknown,
      a: { input: DispatchHistoryInput },
      c: RequestContext,
    ) => dispatchHistory(c, a.input),
    messageResolutions: (
      _r: unknown,
      a: { messageId: string },
      c: RequestContext,
    ) => messageResolutions(c, a.messageId),
    messageDispatchStatuses: (
      _r: unknown,
      a: { ids: string[] },
      c: RequestContext,
    ) => messageDispatchStatuses(c, a.ids),
    messageDispatches: (_r: unknown, _a: unknown, c: RequestContext) =>
      messageDispatches(c),
    communicationSettings: (_r: unknown, _a: unknown, c: RequestContext) =>
      communicationSettings(c),
    contactPreference: (
      _r: unknown,
      a: { residentId: string },
      c: RequestContext,
    ) => contactPreference(c, a.residentId),
    contactLinks: (_r: unknown, a: { residentId: string }, c: RequestContext) =>
      contactLinks(c, a.residentId),
    communicationHistory: (
      _r: unknown,
      a: {
        residentId: string;
        attemptsBefore?: CommunicationCursor | null;
        messagesBefore?: CommunicationCursor | null;
      },
      c: RequestContext,
    ) =>
      communicationHistory(c, a.residentId, a.attemptsBefore, a.messagesBefore),
  },
  Mutation: {
    queueReminder: (
      _r: unknown,
      a: { input: QueueReminderInput },
      c: RequestContext,
    ) => queueReminder(c, a.input),
    resolveMessageUncertainty: (
      _r: unknown,
      a: { input: MessageResolutionInput },
      c: RequestContext,
    ) => resolveMessageUncertainty(c, a.input),
    queueInvoiceMessages: (
      _r: unknown,
      a: { input: InvoiceMessageBatchInput },
      c: RequestContext,
    ) => queueInvoiceMessages(c, a.input),
    saveCommunicationSettings: (
      _r: unknown,
      a: { input: CommunicationSettingsInput },
      c: RequestContext,
    ) => saveCommunicationSettings(c, a.input),
    saveContactPreference: (
      _r: unknown,
      a: { input: ContactPreferenceInput },
      c: RequestContext,
    ) => saveContactPreference(c, a.input),
    recordContactAttempt: (
      _r: unknown,
      a: { input: ContactAttemptInput },
      c: RequestContext,
    ) => recordContactAttempt(c, a.input),
  },
};

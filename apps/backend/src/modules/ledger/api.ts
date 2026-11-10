import {
  audit,
  cleanText,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { parseMoney, moneyString } from '../money.js';
import { agencyToday } from '../delivery/repository.js';
import { calendarDate } from '../scheduling/calendar.js';
import { billingResident, closedPeriod } from '../billing/repository.js';
import { financialRead } from '../billing/transactions.js';
import { postEntry, residentLedger, settleResident } from './service.js';
interface AdjustmentInput {
  requestId: string;
  residentId: string;
  direction: string;
  category: string;
  amount: string;
  date?: string;
  reason: string;
}
export function postAdjustment(ctx: RequestContext, input: AdjustmentInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'ACCOUNT_ADJUSTMENT',
      input,
      async () => {
        const residentId = idValue(input.residentId);
        if (!(await billingResident(c, residentId)))
          return fail('Resident not found.', 'NOT_FOUND');
        if (
          !['CREDIT', 'DEBIT'].includes(input.direction) ||
          !['OPENING', 'CORRECTION'].includes(input.category)
        )
          return fail('Choose a valid adjustment direction and category.');
        const amount = parseMoney(input.amount);
        if (!amount) return fail('Enter an amount greater than zero.');
        const date = input.date ?? (await agencyToday(c));
        calendarDate(date);
        if (await closedPeriod(c, date))
          return fail(
            'This financial period is closed. Record the correction in an open period.',
            'CONFLICT',
          );
        const reason = cleanText(input.reason, 'adjustment reason', 1000),
          entry = await postEntry(c, {
            agencyId: ctx.agent!.agencyId,
            residentId,
            kind: input.category === 'OPENING' ? 'OPENING' : 'ADJUSTMENT',
            sourceKey: `adjustment:${input.requestId}`,
            amountPaise: input.direction === 'CREDIT' ? -amount : amount,
            date,
            dueDate: date,
            description: reason,
            actorId: ctx.agent!.id,
          });
        await settleResident(c, residentId);
        await audit(c, ctx, 'LEDGER', entry!.id, 'ADJUSTMENT_POSTED', {
          direction: input.direction,
          amount: moneyString(amount),
          reason,
        });
        return { id: entry!.id };
      },
    ),
  );
}
export const ledgerTypeDefs = `
type LedgerEntry {id:ID!,kind:String!,sourceKey:String!,amount:String!,openAmount:String!,date:String!,dueDate:String!,description:String!,invoiceId:ID,referenceInvoiceId:ID,createdAt:String!}
type ResidentLedger {balance:String!,credit:String!,entries:[LedgerEntry!]!}
type AdjustmentResult {id:ID!}
input AccountAdjustmentInput {requestId:ID!,residentId:ID!,direction:String!,category:String!,amount:String!,date:String,reason:String!}
extend type Query {residentLedger(residentId:ID!):ResidentLedger!}
extend type Mutation {postAdjustment(input:AccountAdjustmentInput!):AdjustmentResult!}
`;
export const ledgerResolvers = {
  Query: {
    residentLedger: (
      _r: unknown,
      a: { residentId: string },
      c: RequestContext,
    ) =>
      financialRead(c, async (client) => {
        if (!(await billingResident(client, idValue(a.residentId))))
          return fail('Resident not found.', 'NOT_FOUND');
        return residentLedger(client, a.residentId);
      }),
  },
  Mutation: {
    postAdjustment: (
      _r: unknown,
      a: { input: AdjustmentInput },
      c: RequestContext,
    ) => postAdjustment(c, a.input),
  },
};

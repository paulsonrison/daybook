import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  configMutation,
  fail,
  idValue,
  versionMatches,
  type RequestContext,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { nextCode } from '../counter.js';
import { moneyString } from '../money.js';
import {
  residentLedger,
  postEntry,
  settleResident,
} from '../ledger/service.js';
import { buildBill } from './engine.js';
import { financialRead } from './transactions.js';
import type { BillInput, InvoiceInput, InvoicePayload } from './model.js';
import {
  claimInvoiceSources,
  findInvoice,
  insertInvoice,
  invoiceRevisions,
  markIssued,
  readInvoiceHeaders,
  readInvoicePayload,
  readPolicy,
  reviseHeader,
  writeInvoiceRevision,
  writePolicy,
} from './repository.js';

export async function invoiceView(c: PoolClient, id: string) {
  const header = await findInvoice(c, idValue(id));
  if (!header || header.state !== 'ISSUED')
    return fail('Invoice not found.', 'NOT_FOUND');
  const payload = await readInvoicePayload(c, id, header.version);
  if (!payload) return fail('Invoice snapshot is missing.', 'CONFLICT');
  const ledger = await residentLedger(c, header.residentId),
    revisions = await invoiceRevisions(c, id);
  return {
    ...payload.preview,
    id,
    code: header.code,
    version: header.version,
    total: moneyString(header.totalPaise),
    remaining: moneyString(header.remainingPaise),
    status: header.remainingPaise === 0n ? 'PAID' : 'UNPAID',
    locked: header.locked,
    accountBalance: ledger.balance,
    revisions: revisions.map((r) => ({
      version: r.version,
      total: r.payload.preview.invoiceTotal,
      createdAt: r.createdAt,
    })),
  };
}
export const previewBill = (ctx: RequestContext, input: BillInput) =>
  financialRead(ctx, async (c) => (await buildBill(c, input)).preview);
export const invoice = (ctx: RequestContext, id: string) =>
  financialRead(ctx, (c) => invoiceView(c, id));
export const invoices = (ctx: RequestContext, residentId?: string) =>
  financialRead(ctx, async (c) => {
    const headers = await readInvoiceHeaders(
      c,
      residentId ? idValue(residentId) : undefined,
    );
    return Promise.all(headers.map((h) => invoiceView(c, h.id)));
  });
export const billingPolicy = (ctx: RequestContext) =>
  financialRead(ctx, readPolicy);
export function saveBillingPolicy(
  ctx: RequestContext,
  input: {
    noTaxConfirmed: boolean;
    defaultDueDays?: number;
    autoIssue?: boolean;
    version?: number;
  },
) {
  return configMutation(ctx, async (c) => {
    const old = await readPolicy(c);
    if (old.version) versionMatches(old.version, input.version);
    if (input.noTaxConfirmed !== true)
      return fail(
        'Confirm that this agency issues bills without tax. Tax configuration is required for taxable bills.',
      );
    const days = input.defaultDueDays ?? old.defaultDueDays;
    if (!Number.isInteger(days) || days < 0 || days > 365)
      return fail('Choose a due date between zero and 365 days.');
    const result = await writePolicy(c, ctx.agent!.agencyId, {
      taxTreatment: 'NO_TAX',
      defaultDueDays: days,
      autoIssue: input.autoIssue ?? old.autoIssue,
    });
    await audit(
      c,
      ctx,
      'BILLING_POLICY',
      ctx.agent!.agencyId,
      'UPDATED',
      result,
    );
    return result;
  });
}
export function generateInvoice(ctx: RequestContext, input: InvoiceInput) {
  return configMutation(ctx, (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'GENERATE_INVOICE',
      input,
      async () => {
        const built = await buildBill(c, input),
          { preview, existing } = built;
        if (preview.fingerprint !== input.previewFingerprint)
          return fail(
            'This bill changed. Recalculate and review it before saving.',
            'CONFLICT',
          );
        if (!preview.canIssue)
          return fail(
            'Configure and confirm the tax treatment before issuing bills.',
          );
        if (!built.hasActivity)
          return fail(
            'There are no unbilled charges or adjustments in this period.',
          );
        if (preview.missingDayCount && !input.acknowledgeUnmarkedDays)
          return fail(
            'Review and acknowledge unprepared delivery dates before issuing this bill.',
          );
        return persistInvoice(
          c,
          input,
          built,
          ctx.agent!.agencyId,
          ctx.agent!.id,
        );
      },
    ),
  );
}

export async function persistInvoice(
  c: PoolClient,
  input: Pick<InvoiceInput, 'acknowledgeUnmarkedDays'>,
  built: Awaited<ReturnType<typeof buildBill>>,
  agencyId: string,
  actorId: string | null,
) {
  const { preview, existing } = built;
  const id = existing?.id ?? randomUUID(),
    version = (existing?.version ?? 0) + 1;
  const payload: InvoicePayload = {
    preview,
    inputs: built.inputs,
    deliveryBindings: built.bindings,
    merchandiseIds: built.merchandiseIds,
    acknowledgeUnmarkedDays: input.acknowledgeUnmarkedDays === true,
  };
  if (existing) await reviseHeader(c, id, built.invoiceTotal, preview.note);
  else
    await insertInvoice(c, agencyId, {
      id,
      residentId: preview.resident.id,
      code: await nextCode(
        c,
        agencyId,
        'invoice',
        `DB-${preview.issuedDate.slice(0, 4)}-`,
      ),
      residentName: preview.resident.name,
      residentCode: preview.resident.code,
      address: preview.resident.address,
      routeId: preview.resident.routeId,
      routeName: preview.resident.routeName,
      dropOrder: preview.resident.dropOrder,
      periodMode: preview.periodMode,
      periods: preview.periods,
      issuedDate: preview.issuedDate,
      dueDate: preview.dueDate,
      totalPaise: built.invoiceTotal,
      note: preview.note,
    });
  await writeInvoiceRevision(c, agencyId, id, version, payload, actorId);
  await claimInvoiceSources(c, agencyId, preview.resident.id, id, payload);
  const posting = await postEntry(c, {
    agencyId,
    residentId: preview.resident.id,
    kind: existing ? 'INVOICE_REVISION' : 'INVOICE',
    sourceKey: `invoice:${id}:${version}`,
    amountPaise: built.invoiceTotal - (existing?.totalPaise ?? 0n),
    date: preview.issuedDate,
    dueDate: preview.dueDate,
    description: existing ? 'Invoice correction' : 'New invoice charges',
    invoiceId: id,
    actorId,
  });
  if (existing && posting && posting.amountPaise < 0n)
    await settleResident(c, preview.resident.id, {
      creditEntryId: posting.id,
      targetInvoiceId: id,
    });
  await settleResident(c, preview.resident.id);
  if (!existing) await markIssued(c, id);
  await c.query(
    "INSERT INTO daybook.audit_events(id,agency_id,actor_id,actor_kind,entity_type,entity_id,action,details) VALUES(gen_random_uuid(),$1,$2,$3,'INVOICE',$4,$5,$6)",
    [
      agencyId,
      actorId,
      actorId ? 'AGENT' : 'SYSTEM',
      id,
      existing ? 'REVISED' : 'ISSUED',
      JSON.stringify({ version, total: preview.invoiceTotal }),
    ],
  );
  return invoiceView(c, id);
}

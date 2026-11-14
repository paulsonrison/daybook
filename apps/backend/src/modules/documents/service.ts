import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FinancialDocumentModel } from '@daybook/ui/documents';
import {
  audit,
  configMutation,
  fail,
  idValue,
  requireAgent,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { withTenant } from '../../db/tenant.js';
import { onceRequest } from '../requests.js';
import { agencyToday } from '../delivery/repository.js';
import { readResidents } from '../residents/repository.js';
import { findPayment } from '../payments/repository.js';
import { invoiceView } from '../billing/service.js';
import {
  buildUpiIntent,
  readCollectionSettings,
} from '../reports/collection.js';
import { moneyString, parseMoney } from '../money.js';
import { reserveDocumentRenderer } from './engine.js';
type Locale = 'en' | 'ml' | 'hi';
export interface PrepareDocumentInput {
  requestId: string;
  kind: string;
  sourceId: string;
  sourceVersion?: number;
  locale: string;
}
export interface GenerateDocumentInput {
  requestId: string;
  documentId: string;
}
const labels = {
  en: {
    invoice: 'Invoice',
    receipt: 'Payment receipt',
    payslip: 'Payslip',
    refund: 'Refund receipt',
    prepared: 'Prepared',
    date: 'Recorded date',
    method: 'Payment method',
    version: 'Invoice revision',
    period: 'Period',
    description: 'Description',
    quantity: 'Quantity',
    rate: 'Rate',
    amount: 'Amount',
    received: 'Confirmed amount received',
    balance: 'Account balance at confirmation',
    invoiceTotal: 'Issued invoice amount',
    remaining: 'Invoice remaining at preparation',
    account: 'Account balance at preparation',
    net: 'Net payable',
    salary: 'Salary',
    commission: 'Delivery commission',
    allowance: 'Route allowance',
    advance: 'Advance applied',
    reimbursement: 'Approved expense reimbursement',
    correction: 'Approved earnings correction',
    refunded: 'Confirmed amount returned',
    deposit: 'Refunded deposit',
    depositReceived: 'Deposit received',
    credit: 'Returned account credit',
    confirmed: 'Payout confirmed',
    awaiting: 'Awaiting payout',
    zero: 'No payout due',
    snapshot:
      'This document preserves the recorded figures at preparation. Later entries are not reflected.',
    qr: 'QR codes are payment requests, not proof of receipt.',
  },
  ml: {
    invoice: 'ബിൽ',
    receipt: 'പണമടച്ച രസീത്',
    payslip: 'ശമ്പള സ്ലിപ്പ്',
    refund: 'പണം തിരികെ നൽകിയ രസീത്',
    prepared: 'തയ്യാറാക്കിയ തീയതി',
    date: 'രേഖപ്പെടുത്തിയ തീയതി',
    method: 'പണമടച്ച രീതി',
    version: 'ബിൽ പതിപ്പ്',
    period: 'കാലയളവ്',
    description: 'വിവരണം',
    quantity: 'എണ്ണം',
    rate: 'നിരക്ക്',
    amount: 'തുക',
    received: 'ലഭിച്ചതായി സ്ഥിരീകരിച്ച തുക',
    balance: 'സ്ഥിരീകരണ സമയത്തെ അക്കൗണ്ട് ബാലൻസ്',
    invoiceTotal: 'ബിൽ തുക',
    remaining: 'തയ്യാറാക്കിയ സമയത്തെ ബിൽ കുടിശ്ശിക',
    account: 'തയ്യാറാക്കിയ സമയത്തെ അക്കൗണ്ട് ബാലൻസ്',
    net: 'നൽകേണ്ട തുക',
    salary: 'ശമ്പളം',
    commission: 'വിതരണ കമ്മീഷൻ',
    allowance: 'റൂട്ട് അലവൻസ്',
    advance: 'ക്രമീകരിച്ച മുൻകൂർ തുക',
    reimbursement: 'അംഗീകരിച്ച ചെലവ് തിരിച്ചടവ്',
    correction: 'അംഗീകരിച്ച ശമ്പള തിരുത്തൽ',
    refunded: 'തിരികെ നൽകിയതായി സ്ഥിരീകരിച്ച തുക',
    deposit: 'തിരികെ നൽകിയ നിക്ഷേപം',
    depositReceived: 'ലഭിച്ച നിക്ഷേപം',
    credit: 'തിരികെ നൽകിയ അക്കൗണ്ട് ക്രെഡിറ്റ്',
    confirmed: 'ശമ്പളം നൽകിയതായി സ്ഥിരീകരിച്ചു',
    awaiting: 'ശമ്പളം നൽകാനുണ്ട്',
    zero: 'നൽകാൻ തുകയില്ല',
    snapshot:
      'തയ്യാറാക്കിയ സമയത്തെ രേഖകളാണ് ഈ പ്രമാണത്തിൽ. പിന്നീടുള്ള ഇടപാടുകൾ ഇതിൽ ഉൾപ്പെടുന്നില്ല.',
    qr: 'QR കോഡ് പണമടയ്ക്കാനുള്ള അഭ്യർത്ഥനയാണ്; രസീത് സ്ഥിരീകരണമല്ല.',
  },
  hi: {
    invoice: 'बिल',
    receipt: 'भुगतान रसीद',
    payslip: 'वेतन पर्ची',
    refund: 'वापसी रसीद',
    prepared: 'तैयार करने की तारीख',
    date: 'दर्ज तारीख',
    method: 'भुगतान का तरीका',
    version: 'बिल संस्करण',
    period: 'अवधि',
    description: 'विवरण',
    quantity: 'मात्रा',
    rate: 'दर',
    amount: 'राशि',
    received: 'प्राप्त राशि की पुष्टि',
    balance: 'पुष्टि के समय खाते का शेष',
    invoiceTotal: 'जारी बिल राशि',
    remaining: 'तैयारी के समय बिल का बकाया',
    account: 'तैयारी के समय खाते का शेष',
    net: 'देय वेतन',
    salary: 'वेतन',
    commission: 'वितरण कमीशन',
    allowance: 'रूट भत्ता',
    advance: 'समायोजित अग्रिम',
    reimbursement: 'स्वीकृत खर्च की प्रतिपूर्ति',
    correction: 'स्वीकृत वेतन संशोधन',
    refunded: 'वापस की गई पुष्ट राशि',
    deposit: 'वापस की गई जमा राशि',
    depositReceived: 'प्राप्त जमा राशि',
    credit: 'वापस किया गया खाता क्रेडिट',
    confirmed: 'वेतन भुगतान की पुष्टि',
    awaiting: 'वेतन भुगतान बाकी',
    zero: 'कोई भुगतान देय नहीं',
    snapshot:
      'यह दस्तावेज़ तैयारी के समय दर्ज राशियों को सुरक्षित रखता है। बाद की प्रविष्टियाँ इसमें शामिल नहीं हैं।',
    qr: 'QR कोड भुगतान अनुरोध है, भुगतान की पुष्टि नहीं।',
  },
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export const snapshotHash = (model: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(model)))
    .digest('hex');
const signed = (value: string) =>
  value.startsWith('-') ? -parseMoney(value.slice(1)) : parseMoney(value);
async function modelFor(
  c: PoolClient,
  ctx: RequestContext,
  i: PrepareDocumentInput,
  id: string,
) {
  if (!['en', 'ml', 'hi'].includes(i.locale))
    fail('Choose English, Malayalam or Hindi.');
  idValue(i.sourceId);
  const locale = i.locale as Locale,
    l = labels[locale],
    today = await agencyToday(c);
  const model: FinancialDocumentModel = {
    locale,
    kind: i.kind,
    title: '',
    agencyName: ctx.agent!.agency.name,
    reference: '',
    preparedAt: new Date().toISOString(),
    subject: { name: '', reference: '', address: '' },
    meta: [{ label: l.prepared, value: today }],
    columns: [l.description, l.quantity, l.rate, l.amount],
    lines: [],
    totals: [],
    note: '',
    footer: l.snapshot,
    qrDataUrl: null,
    upiUri: null,
  };
  let residentId: string | null = null,
    staffId: string | null = null,
    sourceVersion = 1;
  if (i.kind === 'PAYMENT_RECEIPT') {
    const p = await findPayment(c, i.sourceId);
    if (
      !p ||
      p.status !== 'CONFIRMED' ||
      !p.receiptCode ||
      p.balanceAfterPaise === null
    )
      return fail('Only confirmed funds have a receipt document.');
    residentId = p.residentId;
    sourceVersion = p.version;
    model.title = l.receipt;
    model.reference = p.receiptCode;
    model.meta = [
      ...model.meta,
      { label: l.date, value: p.date },
      { label: l.method, value: p.method },
    ];
    model.lines = [
      {
        description: p.purpose === 'DEPOSIT' ? l.depositReceived : l.received,
        quantity: null,
        rate: null,
        amount: p.amount,
      },
    ];
    model.totals = [
      { label: l.received, amount: p.amount },
      { label: l.balance, amount: moneyString(p.balanceAfterPaise) },
    ];
    model.note = p.confirmationEvidence;
  } else if (i.kind === 'INVOICE') {
    const v = await invoiceView(c, i.sourceId);
    residentId = v.resident.id;
    sourceVersion = v.version;
    model.title = l.invoice;
    model.reference = v.code;
    model.subject = {
      name: v.resident.name,
      reference: v.resident.code,
      address: v.resident.address,
    };
    model.meta = [
      ...model.meta,
      { label: l.date, value: v.issuedDate },
      { label: l.version, value: String(v.version) },
      {
        label: l.period,
        value: v.periods.map((p) => p.from + ' – ' + p.to).join(', '),
      },
    ];
    model.lines = v.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
    }));
    model.totals = [
      { label: l.invoiceTotal, amount: v.invoiceTotal },
      { label: l.remaining, amount: v.remaining },
      { label: l.account, amount: v.accountBalance },
    ];
    model.note = v.note;
    const qr = await buildUpiIntent(
      await readCollectionSettings(c),
      signed(v.accountBalance),
      `DOC${id.replaceAll('-', '')}`,
      `Daybook ${v.resident.code}`,
    );
    model.qrDataUrl = qr.qrDataUrl;
    model.upiUri = qr.upiUri;
    if (qr.qrDataUrl) model.footer += ' ' + l.qr;
  } else if (i.kind === 'PAYSLIP') {
    const p = (
      await c.query(
        `SELECT p.code,p.staff_id,s.name,s.staff_code,p.snapshot,to_char(p.month,'YYYY-MM') AS month,EXISTS(SELECT 1 FROM daybook.payroll_payouts q WHERE q.payslip_id=p.id) AS paid FROM daybook.payslips p JOIN daybook.staff s ON s.id=p.staff_id WHERE p.id=$1`,
        [i.sourceId],
      )
    ).rows[0];
    if (!p) fail('Payslip not found.', 'NOT_FOUND');
    staffId = p.staff_id;
    const s = p.snapshot;
    model.title = l.payslip;
    model.reference = p.code;
    model.subject = { name: p.name, reference: p.staff_code, address: '' };
    model.meta = [...model.meta, { label: l.period, value: p.month }];
    model.lines = [
      { description: l.salary, quantity: null, rate: null, amount: s.salary },
      {
        description: l.commission,
        quantity: null,
        rate: null,
        amount: s.commission,
      },
      {
        description: l.allowance,
        quantity: null,
        rate: null,
        amount: s.routeAllowance,
      },
      {
        description: l.correction,
        quantity: null,
        rate: null,
        amount: s.adjustment ?? '0.00',
      },
      {
        description: l.advance,
        quantity: null,
        rate: null,
        amount: moneyString(-parseMoney(s.advance)),
      },
      {
        description: l.reimbursement,
        quantity: null,
        rate: null,
        amount: s.reimbursement,
      },
    ];
    model.totals = [{ label: l.net, amount: s.net }];
    model.note = p.paid ? l.confirmed : s.net === '0.00' ? l.zero : l.awaiting;
  } else if (i.kind === 'CLEARANCE_REFUND') {
    const r = (
      await c.query(
        `SELECT resident_id,receipt_code,amount_paise::text,deposit_paise::text,account_credit_paise::text,method,confirmation_evidence,to_char(posting_date,'YYYY-MM-DD') AS date FROM daybook.clearance_refunds WHERE id=$1`,
        [i.sourceId],
      )
    ).rows[0];
    if (!r) fail('Refund receipt not found.', 'NOT_FOUND');
    residentId = r.resident_id;
    model.title = l.refund;
    model.reference = r.receipt_code;
    model.meta = [
      ...model.meta,
      { label: l.date, value: r.date },
      { label: l.method, value: r.method },
    ];
    model.lines = [
      {
        description: l.deposit,
        quantity: null,
        rate: null,
        amount: moneyString(BigInt(r.deposit_paise)),
      },
      {
        description: l.credit,
        quantity: null,
        rate: null,
        amount: moneyString(BigInt(r.account_credit_paise)),
      },
    ];
    model.totals = [
      { label: l.refunded, amount: moneyString(BigInt(r.amount_paise)) },
    ];
    model.note = r.confirmation_evidence;
  } else
    fail('Choose an invoice, confirmed receipt, payslip or confirmed refund.');
  if (i.sourceVersion !== undefined && i.sourceVersion !== sourceVersion)
    fail(
      'The source revision changed. Refresh before preparing the document.',
      'CONFLICT',
    );
  if (residentId && !model.subject.name) {
    const resident = (await readResidents(c, residentId))[0];
    if (!resident) fail('Resident snapshot is unavailable.');
    model.subject = {
      name: resident.name,
      reference: resident.code,
      address: resident.address,
    };
  }
  if (model.lines.length > 1000 || JSON.stringify(model).length > 1048576)
    fail('This document is too large; choose a shorter reporting period.');
  return { model, residentId, staffId, sourceVersion };
}
const columns = `id,kind,source_id AS "sourceId",source_version AS "sourceVersion",locale,status,snapshot,snapshot_hash AS "snapshotHash",filename,coalesce(byte_length,0) AS "byteLength",sha256,last_error AS "lastError",attempts,created_at AS "createdAt"`;
async function readDocument(c: PoolClient, id: string) {
  idValue(id);
  const r = (
    await c.query(`SELECT ${columns} FROM daybook.documents WHERE id=$1`, [id])
  ).rows[0];
  if (!r) fail('Document not found.', 'NOT_FOUND');
  return {
    ...r,
    snapshot: JSON.stringify(r.snapshot),
    createdAt: r.createdAt.toISOString(),
  };
}
export const document = (ctx: RequestContext, id: string) =>
  financialRead(ctx, (c) => readDocument(c, id));
export const documents = (ctx: RequestContext, sourceId?: string) =>
  financialRead(ctx, async (c) => {
    if (sourceId) idValue(sourceId);
    return (
      await c.query(
        `SELECT ${columns} FROM daybook.documents ${sourceId ? 'WHERE source_id=$1' : ''} ORDER BY created_at DESC,id LIMIT 200`,
        sourceId ? [sourceId] : [],
      )
    ).rows.map((r) => ({
      ...r,
      snapshot: JSON.stringify(r.snapshot),
      createdAt: r.createdAt.toISOString(),
    }));
  });
export function prepareDocument(ctx: RequestContext, i: PrepareDocumentInput) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'document.prepare',
      i,
      async () => {
        const id = randomUUID(),
          { model, residentId, staffId, sourceVersion } = await modelFor(
            c,
            ctx,
            i,
            id,
          ),
          filename = `${i.kind.toLowerCase()}-${model.reference.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
        await c.query(
          'INSERT INTO daybook.documents(id,agency_id,kind,source_id,source_version,resident_id,staff_id,locale,snapshot,snapshot_hash,filename,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            id,
            ctx.agent!.agencyId,
            i.kind,
            i.sourceId,
            sourceVersion,
            residentId,
            staffId,
            i.locale,
            JSON.stringify(model),
            snapshotHash(model),
            filename,
            ctx.agent!.id,
          ],
        );
        await audit(c, ctx, 'document', id, 'PREPARED', {
          kind: i.kind,
          sourceId: i.sourceId,
          sourceVersion,
          locale: i.locale,
        });
        return { id };
      },
    );
    return readDocument(c, saved.id);
  });
}
async function expireDocumentLeases(pool: Pool, agencyId: string) {
  await withTenant(pool, agencyId, (c) =>
    c.query(
      "UPDATE daybook.documents SET status='FAILED',lease_until=NULL,last_error='Generation attempt limit reached after an expired lease.' WHERE status='GENERATING' AND attempts>=3 AND lease_until<=now()",
    ),
  );
}
export async function generateOneDocument(
  pool: Pool,
  agencyId: string,
  id: string,
) {
  await expireDocumentLeases(pool, agencyId);
  const renderer = reserveDocumentRenderer();
  if (!renderer) return;
  try {
    const claimed = await withTenant(pool, agencyId, async (c) => {
      const r = (
        await c.query<{
          id: string;
          snapshot: FinancialDocumentModel;
          snapshotHash: string;
          attempts: number;
        }>(
          `UPDATE daybook.documents d SET status='GENERATING',attempts=attempts+1,lease_until=now()+interval '60 seconds',last_error=NULL WHERE id=(SELECT id FROM daybook.documents WHERE id=$1 AND attempts<3 AND (status IN('PREPARED','FAILED') OR (status='GENERATING' AND lease_until<=now())) FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,snapshot,snapshot_hash AS "snapshotHash",attempts`,
          [id],
        )
      ).rows[0];
      return r;
    });
    if (!claimed) return;
    try {
      if (snapshotHash(claimed.snapshot) !== claimed.snapshotHash)
        throw new Error('Document snapshot integrity failed');
      const pdf = await renderer.render(claimed.snapshot),
        sha = createHash('sha256').update(pdf).digest('hex');
      await withTenant(pool, agencyId, (c) =>
        c.query(
          "UPDATE daybook.documents SET status='READY',pdf=$3,sha256=$4,lease_until=NULL,last_error=NULL WHERE id=$1 AND attempts=$2 AND status='GENERATING' AND lease_until>now()",
          [id, claimed.attempts, pdf, sha],
        ),
      );
    } catch {
      await withTenant(pool, agencyId, (c) =>
        c.query(
          "UPDATE daybook.documents SET status='FAILED',lease_until=NULL,last_error='Document generation failed; check the configured browser and bundled fonts.' WHERE id=$1 AND attempts=$2 AND status='GENERATING'",
          [id, claimed.attempts],
        ),
      );
    }
  } finally {
    renderer.release();
  }
}
export async function generateDocument(
  ctx: RequestContext,
  i: GenerateDocumentInput,
) {
  const { pool, agent } = requireAgent(ctx);
  await configMutation(ctx, (c) =>
    onceRequest(
      c,
      agent.agencyId,
      i.requestId,
      'document.generate',
      i,
      async () => {
        await readDocument(c, i.documentId);
        return { id: i.documentId };
      },
    ),
  );
  await generateOneDocument(pool, agent.agencyId, i.documentId);
  return document(ctx, i.documentId);
}
export async function runDocumentJobs(pool: Pool, agencyId: string) {
  await expireDocumentLeases(pool, agencyId);
  const rows = await withTenant(pool, agencyId, (c) =>
    c.query<{ id: string }>(
      "SELECT id FROM daybook.documents WHERE attempts<3 AND (status IN('PREPARED','FAILED') OR (status='GENERATING' AND lease_until<=now())) ORDER BY created_at,id LIMIT 3",
    ),
  );
  for (const r of rows.rows) await generateOneDocument(pool, agencyId, r.id);
}

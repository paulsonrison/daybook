import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RequestContext } from '../context.js';
import {
  agencyRead,
  audit,
  configMutation,
  fail,
  idValue,
} from '../context.js';
import { onceRequest } from '../requests.js';
import { readAgencyAnalytics } from '../analytics/service.js';
import { renderAgencyReport } from '@daybook/ui/reports';
import type { AgencyReportSnapshot } from './model.js';
import { assertReportArtifactSize, assertReportBounds } from './model.js';
import { writeReportWorkbook } from './workbook.js';
import { reserveReportRenderer } from './pdf.js';

type Kind = AgencyReportSnapshot['kind'];
type Locale = AgencyReportSnapshot['locale'];
const text: Record<Locale, Record<string, string>> = {
  en: {
    operations: 'Monthly operations report',
    sales: 'Monthly sales report',
    tax: 'Recorded tax report',
    month: 'Selected month',
    asOf: 'Current balances as of',
    generated: 'Generated at',
    coverage: 'Coverage',
    name: 'Name',
    value: 'Value',
    amount: 'Amount',
    basis: 'Basis',
    aging: 'Current account aging',
    circulation: 'Recorded circulation',
    routes: 'Route contribution evidence',
    receipts: 'Confirmed receipts by method',
    refunds: 'Recorded refunds',
    costs: 'Agency costs',
    invoice: 'Resident invoiced sales',
    merchandise: 'Cash merchandise sales',
    advertiser: 'Advertiser subtotal',
    advertiserTax: 'Recorded advertiser tax',
    recordedSales: 'Recorded sales total',
    accountReceipts: 'Account receipts',
    cashCollected: 'Cash account and merchandise receipts',
    deposits: 'Refundable deposits',
    refundTotal: 'Confirmed refunds',
    refundCash: 'Cash refunds',
    refundDeposit: 'Deposit refunds',
    refundCredit: 'Account-credit refunds',
    supply: 'Supply purchases',
    returns: 'Supply return credits',
    payroll: 'Posted payroll expense',
    unavailable: 'Unavailable',
    partial: 'Partial',
    complete: 'Complete',
    taxNote:
      'Only classifications and tax amounts recorded on issued advertiser invoices are shown. No tax rate or jurisdiction was inferred.',
    noTax: 'Tax not charged; agency confirmation recorded',
    taxRecorded: 'Tax amount recorded; jurisdiction/rate not specified',
    noTaxValue: 'No tax recorded',
    classification: 'Recorded treatment',
    recordedTax: 'Recorded tax amount',
    noInvoices: 'No advertiser invoices were recorded in this month.',
    salesNote:
      'Advertiser tax is shown separately. Collections may recover earlier invoices and are not matched to this month’s sales.',
    notDue: 'Not due',
    days1to30: '1–30 days overdue',
    days31to60: '31–60 days overdue',
    days61to90: '61–90 days overdue',
    days91plus: 'Over 90 days overdue',
    methodCash: 'Cash',
    methodCheque: 'Cheque',
    methodBank: 'Bank transfer',
    methodUpi: 'UPI',
    methodUnknown: 'Unknown method',
    recordedTotalBasis: 'Recorded total; does not assert statutory treatment',
    separateLiability: 'Separate liability',
    cashSources: 'Cash account plus cash merchandise',
    confirmedAccount: 'Confirmed account receipts',
    unallocatedCost: 'Unallocated agency cost',
    unallocatedCredit: 'Unallocated agency credit',
  },
  ml: {
    operations: 'പ്രതിമാസ പ്രവർത്തന റിപ്പോർട്ട്',
    sales: 'പ്രതിമാസ വിൽപ്പന റിപ്പോർട്ട്',
    tax: 'രേഖപ്പെടുത്തിയ നികുതി റിപ്പോർട്ട്',
    month: 'തിരഞ്ഞെടുത്ത മാസം',
    asOf: 'നിലവിലെ ബാലൻസ് തീയതി',
    generated: 'തയ്യാറാക്കിയ സമയം',
    coverage: 'വിവര ലഭ്യത',
    name: 'പേര്',
    value: 'മൂല്യം',
    amount: 'തുക',
    basis: 'അടിസ്ഥാനം',
    aging: 'നിലവിലെ അക്കൗണ്ട് കുടിശ്ശിക',
    circulation: 'രേഖപ്പെടുത്തിയ വിതരണം',
    routes: 'റൂട്ട് സംഭാവന തെളിവുകൾ',
    receipts: 'രീതിപ്രകാരമുള്ള സ്ഥിരീകരിച്ച വരവുകൾ',
    refunds: 'രേഖപ്പെടുത്തിയ റീഫണ്ടുകൾ',
    costs: 'ഏജൻസി ചെലവുകൾ',
    invoice: 'താമസക്കാരുടെ ബിൽ വിൽപ്പന',
    merchandise: 'പണമായി വിറ്റ ഉൽപ്പന്നങ്ങൾ',
    advertiser: 'പരസ്യദാതൃ ഉപതുക',
    advertiserTax: 'രേഖപ്പെടുത്തിയ പരസ്യ നികുതി',
    recordedSales: 'രേഖപ്പെടുത്തിയ ആകെ വിൽപ്പന',
    accountReceipts: 'അക്കൗണ്ട് വരവുകൾ',
    cashCollected: 'പണ അക്കൗണ്ട്, ഉൽപ്പന്ന വരവുകൾ',
    deposits: 'തിരികെ നൽകാവുന്ന നിക്ഷേപങ്ങൾ',
    refundTotal: 'സ്ഥിരീകരിച്ച റീഫണ്ടുകൾ',
    refundCash: 'പണ റീഫണ്ടുകൾ',
    refundDeposit: 'നിക്ഷേപ റീഫണ്ടുകൾ',
    refundCredit: 'അക്കൗണ്ട് ക്രെഡിറ്റ് റീഫണ്ടുകൾ',
    supply: 'വിതരണ വാങ്ങലുകൾ',
    returns: 'വിതരണ മടക്ക ക്രെഡിറ്റുകൾ',
    payroll: 'രേഖപ്പെടുത്തിയ ശമ്പള ചെലവ്',
    unavailable: 'ലഭ്യമല്ല',
    partial: 'ഭാഗികം',
    complete: 'പൂർണ്ണം',
    taxNote:
      'ഇഷ്യു ചെയ്ത പരസ്യ ബില്ലുകളിൽ രേഖപ്പെടുത്തിയ വർഗ്ഗീകരണവും നികുതി തുകയും മാത്രം കാണിക്കുന്നു. നിരക്കോ അധികാരപരിധിയോ അനുമാനിച്ചിട്ടില്ല.',
    noTax: 'നികുതി ഈടാക്കിയിട്ടില്ലെന്ന് ഏജൻസി സ്ഥിരീകരിച്ചു',
    taxRecorded:
      'നികുതി തുക രേഖപ്പെടുത്തി; അധികാരപരിധി/നിരക്ക് രേഖപ്പെടുത്തിയിട്ടില്ല',
    noTaxValue: 'നികുതി രേഖപ്പെടുത്തിയിട്ടില്ല',
    classification: 'രേഖപ്പെടുത്തിയ വർഗ്ഗീകരണം',
    recordedTax: 'രേഖപ്പെടുത്തിയ നികുതി തുക',
    noInvoices: 'ഈ മാസത്തിൽ പരസ്യ ബില്ലുകൾ രേഖപ്പെടുത്തിയിട്ടില്ല.',
    salesNote:
      'പരസ്യ നികുതി വേർതിരിച്ച് കാണിക്കുന്നു. വരവുകൾ പഴയ ബില്ലുകൾക്കുള്ളതാകാം; ഈ മാസത്തെ വിൽപ്പനയുമായി നേരിട്ട് പൊരുത്തപ്പെടുത്താനാവില്ല.',
    notDue: 'കാലാവധി കഴിഞ്ഞിട്ടില്ല',
    days1to30: '1–30 ദിവസം കുടിശ്ശിക',
    days31to60: '31–60 ദിവസം കുടിശ്ശിക',
    days61to90: '61–90 ദിവസം കുടിശ്ശിക',
    days91plus: '90 ദിവസത്തിലധികം കുടിശ്ശിക',
    methodCash: 'പണം',
    methodCheque: 'ചെക്ക്',
    methodBank: 'ബാങ്ക് ട്രാൻസ്ഫർ',
    methodUpi: 'UPI',
    methodUnknown: 'അറിയാത്ത രീതി',
    recordedTotalBasis:
      'രേഖപ്പെടുത്തിയ ആകെ; നിയമപരമായ വർഗ്ഗീകരണം ഉറപ്പിക്കുന്നില്ല',
    separateLiability: 'വേറിട്ട ബാധ്യത',
    cashSources: 'പണ അക്കൗണ്ടും പണ ഉൽപ്പന്ന വരവും',
    confirmedAccount: 'സ്ഥിരീകരിച്ച അക്കൗണ്ട് വരവുകൾ',
    unallocatedCost: 'അനുവദിക്കാത്ത ഏജൻസി ചെലവ്',
    unallocatedCredit: 'അനുവദിക്കാത്ത ഏജൻസി ക്രെഡിറ്റ്',
  },
  hi: {
    operations: 'मासिक संचालन रिपोर्ट',
    sales: 'मासिक बिक्री रिपोर्ट',
    tax: 'दर्ज कर रिपोर्ट',
    month: 'चुना गया महीना',
    asOf: 'वर्तमान शेष की तारीख',
    generated: 'तैयार करने का समय',
    coverage: 'डेटा उपलब्धता',
    name: 'नाम',
    value: 'मान',
    amount: 'राशि',
    basis: 'आधार',
    aging: 'वर्तमान खाता बकाया',
    circulation: 'दर्ज वितरण',
    routes: 'रूट योगदान प्रमाण',
    receipts: 'विधि के अनुसार पुष्टि प्राप्तियां',
    refunds: 'दर्ज रिफंड',
    costs: 'एजेंसी लागत',
    invoice: 'निवासी बिल बिक्री',
    merchandise: 'नकद उत्पाद बिक्री',
    advertiser: 'विज्ञापन उप-योग',
    advertiserTax: 'दर्ज विज्ञापन कर',
    recordedSales: 'दर्ज कुल बिक्री',
    accountReceipts: 'खाता प्राप्तियां',
    cashCollected: 'नकद खाता और उत्पाद प्राप्तियां',
    deposits: 'वापसी योग्य जमा',
    refundTotal: 'पुष्टि किए गए रिफंड',
    refundCash: 'नकद रिफंड',
    refundDeposit: 'जमा रिफंड',
    refundCredit: 'खाता क्रेडिट रिफंड',
    supply: 'आपूर्ति खरीद',
    returns: 'आपूर्ति वापसी क्रेडिट',
    payroll: 'दर्ज वेतन खर्च',
    unavailable: 'उपलब्ध नहीं',
    partial: 'आंशिक',
    complete: 'पूर्ण',
    taxNote:
      'केवल जारी विज्ञापन बिलों पर दर्ज वर्गीकरण और कर राशि दिखाई गई है। कर दर या क्षेत्राधिकार का अनुमान नहीं लगाया गया।',
    noTax: 'एजेंसी पुष्टि के अनुसार कर नहीं लिया गया',
    taxRecorded: 'कर राशि दर्ज है; क्षेत्राधिकार/दर निर्दिष्ट नहीं',
    noTaxValue: 'कर दर्ज नहीं है',
    classification: 'दर्ज वर्गीकरण',
    recordedTax: 'दर्ज कर राशि',
    noInvoices: 'इस महीने विज्ञापन बिल दर्ज नहीं किए गए।',
    salesNote:
      'विज्ञापन कर अलग दिखाया गया है। प्राप्तियां पुराने बिलों की हो सकती हैं और इस महीने की बिक्री से सीधे नहीं जोड़ी गई हैं।',
    notDue: 'अभी देय नहीं',
    days1to30: '1–30 दिन बकाया',
    days31to60: '31–60 दिन बकाया',
    days61to90: '61–90 दिन बकाया',
    days91plus: '90 दिनों से अधिक बकाया',
    methodCash: 'नकद',
    methodCheque: 'चेक',
    methodBank: 'बैंक हस्तांतरण',
    methodUpi: 'UPI',
    methodUnknown: 'अज्ञात विधि',
    recordedTotalBasis: 'दर्ज कुल; वैधानिक वर्गीकरण का दावा नहीं',
    separateLiability: 'अलग देयता',
    cashSources: 'नकद खाता और नकद उत्पाद प्राप्तियां',
    confirmedAccount: 'पुष्टि की गई खाता प्राप्तियां',
    unallocatedCost: 'अवंटित एजेंसी लागत',
    unallocatedCredit: 'अवंटित एजेंसी क्रेडिट',
  },
};
const coverageLabel = (value: string, l: Record<string, string>) =>
  value === 'COMPLETE'
    ? l.complete
    : value === 'PARTIAL'
      ? l.partial
      : l.unavailable;
function row(label: string, value: string, basis = ''): string[] {
  return [label, value, basis];
}
function reportSnapshot(
  kind: Kind,
  month: string,
  locale: Locale,
  agencyName: string,
  analytics: Awaited<ReturnType<typeof readAgencyAnalytics>>,
  taxRows: {
    code: string;
    name: string;
    subtotal: string;
    tax: string;
    noTax: boolean;
  }[],
): AgencyReportSnapshot {
  const l = text[locale];
  const agingName: Record<string, string> = {
    NOT_DUE: l.notDue,
    DAYS_1_30: l.days1to30,
    DAYS_31_60: l.days31to60,
    DAYS_61_90: l.days61to90,
    DAYS_91_PLUS: l.days91plus,
  };
  const methodName: Record<string, string> = {
    CASH: l.methodCash,
    CHEQUE: l.methodCheque,
    BANK: l.methodBank,
    BANK_TRANSFER: l.methodBank,
    UPI: l.methodUpi,
    UNKNOWN: l.methodUnknown,
  };
  const sections: { title: string; columns: string[]; rows: string[][] }[] = [];
  if (kind === 'OPERATIONS') {
    sections.push({
      title: l.aging,
      columns: [l.name, l.amount, l.basis],
      rows: analytics.balances.aging.map((x) =>
        row(
          agingName[x.bucket] ?? x.bucket,
          x.amount,
          analytics.balances.asOfDate,
        ),
      ),
    });
    sections.push({
      title: l.circulation,
      columns: [l.name, l.value, l.coverage],
      rows: analytics.circulation.byPublication.map((x) =>
        row(
          x.name,
          x.fulfilledCopies,
          coverageLabel(analytics.circulation.coverage, l),
        ),
      ),
    });
    sections.push({
      title: l.routes,
      columns: [l.name, l.amount, l.coverage],
      rows: analytics.routes.map((x) =>
        row(
          x.snapshotNames.join(', ') || x.routeId,
          x.contributionBeforeShared,
          coverageLabel(x.contributionCoverage, l),
        ),
      ),
    });
  } else if (kind === 'SALES') {
    sections.push({
      title: l.sales,
      columns: [l.name, l.amount, l.basis],
      rows: [
        row(l.invoice, analytics.sales.invoiced, month),
        row(l.merchandise, analytics.sales.cashMerchandise, month),
        row(l.advertiser, analytics.sales.advertiserSubtotal, month),
        row(l.advertiserTax, analytics.sales.advertiserTax, month),
        row(
          l.recordedSales,
          analytics.sales.recordedTotal,
          l.recordedTotalBasis,
        ),
      ],
    });
    sections.push({
      title: l.receipts,
      columns: [l.name, l.amount, l.coverage],
      rows: [
        ...analytics.receipts.byMethod.map((x) =>
          row(methodName[x.method] ?? x.method, x.account, l.confirmedAccount),
        ),
        row(
          l.deposits,
          analytics.receipts.refundableDeposits,
          l.separateLiability,
        ),
        row(
          l.cashCollected,
          analytics.receipts.cashAccountAndMerchandise,
          l.cashSources,
        ),
      ],
    });
    sections.push({
      title: l.refunds,
      columns: [l.name, l.amount, l.basis],
      rows: [
        row(l.refundTotal, analytics.refunds.total),
        row(l.refundCash, analytics.refunds.cash),
        row(l.refundDeposit, analytics.refunds.deposit),
        row(l.refundCredit, analytics.refunds.accountCredit),
      ],
    });
    sections.push({
      title: l.costs,
      columns: [l.name, l.amount, l.basis],
      rows: [
        row(l.supply, analytics.agencyCosts.supplyPurchases, l.unallocatedCost),
        row(
          l.returns,
          analytics.agencyCosts.supplyReturnCredits,
          l.unallocatedCredit,
        ),
        row(
          l.payroll,
          analytics.payroll.knownPostedExpense,
          coverageLabel(analytics.payroll.coverage, l),
        ),
      ],
    });
  } else {
    sections.push({
      title: l.tax,
      columns: [l.name, l.classification, l.amount, l.recordedTax],
      rows: taxRows.map((x) => [
        x.name || x.code,
        x.noTax ? l.noTax : l.taxRecorded,
        x.subtotal,
        x.noTax ? l.noTaxValue : x.tax,
      ]),
    });
  }
  const generatedAt = new Date().toISOString();
  const snapshot: AgencyReportSnapshot = {
    version: 1,
    kind,
    locale,
    reference: `DAYBOOK-${month}-${kind}`,
    title:
      l[
        kind === 'OPERATIONS'
          ? 'operations'
          : kind === 'SALES'
            ? 'sales'
            : 'tax'
      ],
    agencyName,
    month,
    generatedAt,
    balanceAsOf: analytics.balances.asOfDate,
    meta: [
      { label: l.month, value: month },
      { label: l.asOf, value: analytics.balances.asOfDate },
      { label: l.generated, value: generatedAt },
    ],
    notes:
      kind === 'TAX'
        ? [l.taxNote, ...(taxRows.length ? [] : [l.noInvoices])]
        : kind === 'SALES'
          ? [l.salesNote]
          : [],
    sections,
  };
  assertReportBounds(snapshot);
  return snapshot;
}
export async function prepareReport(
  ctx: RequestContext,
  input: { requestId: string; kind: string; month: string; locale: string },
) {
  if (
    !['OPERATIONS', 'SALES', 'TAX'].includes(input.kind) ||
    !['en', 'ml', 'hi'].includes(input.locale)
  )
    return fail('Choose a supported report type and language.');
  return configMutation(ctx, async (c) =>
    onceRequest(
      c,
      ctx.agent!.agencyId,
      input.requestId,
      'exportReport',
      input,
      async () => {
        const analytics = await readAgencyAnalytics(c, { month: input.month });
        const taxRows =
          input.kind === 'TAX'
            ? (
                await c.query<{
                  code: string;
                  name: string;
                  subtotal: string;
                  tax: string;
                  noTax: boolean;
                }>(
                  `SELECT code,advertiser_name AS name,subtotal_paise::text AS subtotal,tax_paise::text AS tax,no_tax_confirmed AS "noTax" FROM daybook.advertiser_invoices WHERE issued_date >= $1::date AND issued_date < ($1::date + interval '1 month') ORDER BY issued_date,id`,
                  [analytics.startDate],
                )
              ).rows
            : [];
        const snapshot = reportSnapshot(
          input.kind as Kind,
          input.month,
          input.locale as Locale,
          ctx.agent!.agency.name,
          analytics,
          taxRows,
        );
        const id = randomUUID(),
          snapshotHash = createHash('sha256')
            .update(JSON.stringify(snapshot))
            .digest('hex');
        const createdAt = new Date().toISOString();
        await c.query(
          'INSERT INTO daybook.agency_reports(id,agency_id,kind,month,locale,snapshot,snapshot_hash,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id,
            ctx.agent!.agencyId,
            input.kind,
            `${input.month}-01`,
            input.locale,
            JSON.stringify(snapshot),
            snapshotHash,
            ctx.agent!.id,
            createdAt,
          ],
        );
        await audit(c, ctx, 'AGENCY_REPORT', id, 'MONTHLY_SNAPSHOT_CREATED', {
          kind: input.kind,
          month: input.month,
          locale: input.locale,
          snapshotHash,
        });
        return {
          id,
          kind: input.kind,
          month: input.month,
          locale: input.locale,
          snapshotHash,
          createdAt,
          artifacts: [],
        };
      },
    ),
  );
}
export function agencyReport(ctx: RequestContext, id: string) {
  idValue(id);
  return agencyRead(ctx, async (c) => {
    const report = (
      await c.query(
        'SELECT id,kind,to_char(month,\'YYYY-MM\') AS month,locale,snapshot_hash AS "snapshotHash",created_at AS "createdAt" FROM daybook.agency_reports WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!report) return fail('Report not found.', 'NOT_FOUND');
    const artifacts = (
      await c.query(
        'SELECT format,status,sha256,byte_length AS "byteLength" FROM daybook.report_artifacts WHERE report_id=$1 ORDER BY format',
        [id],
      )
    ).rows;
    return { ...report, artifacts };
  });
}
export async function generateReport(
  ctx: RequestContext,
  input: { requestId: string; reportId: string; format: string },
) {
  idValue(input.reportId);
  if (!['PDF', 'XLSX'].includes(input.format))
    return fail('Choose PDF or XLSX format.');
  const reportRenderer =
    input.format === 'PDF' ? reserveReportRenderer() : undefined;
  if (input.format === 'PDF' && !reportRenderer)
    return fail('Report rendering is busy. Retry shortly.', 'CONFLICT');
  let reservation;
  try {
    reservation = await configMutation(ctx, async (c) => {
      const prior = await onceRequest(
        c,
        ctx.agent!.agencyId,
        input.requestId,
        'generateReport',
        input,
        async () => ({ accepted: true }),
      );
      const found = (
        await c.query<{
          snapshot: AgencyReportSnapshot;
          status: string | null;
          attempts: number | null;
          leaseUntil: string | null;
        }>(
          'SELECT r.snapshot,a.status,a.attempts,a.lease_until::text AS "leaseUntil" FROM daybook.agency_reports r LEFT JOIN daybook.report_artifacts a ON a.agency_id=r.agency_id AND a.report_id=r.id AND a.format=$2 WHERE r.id=$1',
          [input.reportId, input.format],
        )
      ).rows[0];
      if (!found) return fail('Report not found.', 'NOT_FOUND');
      if (found.status === 'READY')
        return {
          ready: true,
          artifacts: [{ format: input.format, status: 'READY' }],
        };
      if (
        found.status === 'GENERATING' &&
        found.leaseUntil &&
        new Date(found.leaseUntil).getTime() > Date.now()
      )
        return {
          ready: false,
          artifacts: [{ format: input.format, status: 'GENERATING' }],
        };
      if ((found.attempts ?? 0) >= 3)
        return fail(
          'Report generation has reached its retry limit.',
          'CONFLICT',
        );
      const claim = await c.query<{ leaseUntil: string }>(
        `INSERT INTO daybook.report_artifacts(agency_id,report_id,format,status,attempts,lease_until) VALUES($1,$2,$3,'GENERATING',1,now()+interval '2 minutes') ON CONFLICT(agency_id,report_id,format) DO UPDATE SET status='GENERATING',attempts=report_artifacts.attempts+1,lease_until=excluded.lease_until,last_error=NULL WHERE report_artifacts.attempts<3 AND (report_artifacts.status IN('FAILED','PREPARED') OR (report_artifacts.status='GENERATING' AND report_artifacts.lease_until<=now())) RETURNING lease_until::text AS "leaseUntil"`,
        [ctx.agent!.agencyId, input.reportId, input.format],
      );
      const leaseUntil = claim.rows[0]?.leaseUntil;
      if (!leaseUntil)
        return fail('Report generation is already in progress.', 'CONFLICT');
      return { ready: false, snapshot: found.snapshot, prior, leaseUntil };
    });
  } catch (error) {
    reportRenderer?.release();
    throw error;
  }
  if (reservation.ready || !reservation.snapshot) reportRenderer?.release();
  if (reservation.ready || !reservation.snapshot)
    return agencyReport(ctx, input.reportId);
  const snapshot = reservation.snapshot as AgencyReportSnapshot;
  let body: Buffer;
  try {
    body =
      input.format === 'XLSX'
        ? await writeReportWorkbook(snapshot)
        : await reportRenderer!.render(snapshot);
    assertReportArtifactSize(body.length);
  } catch {
    await configMutation(ctx, (c) =>
      c
        .query(
          "UPDATE daybook.report_artifacts SET status='FAILED',lease_until=NULL,last_error='RENDER_FAILED' WHERE report_id=$1 AND format=$2 AND status='GENERATING' AND lease_until=$3",
          [input.reportId, input.format, reservation.leaseUntil],
        )
        .then(() => undefined),
    );
    return fail(
      'The report could not be generated. Retry or contact your agency administrator.',
      'REPORT_FAILED',
    );
  }
  const sha256 = createHash('sha256').update(body).digest('hex');
  await configMutation(ctx, async (c) => {
    await c.query(
      "UPDATE daybook.report_artifacts SET status='READY',lease_until=NULL,body=$3,sha256=$4,last_error=NULL WHERE report_id=$1 AND format=$2 AND status='GENERATING' AND lease_until=$5",
      [input.reportId, input.format, body, sha256, reservation.leaseUntil],
    );
  });
  return agencyReport(ctx, input.reportId);
}

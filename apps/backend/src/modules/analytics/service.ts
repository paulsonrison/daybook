import type { PoolClient } from 'pg';
import { readAnalyticsAdvertiser } from './advertiser.js';
import type { RequestContext } from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { agencyToday } from '../delivery/repository.js';
import { readAnalyticsBalances } from './balances.js';
import { readAnalyticsCirculation } from './circulation.js';
import { readAnalyticsPayroll } from './payroll.js';
import { readAnalyticsRoutes } from './routes.js';
import { readAnalyticsChurn } from './history.js';
import { moneyString } from '../money.js';
import { reportMonth, ratioBasisPoints } from './model.js';

/** All source reads share the existing agency financial/configuration lock. */
export function agencyAnalytics(ctx: RequestContext, input: { month: string }) {
  return financialRead(ctx, (c) => readAgencyAnalytics(c, input));
}
/** Reused by report preparation inside its existing agency transaction and lock. */
export async function readAgencyAnalytics(
  c: PoolClient,
  input: { month: string },
) {
  const today = await agencyToday(c),
    period = reportMonth(input.month, today);
  const sales = (
    await c.query<{
      invoiced: string;
      merchandise: string;
      advertiser: string;
      tax: string;
    }>(
      `
      SELECT
        coalesce((SELECT sum(amount_paise) FROM daybook.ledger_entries WHERE kind IN('INVOICE','INVOICE_REVISION') AND entry_date>=$1::date AND entry_date<$2::date),0)::text AS invoiced,
        coalesce((SELECT sum(amount_paise) FROM daybook.merchandise_charges WHERE settlement='CASH' AND charge_date>=$1::date AND charge_date<$2::date),0)::text AS merchandise,
        coalesce((SELECT sum(subtotal_paise) FROM daybook.advertiser_invoices WHERE issued_date>=$1::date AND issued_date<$2::date),0)::text AS advertiser,
        coalesce((SELECT sum(tax_paise) FROM daybook.advertiser_invoices WHERE issued_date>=$1::date AND issued_date<$2::date),0)::text AS tax
    `,
      [period.startDate, period.nextDate],
    )
  ).rows[0];
  const methods = (
    await c.query<{
      method: string;
      account: string;
      merchandise: string;
      deposits: string;
    }>(
      `
      SELECT s.method,
        coalesce(sum(s.amount_paise) FILTER(WHERE s.kind='PAYMENT' AND p.purpose='ACCOUNT'),0)::text AS account,
        coalesce(sum(s.amount_paise) FILTER(WHERE s.kind='MERCHANDISE'),0)::text AS merchandise,
        coalesce(sum(s.amount_paise) FILTER(WHERE s.kind='DEPOSIT' OR p.purpose='DEPOSIT'),0)::text AS deposits
      FROM daybook.collection_sources s LEFT JOIN daybook.payments p ON s.kind='PAYMENT' AND (p.agency_id,p.id)=(s.agency_id,s.id)
      WHERE s.source_date>=$1::date AND s.source_date<$2::date
      GROUP BY s.method ORDER BY s.method
    `,
      [period.startDate, period.nextDate],
    )
  ).rows;
  const receipts = { account: 0n, cash: 0n, deposits: 0n, unclassified: 0n };
  for (const method of methods) {
    receipts.account += BigInt(method.account);
    receipts.deposits += BigInt(method.deposits);
    if (method.method === 'CASH')
      receipts.cash += BigInt(method.account) + BigInt(method.merchandise);
    if (method.method === 'UNKNOWN')
      receipts.unclassified += BigInt(method.deposits);
  }
  const balances = await readAnalyticsBalances(c, today);
  const circulation = await readAnalyticsCirculation(c, period, today);
  const churn = await readAnalyticsChurn(c, period, today);
  const payroll = await readAnalyticsPayroll(c, period);
  const advertiser = await readAnalyticsAdvertiser(c, period);
  const routes = await readAnalyticsRoutes(
    c,
    period,
    today,
    payroll,
    advertiser,
  );
  const refunds = (
    await c.query<{
      total: string;
      cash: string;
      deposit: string;
      credit: string;
    }>(
      `
      SELECT coalesce(sum(amount_paise),0)::text AS total,
        coalesce(sum(amount_paise) FILTER(WHERE method='CASH'),0)::text AS cash,
        coalesce(sum(deposit_paise),0)::text AS deposit,
        coalesce(sum(account_credit_paise),0)::text AS credit
      FROM daybook.clearance_refunds WHERE posting_date>=$1::date AND posting_date<$2::date
    `,
      [period.startDate, period.nextDate],
    )
  ).rows[0];
  const agencyCosts = (
    await c.query<{ purchases: string; returns: string }>(
      `
      SELECT coalesce((SELECT sum(total_paise) FROM daybook.supply_lots WHERE supply_date>=$1::date AND supply_date<$2::date),0)::text AS purchases,
      coalesce((SELECT sum(credit_paise) FROM daybook.supply_returns WHERE recorded_date>=$1::date AND recorded_date<$2::date),0)::text AS returns
    `,
      [period.startDate, period.nextDate],
    )
  ).rows[0];
  return {
    agencyCosts: {
      supplyPurchases: moneyString(BigInt(agencyCosts.purchases)),
      supplyReturnCredits: moneyString(BigInt(agencyCosts.returns)),
      netSupplyPurchases: moneyString(
        BigInt(agencyCosts.purchases) - BigInt(agencyCosts.returns),
      ),
      allocationBasis: 'UNALLOCATED_AGENCY_PURCHASES_NOT_ROUTE_CONSUMPTION',
    },
    month: period.month,
    startDate: period.startDate,
    endDate: period.endDate,
    asOf: new Date().toISOString(),
    sales: {
      invoiced: moneyString(BigInt(sales.invoiced)),
      cashMerchandise: moneyString(BigInt(sales.merchandise)),
      advertiserSubtotal: moneyString(BigInt(sales.advertiser)),
      advertiserTax: moneyString(BigInt(sales.tax)),
      recordedTotal: moneyString(
        BigInt(sales.invoiced) +
          BigInt(sales.merchandise) +
          BigInt(sales.advertiser),
      ),
    },
    receipts: {
      account: moneyString(receipts.account),
      cashAccountAndMerchandise: moneyString(receipts.cash),
      refundableDeposits: moneyString(receipts.deposits),
      unclassifiedDeposits: moneyString(receipts.unclassified),
      byMethod: methods.map((method) => ({
        method: method.method,
        account: moneyString(BigInt(method.account)),
        refundableDeposits: moneyString(BigInt(method.deposits)),
        cashMerchandise: moneyString(BigInt(method.merchandise)),
      })),
    },
    advertiserAllocation: advertiser.summary,
    payroll: payroll.summary,
    routes,
    balances,
    circulation,
    churn,
    refunds: {
      total: moneyString(BigInt(refunds.total)),
      cash: moneyString(BigInt(refunds.cash)),
      deposit: moneyString(BigInt(refunds.deposit)),
      accountCredit: moneyString(BigInt(refunds.credit)),
    },
    collectionComparison: {
      numerator: moneyString(receipts.account),
      denominator: moneyString(BigInt(sales.invoiced)),
      basisPoints: ratioBasisPoints(receipts.account, BigInt(sales.invoiced)),
      basis: 'ACCOUNT_RECEIPTS_TO_RESIDENT_INVOICED_SALES',
    },
  };
}

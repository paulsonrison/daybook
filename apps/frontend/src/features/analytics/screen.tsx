'use client';
import { useI18n } from '@daybook/ui/i18n';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  BarChart,
  Button,
  Card,
  DataState,
  DataTable,
  Field,
  MetricCard,
  Notification,
} from '@daybook/ui';
import { formatMoney } from '@daybook/ui/money';
import { translateRendered } from '@daybook/ui/messages';
import { AnalyticsStore, type AnalyticsReport, type Coverage } from './store';
import { basisPointsPercent, chartPoints } from './presentation';
function useAnalytics() {
  const [store] = useState(() => new AnalyticsStore());
  useEffect(() => {
    void store.initialize();
    return store.dispose;
  }, [store]);
  return store;
}
function CoverageBadge({ value }: { value: Coverage }) {
  const { t } = useI18n();
  return (
    <Badge tone={value === 'COMPLETE' ? 'success' : 'warning'}>
      {value === 'COMPLETE'
        ? t('Complete')
        : value === 'PARTIAL'
          ? t('Partial')
          : t('Unavailable')}
    </Badge>
  );
}
function Summary({
  report,
  loading = false,
}: {
  report: AnalyticsReport | null;
  loading?: boolean;
}) {
  const { t, locale } = useI18n(),
    numberLocale = locale + '-IN';
  return (
    <div className="agency-metrics">
      <MetricCard
        title={t('Recorded monthly sales')}
        value={formatMoney(report?.sales.recordedTotal, 'INR', numberLocale)}
        loading={loading}
        description={t(
          'Invoiced resident sales, cash merchandise and advertiser subtotal.',
        )}
      />
      <MetricCard
        title={t('Collected cash')}
        value={formatMoney(
          report?.receipts.cashAccountAndMerchandise,
          'INR',
          numberLocale,
        )}
        loading={loading}
        description={t(
          'Confirmed account cash and merchandise receipts; deposits excluded.',
        )}
      />
      <div data-testid="analytics-outstanding">
        <MetricCard
          title={t('Outstanding arrears')}
          value={formatMoney(report?.balances.outstanding, 'INR', numberLocale)}
          loading={loading}
          description={
            report
              ? t('Current balances as of {date}', {
                  date: report.balances.asOfDate,
                })
              : undefined
          }
        />
      </div>
      <MetricCard
        title={t('Scheduled daily copies')}
        value={
          report?.circulation.currentScheduled.copies === null
            ? t('Unavailable')
            : report
              ? new Intl.NumberFormat(numberLocale).format(
                  BigInt(report.circulation.currentScheduled.copies!),
                )
              : null
        }
        loading={loading}
        description={
          report
            ? t('Current schedule as of {date}', {
                date: report.circulation.currentScheduled.asOfDate,
              })
            : undefined
        }
      />
    </div>
  );
}
export const AnalyticsOverview = observer(function AnalyticsOverview() {
  const store = useAnalytics(),
    { t, locale } = useI18n();
  return (
    <section aria-label={t('Business summary')}>
      {store.state === 'error' ? (
        <DataState
          kind="error"
          title={t('Analytics unavailable')}
          description={translateRendered(locale, store.error)}
          onRetry={store.retry}
        />
      ) : (
        <Summary report={store.report} loading={store.state === 'loading'} />
      )}
      <a className="db-button db-button--secondary" href="/analytics">
        {t('View agency analytics')}
      </a>
    </section>
  );
});
export const AnalyticsScreen = observer(function AnalyticsScreen() {
  const store = useAnalytics(),
    { t, locale } = useI18n(),
    report = store.report,
    numberLocale = locale + '-IN';
  const money = (value: string | null) =>
    value === null ? t('Unavailable') : formatMoney(value, 'INR', numberLocale);
  const count = (value: string | null) =>
    value === null
      ? t('Unavailable')
      : new Intl.NumberFormat(numberLocale).format(BigInt(value));
  const agingLabels: Record<string, string> = {
    NOT_DUE: t('Not due'),
    DAYS_1_30: t('1–30 days overdue'),
    DAYS_31_60: t('31–60 days overdue'),
    DAYS_61_90: t('61–90 days overdue'),
    DAYS_91_PLUS: t('Over 90 days overdue'),
  };
  const partial =
    report &&
    (report.circulation.coverage !== 'COMPLETE' ||
      report.churn.coverage !== 'COMPLETE' ||
      report.balances.agingState !== 'COMPLETE' ||
      report.routes.some((row) => row.contributionCoverage !== 'COMPLETE') ||
      report.payroll.coverage !== 'COMPLETE' ||
      report.advertiserAllocation.unsupportedInvoices !== '0');
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">{t('Agency overview')}</p>
          <h1>{t('Agency analytics')}</h1>
          <p className="db-muted">
            {t(
              'Recorded business activity with explicit source dates and missing-cost coverage.',
            )}
          </p>
        </div>
      </header>
      <div className="db-row">
        <Field
          label={t('Report month')}
          type="month"
          value={store.month}
          max={store.today.slice(0, 7) || undefined}
          disabled={!store.today}
          onChange={(event) => {
            if (event.target.value) void store.load(event.target.value);
          }}
        />
        <Button onClick={store.retry} disabled={store.state === 'loading'}>
          {t('Refresh reports')}
        </Button>
      </div>
      {store.state === 'error' ? (
        <DataState
          kind="error"
          title={t('Analytics unavailable')}
          description={translateRendered(locale, store.error)}
          onRetry={store.retry}
        />
      ) : (
        <Summary report={report} loading={store.state === 'loading'} />
      )}
      {report && (
        <>
          <p className="db-muted">
            {t('{start} → {end}', {
              start: report.startDate,
              end: report.endDate,
            })}
          </p>
          <p className="db-muted">
            {t('Report source snapshot: {time}', { time: report.asOf })}
          </p>
          {partial && (
            <Notification
              tone="warning"
              title={t('Recorded sources are incomplete.')}
              description={t(
                'Unavailable costs and missing history are not zero. Route estimates exclude shared expenses and unsupported losses.',
              )}
            />
          )}
          <div className="agency-metrics">
            <MetricCard
              title={t('Account receipts to invoiced sales')}
              value={
                basisPointsPercent(
                  report.collectionComparison.basisPoints,
                  numberLocale,
                ) ?? t('Unavailable')
              }
              description={t(
                'Receipts can recover older debt and may exceed 100% of selected-month invoiced sales.',
              )}
            />
            <MetricCard
              title={t('Recorded account closures')}
              value={count(report.churn.closedAccounts)}
              description={t(
                'Clearance termination dates; subscription cancellations are not account closures.',
              )}
            />
            <MetricCard
              title={t('Open-account cohort closure rate')}
              value={
                basisPointsPercent(
                  report.churn.rateBasisPoints,
                  numberLocale,
                ) ?? t('Unavailable')
              }
              description={t(
                'Recorded open accounts at the start of the month; historical active status is not inferred.',
              )}
            />
          </div>
          <Card
            title={t('Customer cohort evidence')}
            trailing={<CoverageBadge value={report.churn.coverage} />}
          >
            <dl className="db-report-facts">
              <dt>{t('Recorded registrations')}</dt>
              <dd>{count(report.churn.registrations)}</dd>
              <dt>{t('Open accounts at month start')}</dt>
              <dd>{count(report.churn.openAtStart)}</dd>
              <dt>{t('Closures from that cohort')}</dt>
              <dd>{count(report.churn.cohortClosures)}</dd>
              <dt>{t('Accounts with incomplete history')}</dt>
              <dd>{count(report.churn.missingHistoryCount)}</dd>
            </dl>
          </Card>
          <Card
            title={t('Recorded circulation')}
            trailing={<CoverageBadge value={report.circulation.coverage} />}
          >
            <dl className="db-report-facts">
              <dt>{t('Original fulfilled copies')}</dt>
              <dd>{count(report.circulation.fulfilledCopies)}</dd>
              <dt>{t('Chargeable copies')}</dt>
              <dd>{count(report.circulation.chargeableCopies)}</dd>
              <dt>{t('Replacement copies')}</dt>
              <dd>{count(report.circulation.replacementCopies)}</dd>
              <dt>{t('Distinct readers')}</dt>
              <dd>{count(report.circulation.readers)}</dd>
              <dt>{t('Prepared calendar days')}</dt>
              <dd>
                {t('{prepared} of {elapsed}', {
                  prepared: report.circulation.preparedDays,
                  elapsed: report.circulation.elapsedDays,
                })}
              </dd>
            </dl>
            <p className="db-muted">
              {t(
                'Missing prepared days are unknown, not zero circulation. Replacements are attributed to the original delivery date.',
              )}
            </p>
          </Card>
          <BarChart
            emptyTitle={t('No recorded chart data')}
            errorTitle={t('Chart unavailable')}
            missingDescription={t('Missing records are unavailable, not zero.')}
            title={t('Publication readership')}
            state={
              report.circulation.coverage === 'COMPLETE' ? 'ready' : 'partial'
            }
            data={chartPoints(
              report.circulation.byPublication.map((row) => ({
                label: row.name,
                amount: row.readers,
              })),
              'count',
              numberLocale,
            )}
          />
          <BarChart
            emptyTitle={t('No recorded chart data')}
            errorTitle={t('Chart unavailable')}
            missingDescription={t('Missing records are unavailable, not zero.')}
            title={t('Recorded circulation trend')}
            state={
              report.circulation.trend.every(
                (row) => row.coverage === 'COMPLETE',
              )
                ? 'ready'
                : 'partial'
            }
            data={chartPoints(
              report.circulation.trend.map((row) => ({
                label: row.month,
                amount: row.fulfilledCopies,
              })),
              'count',
              numberLocale,
            )}
          />
          <Card
            title={t('Current arrears aging')}
            trailing={<CoverageBadge value={report.balances.agingState} />}
          >
            <p>
              {t('Current balances as of {date}', {
                date: report.balances.asOfDate,
              })}
            </p>
            <dl className="db-report-facts">
              <dt>{t('Net overdue')}</dt>
              <dd>{money(report.balances.overdue)}</dd>
              <dt>{t('Gross unsettled overdue')}</dt>
              <dd>{money(report.balances.unsettledOverdue)}</dd>
              <dt>{t('Credit balances')}</dt>
              <dd>{money(report.balances.credit)}</dd>
              <dt>{t('Unallocated credit offset')}</dt>
              <dd>{money(report.balances.agingUnallocatedCredit)}</dd>
            </dl>
            <p className="db-muted">
              {t(
                'Aging shows gross unsettled debits. Unallocated credit can make net overdue unavailable.',
              )}
            </p>
          </Card>
          <BarChart
            emptyTitle={t('No recorded chart data')}
            errorTitle={t('Chart unavailable')}
            missingDescription={t('Missing records are unavailable, not zero.')}
            title={t('Gross unsettled debit aging')}
            state={
              report.balances.agingState === 'COMPLETE' ? 'ready' : 'partial'
            }
            data={chartPoints(
              report.balances.aging.map((row) => ({
                label: agingLabels[row.bucket] ?? row.bucket,
                amount: row.amount,
              })),
              'money',
              numberLocale,
            )}
          />
          <Card
            title={t('Route contribution before shared expenses')}
            description={t(
              'Recorded chargeable retail value plus allocated advertiser sales, less known procurement estimates and attributable posted payroll. This is not net profit.',
            )}
          >
            <DataTable
              caption={t('Route contribution evidence')}
              rows={report.routes}
              rowKey={(row) => row.routeId}
              state={report.routes.length ? 'ready' : 'empty'}
              emptyTitle={t('No recorded route activity')}
              columns={[
                {
                  key: 'route',
                  header: t('Route'),
                  render: (row) => row.snapshotNames.join(' / ') || row.routeId,
                },
                {
                  key: 'retail',
                  header: t('Chargeable retail value'),
                  render: (row) => money(row.chargeableRetail),
                },
                {
                  key: 'advertiser',
                  header: t('Allocated advertiser sales'),
                  render: (row) => money(row.advertiserSales),
                },
                {
                  key: 'procurement',
                  header: t('Known procurement estimate'),
                  render: (row) => money(row.procurementEstimate),
                },
                {
                  key: 'payroll',
                  header: t('Attributable posted payroll'),
                  render: (row) => money(row.postedPayroll),
                },
                {
                  key: 'contribution',
                  header: t('Contribution before shared expenses'),
                  render: (row) => money(row.contributionBeforeShared),
                },
                {
                  key: 'coverage',
                  header: t('Source coverage'),
                  render: (row) => (
                    <CoverageBadge value={row.contributionCoverage} />
                  ),
                },
                {
                  key: 'missingCost',
                  header: t('Copies without procurement cost'),
                  render: (row) => count(row.missingCostCopies),
                },
                {
                  key: 'missingPay',
                  header: t('Copies without posted payroll cost'),
                  render: (row) => count(row.payrollCopiesWithoutPostedCost),
                },
                {
                  key: 'replacement',
                  header: t('Replacement copies without cost evidence'),
                  render: (row) => count(row.replacementCopies),
                },
                {
                  key: 'exceptions',
                  header: t(
                    'Original exception copies without attributed cost',
                  ),
                  render: (row) =>
                    count(row.exceptionCopiesWithoutAttributedCost),
                },
              ]}
            />
          </Card>
          <BarChart
            emptyTitle={t('No recorded chart data')}
            errorTitle={t('Chart unavailable')}
            missingDescription={t('Missing records are unavailable, not zero.')}
            title={t('Known route contribution')}
            signed
            state={
              report.routes.every(
                (row) => row.contributionCoverage === 'COMPLETE',
              )
                ? 'ready'
                : 'partial'
            }
            data={chartPoints(
              report.routes.map((row) => ({
                label: row.snapshotNames.join(' / ') || row.routeId,
                amount: row.contributionBeforeShared,
              })),
              'money',
              numberLocale,
            )}
          />
          <Card
            title={t('Agency costs and cash outflows')}
            description={t(
              'Agency purchases are not proof of route consumption. Shared expenses and supplier returns are not allocated to routes.',
            )}
          >
            <dl className="db-report-facts">
              <dt>{t('Recorded supply purchases')}</dt>
              <dd>{money(report.agencyCosts.supplyPurchases)}</dd>
              <dt>{t('Recorded supplier return credits')}</dt>
              <dd>{money(report.agencyCosts.supplyReturnCredits)}</dd>
              <dt>{t('Net recorded supply purchases')}</dt>
              <dd>{money(report.agencyCosts.netSupplyPurchases)}</dd>
              <dt>{t('Posted payroll expense')}</dt>
              <dd>{money(report.payroll.postedExpense)}</dd>
              <dt>{t('Known posted payroll expense')}</dt>
              <dd>{money(report.payroll.knownPostedExpense)}</dd>
              <dt>{t('Unallocated posted payroll expense')}</dt>
              <dd>{money(report.payroll.unallocatedExpense)}</dd>
              <dt>{t('Actual payroll payouts')}</dt>
              <dd>{money(report.payroll.actualPayouts)}</dd>
              <dt>{t('Unallocated advertiser subtotal')}</dt>
              <dd>{money(report.advertiserAllocation.unallocatedSubtotal)}</dd>
              <dt>{t('Confirmed clearance refunds')}</dt>
              <dd>{money(report.refunds.total)}</dd>
              <dt>{t('Refundable deposit receipts')}</dt>
              <dd>{money(report.receipts.refundableDeposits)}</dd>
              <dt>{t('Deposit receipts with unknown method')}</dt>
              <dd>{money(report.receipts.unclassifiedDeposits)}</dd>
            </dl>
            <p className="db-muted">
              {t(
                'Advances are financing recovery. Payroll payouts are not a second expense, and deposits are separate liabilities.',
              )}
            </p>
          </Card>
        </>
      )}
    </div>
  );
});

'use client';
import { useEffect, useState } from 'react';
import {
  Card,
  DataState,
  DataTable,
  MetricCard,
  Notification,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
export interface DeliveryMetrics {
  today: string;
  timezone: string;
  openComplaints: number;
  totalComplaints: number;
  resolvedComplaints: number;
  satisfactionAverage: number | null;
  failedJobs: number;
  lastAutomaticRun: string | null;
  staffErrors: {
    staffId: string | null;
    name: string;
    errors: number;
    deliveries: number;
  }[];
}
export const metricsFields =
  'today timezone openComplaints totalComplaints resolvedComplaints satisfactionAverage failedJobs lastAutomaticRun staffErrors{staffId name errors deliveries}';
export function DeliveryMetricsView({ metrics }: { metrics: DeliveryMetrics }) {
  return (
    <>
      <div className="agency-metrics">
        <MetricCard
          title="Open complaints"
          value={String(metrics.openComplaints)}
        />
        <MetricCard
          title="Resolved complaints"
          value={`${metrics.resolvedComplaints} / ${metrics.totalComplaints}`}
        />
        <MetricCard
          title="Recorded resident feedback"
          value={
            metrics.satisfactionAverage === null
              ? '—'
              : `${metrics.satisfactionAverage.toFixed(1)} / 5`
          }
        />
      </div>
      {metrics.failedJobs > 0 && (
        <Notification
          tone="error"
          title="Automatic preparation needs attention"
          description={`${metrics.failedJobs} jobs are awaiting retry or investigation.`}
        />
      )}
      <Card
        title="Automatic preparation"
        description={
          metrics.lastAutomaticRun
            ? `Last successful run: ${new Date(metrics.lastAutomaticRun).toLocaleString('en-IN', { timeZone: metrics.timezone })} (${metrics.timezone})`
            : 'No successful automatic run recorded.'
        }
      >
        <DataTable
          caption="Staff delivery quality"
          rows={metrics.staffErrors}
          rowKey={(s) => s.staffId ?? 'unassigned'}
          emptyTitle="No delivery quality data yet"
          columns={[
            { key: 'staff', header: 'Staff', render: (s) => s.name },
            {
              key: 'errors',
              header: 'Confirmed delivery issues',
              render: (s) => s.errors,
            },
            {
              key: 'deliveries',
              header: 'Recorded deliveries',
              render: (s) => s.deliveries,
            },
            {
              key: 'rate',
              header: 'Issue rate',
              render: (s) =>
                s.deliveries
                  ? `${((s.errors / s.deliveries) * 100).toFixed(1)}%`
                  : '—',
            },
          ]}
        />
      </Card>
    </>
  );
}
export function DeliveryDashboard() {
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void graphqlRequest<{ deliveryMetrics: DeliveryMetrics }>(
      `{deliveryMetrics{${metricsFields}}}`,
    )
      .then((data) => {
        if (active) setMetrics(data.deliveryMetrics);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Delivery metrics unavailable.',
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return metrics ? (
    <DeliveryMetricsView metrics={metrics} />
  ) : (
    <DataState
      kind={error ? 'error' : 'loading'}
      title={
        error ? 'Delivery metrics unavailable' : 'Loading delivery quality'
      }
      description={error || undefined}
      onRetry={() => {
        setError('');
        setAttempt((a) => a + 1);
      }}
    />
  );
}

import type { ReactNode } from 'react';
import { Card } from './card';
import { DataState, Notification, Skeleton } from './feedback';
export function MetricCard({
  title,
  value,
  description,
  loading = false,
}: {
  title: string;
  value: ReactNode;
  description?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <p className="db-muted">{title}</p>
      {loading ? (
        <Skeleton height={34} width="60%" />
      ) : (
        <p className="db-metric">{value ?? 'Unavailable'}</p>
      )}
      {description && <p className="db-field-hint">{description}</p>}
    </Card>
  );
}
export function BarChart({
  title,
  data,
  state = 'ready',
  onRetry,
}: {
  title: string;
  data: readonly { label: string; value: number | null }[];
  state?: 'ready' | 'loading' | 'error' | 'partial';
  onRetry?: () => void;
}) {
  if (state === 'loading')
    return (
      <Card title={title}>
        <div className="db-row" role="status">
          <span className="db-sr-only">Loading chart…</span>
          {[42, 72, 94, 60].map((height, i) => (
            <Skeleton key={i} height={height} width="20%" />
          ))}
        </div>
      </Card>
    );
  if (state === 'error')
    return (
      <DataState
        kind="error"
        title="Collection chart unavailable"
        description="Do not draw a zero-value chart for missing data."
        onRetry={onRetry}
      />
    );
  const known = data.filter(
    (point): point is { label: string; value: number } =>
      point.value !== null && Number.isFinite(point.value),
  );
  if (known.length === 0)
    return (
      <DataState
        kind="empty"
        title="No collection history"
        description="Do not draw a zero-value chart for missing data."
      />
    );
  const max = Math.max(1, ...known.map((point) => point.value));
  return (
    <Card title={title}>
      {(state === 'partial' || known.length !== data.length) && (
        <Notification
          tone="warning"
          title="Incomplete period · total not finalized"
        />
      )}
      <div
        className="db-chart"
        role="img"
        aria-label={`${title}: ${data.map((point) => `${point.label}: ${point.value ?? 'unavailable'}`).join(', ')}`}
      >
        {data.map((point, index) => (
          <div className="db-chart-column" key={`${point.label}-${index}`}>
            <div
              className="db-chart-bar"
              style={{
                height:
                  point.value === null
                    ? 0
                    : Math.max(1, (Math.max(0, point.value) / max) * 110),
                visibility: point.value === null ? 'hidden' : undefined,
              }}
            />
            <span className="db-chart-label">
              {point.label}
              <br />
              {point.value ?? 'Unavailable'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

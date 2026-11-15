'use client';
import { useI18n } from '../i18n-context';
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
  const { t } = useI18n();
  return (
    <Card>
      <p className="db-muted">{title}</p>
      {loading ? (
        <Skeleton height={34} width="60%" />
      ) : (
        <p className="db-metric">{value ?? t('Unavailable')}</p>
      )}
      {description && <p className="db-field-hint">{description}</p>}
    </Card>
  );
}
export function BarChart({
  title,
  data,
  state = 'ready',
  signed = false,
  emptyTitle,
  errorTitle,
  missingDescription,
  onRetry,
}: {
  title: string;
  data: readonly {
    label: string;
    value: number | null;
    displayValue?: string;
  }[];
  state?: 'ready' | 'loading' | 'error' | 'partial';
  signed?: boolean;
  emptyTitle?: string;
  errorTitle?: string;
  missingDescription?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  if (state === 'loading')
    return (
      <Card title={title}>
        <div className="db-row" role="status">
          <span className="db-sr-only">{t('Loading chart…')}</span>
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
        title={errorTitle ?? t('Collection chart unavailable')}
        description={
          missingDescription ??
          t('Do not draw a zero-value chart for missing data.')
        }
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
        title={emptyTitle ?? t('No collection history')}
        description={
          missingDescription ??
          t('Do not draw a zero-value chart for missing data.')
        }
      />
    );
  const max = Math.max(
    1,
    ...known.map((point) => (signed ? Math.abs(point.value) : point.value)),
  );
  return (
    <Card title={title}>
      {(state === 'partial' || known.length !== data.length) && (
        <Notification
          tone="warning"
          title={t('Incomplete period · total not finalized')}
        />
      )}
      <div
        className="db-chart"
        role="img"
        aria-label={`${title}: ${data.map((point) => `${point.label}: ${point.value === null ? t('Unavailable') : (point.displayValue ?? point.value)}`).join(', ')}`}
      >
        {data.map((point, index) => (
          <div className="db-chart-column" key={`${point.label}-${index}`}>
            {signed ? (
              <div className="db-chart-bar-lane">
                <div
                  className="db-chart-bar"
                  data-direction={
                    point.value !== null && point.value < 0
                      ? 'negative'
                      : 'positive'
                  }
                  style={{
                    position: 'absolute',
                    height:
                      point.value === null
                        ? 0
                        : (Math.abs(point.value) / max) * 110,
                    bottom:
                      point.value !== null && point.value >= 0
                        ? 110
                        : undefined,
                    top:
                      point.value !== null && point.value < 0 ? 110 : undefined,
                    background:
                      point.value !== null && point.value < 0
                        ? 'var(--db-danger)'
                        : undefined,
                    visibility: point.value === null ? 'hidden' : undefined,
                  }}
                />
              </div>
            ) : (
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
            )}
            <span className="db-chart-label">
              {point.label}
              <br />
              {point.value === null
                ? t('Unavailable')
                : (point.displayValue ?? point.value)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

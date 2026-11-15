'use client';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useI18n } from '../i18n-context';
import type { Tone } from '../tokens';
import { Icon } from './icon';
import { Button } from './button';

export function Skeleton({
  width = '100%',
  height = 16,
  circle = false,
  style,
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  circle?: boolean;
}) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`db-skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : undefined,
        ...style,
      }}
    />
  );
}
export function LoadingIndicator({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <span role="status" className="db-row">
      <Icon name="loader" size={14} className="db-spin" />
      {label ?? t('Loading…')}
    </span>
  );
}
export interface NotificationProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
  onDismiss?: () => void;
}
export function Notification({
  title,
  description,
  tone = 'info',
  action,
  onDismiss,
  className = '',
  ...props
}: NotificationProps) {
  const { t } = useI18n();
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      {...props}
      className={`db-notification db-tone-${tone} ${className}`}
    >
      <Icon
        name={
          tone === 'success'
            ? 'success'
            : tone === 'warning'
              ? 'warning'
              : tone === 'error'
                ? 'error'
                : 'info'
        }
        size={tone === 'success' ? 18 : 14}
      />
      <div className="db-notification-content">
        <div className="db-notification-title">{title}</div>
        {description && (
          <div className="db-notification-description">{description}</div>
        )}
        {action && (
          <div className="db-row" style={{ marginTop: 12 }}>
            {action}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          className="db-dismiss"
          type="button"
          aria-label={t('Dismiss notification')}
          onClick={onDismiss}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}
export type DataStateKind =
  | 'loading'
  | 'empty'
  | 'no-results'
  | 'error'
  | 'offline'
  | 'partial'
  | 'slow'
  | 'missing'
  | 'access-denied'
  | 'session-expired';
export const stateMessages: Record<
  DataStateKind,
  { title: string; description: string; tone: Tone }
> = {
  loading: {
    title: 'Loading records…',
    description: 'Your route and entered values are preserved.',
    tone: 'info',
  },
  empty: {
    title: 'No records yet',
    description: 'Add a record to get started.',
    tone: 'neutral',
  },
  'no-results': {
    title: 'No matching records',
    description: 'Change your search or clear filters.',
    tone: 'neutral',
  },
  error: {
    title: 'Records unavailable',
    description: 'Keep the current route and retry loading this content.',
    tone: 'error',
  },
  offline: {
    title: 'Offline',
    description:
      'Saved data stays readable. Server-confirmed actions wait for reconnection.',
    tone: 'warning',
  },
  partial: {
    title: 'Some records are unavailable',
    description: 'Loaded records remain visible. Totals are not finalized.',
    tone: 'warning',
  },
  slow: {
    title: 'This is taking longer than expected',
    description: 'Your input is preserved. You can retry this request.',
    tone: 'info',
  },
  missing: {
    title: 'Page not found',
    description: 'This destination is unavailable. Return to the overview.',
    tone: 'neutral',
  },
  'access-denied': {
    title: 'Access denied',
    description: 'Your current role cannot open this workspace area.',
    tone: 'warning',
  },
  'session-expired': {
    title: 'Session expired',
    description: 'Sign in again, then return to your preserved draft.',
    tone: 'warning',
  },
};
export interface DataStateProps {
  kind: DataStateKind;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}
export function DataState({
  kind,
  title,
  description,
  action,
  onRetry,
  retryLabel,
}: DataStateProps) {
  const { t } = useI18n();
  const content = stateMessages[kind];
  return (
    <section
      className="db-data-state"
      aria-busy={kind === 'loading' || undefined}
    >
      <span className="db-eyebrow">
        {t(
          {
            loading: 'Loading',
            empty: 'Empty',
            'no-results': 'No results',
            error: 'Error',
            offline: 'Offline',
            partial: 'Partial',
            slow: 'Slow',
            missing: 'Missing',
            'access-denied': 'Access denied',
            'session-expired': 'Session expired',
          }[kind],
        )}
      </span>
      <h3>{title ?? t(content.title)}</h3>
      <p role={kind === 'error' ? 'alert' : 'status'}>
        {description ?? t(content.description)}
      </p>
      {kind === 'loading' && (
        <div className="db-stack" style={{ width: '100%' }}>
          <Skeleton height={18} width="62%" />
          <Skeleton height={18} width="88%" />
          <Skeleton height={18} width="74%" />
        </div>
      )}
      {(action || onRetry) && (
        <div className="db-row">
          {action}
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              {retryLabel ?? t('Try again')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
export function TableSkeleton({
  rows = 4,
  columns = 3,
  label,
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="db-stack" role="status" aria-busy="true">
      <span className="db-sr-only">{label ?? t('Loading records…')}</span>
      {Array.from({ length: Math.min(20, Math.max(1, rows)) }, (_, row) => (
        <div
          key={row}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(12, Math.max(1, columns))}, minmax(0,1fr))`,
            gap: 16,
            padding: 12,
          }}
        >
          {Array.from(
            { length: Math.min(12, Math.max(1, columns)) },
            (_, column) => (
              <Skeleton
                key={column}
                height={18}
                width={column === 0 ? '80%' : '65%'}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

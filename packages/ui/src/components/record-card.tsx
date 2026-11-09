import type { ReactNode } from 'react';
import { Avatar, Card } from './card';
import { Button } from './button';
import { Notification, Skeleton } from './feedback';
export function RecordCard({
  title,
  description,
  avatar,
  status,
  state = 'ready',
  onRetry,
  children,
}: {
  title: string;
  description?: string;
  avatar?: string;
  status?: ReactNode;
  state?: 'ready' | 'loading' | 'empty' | 'partial' | 'error';
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (state === 'loading')
    return (
      <Card className="db-record-card">
        <div className="db-row" role="status">
          <span className="db-sr-only">Loading records…</span>
          <Skeleton width={34} height={34} circle />
          <Skeleton width="50%" height={18} />
        </div>
      </Card>
    );
  return (
    <Card className="db-record-card">
      <div className="db-row">
        {avatar && <Avatar name={avatar} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="db-card-title">{title}</h3>
          {description && <p className="db-field-hint">{description}</p>}
        </div>
        {status}
      </div>
      {state === 'empty' && (
        <p className="db-field-hint">
          No subscription is available for this resident.
        </p>
      )}
      {state === 'partial' && (
        <p className="db-field-hint">
          Resident loaded · account balance unavailable
        </p>
      )}
      {state === 'error' && (
        <Notification
          tone="error"
          title="Couldn’t load this record."
          action={
            onRetry && (
              <Button variant="secondary" size="small" onClick={onRetry}>
                Retry card
              </Button>
            )
          }
        />
      )}
      {children}
    </Card>
  );
}

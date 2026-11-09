import { Button } from './button';
import {
  DataState,
  LoadingIndicator,
  Notification,
  type DataStateKind,
} from './feedback';
export function WorkspaceState({
  state,
  onReturn,
  onSignIn,
  onRetry,
}: {
  state: 'boot' | 'offline' | 'expired' | 'denied' | 'missing' | 'unavailable';
  onReturn?: () => void;
  onSignIn?: () => void;
  onRetry?: () => void;
}) {
  const kinds: Record<typeof state, DataStateKind> = {
    boot: 'loading',
    offline: 'offline',
    expired: 'session-expired',
    denied: 'access-denied',
    missing: 'missing',
    unavailable: 'error',
  };
  return (
    <DataState
      kind={kinds[state]}
      title={
        state === 'boot'
          ? 'Opening Daybook…'
          : state === 'unavailable'
            ? 'Service unavailable'
            : undefined
      }
      onRetry={state === 'unavailable' ? onRetry : undefined}
      action={
        state === 'expired' && onSignIn ? (
          <Button onClick={onSignIn}>Sign in again</Button>
        ) : state !== 'boot' && onReturn ? (
          <Button variant="secondary" onClick={onReturn}>
            Back to overview
          </Button>
        ) : undefined
      }
    />
  );
}
export function ExportControl({
  state,
  invoice,
  onDownload,
  onRetry,
  onReturn,
}: {
  state:
    | 'ready'
    | 'preparing'
    | 'download-ready'
    | 'error'
    | 'share-unavailable'
    | 'permission-denied';
  invoice?: string;
  onDownload?: () => void;
  onRetry?: () => void;
  onReturn?: () => void;
}) {
  if (state === 'preparing') return <LoadingIndicator label="Preparing PDF…" />;
  const title =
    state === 'ready'
      ? `Saved invoice${invoice ? ` · ${invoice}` : ''}`
      : state === 'download-ready'
        ? 'PDF ready to download'
        : state === 'error'
          ? 'Export failed'
          : state === 'share-unavailable'
            ? 'Sharing service unavailable'
            : 'Export permission required';
  return (
    <Notification
      title={title}
      tone={
        state === 'error'
          ? 'error'
          : state === 'permission-denied' || state === 'share-unavailable'
            ? 'warning'
            : 'info'
      }
      action={
        state === 'error' ? (
          <Button variant="secondary" onClick={onRetry} disabled={!onRetry}>
            Retry export
          </Button>
        ) : state === 'permission-denied' ? (
          <Button variant="secondary" onClick={onReturn} disabled={!onReturn}>
            Back to ledger
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={onDownload}
            disabled={!onDownload}
          >
            Download PDF
          </Button>
        )
      }
    />
  );
}

import { Theme, type TypographyConfig } from '../theme';
import { Card, StatusBadge } from './card';
import { DataState } from './feedback';
export function TypographySpecimen({
  config = {
    family: 'lora',
    size: 16,
    weight: 500,
    style: 'italic',
    lineHeight: 1.6,
  },
  state = 'ready',
  onRetry,
  title = 'A clearer daily rhythm.',
  text = 'Every resident. Every paper. Every collection, in order.',
}: {
  config?: TypographyConfig;
  state?: 'ready' | 'loading' | 'unavailable';
  onRetry?: () => void;
  title?: string;
  text?: string;
}) {
  if (state !== 'ready')
    return (
      <DataState
        kind={state === 'loading' ? 'loading' : 'error'}
        title={
          state === 'loading'
            ? 'Loading font preview…'
            : 'Font preview unavailable'
        }
        description="Use Inter fallback while retaining your selected font preference."
        onRetry={onRetry}
        retryLabel="Retry font load"
      />
    );
  return (
    <Theme typography={config}>
      <Card className="db-typography-specimen">
        <div className="db-row" style={{ justifyContent: 'space-between' }}>
          <span className="db-eyebrow">Applied type specimen</span>
          <StatusBadge status="Saved" />
        </div>
        <p className="db-specimen-display">{title}</p>
        <p>{text}</p>
        <p style={{ fontSize: 23, marginTop: 16 }}>
          Aa Bb Cc · 0123456789 · ₹661.00
        </p>
        <div className="db-specimen-comparison">
          <span className="db-eyebrow">Default Inter</span>
          <span>Every collection, in order.</span>
        </div>
        <p className="db-field-hint">
          Body specimen: {config.family} / {config.size} px / {config.weight} /{' '}
          {config.style} /{' '}
          {Number((config.size * config.lineHeight).toFixed(1))} px line height
        </p>
      </Card>
    </Theme>
  );
}

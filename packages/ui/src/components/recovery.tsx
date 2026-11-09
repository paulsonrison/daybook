import type { ReactNode } from 'react';
import presets from '../recovery-presets.json';
import type { Tone } from '../tokens';
import { Button } from './button';
import { Notification, TableSkeleton } from './feedback';
export const recoveryPresets = presets;
export type RecoveryId =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '19'
  | '20'
  | '21'
  | '22'
  | '23'
  | '24';
/** Callbacks never perform saves automatically. Pass current server state and draft values. */
export function RecoveryPanel({
  scenario,
  title,
  description,
  children,
  onAction,
  pending = false,
  actionLabels,
}: {
  scenario: RecoveryId;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  onAction?: (action: string) => void;
  pending?: boolean;
  actionLabels?: readonly string[];
}) {
  const preset = presets.find((item) => item.id === scenario)!;
  const tone: Tone = ['success', 'warning', 'error', 'info'].includes(
    preset.tone,
  )
    ? (preset.tone as Tone)
    : 'info';
  return (
    <div
      className="db-stack"
      aria-busy={preset.loading || pending || undefined}
    >
      <Notification
        tone={tone}
        title={title ?? preset.title}
        description={description ?? preset.description}
        action={
          (actionLabels ?? preset.actions).length > 0 && (
            <>
              {(actionLabels ?? preset.actions).map((action, index) => (
                <Button
                  key={action}
                  variant={index === 0 ? 'primary' : 'secondary'}
                  disabled={!onAction || pending || preset.loading}
                  onClick={() => onAction?.(action)}
                >
                  {action}
                </Button>
              ))}
            </>
          )
        }
      />
      {preset.loading && <TableSkeleton label={title ?? preset.title} />}
      {children}
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';
import type { Tone } from '../tokens';
export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span {...props} className={`db-badge db-tone-${tone} ${className}`} />
  );
}
export const badgeTones = {
  Paid: 'success',
  Unpaid: 'warning',
  Overdue: 'error',
  Draft: 'neutral',
  Saved: 'success',
  'On hold': 'warning',
  Active: 'success',
  Partial: 'warning',
  Unknown: 'neutral',
  'Pending sync': 'info',
} as const;
export function StatusBadge({ status }: { status: keyof typeof badgeTones }) {
  return <Badge tone={badgeTones[status]}>{status}</Badge>;
}
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
}
export function Card({
  title,
  description,
  trailing,
  footer,
  children,
  className = '',
  ...props
}: CardProps) {
  return (
    <section {...props} className={`db-card ${className}`}>
      {(title || description || trailing) && (
        <header className="db-card-header">
          <div>
            {title && <h3 className="db-card-title">{title}</h3>}
            {description && (
              <div className="db-card-description">{description}</div>
            )}
          </div>
          {trailing}
        </header>
      )}
      {children}
      {footer && <footer className="db-card-footer">{footer}</footer>}
    </section>
  );
}
export function Avatar({ name, src }: { name: string; src?: string }) {
  return src ? (
    <img className="db-avatar" src={src} alt={name} width={34} height={34} />
  ) : (
    <span className="db-avatar" aria-label={name}>
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase() || '?'}
    </span>
  );
}

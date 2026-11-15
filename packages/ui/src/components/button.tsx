'use client';
import type { ButtonHTMLAttributes } from 'react';
import { useI18n } from '../i18n-context';
import { Icon } from './icon';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  loadingLabel?: string;
};
export function Button({
  variant = 'primary',
  loading = false,
  loadingLabel,
  size = 'medium',
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const { t } = useI18n();
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`db-button db-button--${variant} db-button--${size} ${className}`}
    >
      {loading ? (
        <>
          <Icon name="loader" size={12} className="db-spin" />
          {loadingLabel ?? t('Loading…')}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  ...props
}: Omit<ButtonProps, 'children'> & {
  label: string;
  icon?: import('../assets').IconName;
}) {
  return (
    <Button
      variant="secondary"
      {...props}
      loadingLabel=""
      aria-label={label}
      className={`db-icon-button ${props.className ?? ''}`}
    >
      {icon ? <Icon name={icon} size={24} /> : <span>{label}</span>}
    </Button>
  );
}

export const workflowActions = {
  generate: { label: 'Generate bill', icon: 'bill', variant: 'primary' },
  save: { label: 'Save bill', icon: 'paid', variant: 'primary' },
  edit: { label: 'Edit', icon: 'edit', variant: 'secondary' },
  print: { label: 'Print', icon: 'print', variant: 'secondary' },
  share: { label: 'Download & share', icon: 'download', variant: 'secondary' },
  paid: { label: 'Mark as paid', icon: 'paid', variant: 'primary' },
  next: { label: 'Move to next', icon: 'next', variant: 'primary' },
} as const;
export function WorkflowButton({
  action,
  ...props
}: Omit<ButtonProps, 'children'> & { action: keyof typeof workflowActions }) {
  const { t } = useI18n();
  const selected = workflowActions[action];
  return (
    <Button variant={selected.variant} {...props}>
      <Icon name={selected.icon} size={16} />
      {t(selected.label)}
    </Button>
  );
}

import type { ButtonHTMLAttributes } from 'react';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
};
export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`db-button db-button--${variant} ${className}`}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}

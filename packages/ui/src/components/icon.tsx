import type { CSSProperties, HTMLAttributes } from 'react';
import { iconAssets, type IconName } from '../assets';
export interface IconProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  name?: IconName;
  label?: string;
  size?: number;
  fallback?: string;
}
export function Icon({
  name,
  label,
  size = 32,
  fallback = 'Unavailable',
  style,
  className = '',
  ...props
}: IconProps) {
  const asset = name && iconAssets[name];
  if (!asset)
    return (
      <span {...props} className={`db-icon-fallback ${className}`}>
        {label ?? fallback}
      </span>
    );
  return (
    <span
      {...props}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`db-icon ${className}`}
      style={
        {
          width: size,
          height: size,
          maskImage: `url("${asset}")`,
          WebkitMaskImage: `url("${asset}")`,
          ...style,
        } as CSSProperties
      }
    />
  );
}
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`db-brand-mark ${className}`} aria-hidden="true">
      <img
        className="db-brand-light"
        src={iconAssets.brand}
        width={33}
        height={36}
        alt=""
      />
      <img
        className="db-brand-dark"
        src={iconAssets['brand-dark']}
        width={33}
        height={36}
        alt=""
      />
    </span>
  );
}

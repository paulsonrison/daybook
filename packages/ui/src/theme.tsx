import type { CSSProperties, HTMLAttributes } from 'react';
import {
  colorSchemes,
  fonts,
  type ColorScheme,
  type DisplayMode,
  type FontFamily,
} from './tokens';

export interface TypographyConfig {
  family: FontFamily;
  size: number;
  weight: 400 | 500 | 600 | 700;
  style: 'normal' | 'italic';
  lineHeight: 1.25 | 1.45 | 1.6;
}
export const defaultTypography: TypographyConfig = {
  family: 'inter',
  size: 14,
  weight: 400,
  style: 'normal',
  lineHeight: 1.45,
};
export function typographyVariables(
  config: Partial<TypographyConfig> = {},
): CSSProperties {
  const value = { ...defaultTypography, ...config };
  const size = Number.isFinite(value.size)
    ? Math.min(24, Math.max(12, value.size))
    : 14;
  return {
    '--db-font-family':
      value.family === 'manrope' && value.style === 'italic'
        ? fonts.inter.family
        : (fonts[value.family]?.family ?? fonts.inter.family),
    '--db-reading-size': `${size}px`,
    '--db-reading-weight': value.weight,
    '--db-reading-style': value.style,
    '--db-reading-leading': value.lineHeight,
  } as CSSProperties;
}
export interface ThemeProps extends HTMLAttributes<HTMLDivElement> {
  mode?: DisplayMode;
  scheme?: ColorScheme;
  typography?: Partial<TypographyConfig>;
}
/** Scoped and SSR-safe: applications own persistence and preference loading. */
export function Theme({
  mode = 'light',
  scheme = 'teal',
  typography,
  style,
  className = '',
  ...props
}: ThemeProps) {
  const selected = colorSchemes[scheme];
  return (
    <div
      {...props}
      data-db-mode={mode}
      data-db-scheme={scheme}
      className={`db-theme ${className}`}
      style={
        {
          '--db-scheme-accent': selected.accent,
          '--db-scheme-background': selected.background,
          ...typographyVariables(typography),
          ...style,
        } as CSSProperties
      }
    />
  );
}

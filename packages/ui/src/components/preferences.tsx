'use client';
import {
  colorSchemes,
  fonts,
  lineSpacings,
  readingSizes,
  type ColorScheme,
  type DisplayMode,
  type FontFamily,
} from '../tokens';
import { defaultTypography, type TypographyConfig } from '../theme';
import { Field, Select } from './fields';
import { Notification } from './feedback';
import { validReadingSize } from '../utils';
export function ColorSchemePicker({
  value,
  onChange,
}: {
  value: ColorScheme;
  onChange: (value: ColorScheme) => void;
}) {
  return (
    <div className="db-preference-grid" role="group" aria-label="Color scheme">
      {Object.entries(colorSchemes).map(([key, scheme]) => (
        <button
          key={key}
          type="button"
          className="db-preference-option"
          aria-pressed={value === key}
          onClick={() => onChange(key as ColorScheme)}
        >
          <span
            className="db-theme-preview"
            style={{ background: scheme.background }}
            aria-hidden="true"
          >
            <span style={{ background: scheme.accent }} />
          </span>
          {scheme.name}
        </button>
      ))}
    </div>
  );
}
export function DisplayModePicker({
  value,
  onChange,
}: {
  value: DisplayMode;
  onChange: (value: DisplayMode) => void;
}) {
  return (
    <div className="db-row" role="group" aria-label="Display mode">
      {(['light', 'dark', 'system'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className="db-preference-option"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode[0].toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  );
}
export function TypographyControls({
  value = defaultTypography,
  onChange,
  status = 'ready',
  onRetry,
}: {
  value?: TypographyConfig;
  onChange: (value: TypographyConfig) => void;
  status?: 'ready' | 'loading' | 'unavailable' | 'save-error';
  onRetry?: () => void;
}) {
  const update = (patch: Partial<TypographyConfig>) =>
    onChange({ ...value, ...patch });
  return (
    <div className="db-stack">
      <div className="db-preference-grid" role="group" aria-label="Font family">
        {Object.entries(fonts).map(([key, font]) => (
          <button
            key={key}
            type="button"
            className="db-preference-option"
            aria-pressed={value.family === key}
            style={{ fontFamily: font.family }}
            disabled={status === 'loading'}
            onClick={() => update({ family: key as FontFamily })}
          >
            {font.name}
            {value.family === key && <small>Selected</small>}
          </button>
        ))}
      </div>
      <div className="db-row" role="group" aria-label="Reading size">
        {Object.entries(readingSizes).map(([name, size]) => (
          <button
            key={name}
            type="button"
            className="db-preference-option"
            aria-pressed={value.size === size}
            onClick={() => update({ size })}
          >
            {size} px<small>{name}</small>
          </button>
        ))}
      </div>
      <div className="db-date-range">
        <Field
          label="Custom reading size"
          type="number"
          min={12}
          max={24}
          value={Number.isFinite(value.size) ? value.size : ''}
          onChange={(event) => update({ size: event.target.valueAsNumber })}
          error={
            !validReadingSize(value.size)
              ? 'Enter a supported reading size (12–24 px).'
              : undefined
          }
        />
        <Select
          label="Font weight"
          value={value.weight}
          onChange={(event) =>
            update({
              weight: Number(event.target.value) as TypographyConfig['weight'],
            })
          }
          options={[400, 500, 600, 700].map((weight) => ({
            value: String(weight),
            label: `${weight === 400 ? 'Regular' : weight === 500 ? 'Medium' : weight === 600 ? 'Semibold' : 'Bold'} · ${weight}`,
          }))}
        />
      </div>
      <div className="db-row" role="group" aria-label="Font style">
        {(['normal', 'italic'] as const).map((style) => (
          <button
            key={style}
            className="db-preference-option"
            type="button"
            aria-pressed={value.style === style}
            onClick={() => update({ style })}
          >
            {style === 'normal' ? 'Regular' : 'Italic'}
          </button>
        ))}
      </div>
      <div className="db-row" role="group" aria-label="Line spacing">
        {Object.entries(lineSpacings).map(([name, lineHeight]) => (
          <button
            key={name}
            type="button"
            className="db-preference-option"
            aria-pressed={value.lineHeight === lineHeight}
            onClick={() => update({ lineHeight })}
          >
            {lineHeight}
            <small>{name}</small>
          </button>
        ))}
      </div>
      {status === 'unavailable' && (
        <Notification
          tone="warning"
          title="Font preview unavailable"
          description="Use Inter fallback while retaining your selected font preference."
          action={
            onRetry && (
              <button
                type="button"
                className="db-button db-button--secondary"
                onClick={onRetry}
              >
                Retry font load
              </button>
            )
          }
        />
      )}
      {value.family === 'manrope' && value.style === 'italic' && (
        <Notification
          title="Italic preview uses Inter"
          description="Manrope has no bundled italic face. Your selected font preference is retained."
        />
      )}
      {status === 'save-error' && (
        <Notification
          tone="error"
          title="Preferences were not saved"
          description="Preview kept. Retry saving without discarding your selection."
        />
      )}
      {status === 'loading' && <p role="status">Loading font preview…</p>}
    </div>
  );
}

'use client';
import {
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { SaveState } from '../tokens';
import { useI18n } from '../i18n-context';
import { Button } from './button';
import { Icon } from './icon';
export interface FieldDetails {
  label: string;
  hint?: ReactNode;
  error?: string;
  loading?: boolean;
}
function Details({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <>
      {hint && (
        <span id={`${id}-hint`} className="db-field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="db-field-error">
          {error}
        </span>
      )}
    </>
  );
}
function describedBy(
  id: string,
  hint: ReactNode,
  error?: string,
  extra?: string,
) {
  return (
    [hint && `${id}-hint`, error && `${id}-error`, extra]
      .filter(Boolean)
      .join(' ') || undefined
  );
}
export interface FieldProps
  extends InputHTMLAttributes<HTMLInputElement>, FieldDetails {}
export function Field({
  label,
  hint,
  error,
  loading = false,
  id: providedId,
  className = '',
  ...props
}: FieldProps) {
  const { t } = useI18n();
  const generated = useId();
  const id = providedId ?? generated;
  return (
    <div className="db-field">
      <label className="db-field-label" htmlFor={id}>
        {label}
        {props.required && ' *'}
      </label>
      <div className="db-input-wrap">
        <input
          {...props}
          id={id}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-busy={loading || undefined}
          aria-describedby={describedBy(
            id,
            hint,
            error,
            props['aria-describedby'],
          )}
          className={`db-input ${loading || error ? 'db-input-with-action' : ''} ${className}`}
        />
        {loading && (
          <span className="db-input-action" role="status">
            <Icon name="loader" size={12} className="db-spin" />
            <span className="db-sr-only">{t('Loading saved value…')}</span>
          </span>
        )}
        {error && !loading && (
          <span className="db-input-action">
            <Icon name="error" size={12} />
          </span>
        )}
      </div>
      <Details id={id} hint={hint} error={error} />
    </div>
  );
}
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement>, FieldDetails {
  options: readonly SelectOption[];
  placeholder?: string;
  state?: 'ready' | 'loading' | 'empty' | 'no-results' | 'error';
  onRetry?: () => void;
}
export function Select({
  label,
  hint,
  error,
  loading = false,
  options,
  placeholder,
  state = 'ready',
  onRetry,
  id: providedId,
  className = '',
  disabled,
  ...props
}: SelectProps) {
  const { t } = useI18n();
  const generated = useId();
  const id = providedId ?? generated;
  const pending = loading || state === 'loading';
  const message =
    state === 'error'
      ? t('Couldn’t load options. Your selection is preserved.')
      : state === 'empty'
        ? t('No options are available.')
        : state === 'no-results'
          ? t('No matches. Change your search or clear filters.')
          : pending
            ? t('Loading options…')
            : undefined;
  const hasCurrentValue =
    props.value !== undefined &&
    props.value !== '' &&
    !options.some((option) => option.value === String(props.value));
  const details = message ?? hint;
  return (
    <div className="db-field">
      <label className="db-field-label" htmlFor={id}>
        {label}
        {props.required && ' *'}
      </label>
      <div className="db-input-wrap">
        <select
          {...props}
          id={id}
          className={`db-input db-select ${error ? 'db-select-error' : ''} ${className}`}
          disabled={disabled || pending || state === 'empty'}
          aria-busy={pending || undefined}
          aria-invalid={Boolean(error) || state === 'error' || undefined}
          aria-describedby={describedBy(
            id,
            details,
            error,
            props['aria-describedby'],
          )}
        >
          <option value="">{placeholder ?? t('Select an option')}</option>
          {hasCurrentValue && (
            <option value={String(props.value)}>
              {t('{value} · unavailable', { value: String(props.value) })}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <span className="db-select-indicators">
          {pending ? (
            <Icon name="loader" size={12} className="db-spin" />
          ) : (
            <Icon name="chevron-down" size={12} />
          )}{' '}
          {error && <Icon name="error" size={12} />}
        </span>
      </div>
      <Details id={id} hint={details} error={error} />
      {state === 'error' && onRetry && (
        <div>
          <Button variant="secondary" size="small" onClick={onRetry}>
            {t('Retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
export interface SearchFieldProps extends Omit<
  FieldProps,
  'type' | 'value' | 'onChange' | 'results' | 'onSelect'
> {
  value: string;
  onValueChange: (value: string) => void;
  results?: readonly SelectOption[];
  state?: 'ready' | 'loading' | 'no-results' | 'error';
  onSelect?: (option: SelectOption) => void;
  onRetry?: () => void;
}
export function SearchField({
  label,
  value,
  onValueChange,
  results,
  state = 'ready',
  onSelect,
  onRetry,
  hint,
  error,
  id: providedId,
  className = '',
  ...props
}: SearchFieldProps) {
  const { t } = useI18n();
  const generated = useId();
  const id = providedId ?? generated;
  const message =
    state === 'loading'
      ? t('Loading options…')
      : state === 'error'
        ? t('Couldn’t load results. Your query is preserved.')
        : state === 'no-results'
          ? t('No matches. Change your search or clear filters.')
          : hint;
  return (
    <div className="db-field">
      <label className="db-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="db-input-wrap">
        <span className="db-input-icon" aria-hidden="true">
          <Icon name="search" size={12} />
        </span>
        <input
          {...props}
          id={id}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className={`db-input db-input-with-icon db-input-with-action ${className}`}
          aria-invalid={Boolean(error) || state === 'error' || undefined}
          aria-busy={state === 'loading' || undefined}
          aria-describedby={describedBy(
            id,
            message,
            error,
            props['aria-describedby'],
          )}
        />
        <span className="db-input-action">
          {state === 'loading' ? (
            <Icon name="loader" className="db-spin" size={12} />
          ) : (
            value && (
              <button
                className="db-dismiss"
                type="button"
                aria-label={t('Clear search')}
                disabled={props.disabled}
                onClick={() => onValueChange('')}
              >
                <Icon name="close" size={12} />
              </button>
            )
          )}
        </span>
      </div>
      <Details id={id} hint={message} error={error} />
      {state === 'ready' && results && results.length > 0 && (
        <div
          className="db-options"
          role="group"
          aria-label={t('{label} results', { label })}
        >
          {results.map((option) => (
            <button
              key={option.value}
              type="button"
              className="db-option"
              disabled={option.disabled || props.disabled}
              onClick={() => onSelect?.(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {state === 'error' && onRetry && (
        <div>
          <Button variant="secondary" size="small" onClick={onRetry}>
            {t('Retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
export interface ChoiceProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  label: string;
  hint?: string;
  error?: string;
  saveState?: SaveState;
}
function Choice({
  label,
  hint,
  error,
  saveState = 'idle',
  type = 'checkbox',
  indeterminate = false,
  switchControl = false,
  id: providedId,
  className = '',
  disabled,
  ...props
}: ChoiceProps & {
  type?: 'checkbox' | 'radio';
  indeterminate?: boolean;
  switchControl?: boolean;
}) {
  const { t } = useI18n();
  const generated = useId();
  const id = providedId ?? generated;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const pending = saveState === 'saving';
  const message = pending
    ? t('Saving selection…')
    : saveState === 'error'
      ? t('Couldn’t save. Retry remains available.')
      : hint;
  return (
    <div className="db-field">
      <label
        className={`db-choice ${className}`}
        data-disabled={disabled || pending || undefined}
        htmlFor={id}
      >
        <input
          {...props}
          ref={ref}
          id={id}
          type={type}
          role={switchControl ? 'switch' : undefined}
          aria-checked={indeterminate ? 'mixed' : undefined}
          disabled={disabled || pending}
          aria-busy={pending || undefined}
          aria-invalid={Boolean(error) || saveState === 'error' || undefined}
          aria-describedby={describedBy(
            id,
            message,
            error,
            props['aria-describedby'],
          )}
        />
        <span>{label}</span>
        {pending && <Icon name="loader" size={12} className="db-spin" />}
      </label>
      <Details id={id} hint={message} error={error} />
    </div>
  );
}
export function Checkbox(props: ChoiceProps & { indeterminate?: boolean }) {
  return <Choice {...props} />;
}
export function Radio(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}
export function Toggle(props: ChoiceProps) {
  return <Choice {...props} switchControl />;
}

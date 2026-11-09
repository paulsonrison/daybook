'use client';
import { useId } from 'react';
import { validateDateRange } from '../utils';
import { Field } from './fields';
export function DateRange({
  from,
  to,
  onChange,
  latestAllowedDate,
  loading = false,
  unavailable = false,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  latestAllowedDate?: string;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const id = useId();
  const error = validateDateRange(from, to, latestAllowedDate);
  return (
    <fieldset
      style={{ border: 0, padding: 0, margin: 0 }}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="db-sr-only">Billing period</legend>
      <div className="db-date-range">
        <Field
          label="From date"
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.target.value, to })}
          disabled={loading || unavailable}
          max={latestAllowedDate}
          aria-invalid={Boolean(error) || undefined}
        />
        <Field
          label="To date"
          type="date"
          value={to}
          onChange={(event) => onChange({ from, to: event.target.value })}
          disabled={loading || unavailable}
          max={latestAllowedDate}
          aria-invalid={Boolean(error) || undefined}
        />
      </div>
      {error && (
        <p className="db-field-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="db-field-hint">
          Loading available periods…
        </p>
      )}
      {unavailable && (
        <p role="status" className="db-field-hint">
          No billing periods are available for this agency.
        </p>
      )}
    </fieldset>
  );
}

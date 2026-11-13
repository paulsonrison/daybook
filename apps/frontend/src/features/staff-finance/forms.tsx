'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Checkbox, Field, Select } from '@daybook/ui';
import type { Operation, PaymentsStore } from '../payments/store';
export type FormField = {
  key: string;
  label: string;
  type?: string;
  value?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  hint?: string;
};
/** Financial submissions use the shared agency-scoped original-request recovery. */
export const FinanceForm = observer(function FinanceForm({
  store,
  operation,
  fields,
  label,
  base = {},
  disabled = false,
}: {
  store: PaymentsStore;
  operation: Operation;
  fields: FormField[];
  label: string;
  base?: Record<string, unknown>;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({}),
    [completed, setCompleted] = useState(false),
    [requestId, setRequestId] = useState('');
  const completedRequestId = store.lastCompletedRequestId;
  useEffect(() => {
    if (requestId && completedRequestId === requestId) setCompleted(true);
  }, [requestId, completedRequestId]);
  const value = (f: FormField) =>
    values[f.key] ?? (f.type === 'checkbox' ? false : (f.value ?? ''));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const input: Record<string, unknown> = {
      ...base,
      requestId: crypto.randomUUID(),
    };
    setRequestId(String(input.requestId));
    for (const f of fields) {
      const v = value(f);
      if (v !== '' || !f.optional) input[f.key] = v;
    }
    if (await store.execute(operation, input, '')) {
      setCompleted(true);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <fieldset
        className="db-stack"
        style={{ border: 0, padding: 0 }}
        disabled={disabled || completed}
      >
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <Checkbox
              key={f.key}
              label={f.label}
              checked={Boolean(value(f))}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.checked }))
              }
            />
          ) : f.options ? (
            <Select
              key={f.key}
              label={f.label}
              value={String(value(f))}
              options={f.options}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          ) : (
            <Field
              key={f.key}
              label={f.label}
              type={f.type ?? 'text'}
              hint={f.hint}
              required={!f.optional}
              value={String(value(f))}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          ),
        )}
        <Button type="submit" loading={store.busy}>
          {label}
        </Button>
      </fieldset>
      {completed && (
        <Button
          type="button"
          onClick={() => {
            setCompleted(false);
            setValues({});
          }}
        >
          New entry
        </Button>
      )}
    </form>
  );
});

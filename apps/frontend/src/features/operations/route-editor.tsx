'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Checkbox, Field, Select } from '@daybook/ui';
import { Editor } from './editors';
import type { OperationsStore, Route, Stop } from './store';
type DraftStop = Stop & { key: string };
export const RouteEditor = observer(function RouteEditor({
  record,
  store,
  onClose,
}: {
  record: Route | null;
  store: OperationsStore;
  onClose: (saved?: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    code: record?.code ?? '',
    name: record?.name ?? '',
    territoryId: record?.territoryId ?? '',
    staffId: record?.staffId ?? '',
    active: record?.active ?? true,
  });
  const [stops, setStops] = useState<DraftStop[]>(
    () => record?.stops.map((s) => ({ ...s, key: s.id! })) ?? [],
  );
  function changeStop(key: string, field: 'label' | 'door', value: string) {
    setStops((rows) =>
      rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }
  function move(index: number, direction: number) {
    setStops((rows) => {
      const copy = [...rows];
      const next = index + direction;
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy.map((s, i) => ({ ...s, sequence: i + 1 }));
    });
  }
  return (
    <Editor
      title={record ? 'Edit route' : 'Add route'}
      label="Save route"
      store={store}
      onClose={() => onClose()}
      onSave={async () => {
        const input = {
          id: record?.id,
          version: record?.version,
          ...draft,
          staffId: draft.staffId || null,
          stops: stops.map(({ id, label, door }, i) => ({
            id,
            label,
            door,
            sequence: i + 1,
          })),
        };
        if (await store.save('route', input)) onClose(true);
      }}
    >
      <div className="agency-form-grid">
        <Field
          label="Route code"
          value={draft.code}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
          required
          maxLength={32}
        />
        <Field
          label="Route name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          required
          maxLength={120}
        />
      </div>
      <Select
        label="Territory"
        value={draft.territoryId}
        onChange={(e) =>
          setDraft((d) => ({ ...d, territoryId: e.target.value }))
        }
        required
        state={store.territories.length ? 'ready' : 'empty'}
        options={store.territories
          .filter((t) => t.active || t.id === draft.territoryId)
          .map((t) => ({ value: t.id, label: t.name }))}
        hint="Create an active territory in Settings first."
      />
      <Select
        label="Assigned staff"
        value={draft.staffId}
        onChange={(e) => setDraft((d) => ({ ...d, staffId: e.target.value }))}
        options={[
          { value: '', label: 'Unassigned' },
          ...store.staff
            .filter((s) => s.status === 'ACTIVE' || s.id === draft.staffId)
            .map((s) => ({ value: s.id, label: s.name })),
        ]}
        hint="Unassigned routes need a staff member before dispatch."
      />
      <Checkbox
        label="Active route"
        checked={draft.active}
        onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
      />
      <h3>Door-to-door sequence</h3>
      {stops.map((stop, index) => (
        <div className="agency-stop-editor" key={stop.key}>
          <div className="agency-form-grid">
            <Field
              label={`Delivery point ${index + 1}`}
              value={stop.label}
              onChange={(e) => changeStop(stop.key, 'label', e.target.value)}
              required
              maxLength={160}
            />
            <Field
              label={`Door / address ${index + 1}`}
              value={stop.door}
              onChange={(e) => changeStop(stop.key, 'door', e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="db-row">
            <Button
              variant="tertiary"
              size="small"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              Move up
            </Button>
            <Button
              variant="tertiary"
              size="small"
              disabled={index === stops.length - 1}
              onClick={() => move(index, 1)}
            >
              Move down
            </Button>
            <Button
              variant="tertiary"
              size="small"
              onClick={() =>
                setStops((rows) => rows.filter((r) => r.key !== stop.key))
              }
            >
              Remove point {index + 1}
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={() =>
          setStops((rows) => [
            ...rows,
            {
              key: crypto.randomUUID(),
              label: '',
              door: '',
              sequence: rows.length + 1,
            },
          ])
        }
      >
        Add delivery point
      </Button>
    </Editor>
  );
});

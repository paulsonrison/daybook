'use client';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Notification,
  Select,
} from '@daybook/ui';
import type { OperationsStore, Staff, Territory } from './store';

export const Editor = observer(function Editor({
  title,
  label,
  store,
  onClose,
  onSave,
  children,
}: {
  title: string;
  label: string;
  store: OperationsStore;
  onClose: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      busy={store.saving}
      footer={
        <div className="db-row">
          <Button variant="secondary" disabled={store.saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={id} loading={store.saving}>
            {label}
          </Button>
        </div>
      }
    >
      <form
        id={id}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSave();
        }}
        className="agency-editor"
      >
        {store.saveError && (
          <Notification
            tone="error"
            title="Changes were not saved"
            description={store.saveError}
          />
        )}
        <fieldset disabled={store.saving}>{children}</fieldset>
      </form>
    </Dialog>
  );
});
export const TerritoryEditor = observer(function TerritoryEditor({
  record,
  store,
  onClose,
}: {
  record: Territory | null;
  store: OperationsStore;
  onClose: (saved?: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    name: record?.name ?? '',
    locality: record?.locality ?? '',
    pins: record?.pinCodes.join(', ') ?? '',
    sectors: record?.sectors.join(', ') ?? '',
    active: record?.active ?? true,
    overlapReason: '',
  });
  const change = (key: keyof typeof draft, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Editor
      title={record ? 'Edit territory' : 'Add territory'}
      label="Save territory"
      store={store}
      onClose={() => onClose()}
      onSave={async () => {
        const saved = await store.save('territory', {
          id: record?.id,
          version: record?.version,
          name: draft.name,
          locality: draft.locality,
          pinCodes: draft.pins
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          sectors: draft.sectors
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          active: draft.active,
          overlapReason: draft.overlapReason || undefined,
        });
        if (saved) onClose(true);
      }}
    >
      <Field
        label="Territory name"
        value={draft.name}
        onChange={(e) => change('name', e.target.value)}
        required
        maxLength={120}
      />
      <Field
        label="Locality"
        value={draft.locality}
        onChange={(e) => change('locality', e.target.value)}
        required
        maxLength={120}
      />
      <Field
        label="PIN codes"
        value={draft.pins}
        onChange={(e) => change('pins', e.target.value)}
        hint="Separate six-digit PIN codes with commas."
        required
      />
      <Field
        label="Sector boundaries"
        value={draft.sectors}
        onChange={(e) => change('sectors', e.target.value)}
        hint="Separate streets or sectors with commas."
        required
      />
      <Field
        label="Overlap authorization reason"
        value={draft.overlapReason}
        onChange={(e) => change('overlapReason', e.target.value)}
        hint="Only enter a reason when you deliberately authorize a shared boundary."
        maxLength={500}
      />
      <Checkbox
        label="Active territory"
        checked={draft.active}
        onChange={(e) => change('active', e.target.checked)}
      />
    </Editor>
  );
});
export const StaffEditor = observer(function StaffEditor({
  record,
  store,
  onClose,
}: {
  record: Staff | null;
  store: OperationsStore;
  onClose: (saved?: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    name: record?.name ?? '',
    staffCode: record?.staffCode ?? '',
    phone: record?.phone ?? '',
    status: record?.status ?? 'ACTIVE',
  });
  return (
    <Editor
      title={record ? 'Edit staff' : 'Add staff'}
      label="Save staff"
      store={store}
      onClose={() => onClose()}
      onSave={async () => {
        if (
          await store.save('staff', {
            id: record?.id,
            version: record?.version,
            ...draft,
          })
        )
          onClose(true);
      }}
    >
      <Field
        label="Staff name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        required
        maxLength={120}
      />
      <Field
        label="Staff ID"
        value={draft.staffCode}
        onChange={(e) => setDraft((d) => ({ ...d, staffCode: e.target.value }))}
        required
        maxLength={40}
      />
      <Field
        label="Phone"
        value={draft.phone}
        onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
        required
        type="tel"
        hint="A ten-digit Indian number or an international number with country code."
        maxLength={30}
      />
      <Select
        label="Status"
        value={draft.status}
        onChange={(e) =>
          setDraft((d) => ({ ...d, status: e.target.value as Staff['status'] }))
        }
        options={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'ON_LEAVE', label: 'On leave' },
          { value: 'INACTIVE', label: 'Inactive' },
        ]}
      />
    </Editor>
  );
});

'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Checkbox, Field, Select } from '@daybook/ui';
import { Editor } from '../operations/editors';
import {
  type Assignment,
  type Complaint,
  type Delivery,
  type DeliveryStore,
  type Holiday,
} from './store';
export const ComplaintEditor = observer(function ComplaintEditor({
  delivery,
  complaint,
  store,
  onClose,
}: {
  delivery?: Delivery;
  complaint?: Complaint;
  store: DeliveryStore;
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [kind, setKind] = useState(
      delivery?.status === 'DAMAGED' ? 'DAMAGED' : 'MISSED',
    ),
    [note, setNote] = useState(''),
    [resolution, setResolution] = useState('REPLACEMENT'),
    [rating, setRating] = useState('');
  return (
    <Editor
      title={complaint ? 'Resolve complaint' : 'Log complaint'}
      label={complaint ? 'Save resolution' : 'Save complaint'}
      store={store}
      onClose={onClose}
      onSave={async () => {
        const saved = complaint
          ? await store.save('resolution', {
              id: complaint.id,
              version: complaint.version,
              requestId,
              resolution,
              rating: rating ? Number(rating) : undefined,
              note,
            })
          : await store.save('complaint', {
              deliveryId: delivery!.id,
              requestId,
              kind,
              note,
            });
        if (saved) onClose();
      }}
    >
      {complaint ? (
        <>
          <Select
            label="Resolution"
            value={resolution}
            options={[
              { value: 'REPLACEMENT', label: 'Replacement dispatched' },
              { value: 'CREDIT', label: 'Approve billing credit' },
              { value: 'UNSUBSTANTIATED', label: 'Unsubstantiated' },
            ]}
            onChange={(e) => setResolution(e.target.value)}
          />
          <Field
            label="Resolution note"
            required
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Select
            label="Resident feedback"
            value={rating}
            options={[
              { value: '', label: 'No rating recorded' },
              ...['1', '2', '3', '4', '5'].map((value) => ({
                value,
                label: `${value} / 5`,
              })),
            ]}
            onChange={(e) => setRating(e.target.value)}
          />
        </>
      ) : (
        <>
          <Select
            label="Complaint type"
            value={kind}
            options={[
              { value: 'MISSED', label: 'Missed paper' },
              { value: 'DAMAGED', label: 'Wet or damaged paper' },
              { value: 'LATE', label: 'Late delivery' },
            ]}
            onChange={(e) => setKind(e.target.value)}
          />
          <Field
            label="Complaint details"
            required
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
    </Editor>
  );
});
export const OverrideEditor = observer(function OverrideEditor({
  delivery,
  store,
  onClose,
}: {
  delivery: Delivery;
  store: DeliveryStore;
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [reason, setReason] = useState('');
  return (
    <Editor
      title="Flag damaged delivery"
      label="Save delivery exception"
      store={store}
      onClose={onClose}
      onSave={async () => {
        if (
          await store.save('override', {
            id: delivery.id,
            version: delivery.version,
            status: 'DAMAGED',
            reason,
            requestId,
          })
        )
          onClose();
      }}
    >
      <Field
        label="Exception reason"
        required
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Editor>
  );
});
export const SubstituteEditor = observer(function SubstituteEditor({
  record,
  store,
  onClose,
}: {
  record: Assignment | null;
  store: DeliveryStore;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    routeId: record?.routeId ?? '',
    startDate: record?.startDate ?? store.date,
    endDate: record?.endDate ?? store.date,
    reason: record?.reason ?? '',
    active: record?.active ?? true,
    allocations: record?.allocations.map((a) => ({ ...a })) ?? [
      { staffId: '', fromDrop: 1, toDrop: 99999 },
    ],
  });
  return (
    <Editor
      title={record ? 'Edit temporary assignment' : 'Assign substitute staff'}
      label="Save temporary assignment"
      store={store}
      onClose={onClose}
      onSave={async () => {
        if (
          await store.save('substitute', {
            ...draft,
            id: record?.id,
            version: record?.version,
          })
        )
          onClose();
      }}
    >
      <Select
        label="Delivery route"
        required
        value={draft.routeId}
        options={[
          { value: '', label: 'Choose route' },
          ...store.routes
            .filter((r) => r.active || r.id === draft.routeId)
            .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
        ]}
        onChange={(e) => setDraft((d) => ({ ...d, routeId: e.target.value }))}
      />
      <Field
        label="Absence start"
        type="date"
        required
        value={draft.startDate}
        onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
      />
      <Field
        label="Absence end"
        type="date"
        required
        value={draft.endDate}
        onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
      />
      <Field
        label="Absence reason"
        required
        maxLength={500}
        value={draft.reason}
        onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
      />
      <p className="db-muted">
        Transfer all drops to one substitute, or split consecutive ranges. The
        final range ends at 99999 so new delivery points remain covered.
      </p>
      {draft.allocations.map((a, index) => (
        <div className="agency-stop-editor" key={index}>
          <Select
            label={`Substitute staff ${index + 1}`}
            required
            value={a.staffId}
            options={[
              { value: '', label: 'Choose staff' },
              ...store.staff
                .filter((s) => s.status === 'ACTIVE' || s.id === a.staffId)
                .map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                allocations: d.allocations.map((v, i) =>
                  i === index ? { ...v, staffId: e.target.value } : v,
                ),
              }))
            }
          />
          <Field
            label={`From drop ${index + 1}`}
            type="number"
            min={1}
            max={99999}
            required
            value={a.fromDrop}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                allocations: d.allocations.map((v, i) =>
                  i === index ? { ...v, fromDrop: Number(e.target.value) } : v,
                ),
              }))
            }
          />
          <Field
            label={`Through drop ${index + 1}`}
            type="number"
            min={1}
            max={99999}
            required
            value={a.toDrop}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                allocations: d.allocations.map((v, i) =>
                  i === index ? { ...v, toDrop: Number(e.target.value) } : v,
                ),
              }))
            }
          />
          {draft.allocations.length > 1 && (
            <Button
              variant="tertiary"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  allocations: d.allocations.filter((_, i) => i !== index),
                }))
              }
            >
              Remove allocation {index + 1}
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={draft.allocations.length >= 100}
        onClick={() =>
          setDraft((d) => {
            const allocations = d.allocations.map((a) => ({ ...a })),
              last = allocations[allocations.length - 1];
            if (last.fromDrop >= 99999) return d;
            last.toDrop = last.fromDrop;
            return {
              ...d,
              allocations: [
                ...allocations,
                { staffId: '', fromDrop: last.toDrop + 1, toDrop: 99999 },
              ],
            };
          })
        }
      >
        Split route
      </Button>
      <Checkbox
        label="Temporary assignment active"
        checked={draft.active}
        onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
      />
    </Editor>
  );
});
export const HolidayEditor = observer(function HolidayEditor({
  record,
  store,
  onClose,
}: {
  record: Holiday | null;
  store: DeliveryStore;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    publicationId: record?.publicationId ?? '',
    date: record?.date ?? store.date,
    reason: record?.reason ?? '',
    active: record?.active ?? true,
  });
  return (
    <Editor
      title={record ? 'Edit press holiday' : 'Add press holiday'}
      label="Save press holiday"
      store={store}
      onClose={onClose}
      onSave={async () => {
        if (
          await store.save('holiday', {
            ...draft,
            id: record?.id,
            version: record?.version,
          })
        )
          onClose();
      }}
    >
      <Select
        label="Publication"
        required
        value={draft.publicationId}
        options={[
          { value: '', label: 'Choose publication' },
          ...store.publications.map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.edition}`,
          })),
        ]}
        onChange={(e) =>
          setDraft((d) => ({ ...d, publicationId: e.target.value }))
        }
      />
      <Field
        label="Non-printing date"
        required
        type="date"
        value={draft.date}
        onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
      />
      <Field
        label="Press holiday reason"
        required
        maxLength={500}
        value={draft.reason}
        onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
      />
      <Checkbox
        label="Press holiday active"
        checked={draft.active}
        onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
      />
    </Editor>
  );
});

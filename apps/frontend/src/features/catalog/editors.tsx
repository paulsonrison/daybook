'use client';
import { useState } from 'react';
import { useI18n } from '@daybook/ui/i18n';
import { observer } from 'mobx-react-lite';
import { Checkbox, Field, Select } from '@daybook/ui';
import { Editor } from '../operations/editors';
import { type CatalogStore, type Publication, type Resident } from './store';
const days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const publicationKinds: Record<string, string> = {
  NEWSPAPER: 'Newspaper',
  MAGAZINE: 'Magazine',
  PERIODICAL: 'Periodical',
  SUPPLEMENT: 'Supplement',
};
const options = (
  values: string[],
  translate: (value: string) => string = (value) => value,
) =>
  values.map((value) => ({
    value,
    label: translate(
      publicationKinds[value] ?? value.charAt(0) + value.slice(1).toLowerCase(),
    ),
  }));
export const PublicationEditor = observer(function PublicationEditor({
  record,
  store,
  onClose,
}: {
  record: Publication | null;
  store: CatalogStore;
  onClose: (saved?: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({
    name: record?.name ?? '',
    edition: record?.edition ?? '',
    kind: record?.kind ?? 'NEWSPAPER',
    language: record?.language ?? 'English',
    dispatch: record?.dispatch ?? 'MORNING',
    frequency: record?.frequency ?? 'DAILY',
    publishingDays: record?.publishingDays ?? [0, 1, 2, 3, 4, 5, 6],
    anchorDate: record?.anchorDate ?? '',
    weekdayPrice: record?.weekdayPrice ?? '0.00',
    weekendPrice: record?.weekendPrice ?? '0.00',
    procurementNetCost: record?.procurementNetCost ?? '',
    active: record?.active ?? true,
  });
  const change = (
    key: keyof typeof draft,
    value: string | boolean | number[],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Editor
      title={t(record ? 'Edit publication' : 'Add publication')}
      label={t('Save publication')}
      store={store}
      onClose={() => onClose()}
      onSave={async () => {
        if (
          await store.save('publication', {
            ...draft,
            id: record?.id,
            version: record?.version,
            anchorDate: draft.anchorDate || null,
            procurementNetCost: draft.procurementNetCost || null,
          })
        )
          onClose(true);
      }}
    >
      <Field
        label={t('Publication name')}
        required
        maxLength={120}
        value={draft.name}
        onChange={(e) => change('name', e.target.value)}
      />
      <Field
        label={t('Edition')}
        required
        maxLength={100}
        value={draft.edition}
        onChange={(e) => change('edition', e.target.value)}
      />
      <Select
        label={t('Publication type')}
        value={draft.kind}
        options={options(
          ['NEWSPAPER', 'MAGAZINE', 'PERIODICAL', 'SUPPLEMENT'],
          t,
        )}
        onChange={(e) => change('kind', e.target.value)}
      />
      <Field
        label={t('Language')}
        required
        maxLength={40}
        value={draft.language}
        onChange={(e) => change('language', e.target.value)}
      />
      <Select
        label={t('Dispatch')}
        value={draft.dispatch}
        options={options(['MORNING', 'EVENING'], t)}
        onChange={(e) => change('dispatch', e.target.value)}
      />
      <Select
        label={t('Publishing frequency')}
        value={draft.frequency}
        options={options(
          ['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'YEARLY'],
          t,
        )}
        onChange={(e) => change('frequency', e.target.value)}
      />
      <div role="group" aria-label={t('Publishing weekdays')}>
        {days.map((day, index) => (
          <Checkbox
            key={day}
            label={t(day)}
            checked={draft.publishingDays.includes(index)}
            onChange={(e) =>
              change(
                'publishingDays',
                e.target.checked
                  ? [...draft.publishingDays, index]
                  : draft.publishingDays.filter((d) => d !== index),
              )
            }
          />
        ))}
      </div>
      {['FORTNIGHTLY', 'MONTHLY', 'YEARLY'].includes(draft.frequency) && (
        <Field
          label={t('Anchor issue date')}
          type="date"
          required
          value={draft.anchorDate}
          onChange={(e) => change('anchorDate', e.target.value)}
        />
      )}
      <Field
        label={t('Weekday price')}
        inputMode="decimal"
        required
        value={draft.weekdayPrice}
        onChange={(e) => change('weekdayPrice', e.target.value)}
      />
      <Field
        label={t('Weekend price')}
        inputMode="decimal"
        required
        value={draft.weekendPrice}
        onChange={(e) => change('weekendPrice', e.target.value)}
      />
      <Field
        label={t('Procurement net cost')}
        inputMode="decimal"
        hint={t(
          'Cost per copy after publisher margin. Leave blank if unknown.',
        )}
        value={draft.procurementNetCost}
        onChange={(e) => change('procurementNetCost', e.target.value)}
      />
      <Checkbox
        label={t('Active publication')}
        checked={draft.active}
        onChange={(e) => change('active', e.target.checked)}
      />
    </Editor>
  );
});
export const ResidentEditor = observer(function ResidentEditor({
  record,
  store,
  onClose,
}: {
  record: Resident | null;
  store: CatalogStore;
  onClose: (saved?: boolean) => void;
}) {
  const { t } = useI18n();
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({
    name: record?.name ?? '',
    address: record?.address ?? '',
    phone: record?.phone ?? '',
    routeId: record?.routeId ?? '',
    sector: record?.sector ?? '',
    dropOrder: String(record?.dropOrder ?? 1),
    openingDeposit: '0.00',
    status: record?.status ?? 'ACTIVE',
    stopId: '',
  });
  const route = store.routes.find((r) => r.id === draft.routeId);
  const sectors =
    store.territories.find((t) => t.id === route?.territoryId)?.sectors ?? [];
  const change = (key: keyof typeof draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Editor
      title={t(record ? 'Edit resident' : 'Add resident')}
      label={t('Save resident')}
      store={store}
      onClose={() => onClose()}
      onSave={async () => {
        if (
          await store.save('resident', {
            ...draft,
            stopId: draft.stopId || undefined,
            id: record?.id,
            version: record?.version,
            requestId: record ? undefined : requestId,
            dropOrder: Number(draft.dropOrder),
            openingDeposit: record ? undefined : draft.openingDeposit,
          })
        )
          onClose(true);
      }}
    >
      <Field
        label={t('Resident name')}
        required
        maxLength={120}
        value={draft.name}
        onChange={(e) => change('name', e.target.value)}
      />
      <Field
        label={t('Delivery address')}
        required
        maxLength={240}
        value={draft.address}
        onChange={(e) => change('address', e.target.value)}
      />
      <Field
        label={t('Phone')}
        type="tel"
        required
        maxLength={30}
        value={draft.phone}
        onChange={(e) => change('phone', e.target.value)}
      />
      <Select
        label={t('Delivery route')}
        required
        value={draft.routeId}
        options={[
          { value: '', label: t('Choose route') },
          ...store.routes
            .filter((r) => r.active || r.id === record?.routeId)
            .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
        ]}
        onChange={(e) => {
          const selected = store.routes.find((r) => r.id === e.target.value);
          setDraft((d) => ({
            ...d,
            routeId: e.target.value,
            sector: '',
            stopId: '',
            dropOrder: String(
              record && selected?.id === record.routeId
                ? record.dropOrder
                : Math.max(
                    0,
                    ...(selected?.stops.map((s) => s.sequence) ?? []),
                  ) + 1,
            ),
          }));
        }}
      />
      <Select
        label={t('Sector')}
        required
        value={draft.sector}
        options={[
          { value: '', label: t('Choose sector') },
          ...sectors.map((value) => ({ value, label: value })),
        ]}
        onChange={(e) => change('sector', e.target.value)}
      />
      <Field
        label={t('Drop position')}
        type="number"
        min={1}
        max={99999}
        required
        readOnly={Boolean(draft.stopId)}
        value={draft.dropOrder}
        onChange={(e) => change('dropOrder', e.target.value)}
      />
      {!record && route && (
        <Select
          label={t('Existing delivery point')}
          value={draft.stopId}
          options={[
            { value: '', label: t('Create a new delivery point') },
            ...route.stops
              .filter((stop) => !stop.residentId && stop.id)
              .map((stop) => ({
                value: stop.id!,
                label: `${stop.sequence} · ${stop.label} · ${stop.door}`,
              })),
          ]}
          onChange={(e) => {
            const stop = route.stops.find((s) => s.id === e.target.value);
            setDraft((d) => ({
              ...d,
              stopId: e.target.value,
              dropOrder: String(
                stop?.sequence ??
                  Math.max(0, ...route.stops.map((s) => s.sequence)) + 1,
              ),
            }));
          }}
        />
      )}
      {!record && (
        <Field
          label={t('Opening deposit')}
          inputMode="decimal"
          required
          hint={t('Refundable cash deposit received with this registration.')}
          value={draft.openingDeposit}
          onChange={(e) => change('openingDeposit', e.target.value)}
        />
      )}
      <Select
        label={t('Resident status')}
        value={draft.status}
        options={
          record?.status === 'SUSPENDED'
            ? [
                ...options(['ACTIVE', 'INACTIVE'], t),
                {
                  value: 'SUSPENDED',
                  label: t('Suspended (credit hold)'),
                  disabled: true,
                },
              ]
            : options(['ACTIVE', 'INACTIVE'], t)
        }
        onChange={(e) => change('status', e.target.value)}
      />
    </Editor>
  );
});

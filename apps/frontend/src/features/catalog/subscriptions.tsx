'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Checkbox,
  DataState,
  DataTable,
  Dialog,
  Field,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import { type CatalogStore, type Publication, type Resident } from './store';
import {
  SubscriptionStore,
  type Subscription,
  type Hold,
  type PriceRule,
} from './subscription-store';
const days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const cadenceOptions = [
  ['DAILY', 'All days (daily)'],
  ['WEEKDAYS', 'Custom weekdays'],
  ['SUNDAY', 'Sundays only'],
  ['ONCE', 'One time'],
  ['WEEKLY', 'Once a week'],
  ['FORTNIGHTLY', 'Fortnightly'],
  ['MONTHLY', 'Once a month'],
  ['YEARLY', 'Once a year'],
].map(([value, label]) => ({ value, label }));
function useSubscriptions() {
  const [store] = useState(() => new SubscriptionStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  return store;
}
function DayChoices({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <div role="group" aria-label="Weekdays">
      {days.map((label, day) => (
        <Checkbox
          key={day}
          label={label}
          checked={value.includes(day)}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? [...value, day]
                : value.filter((d) => d !== day),
            )
          }
        />
      ))}
    </div>
  );
}
const Panel = observer(function Panel({
  title,
  store,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  store: SubscriptionStore;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      title={title}
      busy={store.saving}
      onClose={onClose}
      footer={
        <Button variant="secondary" disabled={store.saving} onClick={onClose}>
          {closeLabel}
        </Button>
      }
    >
      {store.error && (
        <DataState
          kind="error"
          title="Records unavailable"
          description={store.error}
          onRetry={store.load}
        />
      )}{' '}
      {store.saveError && (
        <Notification
          tone="error"
          title="Changes were not saved"
          description={store.saveError}
        />
      )}{' '}
      {store.notice && (
        <Notification
          tone="success"
          title="Changes saved"
          description={store.notice}
        />
      )}{' '}
      {store.state === 'loading' ? (
        <DataState kind="loading" title="Loading records" />
      ) : store.state === 'ready' ? (
        children
      ) : null}
    </Dialog>
  );
});
export const SubscriptionsPanel = observer(function SubscriptionsPanel({
  resident,
  catalog,
  onClose,
}: {
  resident: Resident;
  catalog: CatalogStore;
  onClose: () => void;
}) {
  const store = useSubscriptions();
  const empty = {
    id: undefined as string | undefined,
    version: undefined as number | undefined,
    publicationId: '',
    cadence: 'DAILY',
    startDate: '',
    endDate: '',
    weekdays: [] as number[],
    quantity: '1',
    status: 'ACTIVE',
  };
  const [draft, setDraft] = useState(empty);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const blankHold = {
    id: undefined as string | undefined,
    version: undefined as number | undefined,
    subscriptionId: '',
    startDate: '',
    resumeDate: '',
    active: true,
  };
  const [hold, setHold] = useState(blankHold);
  const subscriptions = store.subscriptions.filter(
      (s) => s.residentId === resident.id,
    ),
    holds = store.holds.filter((h) => h.residentId === resident.id);
  function edit(s: Subscription) {
    setDraft({ ...s, endDate: s.endDate ?? '', quantity: String(s.quantity) });
  }
  function editHold(h: Hold) {
    setHold({
      ...h,
      subscriptionId: h.subscriptionId ?? '',
      resumeDate: h.resumeDate ?? '',
    });
  }
  const publicationName = (id: string) =>
    catalog.publications.find((p) => p.id === id)?.name ??
    'Unavailable publication';
  return (
    <Panel
      title={`${resident.name} · subscriptions`}
      closeLabel="Close subscriptions"
      store={store}
      onClose={onClose}
    >
      <DataTable
        rows={subscriptions}
        rowKey={(s) => s.id}
        caption="Resident subscriptions"
        emptyTitle="No subscriptions yet"
        columns={[
          {
            key: 'publication',
            header: 'Publication',
            render: (s) => publicationName(s.publicationId),
          },
          {
            key: 'schedule',
            header: 'Schedule',
            render: (s) => `${s.cadence} · ${s.quantity} copies · ${s.status}`,
          },
          {
            key: 'edit',
            header: 'Action',
            render: (s) => (
              <Button
                variant="tertiary"
                disabled={store.saving}
                onClick={() => edit(s)}
              >
                Edit subscription
              </Button>
            ),
          },
        ]}
      />
      <form
        className="agency-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void store
            .save('subscription', {
              ...draft,
              requestId: draft.id ? undefined : requestId,
              residentId: resident.id,
              endDate: draft.endDate || null,
              quantity: Number(draft.quantity),
            })
            .then((saved) => {
              if (saved) {
                setDraft(empty);
                setRequestId(crypto.randomUUID());
              }
            });
        }}
      >
        <fieldset disabled={store.saving}>
          <h3>{draft.id ? 'Edit subscription' : 'Assign publication'}</h3>
          <Select
            label="Publication"
            required
            disabled={Boolean(draft.id)}
            value={draft.publicationId}
            options={[
              { value: '', label: 'Choose publication' },
              ...catalog.publications
                .filter((p) => p.active || p.id === draft.publicationId)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${p.edition} · ${p.dispatch}`,
                })),
            ]}
            onChange={(e) =>
              setDraft((d) => ({ ...d, publicationId: e.target.value }))
            }
          />
          <Select
            label="Delivery cadence"
            value={draft.cadence}
            options={cadenceOptions}
            onChange={(e) =>
              setDraft((d) => ({ ...d, cadence: e.target.value }))
            }
          />
          <Field
            label="Subscription start"
            required
            type="date"
            value={draft.startDate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, startDate: e.target.value }))
            }
          />
          <Field
            label="Subscription end"
            type="date"
            value={draft.endDate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, endDate: e.target.value }))
            }
          />
          {draft.cadence === 'WEEKDAYS' && (
            <DayChoices
              value={draft.weekdays}
              onChange={(weekdays) => setDraft((d) => ({ ...d, weekdays }))}
            />
          )}
          <Field
            label="Copies"
            type="number"
            required
            min={1}
            max={1000}
            value={draft.quantity}
            onChange={(e) =>
              setDraft((d) => ({ ...d, quantity: e.target.value }))
            }
          />
          <Select
            label="Subscription status"
            value={draft.status}
            options={['ACTIVE', 'PAUSED', 'CANCELLED'].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(e) =>
              setDraft((d) => ({ ...d, status: e.target.value }))
            }
          />
          <Button type="submit" loading={store.saving}>
            Save subscription
          </Button>
          {draft.id && (
            <Button variant="tertiary" onClick={() => setDraft(empty)}>
              New assignment
            </Button>
          )}
        </fieldset>
      </form>
      <h3>Vacation & suspension</h3>
      <ul>
        {holds.map((h) => (
          <li key={h.id}>
            {h.startDate} → {h.resumeDate ?? 'Until resumed'} ·{' '}
            {h.active ? 'Active' : 'Ended'}{' '}
            <Button
              variant="tertiary"
              disabled={store.saving}
              onClick={() => editHold(h)}
            >
              Edit hold
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="agency-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void store
            .save('hold', {
              ...hold,
              residentId: resident.id,
              subscriptionId: hold.subscriptionId || null,
              resumeDate: hold.resumeDate || null,
            })
            .then((saved) => {
              if (saved) setHold(blankHold);
            });
        }}
      >
        <fieldset disabled={store.saving}>
          <Select
            label="Pause scope"
            value={hold.subscriptionId}
            options={[
              { value: '', label: 'All resident publications' },
              ...subscriptions.map((s) => ({
                value: s.id,
                label: publicationName(s.publicationId),
              })),
            ]}
            onChange={(e) =>
              setHold((h) => ({ ...h, subscriptionId: e.target.value }))
            }
          />
          <Field
            label="Pause start"
            type="date"
            required
            value={hold.startDate}
            onChange={(e) =>
              setHold((h) => ({ ...h, startDate: e.target.value }))
            }
          />
          <Field
            label="Resume date"
            type="date"
            hint="Delivery resumes on this date. Leave blank for an indefinite suspension."
            value={hold.resumeDate}
            onChange={(e) =>
              setHold((h) => ({ ...h, resumeDate: e.target.value }))
            }
          />
          <Checkbox
            label="Hold active"
            checked={hold.active}
            onChange={(e) =>
              setHold((h) => ({ ...h, active: e.target.checked }))
            }
          />
          <Button type="submit" loading={store.saving}>
            Save vacation hold
          </Button>
          {hold.id && (
            <Button variant="tertiary" onClick={() => setHold(blankHold)}>
              New hold
            </Button>
          )}
        </fieldset>
      </form>
    </Panel>
  );
});
export const PriceRulesPanel = observer(function PriceRulesPanel({
  publication,
  onClose,
}: {
  publication: Publication;
  onClose: () => void;
}) {
  const store = useSubscriptions();
  const empty = {
    id: undefined as string | undefined,
    version: undefined as number | undefined,
    startDate: '',
    endDate: '',
    weekdays: [] as number[],
    price: '',
    active: true,
  };
  const [draft, setDraft] = useState(empty);
  function edit(rule: PriceRule) {
    setDraft({ ...rule, endDate: rule.endDate ?? '' });
  }
  return (
    <Panel
      title={`${publication.name} · price rules`}
      closeLabel="Close price rules"
      store={store}
      onClose={onClose}
    >
      <DataTable
        rows={store.priceRules.filter(
          (r) => r.publicationId === publication.id,
        )}
        rowKey={(r) => r.id}
        caption="Effective price rules"
        emptyTitle="No price overrides"
        columns={[
          {
            key: 'validity',
            header: 'Validity',
            render: (r) =>
              `${r.startDate} → ${r.endDate ?? 'Permanent'} · ${r.active ? 'Active' : 'Inactive'}`,
          },
          {
            key: 'days',
            header: 'Weekdays',
            render: (r) =>
              r.weekdays.length
                ? r.weekdays.map((d) => days[d]).join(', ')
                : 'Every date in range',
          },
          {
            key: 'price',
            header: 'Copy price',
            render: (r) => formatMoney(r.price),
          },
          {
            key: 'edit',
            header: 'Action',
            render: (r) => (
              <Button
                variant="tertiary"
                disabled={store.saving}
                onClick={() => edit(r)}
              >
                Edit price rule
              </Button>
            ),
          },
        ]}
      />
      <form
        className="agency-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void store
            .save('price', {
              ...draft,
              publicationId: publication.id,
              endDate: draft.endDate || null,
            })
            .then((saved) => {
              if (saved) setDraft(empty);
            });
        }}
      >
        <fieldset disabled={store.saving}>
          <Field
            label="Effective from"
            type="date"
            required
            value={draft.startDate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, startDate: e.target.value }))
            }
          />
          <Field
            label="Effective through"
            type="date"
            value={draft.endDate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, endDate: e.target.value }))
            }
          />
          <p className="db-muted">
            Select weekdays for recurring rates. With no weekdays selected, the
            price applies to every date in the bounded range.
          </p>
          <DayChoices
            value={draft.weekdays}
            onChange={(weekdays) => setDraft((d) => ({ ...d, weekdays }))}
          />
          <Field
            label="Override price"
            required
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
          />
          <Checkbox
            label="Price rule active"
            checked={draft.active}
            onChange={(e) =>
              setDraft((d) => ({ ...d, active: e.target.checked }))
            }
          />
          <Button type="submit" loading={store.saving}>
            Save price rule
          </Button>
          {draft.id && (
            <Button variant="tertiary" onClick={() => setDraft(empty)}>
              New price rule
            </Button>
          )}
        </fieldset>
      </form>
    </Panel>
  );
});

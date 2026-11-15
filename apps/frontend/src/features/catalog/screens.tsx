'use client';
import { useI18n } from '@daybook/ui/i18n';
import { translateRendered } from '@daybook/ui/messages';
import { ResidentContact } from '../communications/resident-contact';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Notification,
  SearchField,
  formatMoney,
  type Column,
} from '@daybook/ui';
import { CatalogStore, type Publication, type Resident } from './store';
import { PublicationEditor, ResidentEditor } from './editors';
import { SubscriptionsPanel, PriceRulesPanel } from './subscriptions';
export const CatalogScreen = observer(function CatalogScreen({
  kind,
}: {
  kind: 'publication' | 'resident';
}) {
  const { t, locale } = useI18n();
  const codeLabels: Record<string, string> = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    SUSPENDED: 'Suspended',
    CLOSED: 'Closed',
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    FORTNIGHTLY: 'Fortnightly',
    MONTHLY: 'Monthly',
    YEARLY: 'Yearly',
    MORNING: 'Morning',
    EVENING: 'Evening',
  };
  const displayCode = (value: string) => t(codeLabels[value] ?? value);
  const [store] = useState(() => new CatalogStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<
      Publication | Resident | null | undefined
    >(),
    [notice, setNotice] = useState('');
  const [subscriptionsResident, setSubscriptionsResident] =
      useState<Resident | null>(null),
    [pricingPublication, setPricingPublication] = useState<Publication | null>(
      null,
    );
  const title =
    kind === 'publication'
      ? 'Publications & pricing'
      : 'Residents & subscriptions';
  function open(record: Publication | Resident | null) {
    store.clearSaveError();
    setNotice('');
    setEditing(record);
  }
  function close(saved = false) {
    setEditing(undefined);
    if (saved) setNotice('Your changes have been saved.');
  }
  const source = kind === 'publication' ? store.publications : store.residents;
  const rows = source.filter((r) =>
    ('edition' in r
      ? [
          r.name,
          r.edition,
          r.language,
          r.dispatch,
          r.frequency,
          displayCode(r.dispatch),
          displayCode(r.frequency),
        ]
      : [r.name, r.code, r.address, r.phone, r.sector]
    )
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
      .includes(search.normalize('NFKC').trim().toLowerCase()),
  );
  const state =
    store.state === 'idle' || store.state === 'loading'
      ? 'loading'
      : store.error
        ? source.length
          ? 'partial'
          : 'error'
        : rows.length
          ? 'ready'
          : source.length
            ? 'no-results'
            : 'empty';
  const publications: Column<Publication>[] = [
    {
      key: 'name',
      header: t('Publication'),
      render: (r) => (
        <>
          <strong>{r.name}</strong>
          <div className="db-muted">
            {r.edition} · {r.language}
          </div>
        </>
      ),
    },
    {
      key: 'schedule',
      header: t('Publishing'),
      render: (r) => `${displayCode(r.frequency)} · ${displayCode(r.dispatch)}`,
    },
    {
      key: 'weekday',
      header: t('Weekday price'),
      render: (r) => formatMoney(r.weekdayPrice),
    },
    {
      key: 'weekend',
      header: t('Weekend price'),
      render: (r) => formatMoney(r.weekendPrice),
    },
    {
      key: 'cost',
      header: t('Net cost'),
      render: (r) => formatMoney(r.procurementNetCost),
    },
    {
      key: 'status',
      header: t('Status'),
      render: (r) => (
        <Badge tone={r.active ? 'success' : 'neutral'}>
          {t(r.active ? 'Active' : 'Inactive')}
        </Badge>
      ),
    },
    {
      key: 'edit',
      header: t('Action'),
      render: (r) => (
        <div className="db-row">
          <Button variant="tertiary" onClick={() => open(r)}>
            {t('Edit publication')}
          </Button>
          <Button variant="tertiary" onClick={() => setPricingPublication(r)}>
            {t('Price rules')}
          </Button>
        </div>
      ),
    },
  ];
  const residents: Column<Resident>[] = [
    {
      key: 'name',
      header: t('Resident'),
      render: (r) => (
        <>
          <strong>{r.name}</strong>
          <div className="db-muted">
            {r.code} · {r.phone}
          </div>
          <ResidentContact key={r.id} residentId={r.id} name={r.name} />
        </>
      ),
    },
    {
      key: 'address',
      header: t('Delivery address'),
      render: (r) => (
        <>
          {r.address}
          <div className="db-muted">
            {r.sector} · {t('Drop {order}', { order: r.dropOrder })}
          </div>
        </>
      ),
    },
    {
      key: 'route',
      header: t('Route'),
      render: (r) =>
        store.routes.find((route) => route.id === r.routeId)?.name ??
        t('Unavailable'),
    },
    {
      key: 'deposit',
      header: t('Refundable deposit'),
      render: (r) => formatMoney(r.depositBalance),
    },
    {
      key: 'status',
      header: t('Status'),
      render: (r) => (
        <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {displayCode(r.status)}
        </Badge>
      ),
    },
    {
      key: 'edit',
      header: t('Action'),
      render: (r) => (
        <div className="db-row">
          <Button variant="tertiary" onClick={() => open(r)}>
            {t('Edit resident')}
          </Button>
          <Button
            variant="tertiary"
            onClick={() => setSubscriptionsResident(r)}
          >
            {t('Manage subscriptions')}
          </Button>
        </div>
      ),
    },
  ];
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">{t('Agency workspace')}</p>
          <h1>{t(title)}</h1>
          <p className="db-muted">
            {kind === 'publication'
              ? t('Manage editions, publishing schedules and copy prices.')
              : t(
                  'Maintain resident details, delivery order and refundable deposits.',
                )}
          </p>
        </div>
        <Button disabled={store.state !== 'ready'} onClick={() => open(null)}>
          {t(kind === 'publication' ? 'Add publication' : 'Add resident')}
        </Button>
      </header>
      {store.error && (
        <Notification
          tone="error"
          title={t('Unable to refresh records')}
          description={translateRendered(locale, store.error)}
          action={<Button onClick={store.load}>{t('Try again')}</Button>}
        />
      )}
      {notice && (
        <Notification
          tone="success"
          title={t('Changes saved')}
          description={translateRendered(locale, notice)}
          onDismiss={() => setNotice('')}
        />
      )}
      <Card>
        <div className="agency-toolbar">
          <SearchField
            label={t('Search records')}
            value={search}
            onValueChange={setSearch}
            placeholder={t('Search by name, edition or address')}
          />
        </div>
        {kind === 'publication' ? (
          <DataTable
            rows={rows as Publication[]}
            columns={publications}
            rowKey={(r) => r.id}
            caption={t('Publication catalog')}
            state={state}
            onRetry={store.load}
            emptyTitle={t('No publications yet')}
            emptyAction={
              <Button onClick={() => open(null)}>
                {t('Add first publication')}
              </Button>
            }
          />
        ) : (
          <DataTable
            rows={rows as Resident[]}
            columns={residents}
            rowKey={(r) => r.id}
            caption={t('Resident directory')}
            state={state}
            onRetry={store.load}
            emptyTitle={t('No residents yet')}
            emptyAction={
              <Button onClick={() => open(null)}>
                {t('Add first resident')}
              </Button>
            }
          />
        )}
      </Card>
      {subscriptionsResident && (
        <SubscriptionsPanel
          resident={subscriptionsResident}
          catalog={store}
          onClose={() => setSubscriptionsResident(null)}
        />
      )}
      {pricingPublication && (
        <PriceRulesPanel
          publication={pricingPublication}
          onClose={() => setPricingPublication(null)}
        />
      )}
      {editing !== undefined &&
        (kind === 'publication' ? (
          <PublicationEditor
            key={editing?.id ?? 'new'}
            record={editing as Publication | null}
            store={store}
            onClose={close}
          />
        ) : (
          <ResidentEditor
            key={editing?.id ?? 'new'}
            record={editing as Resident | null}
            store={store}
            onClose={close}
          />
        ))}
    </div>
  );
});

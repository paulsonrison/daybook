'use client';
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
      ? [r.name, r.edition, r.language, r.dispatch, r.frequency]
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
      header: 'Publication',
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
      header: 'Publishing',
      render: (r) => `${r.frequency} · ${r.dispatch}`,
    },
    {
      key: 'weekday',
      header: 'Weekday price',
      render: (r) => formatMoney(r.weekdayPrice),
    },
    {
      key: 'weekend',
      header: 'Weekend price',
      render: (r) => formatMoney(r.weekendPrice),
    },
    {
      key: 'cost',
      header: 'Net cost',
      render: (r) => formatMoney(r.procurementNetCost),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.active ? 'success' : 'neutral'}>
          {r.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'edit',
      header: 'Action',
      render: (r) => (
        <div className="db-row">
          <Button variant="tertiary" onClick={() => open(r)}>
            Edit publication
          </Button>
          <Button variant="tertiary" onClick={() => setPricingPublication(r)}>
            Price rules
          </Button>
        </div>
      ),
    },
  ];
  const residents: Column<Resident>[] = [
    {
      key: 'name',
      header: 'Resident',
      render: (r) => (
        <>
          <strong>{r.name}</strong>
          <div className="db-muted">
            {r.code} · {r.phone}
          </div>
        </>
      ),
    },
    {
      key: 'address',
      header: 'Delivery address',
      render: (r) => (
        <>
          {r.address}
          <div className="db-muted">
            {r.sector} · Drop {r.dropOrder}
          </div>
        </>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      render: (r) =>
        store.routes.find((route) => route.id === r.routeId)?.name ??
        'Unavailable',
    },
    {
      key: 'deposit',
      header: 'Refundable deposit',
      render: (r) => formatMoney(r.depositBalance),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'edit',
      header: 'Action',
      render: (r) => (
        <div className="db-row">
          <Button variant="tertiary" onClick={() => open(r)}>
            Edit resident
          </Button>
          <Button
            variant="tertiary"
            onClick={() => setSubscriptionsResident(r)}
          >
            Manage subscriptions
          </Button>
        </div>
      ),
    },
  ];
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">Agency workspace</p>
          <h1>{title}</h1>
          <p className="db-muted">
            {kind === 'publication'
              ? 'Manage editions, publishing schedules and copy prices.'
              : 'Maintain resident details, delivery order and refundable deposits.'}
          </p>
        </div>
        <Button disabled={store.state !== 'ready'} onClick={() => open(null)}>
          Add {kind}
        </Button>
      </header>
      {store.error && (
        <Notification
          tone="error"
          title="Unable to refresh records"
          description={store.error}
          action={<Button onClick={store.load}>Try again</Button>}
        />
      )}
      {notice && (
        <Notification
          tone="success"
          title="Changes saved"
          description={notice}
          onDismiss={() => setNotice('')}
        />
      )}
      <Card>
        <div className="agency-toolbar">
          <SearchField
            label="Search records"
            value={search}
            onValueChange={setSearch}
            placeholder="Search by name, edition or address"
          />
        </div>
        {kind === 'publication' ? (
          <DataTable
            rows={rows as Publication[]}
            columns={publications}
            rowKey={(r) => r.id}
            caption="Publication catalog"
            state={state}
            onRetry={store.load}
            emptyTitle="No publications yet"
            emptyAction={
              <Button onClick={() => open(null)}>Add first publication</Button>
            }
          />
        ) : (
          <DataTable
            rows={rows as Resident[]}
            columns={residents}
            rowKey={(r) => r.id}
            caption="Resident directory"
            state={state}
            onRetry={store.load}
            emptyTitle="No residents yet"
            emptyAction={
              <Button onClick={() => open(null)}>Add first resident</Button>
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

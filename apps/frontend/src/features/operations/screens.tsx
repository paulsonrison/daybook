'use client';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  Button,
  Card,
  DataState,
  DataTable,
  MetricCard,
  Notification,
  SearchField,
  Select,
  type Column,
} from '@daybook/ui';
import {
  OperationsStore,
  type Route,
  type Staff,
  type Territory,
} from './store';
import { StaffEditor, TerritoryEditor } from './editors';
import { RouteEditor } from './route-editor';

function useOperations() {
  const [store] = useState(() => new OperationsStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  return store;
}
const statusName = (status: Staff['status']) =>
  status === 'ON_LEAVE'
    ? 'On leave'
    : status === 'ACTIVE'
      ? 'Active'
      : 'Inactive';
type Kind = 'territory' | 'staff' | 'route';
const copy = {
  territory: {
    title: 'Delivery territory',
    description: 'Define your locality, PIN codes and delivery sectors.',
    add: 'Add territory',
  },
  staff: {
    title: 'Staff & payroll',
    description:
      'Maintain your delivery team, availability and assigned sectors.',
    add: 'Add staff',
  },
  route: {
    title: 'Routes & delivery',
    description:
      'Divide your coverage area and maintain a clear door-to-door delivery order.',
    add: 'Add route',
  },
};
export const OperationsScreen = observer(function OperationsScreen({
  kind,
}: {
  kind: Kind;
}) {
  const store = useOperations();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<
    Territory | Staff | Route | null | undefined
  >();
  const [notice, setNotice] = useState('');
  const heading = copy[kind];
  const source =
    kind === 'territory'
      ? store.territories
      : kind === 'staff'
        ? store.staff
        : store.routes;
  const rows = source.filter(
    (row) =>
      ('stops' in row
        ? [
            row.code,
            row.name,
            row.staffName,
            store.territories.find((t) => t.id === row.territoryId)?.name,
            ...row.stops.flatMap((stop) => [stop.label, stop.door]),
          ]
        : 'staffCode' in row
          ? [row.name, row.staffCode, row.phone, ...row.assignedSectors]
          : [row.name, row.locality, ...row.pinCodes, ...row.sectors]
      )
        .join(' ')
        .normalize('NFKC')
        .toLowerCase()
        .includes(search.normalize('NFKC').trim().toLowerCase()) &&
      (filter === 'all' ||
        ('status' in row
          ? row.status === filter
          : row.active === (filter === 'active'))),
  );
  function open(record: Territory | Staff | Route | null) {
    store.clearSaveError();
    setEditing(record);
    setNotice('');
  }
  function close(saved = false) {
    setEditing(undefined);
    if (saved) setNotice('Agency records are up to date.');
  }
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
  const territoryColumns: Column<Territory>[] = [
    {
      key: 'name',
      header: 'Territory',
      render: (r) => <strong>{r.name}</strong>,
    },
    { key: 'locality', header: 'Locality', render: (r) => r.locality },
    { key: 'pins', header: 'PIN codes', render: (r) => r.pinCodes.join(', ') },
    { key: 'sectors', header: 'Sectors', render: (r) => r.sectors.join(', ') },
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
        <Button variant="tertiary" onClick={() => open(r)}>
          Edit territory
        </Button>
      ),
    },
  ];
  const staffColumns: Column<Staff>[] = [
    {
      key: 'name',
      header: 'Staff',
      render: (r) => (
        <>
          <strong>{r.name}</strong>
          <div className="db-muted">{r.staffCode}</div>
        </>
      ),
    },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    {
      key: 'sectors',
      header: 'Assigned sectors',
      render: (r) => r.assignedSectors.join(', ') || 'No routes assigned',
    },
    {
      key: 'status',
      header: 'Availability',
      render: (r) => (
        <Badge
          tone={
            r.status === 'ACTIVE'
              ? 'success'
              : r.status === 'ON_LEAVE'
                ? 'warning'
                : 'neutral'
          }
        >
          {statusName(r.status)}
        </Badge>
      ),
    },
    {
      key: 'edit',
      header: 'Action',
      render: (r) => (
        <Button variant="tertiary" onClick={() => open(r)}>
          Edit staff
        </Button>
      ),
    },
  ];
  const routeColumns: Column<Route>[] = [
    {
      key: 'route',
      header: 'Route',
      render: (r) => (
        <>
          <strong>
            {r.code} · {r.name}
          </strong>
          <div className="db-muted">
            {store.territories.find((t) => t.id === r.territoryId)?.name ??
              'Territory unavailable'}
          </div>
        </>
      ),
    },
    {
      key: 'staff',
      header: 'Assigned staff',
      render: (r) => r.staffName ?? 'Unassigned',
    },
    { key: 'stops', header: 'Delivery points', render: (r) => r.stops.length },
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
        <Button variant="tertiary" onClick={() => open(r)}>
          Edit route
        </Button>
      ),
    },
  ];
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">
            {kind === 'route'
              ? 'Delivery operations'
              : kind === 'staff'
                ? 'Operations'
                : 'Agency settings'}
          </p>
          <h1>{heading.title}</h1>
          <p className="db-muted">{heading.description}</p>
        </div>
        <Button onClick={() => open(null)} disabled={store.state === 'loading'}>
          {heading.add}
        </Button>
      </header>
      {store.error && (
        <Notification
          tone="error"
          title="Unable to refresh records"
          description={store.error}
          action={
            <Button variant="secondary" onClick={store.load}>
              Try again
            </Button>
          }
        />
      )}
      {notice && (
        <Notification
          title="Changes saved"
          description={notice}
          tone="success"
          onDismiss={() => setNotice('')}
        />
      )}
      <Card>
        <div className="agency-toolbar">
          <SearchField
            label="Search records"
            value={search}
            onValueChange={setSearch}
            placeholder="Search by name, code or address"
          />
          <Select
            label="Status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={
              kind === 'staff'
                ? [
                    { value: 'all', label: 'All staff' },
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'ON_LEAVE', label: 'On leave' },
                    { value: 'INACTIVE', label: 'Inactive' },
                  ]
                : [
                    { value: 'all', label: 'All statuses' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]
            }
          />
        </div>
        {kind === 'territory' ? (
          <DataTable<Territory>
            rows={rows as Territory[]}
            columns={territoryColumns}
            rowKey={(r) => r.id}
            caption="Delivery territories"
            state={state}
            onRetry={store.load}
            emptyTitle="No delivery territories yet"
            emptyAction={
              <Button onClick={() => open(null)}>Add first territory</Button>
            }
          />
        ) : kind === 'staff' ? (
          <DataTable<Staff>
            rows={rows as Staff[]}
            columns={staffColumns}
            rowKey={(r) => r.id}
            caption="Delivery staff"
            state={state}
            onRetry={store.load}
            emptyTitle="No staff profiles yet"
            emptyAction={
              <Button onClick={() => open(null)}>
                Add first staff profile
              </Button>
            }
          />
        ) : (
          <DataTable<Route>
            rows={rows as Route[]}
            columns={routeColumns}
            rowKey={(r) => r.id}
            caption="Delivery routes"
            state={state}
            onRetry={store.load}
            emptyTitle="No routes yet"
            emptyAction={
              <Button onClick={() => open(null)}>Add first route</Button>
            }
          />
        )}
      </Card>
      {editing !== undefined &&
        (kind === 'territory' ? (
          <TerritoryEditor
            key={editing?.id ?? 'new'}
            record={editing as Territory | null}
            store={store}
            onClose={close}
          />
        ) : kind === 'staff' ? (
          <StaffEditor
            key={editing?.id ?? 'new'}
            record={editing as Staff | null}
            store={store}
            onClose={close}
          />
        ) : (
          <RouteEditor
            key={editing?.id ?? 'new'}
            record={editing as Route | null}
            store={store}
            onClose={close}
          />
        ))}
    </div>
  );
});
export const AgencyOverview = observer(function AgencyOverview() {
  const store = useOperations();
  if (store.state === 'error')
    return (
      <DataState
        kind="error"
        title="Overview unavailable"
        description={store.error}
        onRetry={store.load}
      />
    );
  const loading = store.state !== 'ready';
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">Agency overview</p>
          <h1>A clear start to your day.</h1>
          <p className="db-muted">
            Keep your delivery coverage and team organized.
          </p>
        </div>
      </header>
      <div className="agency-metrics">
        <MetricCard
          title="Delivery territory"
          value={`${store.summary.territories} active ${store.summary.territories === 1 ? 'territory' : 'territories'}`}
          loading={loading}
        />
        <MetricCard
          title="Delivery team"
          value={`${store.summary.activeStaff} active staff ${store.summary.activeStaff === 1 ? 'member' : 'members'}`}
          loading={loading}
        />
        <MetricCard
          title="Routes"
          value={`${store.summary.activeRoutes} active ${store.summary.activeRoutes === 1 ? 'route' : 'routes'}`}
          loading={loading}
        />
      </div>
      <Card title="Your delivery coverage">
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Territory',
              render: (r: Territory) => r.name,
            },
            {
              key: 'sectors',
              header: 'Sectors',
              render: (r: Territory) => r.sectors.join(', '),
            },
            {
              key: 'pins',
              header: 'PIN codes',
              render: (r: Territory) => r.pinCodes.join(', '),
            },
          ]}
          rows={store.territories}
          rowKey={(r) => r.id}
          caption="Territory summary"
          state={
            loading ? 'loading' : store.territories.length ? 'ready' : 'empty'
          }
          emptyTitle="Set up your first delivery territory"
          emptyAction={
            <a
              className="db-button db-button--primary"
              href="/settings/territory"
            >
              Open territory settings
            </a>
          }
        />
      </Card>
    </div>
  );
});

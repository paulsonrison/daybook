'use client';
import { ResidentContact } from '../communications/resident-contact';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  Button,
  Card,
  DataState,
  DataTable,
  Field,
  MetricCard,
  Notification,
  SearchField,
  Select,
  Theme,
  type DisplayMode,
} from '@daybook/ui';
import {
  DeliveryStore,
  type Assignment,
  type Complaint,
  type Delivery,
  type Holiday,
} from './store';
import {
  ComplaintEditor,
  HolidayEditor,
  OverrideEditor,
  SubstituteEditor,
} from './editors';
const FieldDelivery = observer(function FieldDelivery({
  row,
  store,
  onComplaint,
  onFlag,
}: {
  row: Delivery;
  store: DeliveryStore;
  onComplaint: () => void;
  onFlag: () => void;
}) {
  const pointer = useRef<{ x: number; y: number } | null>(null),
    resolved = ['REPLACED', 'CREDITED', 'SKIPPED'].includes(row.status);
  return (
    <article
      className="delivery-field-card"
      aria-label={`${row.dropOrder} · ${row.residentName}`}
      onPointerDown={(e) => {
        if (
          e.pointerType === 'touch' &&
          !(e.target as HTMLElement).closest('button,a,input,select')
        )
          pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
      onPointerUp={(e) => {
        const start = pointer.current;
        pointer.current = null;
        if (
          start &&
          !resolved &&
          e.clientX - start.x < -70 &&
          Math.abs(e.clientX - start.x) > Math.abs(e.clientY - start.y) * 1.5
        )
          onFlag();
      }}
    >
      <Card>
        <div className="agency-page-heading">
          <div>
            <p className="db-eyebrow">
              Drop {row.dropOrder} · {row.routeName}
            </p>
            <h2>{row.residentName}</h2>
            <p>{row.address}</p>
            <ResidentContact
              key={row.residentId}
              residentId={row.residentId}
              name={row.residentName}
            />
          </div>
          <Badge
            tone={
              row.status === 'DELIVERED' || row.status === 'REPLACED'
                ? 'success'
                : row.status === 'SKIPPED'
                  ? 'neutral'
                  : 'warning'
            }
          >
            {row.status}
          </Badge>
        </div>
        <p>
          <strong>{row.quantity} copies</strong> · {row.publicationName}
        </p>
        <p className="db-muted">
          {row.staffName ?? 'Staff unassigned'}
          {row.reason ? ` · ${row.reason}` : ''}
        </p>
        <div className="delivery-field-actions">
          <Button
            variant={row.status === 'DELIVERED' ? 'secondary' : 'primary'}
            disabled={store.saving || resolved}
            onClick={() =>
              void store.save('override', {
                id: row.id,
                version: row.version,
                status: row.status === 'DELIVERED' ? 'MISSED' : 'DELIVERED',
                reason:
                  row.status === 'DELIVERED'
                    ? 'Marked missed during field delivery'
                    : 'Delivery confirmed in field',
                requestId: crypto.randomUUID(),
              })
            }
          >
            {row.status === 'DELIVERED' ? 'Mark missed' : 'Mark delivered'}
          </Button>
          <Button
            variant="secondary"
            disabled={store.saving || resolved}
            onClick={onFlag}
          >
            Flag damaged
          </Button>
          <Button
            variant="tertiary"
            disabled={store.saving}
            onClick={onComplaint}
          >
            Log complaint
          </Button>
        </div>
      </Card>
    </article>
  );
});
export const DeliveryScreen = observer(function DeliveryScreen() {
  const [store] = useState(() => new DeliveryStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  const [search, setSearch] = useState(''),
    [route, setRoute] = useState(''),
    [mode, setMode] = useState<DisplayMode>('light');
  const [complaint, setComplaint] = useState<{
      delivery?: Delivery;
      complaint?: Complaint;
    } | null>(null),
    [flag, setFlag] = useState<Delivery | null>(null),
    [assignment, setAssignment] = useState<Assignment | null | undefined>(),
    [holiday, setHoliday] = useState<Holiday | null | undefined>();
  const manifest = store.manifests.find((m) => m.dispatch === store.dispatch),
    rows = store.logs.filter(
      (r) =>
        r.dispatch === store.dispatch &&
        (!route || r.routeId === route) &&
        [
          r.residentName,
          r.address,
          r.publicationName,
          r.routeName,
          r.staffName ?? '',
        ]
          .join(' ')
          .normalize('NFKC')
          .toLowerCase()
          .includes(search.normalize('NFKC').trim().toLowerCase()),
    );
  const open = (work: () => void) => {
    store.clearSaveError();
    work();
  };
  const editing =
    complaint || flag || assignment !== undefined || holiday !== undefined;
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">Delivery operations</p>
          <h1>Daily delivery log</h1>
          <p className="db-muted">
            Prepare your publisher pickup and follow each delivery in route
            order.
          </p>
        </div>
        <Button
          loading={store.saving}
          disabled={
            store.state !== 'ready' || !/^\d{4}-\d{2}-\d{2}$/.test(store.date)
          }
          onClick={() => void store.generate()}
        >
          Generate dispatch
        </Button>
      </header>
      <div className="agency-form-grid">
        <Field
          label="Delivery date"
          type="date"
          required
          value={store.date}
          disabled={store.saving}
          onChange={(e) => store.setDate(e.target.value)}
        />
        <Select
          label="Dispatch"
          value={store.dispatch}
          disabled={store.saving}
          options={[
            { value: 'MORNING', label: 'Morning' },
            { value: 'EVENING', label: 'Evening' },
          ]}
          onChange={(e) => store.setDispatch(e.target.value)}
        />
      </div>
      {store.metrics && (
        <Card
          title="Automatic preparation"
          description={
            store.metrics.lastAutomaticRun
              ? `Last successful automatic run: ${new Date(store.metrics.lastAutomaticRun).toLocaleString('en-IN', { timeZone: store.metrics.timezone })}`
              : 'No successful automatic run recorded.'
          }
        >
          <p className="db-muted">Agency timezone: {store.metrics.timezone}</p>
          {store.metrics.failedJobs > 0 && (
            <Notification
              tone="error"
              title="Automatic preparation needs attention"
              description={`${store.metrics.failedJobs} jobs await retry or investigation.`}
            />
          )}
        </Card>
      )}
      {store.error && (
        <DataState
          kind="error"
          title="Deliveries unavailable"
          description={store.error}
          onRetry={store.load}
        />
      )}
      {store.saveError && !editing && (
        <Notification
          tone="error"
          title="Changes could not be confirmed"
          description={store.saveError}
        />
      )}
      {store.notice && (
        <Notification
          tone="success"
          title="Changes saved"
          description={store.notice}
        />
      )}
      {store.state === 'loading' ? (
        <DataState kind="loading" title="Loading daily deliveries" />
      ) : (
        store.state === 'ready' && (
          <>
            <div className="agency-metrics">
              <MetricCard
                title="Dispatch copies"
                value={manifest ? String(manifest.totalCopies) : '—'}
              />
              <MetricCard
                title="Delivery points"
                value={String(
                  new Set(
                    store.logs
                      .filter(
                        (r) =>
                          r.dispatch === store.dispatch &&
                          r.status !== 'SKIPPED',
                      )
                      .map((r) => r.residentId),
                  ).size,
                )}
              />
              <MetricCard
                title="Open complaints"
                value={String(
                  store.complaints.filter((c) => c.status === 'OPEN').length,
                )}
              />
            </div>
            {manifest?.deviation && (
              <Notification
                tone="warning"
                title="Dispatch count changed significantly"
                description={`${manifest.totalCopies} copies compared with a recent average of ${manifest.averageCopies?.toFixed(1)}. Review holds, schedules and route changes before pickup.`}
              />
            )}
            <Card title="Publisher pickup indent">
              <DataTable
                caption="Publisher pickup indent"
                rows={manifest?.publications ?? []}
                rowKey={(r) => r.publicationId}
                emptyTitle="No dispatch prepared for this date"
                emptyAction={
                  <Button
                    onClick={() => void store.generate()}
                    disabled={store.saving}
                  >
                    Prepare dispatch
                  </Button>
                }
                columns={[
                  {
                    key: 'title',
                    header: 'Publication / edition',
                    render: (r) => r.name,
                  },
                  { key: 'count', header: 'Copies', render: (r) => r.copies },
                ]}
              />
            </Card>
            {manifest && (
              <Card title="Route bag-packing slip">
                <DataTable
                  caption="Route bag-packing slip"
                  rows={manifest.rows}
                  rowKey={(r) => r.subscriptionId}
                  columns={[
                    {
                      key: 'route',
                      header: 'Route / staff',
                      render: (r) => (
                        <>
                          {r.routeName}
                          <div className="db-muted">
                            {r.staffName ?? 'Unassigned'}
                          </div>
                        </>
                      ),
                    },
                    { key: 'drop', header: 'Drop', render: (r) => r.dropOrder },
                    {
                      key: 'address',
                      header: 'Resident / door',
                      render: (r) => (
                        <>
                          {r.residentName}
                          <div className="db-muted">{r.address}</div>
                          <ResidentContact
                            key={r.residentId}
                            residentId={r.residentId}
                            name={r.residentName}
                          />
                        </>
                      ),
                    },
                    {
                      key: 'publication',
                      header: 'Publication',
                      render: (r) => r.publicationName,
                    },
                    {
                      key: 'copies',
                      header: 'Copies',
                      render: (r) => r.quantity,
                    },
                  ]}
                />
              </Card>
            )}
            {manifest && (
              <Card title="Additional depot items">
                <DataTable
                  caption="Additional depot items"
                  rows={manifest.extraItems}
                  rowKey={(r) => `${r.kind}:${r.sourceOrderId}:${r.residentId}`}
                  emptyTitle="No seasonal items or leaflets for this dispatch"
                  columns={[
                    {
                      key: 'drop',
                      header: 'Route / drop',
                      render: (r) => `${r.routeName} � ${r.dropOrder}`,
                    },
                    {
                      key: 'resident',
                      header: 'Resident / door',
                      render: (r) => (
                        <>
                          {r.residentName}
                          <div className="db-muted">{r.address}</div>
                        </>
                      ),
                    },
                    { key: 'item', header: 'Item', render: (r) => r.name },
                    {
                      key: 'qty',
                      header: 'Quantity',
                      render: (r) => r.quantity,
                    },
                    {
                      key: 'status',
                      header: 'Current fulfilment',
                      render: (r) =>
                        store.orderStates[`${r.kind}:${r.sourceOrderId}`] ??
                        'Unknown',
                    },
                  ]}
                />
                {manifest.extraWarnings.map((warning, index) => (
                  <Notification
                    key={index}
                    tone="warning"
                    title="Packing allocation needs attention"
                    description={warning}
                  />
                ))}
              </Card>
            )}
            <Theme mode={mode} className="delivery-field">
              <header className="agency-page-heading">
                <h2>Door-to-door delivery</h2>
                <Select
                  label="Field theme"
                  value={mode}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  onChange={(e) => setMode(e.target.value as DisplayMode)}
                />
              </header>
              <div className="agency-toolbar">
                <SearchField
                  label="Find resident"
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Name, door or publication"
                />
                <Select
                  label="Delivery route filter"
                  value={route}
                  options={[
                    { value: '', label: 'All routes' },
                    ...store.routes.map((r) => ({
                      value: r.id,
                      label: r.name,
                    })),
                  ]}
                  onChange={(e) => setRoute(e.target.value)}
                />
              </div>
              <p className="db-muted">
                Tap to update a delivery. Swipe left on a card to flag damage,
                or use the Flag damaged button.
              </p>
              {rows.length ? (
                <div className="delivery-field-list">
                  {rows.map((row) => (
                    <FieldDelivery
                      key={row.id}
                      row={row}
                      store={store}
                      onFlag={() => open(() => setFlag(row))}
                      onComplaint={() =>
                        open(() => setComplaint({ delivery: row }))
                      }
                    />
                  ))}
                </div>
              ) : (
                <DataState
                  kind={store.logs.length ? 'no-results' : 'empty'}
                  title={
                    store.logs.length
                      ? 'No matching deliveries'
                      : 'No delivery log for this date'
                  }
                  description="Generate the dispatch to expand active schedules, excluding holds and press holidays."
                />
              )}
            </Theme>
            <Card title="Delivery complaints">
              <DataTable
                caption="Delivery complaints"
                rows={store.complaints}
                rowKey={(c) => c.id}
                emptyTitle="No delivery complaints"
                columns={[
                  {
                    key: 'resident',
                    header: 'Resident / route',
                    render: (c) => (
                      <>
                        {c.residentName}
                        <div className="db-muted">
                          {c.routeName} · {c.staffName ?? 'Unassigned'}
                        </div>
                      </>
                    ),
                  },
                  {
                    key: 'detail',
                    header: 'Reported issue',
                    render: (c) => `${c.kind} · ${c.note}`,
                  },
                  {
                    key: 'status',
                    header: 'Resolution',
                    render: (c) => c.status,
                  },
                  {
                    key: 'action',
                    header: 'Action',
                    render: (c) =>
                      c.status === 'OPEN' ? (
                        <Button
                          variant="tertiary"
                          onClick={() =>
                            open(() => setComplaint({ complaint: c }))
                          }
                        >
                          Resolve complaint
                        </Button>
                      ) : c.status === 'REPLACEMENT' ? (
                        `${c.replacementCopies} replacement copies`
                      ) : c.status === 'CREDIT' ? (
                        `Billing credit approved: ${c.credit}`
                      ) : (
                        'Closed'
                      ),
                  },
                ]}
              />
            </Card>
            <Card
              title="Temporary staff assignments"
              trailing={
                <Button
                  variant="secondary"
                  onClick={() => open(() => setAssignment(null))}
                >
                  Assign substitute staff
                </Button>
              }
            >
              <DataTable
                caption="Temporary assignments"
                rows={store.assignments}
                rowKey={(a) => a.id}
                emptyTitle="No temporary assignments"
                columns={[
                  {
                    key: 'route',
                    header: 'Route',
                    render: (a) =>
                      store.routes.find((r) => r.id === a.routeId)?.name ??
                      'Unavailable',
                  },
                  {
                    key: 'dates',
                    header: 'Absence',
                    render: (a) => `${a.startDate} → ${a.endDate}`,
                  },
                  {
                    key: 'staff',
                    header: 'Allocation',
                    render: (a) =>
                      a.allocations
                        .map(
                          (s) =>
                            `${store.staff.find((p) => p.id === s.staffId)?.name ?? 'Unavailable'}: ${s.fromDrop}–${s.toDrop}`,
                        )
                        .join(', '),
                  },
                  {
                    key: 'active',
                    header: 'Status',
                    render: (a) => (a.active ? 'Active' : 'Cancelled'),
                  },
                  {
                    key: 'edit',
                    header: 'Action',
                    render: (a) => (
                      <Button
                        variant="tertiary"
                        onClick={() => open(() => setAssignment(a))}
                      >
                        Edit temporary assignment
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
            <Card
              title="Press holidays"
              trailing={
                <Button
                  variant="secondary"
                  onClick={() => open(() => setHoliday(null))}
                >
                  Add press holiday
                </Button>
              }
            >
              <DataTable
                caption="Press holidays"
                rows={store.holidays}
                rowKey={(h) => h.id}
                emptyTitle="No press holidays recorded"
                columns={[
                  {
                    key: 'pub',
                    header: 'Publication',
                    render: (h) =>
                      store.publications.find((p) => p.id === h.publicationId)
                        ?.name ?? 'Unavailable',
                  },
                  { key: 'date', header: 'Date', render: (h) => h.date },
                  { key: 'reason', header: 'Reason', render: (h) => h.reason },
                  {
                    key: 'active',
                    header: 'Status',
                    render: (h) =>
                      h.active ? 'Non-printing day' : 'Cancelled',
                  },
                  {
                    key: 'edit',
                    header: 'Action',
                    render: (h) => (
                      <Button
                        variant="tertiary"
                        onClick={() => open(() => setHoliday(h))}
                      >
                        Edit press holiday
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          </>
        )
      )}
      {complaint && (
        <ComplaintEditor
          {...complaint}
          store={store}
          onClose={() => setComplaint(null)}
        />
      )}{' '}
      {flag && (
        <OverrideEditor
          delivery={flag}
          store={store}
          onClose={() => setFlag(null)}
        />
      )}{' '}
      {assignment !== undefined && (
        <SubstituteEditor
          record={assignment}
          store={store}
          onClose={() => setAssignment(undefined)}
        />
      )}{' '}
      {holiday !== undefined && (
        <HolidayEditor
          record={holiday}
          store={store}
          onClose={() => setHoliday(undefined)}
        />
      )}
    </div>
  );
});

'use client';
import { useEffect, useState } from 'react';
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
  formatMoney,
} from '@daybook/ui';
import { CommerceStore } from './store';
import { CommerceEditor, type CommerceRecord, type EditorKind } from './editor';
type Kind = 'publishers' | 'inventory' | 'advertisers';
const headings = {
  publishers: [
    'Publishers & returns',
    'Record supply, eligible returns and monthly reconciliation.',
    'Add publisher',
  ],
  inventory: [
    'Seasonal stock',
    'Manage calendars, diaries and festival issues from preorder to fulfilment.',
    'Add seasonal item',
  ],
  advertisers: [
    'Advertisers & inserts',
    'Plan targeted leaflet distribution and bill completed campaigns.',
    'Add advertiser',
  ],
} as const;
export const CommerceScreen = observer(function CommerceScreen({
  kind,
}: {
  kind: Kind;
}) {
  const [store] = useState(() => new CommerceStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  const [search, setSearch] = useState(''),
    [editor, setEditor] = useState<{
      kind: EditorKind;
      record: CommerceRecord | null;
    } | null>(null),
    [statementPublisher, setStatementPublisher] = useState(''),
    [month, setMonth] = useState('');
  function open(kind: EditorKind, record: CommerceRecord | null = null) {
    store.clearSaveError();
    setEditor({ kind, record });
  }
  const matches = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .includes(search.normalize('NFKC').trim().toLowerCase());
  const filteredPublishers = store.publishers.filter((p) =>
      matches(`${p.name} ${p.phone}`),
    ),
    filteredItems = store.items.filter((i) =>
      matches(`${i.name} ${i.sku} ${i.kind}`),
    ),
    filteredAdvertisers = store.advertisers.filter((a) =>
      matches(`${a.name} ${a.phone} ${a.email ?? ''} ${a.billingAddress}`),
    );
  const resident = (id: string) =>
      store.residents.find((r) => r.id === id)?.name ?? 'Unavailable resident',
    publisher = (id: string) =>
      store.publishers.find((p) => p.id === id)?.name ??
      'Unavailable publisher',
    advertiser = (id: string) =>
      store.advertisers.find((a) => a.id === id)?.name ??
      'Unavailable advertiser';
  const primary =
    kind === 'publishers'
      ? 'publisher'
      : kind === 'inventory'
        ? 'item'
        : 'advertiser';
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">Agency operations</p>
          <h1>{headings[kind][0]}</h1>
          <p className="db-muted">{headings[kind][1]}</p>
        </div>
        <Button
          disabled={store.state !== 'ready'}
          onClick={() => open(primary)}
        >
          {headings[kind][2]}
        </Button>
      </header>
      {store.error && (
        <DataState
          kind="error"
          title="Agency records unavailable"
          description={store.error}
          onRetry={store.load}
        />
      )}
      {store.saveError && !editor && (
        <Notification
          tone="error"
          title="Changes could not be confirmed"
          description={store.saveError}
        />
      )}{' '}
      {store.notice && (
        <Notification
          tone="success"
          title="Changes saved"
          description={store.notice}
        />
      )}
      {store.state === 'loading' ? (
        <DataState kind="loading" title="Loading agency records" />
      ) : (
        store.state === 'ready' && (
          <>
            <SearchField
              label={
                kind === 'publishers'
                  ? 'Find publisher'
                  : kind === 'inventory'
                    ? 'Find seasonal item'
                    : 'Find advertiser'
              }
              value={search}
              onValueChange={setSearch}
              placeholder="Search by name or code"
            />
            {kind === 'publishers' && (
              <>
                <Card title="Publishers">
                  <DataTable
                    caption="Publishers"
                    rows={filteredPublishers}
                    rowKey={(p) => p.id}
                    state={
                      filteredPublishers.length
                        ? 'ready'
                        : store.publishers.length
                          ? 'no-results'
                          : 'empty'
                    }
                    emptyTitle="No publishers yet"
                    emptyAction={
                      <Button onClick={() => open('publisher')}>
                        Add first publisher
                      </Button>
                    }
                    columns={[
                      {
                        key: 'name',
                        header: 'Publisher',
                        render: (p) => <strong>{p.name}</strong>,
                      },
                      { key: 'phone', header: 'Phone', render: (p) => p.phone },
                      {
                        key: 'cutoff',
                        header: 'Return cutoff',
                        render: (p) =>
                          `${p.returnCutoff} · ${p.returnWindowDays} day window · ${store.timezone}`,
                      },
                      {
                        key: 'active',
                        header: 'Status',
                        render: (p) => (
                          <Badge tone={p.active ? 'success' : 'neutral'}>
                            {p.active ? 'Active' : 'Inactive'}
                          </Badge>
                        ),
                      },
                      {
                        key: 'edit',
                        header: 'Action',
                        render: (p) => (
                          <Button
                            variant="tertiary"
                            onClick={() => open('publisher', p)}
                          >
                            Edit publisher
                          </Button>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card
                  title="Publisher supply lots"
                  trailing={
                    <Button variant="secondary" onClick={() => open('supply')}>
                      Receive supply
                    </Button>
                  }
                >
                  <DataTable
                    caption="Publisher supply lots"
                    rows={store.supplies}
                    rowKey={(s) => s.id}
                    emptyTitle="No supply received"
                    columns={[
                      {
                        key: 'date',
                        header: 'Issue / publisher',
                        render: (s) => (
                          <>
                            {s.date}
                            <div className="db-muted">
                              {publisher(s.publisherId)}
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'pub',
                        header: 'Publication',
                        render: (s) => (
                          <>
                            {s.publicationName}
                            <div className="db-muted">{s.dispatch}</div>
                          </>
                        ),
                      },
                      {
                        key: 'qty',
                        header: 'Supplied / returned',
                        render: (s) => `${s.quantity} / ${s.returned}`,
                      },
                      {
                        key: 'cost',
                        header: 'Net cost / total',
                        render: (s) => (
                          <>
                            {formatMoney(s.netCost)}
                            <div>{formatMoney(s.totalCost)}</div>
                          </>
                        ),
                      },
                      {
                        key: 'return',
                        header: 'Action',
                        render: (s) => (
                          <Button
                            variant="tertiary"
                            disabled={s.returned >= s.quantity}
                            onClick={() => open('return', s)}
                          >
                            Record return
                          </Button>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="Validated returns">
                  <DataTable
                    caption="Publisher returns"
                    rows={store.returns}
                    rowKey={(r) => r.id}
                    emptyTitle="No returns recorded"
                    columns={[
                      {
                        key: 'date',
                        header: 'Recorded date',
                        render: (r) => r.date,
                      },
                      {
                        key: 'publication',
                        header: 'Publication',
                        render: (r) =>
                          store.supplies.find((s) => s.id === r.supplyId)
                            ?.publicationName ?? 'Unavailable supply lot',
                      },
                      {
                        key: 'quantity',
                        header: 'Returned copies',
                        render: (r) => r.quantity,
                      },
                      {
                        key: 'reason',
                        header: 'Reason',
                        render: (r) => r.reason,
                      },
                      {
                        key: 'credit',
                        header: 'Publisher credit',
                        render: (r) => formatMoney(r.credit),
                      },
                    ]}
                  />
                </Card>
                <Card title="Monthly publisher statement">
                  <form
                    className="agency-toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void store.loadStatement(
                        statementPublisher,
                        month || store.today.slice(0, 7),
                      );
                    }}
                  >
                    <Select
                      label="Statement publisher"
                      value={statementPublisher}
                      options={[
                        { value: '', label: 'Choose publisher' },
                        ...store.publishers.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onChange={(e) => setStatementPublisher(e.target.value)}
                    />
                    <Field
                      label="Reconciliation month"
                      type="month"
                      required
                      value={month || store.today.slice(0, 7)}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                    <Button
                      type="submit"
                      loading={store.statementLoading}
                      disabled={!statementPublisher}
                    >
                      View statement
                    </Button>
                  </form>
                  {store.statementError && (
                    <DataState
                      kind="error"
                      title="Statement unavailable"
                      description={store.statementError}
                      onRetry={() =>
                        void store.loadStatement(
                          statementPublisher,
                          month || store.today.slice(0, 7),
                        )
                      }
                    />
                  )}{' '}
                  {store.statement && (
                    <>
                      <p>
                        <strong>
                          {publisher(store.statement.publisherId)}
                        </strong>{' '}
                        · {store.statement.month}
                      </p>
                      <div className="agency-metrics">
                        <MetricCard
                          title="Supply cost"
                          value={formatMoney(store.statement.supplyCost)}
                        />
                        <MetricCard
                          title="Return credits"
                          value={formatMoney(store.statement.returnCredit)}
                        />
                        <MetricCard
                          title="Net payable"
                          value={formatMoney(store.statement.netPayable)}
                        />
                      </div>
                      <DataTable
                        caption="Publisher reconciliation"
                        rows={store.statement.rows}
                        rowKey={(r) => `${r.publicationId}:${r.dispatch}`}
                        emptyTitle="No supply or return entries in this month"
                        columns={[
                          {
                            key: 'title',
                            header: 'Publication / dispatch',
                            render: (r) => `${r.name} · ${r.dispatch}`,
                          },
                          {
                            key: 'qty',
                            header: 'Supplied / returned',
                            render: (r) => `${r.supplied} / ${r.returned}`,
                          },
                          {
                            key: 'supply',
                            header: 'Supply cost',
                            render: (r) => formatMoney(r.supplyCost),
                          },
                          {
                            key: 'credit',
                            header: 'Return credit',
                            render: (r) => formatMoney(r.returnCredit),
                          },
                          {
                            key: 'net',
                            header: 'Net payable',
                            render: (r) => formatMoney(r.netPayable),
                          },
                        ]}
                      />
                    </>
                  )}
                </Card>
              </>
            )}
            {kind === 'inventory' && (
              <>
                <Card title="Seasonal items">
                  <DataTable
                    caption="Seasonal stock"
                    rows={filteredItems}
                    rowKey={(i) => i.id}
                    state={
                      filteredItems.length
                        ? 'ready'
                        : store.items.length
                          ? 'no-results'
                          : 'empty'
                    }
                    emptyTitle="No seasonal items yet"
                    emptyAction={
                      <Button onClick={() => open('item')}>
                        Add first seasonal item
                      </Button>
                    }
                    columns={[
                      {
                        key: 'name',
                        header: 'Item',
                        render: (i) => (
                          <>
                            <strong>{i.name}</strong>
                            <div className="db-muted">
                              {i.sku} · {i.kind}
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'price',
                        header: 'Retail price',
                        render: (i) => formatMoney(i.price),
                      },
                      {
                        key: 'stock',
                        header: 'On hand / reserved / available',
                        render: (i) =>
                          `${i.onHand} / ${i.reserved} / ${i.available}`,
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (i) => (i.active ? 'Active' : 'Inactive'),
                      },
                      {
                        key: 'action',
                        header: 'Actions',
                        render: (i) => (
                          <div className="db-row">
                            <Button
                              variant="tertiary"
                              onClick={() => open('item', i)}
                            >
                              Edit item
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => open('stock', i)}
                            >
                              Receive stock
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card
                  title="Seasonal preorders"
                  trailing={
                    <Button
                      variant="secondary"
                      onClick={() => open('preorder')}
                    >
                      New preorder
                    </Button>
                  }
                >
                  <DataTable
                    caption="Seasonal preorders"
                    rows={store.orders}
                    rowKey={(o) => o.id}
                    emptyTitle="No preorders yet"
                    columns={[
                      {
                        key: 'buyer',
                        header: 'Resident / item',
                        render: (o) => (
                          <>
                            {resident(o.residentId)}
                            <div className="db-muted">
                              {o.name} · {o.quantity} items
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'date',
                        header: 'Dispatch',
                        render: (o) => `${o.date} · ${o.dispatch}`,
                      },
                      {
                        key: 'total',
                        header: 'Agreed total',
                        render: (o) => formatMoney(o.total),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (o) => (
                          <Badge
                            tone={
                              o.status === 'FULFILLED'
                                ? 'success'
                                : o.status === 'CANCELLED'
                                  ? 'neutral'
                                  : 'info'
                            }
                          >
                            {o.status}
                          </Badge>
                        ),
                      },
                      {
                        key: 'actions',
                        header: 'Actions',
                        render: (o) => (
                          <div className="db-row">
                            {o.status === 'PREORDER' && (
                              <Button
                                variant="secondary"
                                disabled={store.saving}
                                onClick={() =>
                                  void store.save('reserve', {
                                    requestId: crypto.randomUUID(),
                                    orderId: o.id,
                                    version: o.version,
                                  })
                                }
                              >
                                Reserve stock
                              </Button>
                            )}
                            {o.status === 'RESERVED' && (
                              <Button
                                variant="secondary"
                                onClick={() => open('fulfil', o)}
                              >
                                Confirm delivery
                              </Button>
                            )}
                            {['PREORDER', 'RESERVED'].includes(o.status) && (
                              <Button
                                variant="tertiary"
                                onClick={() => open('cancelPreorder', o)}
                              >
                                Cancel preorder
                              </Button>
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="Seasonal charges">
                  <DataTable
                    caption="Seasonal charges"
                    rows={store.charges}
                    rowKey={(c) => c.id}
                    emptyTitle="No fulfilled item charges"
                    columns={[
                      {
                        key: 'date',
                        header: 'Recorded date',
                        render: (c) => c.date,
                      },
                      {
                        key: 'resident',
                        header: 'Resident',
                        render: (c) => resident(c.residentId),
                      },
                      {
                        key: 'amount',
                        header: 'Amount',
                        render: (c) => formatMoney(c.amount),
                      },
                      {
                        key: 'settlement',
                        header: 'Settlement',
                        render: (c) =>
                          c.settlement === 'CASH'
                            ? 'Cash received'
                            : 'Resident invoice',
                      },
                      {
                        key: 'receipt',
                        header: 'Cash receipt',
                        render: (c) => c.receiptCode ?? '—',
                      },
                    ]}
                  />
                </Card>
              </>
            )}
            {kind === 'advertisers' && (
              <>
                <Card title="Advertisers">
                  <DataTable
                    caption="Advertisers"
                    rows={filteredAdvertisers}
                    rowKey={(a) => a.id}
                    state={
                      filteredAdvertisers.length
                        ? 'ready'
                        : store.advertisers.length
                          ? 'no-results'
                          : 'empty'
                    }
                    emptyTitle="No advertisers yet"
                    emptyAction={
                      <Button onClick={() => open('advertiser')}>
                        Add first advertiser
                      </Button>
                    }
                    columns={[
                      {
                        key: 'name',
                        header: 'Advertiser',
                        render: (a) => <strong>{a.name}</strong>,
                      },
                      {
                        key: 'contact',
                        header: 'Contact',
                        render: (a) => (
                          <>
                            {a.phone}
                            <div className="db-muted">
                              {a.email ?? 'No email recorded'}
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'address',
                        header: 'Billing address',
                        render: (a) => a.billingAddress,
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (a) => (a.active ? 'Active' : 'Inactive'),
                      },
                      {
                        key: 'edit',
                        header: 'Action',
                        render: (a) => (
                          <Button
                            variant="tertiary"
                            onClick={() => open('advertiser', a)}
                          >
                            Edit advertiser
                          </Button>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card
                  title="Insertion campaigns"
                  trailing={
                    <Button variant="secondary" onClick={() => open('insert')}>
                      Schedule insert
                    </Button>
                  }
                >
                  <DataTable
                    caption="Insertion orders"
                    rows={store.inserts}
                    rowKey={(o) => o.id}
                    emptyTitle="No insertion campaigns"
                    columns={[
                      {
                        key: 'title',
                        header: 'Campaign / advertiser',
                        render: (o) => (
                          <>
                            <strong>{o.title}</strong>
                            <div className="db-muted">
                              {advertiser(o.advertiserId)}
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'date',
                        header: 'Dispatch',
                        render: (o) => `${o.date} · ${o.dispatch}`,
                      },
                      {
                        key: 'targets',
                        header: 'Route quantities',
                        render: (o) =>
                          o.allocations
                            .map(
                              (a) =>
                                `${store.routes.find((r) => r.id === a.routeId)?.name ?? 'Unavailable'}: ${a.quantity}`,
                            )
                            .join(', '),
                      },
                      {
                        key: 'total',
                        header: 'Total',
                        render: (o) => formatMoney(o.total),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (o) => (
                          <Badge
                            tone={
                              o.status === 'COMPLETED' ? 'success' : 'neutral'
                            }
                          >
                            {o.status}
                          </Badge>
                        ),
                      },
                      {
                        key: 'actions',
                        header: 'Actions',
                        render: (o) =>
                          o.status === 'SCHEDULED' ? (
                            <div className="db-row">
                              <Button
                                variant="tertiary"
                                onClick={() => open('insert', o)}
                              >
                                Edit campaign
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={o.date > store.today}
                                onClick={() => open('completeInsert', o)}
                              >
                                Complete and invoice
                              </Button>
                              <Button
                                variant="tertiary"
                                onClick={() => open('cancelInsert', o)}
                              >
                                Cancel campaign
                              </Button>
                            </div>
                          ) : null,
                      },
                    ]}
                  />
                </Card>
                <Card title="Advertiser invoices">
                  <DataTable
                    caption="Advertiser invoices"
                    rows={store.invoices}
                    rowKey={(i) => i.id}
                    emptyTitle="No completed campaign invoices"
                    columns={[
                      {
                        key: 'code',
                        header: 'Invoice',
                        render: (i) => (
                          <>
                            <strong>{i.code}</strong>
                            <div className="db-muted">{i.date}</div>
                          </>
                        ),
                      },
                      {
                        key: 'buyer',
                        header: 'Advertiser',
                        render: (i) => i.advertiserName,
                      },
                      {
                        key: 'subtotal',
                        header: 'Subtotal',
                        render: (i) => formatMoney(i.subtotal),
                      },
                      {
                        key: 'tax',
                        header: 'Recorded tax',
                        render: (i) => formatMoney(i.tax),
                      },
                      {
                        key: 'total',
                        header: 'Total',
                        render: (i) => formatMoney(i.total),
                      },
                      {
                        key: 'proof',
                        header: 'Completion proof',
                        render: (i) => i.proofReference,
                      },
                    ]}
                  />
                </Card>
              </>
            )}
          </>
        )
      )}
      {editor && (
        <CommerceEditor
          key={`${editor.kind}:${editor.record?.id ?? 'new'}`}
          {...editor}
          store={store}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
});

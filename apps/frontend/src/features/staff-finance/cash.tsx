'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  DataState,
  Field,
  MetricCard,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import { usePaymentsStore } from '../payments/hooks';
import { PendingRecovery } from '../payments/screen';
import { FinanceForm } from './forms';
import { CashHistoryRecords, type CashHistory } from './records';
type Source = {
  kind: string;
  id: string;
  receiptCode: string;
  amount: string;
  method: string;
  custodyId: string | null;
  custody: string | null;
  staffId: string | null;
  routeId: string | null;
  claimed: boolean;
};
type Day = {
  date: string;
  directCash: string;
  handoverCash: string;
  outflow: string;
  expectedMovement: string;
  suspense: string;
  unclassified: number;
  unhanded: number;
  sources: Source[];
  closedId: string | null;
};
type Staff = { id: string; name: string };
export const CashScreen = observer(function CashScreen() {
  const store = usePaymentsStore(),
    [date, setDate] = useState(''),
    [day, setDay] = useState<Day | null>(null),
    [staff, setStaff] = useState<Staff[]>([]),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false),
    [readFailed, setReadFailed] = useState(false),
    [readEpoch, setReadEpoch] = useState(0),
    [history, setHistory] = useState<CashHistory>({
      handovers: [],
      closes: [],
      movements: [],
    }),
    [staffId, setStaffId] = useState(''),
    [routeId, setRouteId] = useState(''),
    [actual, setActual] = useState(''),
    [signoff, setSignoff] = useState(''),
    [handoverRequestId, setHandoverRequestId] = useState(''),
    [returnId, setReturnId] = useState(''),
    [returnQty, setReturnQty] = useState(''),
    [returnReason, setReturnReason] = useState(''),
    [lots, setLots] = useState<
      {
        id: string;
        publicationName: string;
        quantity: number;
        returned: number;
      }[]
    >([]);
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready' ||
    reading ||
    readFailed ||
    (Boolean(day) && day?.date !== date) ||
    Boolean(day?.closedId);
  const options = [
      { value: '', label: 'Choose staff' },
      ...staff.map((s) => ({ value: s.id, label: s.name })),
    ],
    routes = [
      { value: '', label: 'Choose route' },
      ...store.routes.map((r) => ({ value: r.id, label: r.name })),
    ];
  useEffect(() => {
    if (!date && store.today) setDate(store.today);
  }, [date, store.today]);
  useEffect(() => {
    let live = true;
    if (store.busy) return;
    void graphqlRequest<{ cashHistory: CashHistory }>(
      '{cashHistory{handovers{id staffId routeId date postingDate expected actual discrepancy outstanding returnedCopies signoff} closes{id date opening expected counted bankDeposit variance reason signoff} movements{id date kind amount handoverId reason}}}',
    )
      .then((d) => {
        if (live) setHistory(d.cashHistory);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [store.busy]);
  useEffect(() => {
    let live = true;
    void graphqlRequest<{ staff: Staff[]; supplyLots: typeof lots }>(
      '{staff{id name} supplyLots{id publicationName quantity returned}}',
    )
      .then((d) => {
        if (live) {
          setStaff(d.staff);
          setLots(d.supplyLots);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [store.busy]);
  useEffect(() => {
    let live = true;
    if (!date || store.busy) return;
    setReading(true);
    setReadFailed(false);
    void graphqlRequest<{ cashDay: Day }>(
      'query($date:String!){cashDay(date:$date){date directCash handoverCash outflow expectedMovement suspense unclassified unhanded closedId sources{kind id receiptCode amount method custodyId custody staffId routeId claimed}}}',
      { date },
    )
      .then((d) => {
        if (live) setDay(d.cashDay);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setReadFailed(true);
        }
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [date, store.busy, readEpoch]);
  const selected =
    day?.sources.filter(
      (s) =>
        s.custody === 'STAFF' &&
        !s.claimed &&
        s.staffId === staffId &&
        s.routeId === routeId,
    ) ?? [];
  const completedRequestId = store.lastCompletedRequestId;
  useEffect(() => {
    if (handoverRequestId && completedRequestId === handoverRequestId) {
      setActual('');
      setSignoff('');
      setReturnId('');
      setReturnQty('');
      setReturnReason('');
      setHandoverRequestId('');
    }
  }, [handoverRequestId, completedRequestId]);
  async function handover(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const requestId = crypto.randomUUID();
    setHandoverRequestId(requestId);
    const returns = returnId
      ? [
          {
            requestId: crypto.randomUUID(),
            supplyId: returnId,
            quantity: Number(returnQty),
            reason: returnReason,
          },
        ]
      : [];
    if (
      await store.execute(
        'handover',
        {
          requestId,
          staffId,
          routeId,
          date,
          paymentIds: [],
          custodyIds: selected.map((s) => s.custodyId),
          actualCash: actual,
          returns,
          signoff,
        },
        '',
      )
    ) {
      setActual('');
      setSignoff('');
      setReturnId('');
      setReturnQty('');
      setReturnReason('');
    }
  }
  return (
    <div className="db-stack">
      <header>
        <h1>Cash handover & closing</h1>
        <p>
          Record money actually handed over. Staff shortages stay in agency
          suspense and do not reduce wages automatically.
        </p>
      </header>
      <PendingRecovery store={store} />
      {(error || store.error) && (
        <Notification
          tone="error"
          title="Cash records need attention"
          description={error || store.error}
        />
      )}
      {store.notice && <Notification tone="success" title={store.notice} />}
      <Field
        label="Cash register date"
        type="date"
        value={date}
        max={store.today}
        disabled={store.busy || Boolean(store.pending)}
        onChange={(e) => {
          setDay(null);
          setDate(e.target.value);
        }}
      />
      {readFailed && (
        <Button onClick={() => setReadEpoch((v) => v + 1)}>
          Retry cash register
        </Button>
      )}
      {reading && !day ? (
        <DataState kind="loading" title="Loading cash register" />
      ) : !day ? (
        <DataState kind="empty" title="Choose a cash day" />
      ) : (
        <>
          {day.closedId && (
            <Notification
              tone="success"
              title="Cash day signed"
              description="This signed snapshot is preserved. Further cash movements require an open day."
            />
          )}
          <div className="db-example-grid">
            <MetricCard
              title="Direct agency cash"
              value={formatMoney(day.directCash)}
            />
            <MetricCard
              title="Actual handovers"
              value={formatMoney(day.handoverCash)}
            />
            <MetricCard
              title="Cash outflows"
              value={formatMoney(day.outflow)}
            />
            <div data-testid="cash-movement">
              <MetricCard
                title="Net drawer movement"
                value={formatMoney(day.expectedMovement)}
              />
            </div>
            <MetricCard
              title="Agency suspense"
              value={formatMoney(day.suspense)}
            />
          </div>
          <Card>
            <h2>Collection custody</h2>
            <p>
              {day.unclassified} unclassified collections; {day.unhanded}{' '}
              staff-held collections awaiting handover. Digital receipts are
              separate from drawer cash.
            </p>
            {!day.sources.length ? (
              <DataState
                kind="empty"
                title="No confirmed collections for this day"
              />
            ) : (
              day.sources.map((s) => (
                <article className="db-stack" key={s.kind + s.id}>
                  <p>
                    {s.receiptCode} · {s.method} · {formatMoney(s.amount)} ·{' '}
                    {s.custody ?? 'Custody unknown'}{' '}
                    {s.claimed ? '· Handed over' : ''}
                  </p>
                  {!s.custody && (
                    <FinanceForm
                      store={store}
                      operation="custody"
                      label="Confirm collection custody"
                      disabled={locked}
                      base={{ sourceKind: s.kind, sourceId: s.id }}
                      fields={[
                        {
                          key: 'custody',
                          label: 'Collection custody',
                          value: s.method === 'CASH' ? 'AGENCY' : 'DIGITAL',
                          options: [
                            {
                              value: 'AGENCY',
                              label: 'Cash at agency counter',
                            },
                            { value: 'STAFF', label: 'Cash held by staff' },
                            {
                              value: 'DIGITAL',
                              label: 'Digital; outside cash drawer',
                            },
                          ],
                        },
                        {
                          key: 'staffId',
                          label: 'Collecting staff (staff custody only)',
                          optional: true,
                          options,
                        },
                        {
                          key: 'routeId',
                          label: 'Collection route (staff custody only)',
                          optional: true,
                          options: routes,
                        },
                        { key: 'reason', label: 'Custody confirmation reason' },
                      ]}
                    />
                  )}
                </article>
              ))
            )}
          </Card>
          <div className="db-example-grid">
            <Card>
              <h2>Rapid route handover</h2>
              <form className="db-stack" onSubmit={(e) => void handover(e)}>
                <fieldset
                  disabled={locked}
                  className="db-stack"
                  style={{ border: 0, padding: 0 }}
                >
                  <Select
                    label="Handover staff"
                    value={staffId}
                    options={options}
                    onChange={(e) => setStaffId(e.target.value)}
                  />
                  <Select
                    label="Handover route"
                    value={routeId}
                    options={routes}
                    onChange={(e) => setRouteId(e.target.value)}
                  />
                  <p>
                    {selected.length} eligible collection receipts. Expected
                    amounts are shown above; hand over only money actually
                    received.
                  </p>
                  <Field
                    label="Actual cash received"
                    required
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                  />
                  <Select
                    label="Returned publication lot (optional)"
                    value={returnId}
                    options={[
                      { value: '', label: 'No publisher returns' },
                      ...lots
                        .filter((l) => l.quantity > l.returned)
                        .map((l) => ({
                          value: l.id,
                          label: `${l.publicationName} · ${l.quantity - l.returned} remaining`,
                        })),
                    ]}
                    onChange={(e) => setReturnId(e.target.value)}
                  />
                  {returnId && (
                    <>
                      <Field
                        label="Original copies returned"
                        type="number"
                        min={1}
                        required
                        value={returnQty}
                        onChange={(e) => setReturnQty(e.target.value)}
                      />
                      <Field
                        label="Return reason"
                        required
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                      />
                    </>
                  )}
                  <Field
                    label="Handover sign-off"
                    required
                    value={signoff}
                    onChange={(e) => setSignoff(e.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={
                      !staffId || !routeId || (!selected.length && !returnId)
                    }
                  >
                    Sign handover
                  </Button>
                </fieldset>
              </form>
            </Card>
            <Card>
              <h2>Petty cash or bank deposit</h2>
              <FinanceForm
                store={store}
                operation="cashExpense"
                label="Record cash outflow"
                disabled={locked}
                fields={[
                  {
                    key: 'kind',
                    label: 'Cash outflow type',
                    value: 'PETTY',
                    options: [
                      { value: 'PETTY', label: 'Petty cash expense' },
                      {
                        value: 'BANK_DEPOSIT',
                        label: 'Cash deposited at bank',
                      },
                    ],
                  },
                  { key: 'amount', label: 'Cash outflow amount' },
                  { key: 'reason', label: 'Cash outflow reason' },
                ]}
              />
            </Card>
            <Card>
              <h2>Late remittance or suspense classification</h2>
              <p>
                Select the original signed handover. A memo classification moves
                no cash and creates no staff debt.
              </p>
              <FinanceForm
                store={store}
                operation="cashExpense"
                label="Record suspense action"
                disabled={locked}
                fields={[
                  {
                    key: 'kind',
                    label: 'Suspense action',
                    value: 'LATE_REMITTANCE',
                    options: [
                      {
                        value: 'LATE_REMITTANCE',
                        label: 'Actual late cash received',
                      },
                      {
                        value: 'SUSPENSE_RESOLUTION',
                        label:
                          'Reasoned memo classification; no funds movement',
                      },
                    ],
                  },
                  {
                    key: 'handoverId',
                    label: 'Original handover',
                    options: [
                      { value: '', label: 'Choose signed handover' },
                      ...history.handovers.map((h) => ({
                        value: h.id,
                        label: `${h.postingDate} · ${staff.find((s) => s.id === h.staffId)?.name ?? 'Recorded staff'} · Memo ${formatMoney(h.discrepancy)}`,
                      })),
                    ],
                  },
                  {
                    key: 'amount',
                    label: 'Late cash amount (zero for memo classification)',
                  },
                  { key: 'reason', label: 'Suspense action reason' },
                ]}
              />
            </Card>
            <Card>
              <h2>Owner closing sign-off</h2>
              <p>
                Enter observed opening and drawer counts. Bank deposits already
                recorded as outflows must not be entered again here.
              </p>
              <FinanceForm
                key={date}
                store={store}
                operation="cashClose"
                label="Sign cash close"
                disabled={
                  locked ||
                  date !== store.today ||
                  day.unclassified > 0 ||
                  day.unhanded > 0
                }
                base={{ date }}
                fields={[
                  {
                    key: 'opening',
                    label: 'Opening cash',
                    value:
                      history.closes.find((c) => c.date < date)?.counted ?? '',
                    hint: 'Required; unknown opening is never assumed to be zero.',
                  },
                  { key: 'counted', label: 'Counted drawer cash' },
                  {
                    key: 'bankDeposit',
                    label: 'Bank deposit at closing',
                    value: '0',
                  },
                  { key: 'reason', label: 'Closing reason' },
                  { key: 'signoff', label: 'Closing sign-off' },
                ]}
              />
            </Card>
          </div>
        </>
      )}
      <CashHistoryRecords
        history={history}
        staff={staff}
        routes={store.routes}
      />
    </div>
  );
});

'use client';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import {
  BillSummary,
  Button,
  Card,
  Checkbox,
  DataState,
  DataTable,
  Field,
  Notification,
  SearchField,
  Select,
  formatMoney,
} from '@daybook/ui';
import { BillingStore } from './store';
export const BillingScreen = observer(function BillingScreen() {
  const [store] = useState(() => new BillingStore()),
    [search, setSearch] = useState(''),
    [route, setRoute] = useState('');
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  const residents = store.residents
    .filter(
      (r) =>
        (!route || r.routeId === route) &&
        `${r.name} ${r.code}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.routeId.localeCompare(b.routeId) ||
        (a.dropOrder ?? 99999) - (b.dropOrder ?? 99999),
    );
  const bill = store.bill,
    disabled = store.busy || Boolean(store.pending),
    editable = store.editing;
  function change(work: () => void) {
    runInAction(() => {
      work();
      store.change();
    });
  }
  if (store.state === 'loading')
    return <DataState kind="loading" title="Loading collections…" />;
  if (store.state === 'error')
    return (
      <DataState
        kind="error"
        title="Collections unavailable"
        description={store.error}
        onRetry={() => void store.load()}
      />
    );
  return (
    <div className="db-stack" style={{ gap: 24 }}>
      <div className="db-stack db-no-print" style={{ gap: 24 }}>
        <header>
          <p className="db-eyebrow">Billing & collection</p>
          <h1>Collections</h1>
          <p>
            Prepare bills from recorded deliveries, then work through residents
            in route order.
          </p>
        </header>
        {store.error && (
          <Notification
            tone="error"
            title="Bill not confirmed"
            description={store.error}
          />
        )}
        {store.notice && <Notification tone="success" title={store.notice} />}
        {store.policy.taxTreatment === 'UNCONFIGURED' && (
          <Card>
            <h2>Confirm billing tax treatment</h2>
            <p>
              Bills cannot be issued until the agency tax treatment is
              confirmed.
            </p>
            <Button
              disabled={disabled}
              onClick={() => void store.confirmNoTax()}
            >
              Confirm bills have no tax
            </Button>
          </Card>
        )}
        <div className="db-row">
          <SearchField
            label="Find resident"
            value={search}
            onValueChange={setSearch}
          />
          <Select
            label="Collection route"
            value={route}
            placeholder="All routes"
            options={store.routes.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(e) => setRoute(e.target.value)}
          />
        </div>
        <DataTable
          caption="Collection run-sheet"
          rows={residents}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'resident',
              header: 'Resident',
              render: (r) => (
                <>
                  <strong>{r.name}</strong>
                  <br />
                  {r.code} · Drop {r.dropOrder ?? 'unavailable'}
                </>
              ),
            },
            {
              key: 'bill',
              header: 'Saved bills',
              render: (r) => (
                <div className="db-stack">
                  {store.invoices
                    .filter((b) => b.resident.id === r.id)
                    .map((b) => (
                      <Button
                        key={b.id}
                        variant="tertiary"
                        disabled={disabled}
                        onClick={() => store.open(b)}
                      >
                        Open {b.code} · {formatMoney(b.remaining)}
                      </Button>
                    ))}
                </div>
              ),
            },
            {
              key: 'action',
              header: 'Prepare',
              render: (r) => (
                <Button
                  variant="secondary"
                  disabled={disabled || r.status !== 'ACTIVE'}
                  aria-label={`Prepare bill for ${r.name}`}
                  onClick={() => store.prepare(r.id)}
                >
                  Prepare bill
                </Button>
              ),
            },
          ]}
        />
        {editable && (
          <Card>
            <h2>{bill?.id ? 'Edit bill' : 'Prepare bill'}</h2>
            <fieldset
              disabled={disabled}
              style={{ border: 0, padding: 0 }}
              className="db-stack"
            >
              <div className="db-row">
                <Select
                  options={[
                    { value: 'CUSTOM', label: 'Custom dates' },
                    { value: 'MONTHLY', label: 'Monthly' },
                    { value: 'WEEKLY', label: 'Weekly' },
                    { value: 'SELECTED_MONTHS', label: 'Selected past months' },
                  ]}
                  label="Billing period"
                  value={store.mode}
                  disabled={Boolean(bill?.id)}
                  onChange={(e) =>
                    change(() => {
                      store.mode = e.target.value;
                    })
                  }
                ></Select>
                {store.mode === 'SELECTED_MONTHS' && (
                  <Field
                    label="Selected months"
                    hint="YYYY-MM, separated by commas"
                    value={store.selectedMonths}
                    disabled={Boolean(bill?.id)}
                    onChange={(e) =>
                      change(() => {
                        store.selectedMonths = e.target.value;
                      })
                    }
                  />
                )}
                <Field
                  label="From date"
                  type="date"
                  value={store.from}
                  max={store.today}
                  disabled={Boolean(bill?.id)}
                  onChange={(e) =>
                    change(() => {
                      store.from = e.target.value;
                    })
                  }
                />
                <Field
                  label="To date"
                  type="date"
                  value={store.to}
                  max={store.today}
                  disabled={Boolean(bill?.id)}
                  onChange={(e) =>
                    change(() => {
                      store.to = e.target.value;
                    })
                  }
                />
              </div>
              {bill?.lines
                .filter((l) => l.kind === 'DELIVERY')
                .map((line) => {
                  const correction = store.corrections.find(
                    (c) => c.key === line.key,
                  );
                  return (
                    <div className="db-stack" key={line.key}>
                      <h3>{line.description}</h3>
                      <div className="db-row">
                        <Field
                          label={`Rate for ${line.description}`}
                          inputMode="decimal"
                          value={correction?.rate ?? line.rate}
                          onChange={(e) =>
                            store.correct(line.key, { rate: e.target.value })
                          }
                        />
                        <Field
                          label={`Reason for ${line.description}`}
                          value={correction?.reason ?? line.reason ?? ''}
                          onChange={(e) =>
                            store.correct(line.key, { reason: e.target.value })
                          }
                        />
                      </div>
                      {line.deliveryItems.map((member) => (
                        <Field
                          key={member.id}
                          label={`Copies for ${line.description} on ${member.date}`}
                          type="number"
                          min={0}
                          step={1}
                          value={
                            correction?.deliveryQuantities?.find(
                              (d) => d.deliveryId === member.id,
                            )?.quantity ?? member.quantity
                          }
                          onChange={(e) => {
                            const quantities = line.deliveryItems.map((d) => ({
                              deliveryId: d.id,
                              quantity:
                                correction?.deliveryQuantities?.find(
                                  (v) => v.deliveryId === d.id,
                                )?.quantity ?? d.quantity,
                            }));
                            quantities.find(
                              (d) => d.deliveryId === member.id,
                            )!.quantity = Number(e.target.value);
                            store.correct(line.key, {
                              quantity: quantities.reduce(
                                (s, d) => s + d.quantity,
                                0,
                              ),
                              deliveryQuantities: quantities,
                            });
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              {store.adjustments.map((adjustment, index) => (
                <div className="db-row" key={adjustment.id}>
                  <Select
                    label={`Adjustment type ${index + 1}`}
                    value={adjustment.kind}
                    options={[
                      { value: 'CREDIT', label: 'Credit' },
                      { value: 'SURCHARGE', label: 'Surcharge' },
                    ]}
                    onChange={(e) =>
                      change(() => {
                        adjustment.kind = e.target.value;
                      })
                    }
                  />
                  <Field
                    label={`Adjustment amount ${index + 1}`}
                    inputMode="decimal"
                    value={adjustment.amount}
                    onChange={(e) =>
                      change(() => {
                        adjustment.amount = e.target.value;
                      })
                    }
                  />
                  <Field
                    label={`Adjustment reason ${index + 1}`}
                    value={adjustment.reason}
                    onChange={(e) =>
                      change(() => {
                        adjustment.reason = e.target.value;
                      })
                    }
                  />
                  <Button
                    variant="tertiary"
                    onClick={() =>
                      change(() => {
                        store.adjustments = store.adjustments.filter(
                          (a) => a.id !== adjustment.id,
                        );
                      })
                    }
                  >
                    Remove adjustment {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  change(() => {
                    store.adjustments.push({
                      id: crypto.randomUUID(),
                      kind: 'CREDIT',
                      amount: '',
                      reason: '',
                    });
                  })
                }
              >
                Add credit or surcharge
              </Button>
              <Field
                label="Bill note"
                value={store.note}
                onChange={(e) =>
                  change(() => {
                    store.note = e.target.value;
                  })
                }
              />
              <Button
                loading={store.busy}
                onClick={() => void store.recalculate()}
              >
                Recalculate bill
              </Button>
            </fieldset>
            {bill && (
              <>
                <p>
                  {store.dirty
                    ? 'Changes need recalculation before saving.'
                    : 'Review the calculated bill below before saving.'}
                </p>
                {bill.missingDayCount > 0 && (
                  <Checkbox
                    label={`I reviewed ${bill.missingDayCount} unprepared delivery dates`}
                    checked={store.acknowledged}
                    disabled={disabled}
                    onChange={(e) =>
                      runInAction(() => {
                        store.acknowledged = e.target.checked;
                      })
                    }
                  />
                )}
                <Button
                  disabled={
                    store.dirty ||
                    !bill.canIssue ||
                    (bill.missingDayCount > 0 && !store.acknowledged)
                  }
                  loading={store.busy}
                  onClick={() => void store.save()}
                >
                  {store.pending ? 'Retry original save' : 'Save bill'}
                </Button>
              </>
            )}
          </Card>
        )}
      </div>
      {bill && (
        <BillSummary
          resident={{
            name: bill.resident.name,
            reference: bill.resident.code,
            address: bill.resident.address,
          }}
          invoice={bill.code ?? 'Draft bill'}
          period={bill.periods.map((p) => `${p.from} – ${p.to}`).join(', ')}
          issued={bill.issuedDate}
          due={bill.dueDate}
          status={
            editable ? 'Draft' : bill.status === 'PAID' ? 'Paid' : 'Saved'
          }
          lines={bill.lines.map((l) => ({
            id: l.key,
            publication: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
          }))}
          totals={[
            { label: 'Current charges', amount: bill.currentAmount },
            { label: 'Credits / surcharges', amount: bill.adjustmentsTotal },
            { label: 'Previous balance', amount: bill.previousBalance },
            { label: 'Payments received', amount: bill.paymentsReceived },
            { label: 'Total due', amount: bill.totalDue },
          ]}
          note={bill.note}
          footer={
            !editable && (
              <div className="db-row db-no-print">
                <Button disabled={disabled || bill.locked} onClick={store.edit}>
                  Edit bill
                </Button>
                <Button variant="secondary" onClick={() => window.print()}>
                  Print bill
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    const index = residents.findIndex(
                        (r) => r.id === bill.resident.id,
                      ),
                      next = residents[index + 1];
                    if (next) store.prepare(next.id);
                    else
                      runInAction(() => {
                        store.notice = 'End of collection route';
                      });
                  }}
                >
                  Move to next
                </Button>
              </div>
            )
          }
        />
      )}
    </div>
  );
});

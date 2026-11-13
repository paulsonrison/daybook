'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataState,
  DataTable,
  Field,
  MetricCard,
  Notification,
  formatMoney,
} from '@daybook/ui';
import { usePaymentsStore } from './hooks';
import { PendingRecovery } from './screen';
import type { PaymentsStore } from './store';
const CreditPolicyForm = observer(function CreditPolicyForm({
  store,
}: {
  store: PaymentsStore;
}) {
  const [amount, setAmount] = useState(store.policy.maxOverdueAmount ?? ''),
    [days, setDays] = useState(
      store.policy.maxOverdueDays === null
        ? ''
        : String(store.policy.maxOverdueDays),
    ),
    [enabled, setEnabled] = useState(store.policy.enabled);
  return (
    <Card>
      <h2>Overdue credit limits</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void store.savePolicy({
            maxOverdueAmount: amount.trim() || null,
            maxOverdueDays: days === '' ? null : Number(days),
            enabled,
          });
        }}
      >
        <fieldset
          className="db-stack"
          style={{ border: 0, padding: 0 }}
          disabled={store.locked}
        >
          <Checkbox
            label="Enable overdue credit alerts"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Field
            label="Maximum overdue amount"
            inputMode="decimal"
            hint="Blank disables the amount threshold. Only confirmed outstanding overdue debt is counted."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Maximum overdue days"
            type="number"
            min={1}
            max={3650}
            hint="Blank disables the age threshold. The configured day is included."
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Button type="submit" loading={store.busy}>
            Save credit limits
          </Button>
        </fieldset>
      </form>
    </Card>
  );
});
export const CreditControlScreen = observer(function CreditControlScreen() {
  const store = usePaymentsStore();
  if (store.state === 'loading')
    return <DataState kind="loading" title="Loading credit controls…" />;
  if (store.state === 'error')
    return (
      <DataState
        kind="error"
        title="Credit controls unavailable"
        description={store.error}
        onRetry={() => void store.load()}
      />
    );
  const risks = store.risks.filter((r) => r.highRisk);
  const locked = store.locked;
  return (
    <div className="db-stack" style={{ gap: 24 }}>
      <header>
        <p className="db-eyebrow">Agency settings</p>
        <h1>Credit control</h1>
        <p>
          Review overdue accounts and explicitly pause service when a credit
          limit is exceeded.
        </p>
      </header>
      <PendingRecovery store={store} />
      {store.error && (
        <Notification
          tone="error"
          title="Action not confirmed"
          description={store.error}
        />
      )}{' '}
      {store.notice && <Notification title={store.notice} />}
      <MetricCard title="Accounts above credit limits" value={risks.length} />
      <CreditPolicyForm store={store} />
      <Card>
        <h2>Overdue accounts</h2>
        {risks.length ? (
          <DataTable
            caption="Accounts exceeding credit limits"
            rows={risks}
            rowKey={(r) => r.residentId}
            columns={[
              {
                key: 'name',
                header: 'Resident',
                render: (r) => (
                  <>
                    {r.name}
                    <br />
                    {r.code} · {r.routeName}
                  </>
                ),
              },
              {
                key: 'overdue',
                header: 'Overdue',
                render: (r) => (
                  <>
                    {formatMoney(r.overdueAmount)}
                    <br />
                    {r.overdueDays} days
                  </>
                ),
              },
              {
                key: 'status',
                header: 'Service',
                render: (r) => (
                  <Badge>
                    {r.status === 'SUSPENDED' ? 'Suspended' : 'Active'}
                  </Badge>
                ),
              },
              {
                key: 'action',
                header: 'Action',
                render: (r) =>
                  r.status === 'ACTIVE' ? (
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() =>
                        void store.execute(
                          'suspend',
                          {
                            requestId: crypto.randomUUID(),
                            residentId: r.residentId,
                            version: r.version,
                            reason: `Credit limit exceeded: ${r.overdueDays} days overdue and ${r.overdueAmount} outstanding.`,
                          },
                          r.residentId,
                        )
                      }
                    >
                      Suspend service for {r.name}
                    </Button>
                  ) : (
                    <span>Credit hold recorded</span>
                  ),
              },
            ]}
          />
        ) : (
          <DataState
            kind="empty"
            title={
              store.policy.enabled
                ? 'No accounts exceed the credit limits'
                : 'Credit alerts are disabled'
            }
          />
        )}
        <p>
          Service suspension is recorded immediately. WhatsApp delivery remains
          unavailable until messaging is configured.
        </p>
      </Card>
    </div>
  );
});

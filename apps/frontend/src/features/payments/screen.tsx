'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { runInAction } from 'mobx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataState,
  DataTable,
  Dialog,
  Field,
  MetricCard,
  Notification,
  PaymentConfirmation,
  Select,
  formatMoney,
} from '@daybook/ui';
import type { PaymentsStore, Payment } from './store';
import { usePaymentsStore } from './hooks';
export const PendingRecovery = observer(function PendingRecovery({
  store,
}: {
  store: PaymentsStore;
}) {
  if (store.recoveryUnavailable)
    return (
      <Notification
        tone="error"
        title="Payment recovery unavailable"
        description="Account history remains available. Restore this browser’s access to saved records, then reload to check recovery before recording more funds."
        action={
          <Button onClick={() => window.location.reload()}>
            Retry recovery check
          </Button>
        }
      />
    );
  return store.pending ? (
    <Notification
      tone="warning"
      title="Original operation unconfirmed"
      description="New financial actions are blocked until the original request is resolved."
      action={
        <Button loading={store.busy} onClick={() => void store.retryOriginal()}>
          Check original operation
        </Button>
      }
    />
  ) : null;
});
const PaymentForm = observer(function PaymentForm({
  store,
}: {
  store: PaymentsStore;
}) {
  const today = store.today;
  const initial = useCallback(
    () => ({
      requestId: crypto.randomUUID(),
      purpose: 'ACCOUNT',
      method: 'CASH',
      amount: '',
      date: today,
      reference: '',
      targetInvoiceId: '',
      confirmReceived: false,
      confirmationNote: '',
      collectorCustody: '',
      collectorStaffId: '',
      collectorRouteId: '',
    }),
    [today],
  );
  const [draft, setDraft] = useState(() => ({
    ...initial(),
    targetInvoiceId:
      new URLSearchParams(window.location.search).get('invoice') ?? '',
  }));
  useEffect(() => {
    const completed = store.lastPayment?.requestId;
    if (completed)
      setDraft((old) => (old.requestId === completed ? initial() : old));
  }, [store.lastPayment?.requestId, initial]);
  const change = (key: string, value: string | boolean) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <Card>
      <h2>Record funds received</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void store.execute('record', {
            ...draft,
            collectorCustody:
              draft.method === 'CASH' && draft.confirmReceived
                ? draft.collectorCustody || null
                : null,
            collectorStaffId:
              draft.method === 'CASH' &&
              draft.confirmReceived &&
              draft.collectorCustody === 'STAFF'
                ? draft.collectorStaffId || null
                : null,
            collectorRouteId:
              draft.method === 'CASH' &&
              draft.confirmReceived &&
              draft.collectorCustody === 'STAFF'
                ? draft.collectorRouteId || null
                : null,
            residentId: store.selectedResidentId,
            targetInvoiceId:
              draft.purpose === 'ACCOUNT' && draft.targetInvoiceId
                ? draft.targetInvoiceId
                : null,
            reference: draft.reference || null,
            confirmReceived:
              draft.method === 'CHEQUE' ? false : draft.confirmReceived,
          });
        }}
      >
        <fieldset
          disabled={store.locked}
          className="db-stack"
          style={{ border: 0, padding: 0 }}
        >
          <div className="db-row">
            <Select
              label="Receipt purpose"
              value={draft.purpose}
              options={[
                { value: 'ACCOUNT', label: 'Resident account' },
                {
                  value: 'DEPOSIT',
                  label: 'Caution deposit',
                  disabled: store.person?.status === 'CLOSED',
                },
              ]}
              onChange={(e) => change('purpose', e.target.value)}
            />
            <Select
              label="Payment method"
              value={draft.method}
              options={['CASH', 'UPI', 'BANK', 'CHEQUE'].map((value) => ({
                value,
                label:
                  value === 'BANK'
                    ? 'Bank transfer'
                    : value === 'CHEQUE'
                      ? 'Cheque'
                      : value,
              }))}
              onChange={(e) =>
                setDraft((old) => ({
                  ...old,
                  method: e.target.value,
                  confirmReceived: false,
                }))
              }
            />
            <Field
              label="Payment amount"
              inputMode="decimal"
              required
              value={draft.amount}
              onChange={(e) => change('amount', e.target.value)}
            />
            <Field
              label="Received date"
              type="date"
              max={store.today}
              required
              value={draft.date}
              onChange={(e) => change('date', e.target.value)}
            />
          </div>
          {draft.purpose === 'ACCOUNT' && (
            <Select
              label="Allocate payment"
              placeholder="Oldest due first"
              value={draft.targetInvoiceId}
              options={store.invoices
                .filter((i) => i.status !== 'PAID')
                .map((i) => ({
                  value: i.id,
                  label: `${i.code} · ${formatMoney(i.remaining)}`,
                }))}
              onChange={(e) => change('targetInvoiceId', e.target.value)}
            />
          )}
          <Field
            label="Transaction reference"
            value={draft.reference}
            onChange={(e) => change('reference', e.target.value)}
            hint={
              draft.method === 'CASH'
                ? 'Optional cash reference'
                : 'Bank / UPI reference or cheque number'
            }
          />
          {draft.method === 'CHEQUE' ? (
            <Notification
              title="Cheque remains pending"
              description="Record clearing evidence separately before it reduces the balance."
            />
          ) : (
            <>
              <Checkbox
                label="I confirmed these funds were received"
                checked={draft.confirmReceived}
                onChange={(e) => change('confirmReceived', e.target.checked)}
              />
              {draft.confirmReceived && (
                <Field
                  label="Confirmation evidence"
                  required
                  value={draft.confirmationNote}
                  onChange={(e) => change('confirmationNote', e.target.value)}
                />
              )}
            </>
          )}
          {draft.method === 'CASH' && draft.confirmReceived && (
            <>
              <Select
                label="Cash collection custody"
                value={draft.collectorCustody}
                options={[
                  { value: '', label: 'Unknown; classify before cash closing' },
                  { value: 'AGENCY', label: 'Cash received at agency counter' },
                  { value: 'STAFF', label: 'Cash held by a staff collector' },
                ]}
                onChange={(e) => change('collectorCustody', e.target.value)}
              />
              {draft.collectorCustody === 'STAFF' && (
                <>
                  <Select
                    label="Cash collector"
                    value={draft.collectorStaffId}
                    options={[
                      { value: '', label: 'Choose collecting staff' },
                      ...store.staffCollectors.map((s) => ({
                        value: s.id,
                        label: s.name,
                      })),
                    ]}
                    onChange={(e) => change('collectorStaffId', e.target.value)}
                  />
                  <Select
                    label="Cash collection route"
                    value={draft.collectorRouteId}
                    options={[
                      { value: '', label: 'Choose collection route' },
                      ...store.routes.map((r) => ({
                        value: r.id,
                        label: r.name,
                      })),
                    ]}
                    onChange={(e) => change('collectorRouteId', e.target.value)}
                  />
                </>
              )}
            </>
          )}
          <Button type="submit" loading={store.busy}>
            Record payment
          </Button>
        </fieldset>
      </form>
    </Card>
  );
});
const FinancialDialog = observer(function FinancialDialog({
  title,
  store,
  onClose,
  onSubmit,
  submitLabel,
  children,
}: {
  title: string;
  store: PaymentsStore;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      title={title}
      busy={store.busy}
      onClose={() => {
        if (!store.pending) onClose();
      }}
    >
      <PendingRecovery store={store} />
      {store.error && (
        <Notification
          tone="error"
          title="Action not confirmed"
          description={store.error}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <fieldset
          disabled={store.locked}
          className="db-stack"
          style={{ border: 0, padding: 0 }}
        >
          {children}
          <div className="db-row">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={store.busy}>
              {submitLabel}
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
});
const ReconcileDialog = observer(function ReconcileDialog({
  store,
  payment,
  onClose,
}: {
  store: PaymentsStore;
  payment: Payment;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState('CONFIRMED'),
    [reference, setReference] = useState(payment.reference ?? ''),
    [evidence, setEvidence] = useState(''),
    [requestId] = useState(() => crypto.randomUUID());
  return (
    <FinancialDialog
      title="Reconcile payment"
      store={store}
      onClose={onClose}
      submitLabel="Confirm reconciliation"
      onSubmit={async () => {
        if (
          await store.execute('reconcile', {
            requestId,
            paymentId: payment.id,
            version: payment.version,
            outcome,
            reference: reference || null,
            evidence,
          })
        )
          onClose();
      }}
    >
      <p>
        {payment.method} · {formatMoney(payment.amount)}. Confirm using your
        cash record or bank statement.
      </p>
      <Select
        label="Reconciliation outcome"
        value={outcome}
        options={[
          { value: 'CONFIRMED', label: 'Funds confirmed / cheque cleared' },
          { value: 'FAILED', label: 'Failed / cheque returned' },
        ]}
        onChange={(e) => setOutcome(e.target.value)}
      />
      <Field
        label="Transaction reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <Field
        label="Reconciliation evidence"
        required
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
      />
    </FinancialDialog>
  );
});
const ClearanceDialog = observer(function ClearanceDialog({
  store,
  onClose,
}: {
  store: PaymentsStore;
  onClose: () => void;
}) {
  const [date, setDate] = useState(store.today),
    [ack, setAck] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  const preview = store.preview;
  return (
    <Dialog
      open
      title="Account clearance"
      busy={store.busy}
      onClose={() => {
        if (!store.pending) onClose();
      }}
    >
      <div className="db-stack">
        <PendingRecovery store={store} />
        {store.error && (
          <Notification
            tone="error"
            title="Clearance not confirmed"
            description={store.error}
          />
        )}
        <Field
          label="Termination date"
          type="date"
          max={store.today}
          value={date}
          disabled={store.locked}
          onChange={(e) => {
            setDate(e.target.value);
            runInAction(() => {
              store.preview = null;
            });
          }}
        />
        <Button
          disabled={store.locked}
          loading={store.busy}
          onClick={() => void store.calculateClearance(date)}
        >
          Calculate clearance
        </Button>
        {preview && (
          <>
            <p>Final deliveries {formatMoney(preview.finalCharges)}</p>
            <p>
              Balance before deposit {formatMoney(preview.balanceBeforeOffset)}
            </p>
            <p>Deposit offset {formatMoney(preview.depositOffset)}</p>
            <p>Refund due {formatMoney(preview.refundDue)}</p>
            <p>Collection due {formatMoney(preview.collectionDue)}</p>
            {preview.missingDayCount > 0 && (
              <Checkbox
                label={`I reviewed ${preview.missingDayCount} unprepared delivery dates`}
                checked={ack}
                disabled={store.locked}
                onChange={(e) => setAck(e.target.checked)}
              />
            )}
            <p>
              Archiving cancels outstanding preorders and future service. Refund
              due is recorded separately from funds actually returned.
            </p>
            <Button
              disabled={
                store.locked ||
                (preview.missingDayCount > 0 && !ack) ||
                preview.unresolvedPayments > 0
              }
              onClick={async () => {
                if (
                  await store.execute('clear', {
                    requestId,
                    residentId: store.selectedResidentId,
                    terminationDate: date,
                    previewFingerprint: preview.fingerprint,
                    acknowledgeUnmarkedDays: ack,
                  })
                )
                  onClose();
              }}
            >
              Archive account and apply deposit
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
});
const RefundDialog = observer(function RefundDialog({
  store,
  onClose,
}: {
  store: PaymentsStore;
  onClose: () => void;
}) {
  const [method, setMethod] = useState('CASH'),
    [reference, setReference] = useState(''),
    [evidence, setEvidence] = useState(''),
    [requestId] = useState(() => crypto.randomUUID()),
    amount = store.clearance!.refundDue;
  return (
    <FinancialDialog
      title="Record confirmed refund"
      store={store}
      onClose={onClose}
      submitLabel="Confirm funds returned"
      onSubmit={async () => {
        if (
          await store.execute('refund', {
            requestId,
            clearanceId: store.clearance!.id,
            amount,
            method,
            reference: reference || null,
            confirmationNote: evidence,
          })
        )
          onClose();
      }}
    >
      <p>
        This records funds you have already returned: {formatMoney(amount)}.
      </p>
      <Select
        label="Refund method"
        value={method}
        options={['CASH', 'UPI', 'BANK'].map((value) => ({
          value,
          label: value,
        }))}
        onChange={(e) => setMethod(e.target.value)}
      />
      <Field
        label="Refund reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <Field
        label="Refund confirmation evidence"
        required
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
      />
    </FinancialDialog>
  );
});
export const PaymentsScreen = observer(function PaymentsScreen() {
  const store = usePaymentsStore(),
    [reconcileId, setReconcileId] = useState(''),
    [clearanceOpen, setClearanceOpen] = useState(false),
    [refundOpen, setRefundOpen] = useState(false);
  if (store.state === 'loading')
    return <DataState kind="loading" title="Loading resident accounts…" />;
  if (store.state === 'error')
    return (
      <DataState
        kind="error"
        title="Accounts unavailable"
        description={store.error}
        onRetry={() => void store.load()}
      />
    );
  const person = store.person,
    receipt = store.lastPayment,
    pendingPayment = store.payments.find(
      (p) => p.id === reconcileId && p.status === 'PENDING',
    ),
    remaining = receipt?.balance.startsWith('-')
      ? '0.00'
      : (receipt?.balance ?? '0.00');
  return (
    <div className="db-stack" style={{ gap: 24 }}>
      <header className="db-no-print">
        <p className="db-eyebrow">Billing & collection</p>
        <h1>Payments & accounts</h1>
        <Link href="/settings/credit">Credit control</Link> �{' '}
        <Link href="/collection-sheets">Route collection sheets</Link>
        <p>
          Record confirmed funds, resolve pending payments and settle departing
          residents.
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
      {store.notice && <Notification tone="info" title={store.notice} />}
      <div className="db-no-print">
        <Select
          label="Resident account"
          value={store.selectedResidentId}
          disabled={store.readingLocked}
          options={store.residents.map((r) => ({
            value: r.id,
            label: `${r.name} · ${r.code}${r.status === 'CLOSED' ? ' · Closed' : ''}`,
          }))}
          onChange={(e) => void store.selectResident(e.target.value)}
        />
      </div>
      {person && store.residentState !== 'ready' ? (
        <DataState
          kind={store.residentState === 'loading' ? 'loading' : 'error'}
          title={
            store.residentState === 'loading'
              ? 'Loading account balance…'
              : 'Account balance unavailable'
          }
          description="Financial actions are unavailable until this resident account is loaded."
          onRetry={() => void store.loadResident()}
        />
      ) : person ? (
        <>
          <div className="db-row db-no-print">
            <MetricCard
              title="Account balance"
              value={formatMoney(store.ledger.balance)}
            />
            <MetricCard
              title="Refundable deposit"
              value={formatMoney(person.depositBalance)}
            />
            <Badge>
              {person.status === 'CLOSED'
                ? 'Closed'
                : person.status === 'SUSPENDED'
                  ? 'Suspended'
                  : person.status === 'ACTIVE'
                    ? 'Active'
                    : 'Inactive'}
            </Badge>
          </div>
          <div className="db-no-print">
            <PaymentForm key={person.id} store={store} />
          </div>
          {receipt?.status === 'CONFIRMED' &&
            (receipt.purpose === 'ACCOUNT' ? (
              <PaymentConfirmation
                status={remaining === '0.00' ? 'confirmed' : 'partial'}
                amount={receipt.amount}
                remaining={remaining}
                receipt={receipt.receiptCode!}
                invoice={
                  store.invoices.find((i) => i.id === receipt.targetInvoiceId)
                    ?.code ?? ''
                }
                method={receipt.method}
                recordedAt={receipt.date}
                description={`${store.agencyName} · ${person.name} (${person.code}). Funds confirmed by the agency agent; balance shown at receipt confirmation.${receipt.reference ? ` Reference ${receipt.reference}.` : ''}`}
                onReceipt={() => window.print()}
              />
            ) : (
              <Card>
                <h2>Deposit receipt</h2>
                <p>
                  {store.agencyName} · {person.name} ({person.code})
                </p>
                <p>
                  {receipt.receiptCode} · {formatMoney(receipt.amount)} ·{' '}
                  {receipt.method}
                </p>
                <p>
                  Confirmed refundable deposit; resident bill balance is
                  unchanged.
                </p>
              </Card>
            ))}
          {store.lastRefund && (
            <Card>
              <h2>Refund receipt</h2>
              <p>
                {store.agencyName} · {person.name} ({person.code})
              </p>
              <p>
                {store.lastRefund.receiptCode} ·{' '}
                {formatMoney(store.lastRefund.amount)}
              </p>
              <p>Funds returned and confirmed by the agency agent.</p>
            </Card>
          )}
          <div className="db-stack db-no-print">
            <Card>
              <h2>Payment history</h2>
              <DataTable
                caption="Payment receipts and pending funds"
                rows={store.payments}
                rowKey={(p) => p.id}
                columns={[
                  {
                    key: 'receipt',
                    header: 'Receipt / operation',
                    render: (p) => (
                      <>
                        {p.receiptCode ?? 'No receipt'}
                        <br />
                        {p.date}
                      </>
                    ),
                  },
                  {
                    key: 'method',
                    header: 'Method',
                    render: (p) => (
                      <>
                        {p.method}
                        <br />
                        {p.reference ?? 'No reference'}
                      </>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    render: (p) => formatMoney(p.amount),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (p) => (
                      <>
                        {p.status}
                        {p.status === 'CONFIRMED' && (
                          <Button
                            variant="secondary"
                            disabled={store.readingLocked}
                            onClick={() => store.viewReceipt(p)}
                          >
                            View receipt {p.receiptCode}
                          </Button>
                        )}
                        {p.status === 'PENDING' && (
                          <Button
                            variant="secondary"
                            disabled={store.locked}
                            onClick={() => setReconcileId(p.id)}
                          >
                            Reconcile payment {p.method} {formatMoney(p.amount)}
                          </Button>
                        )}
                      </>
                    ),
                  },
                ]}
              />
            </Card>
            <Card>
              <h2>Resident ledger</h2>
              <DataTable
                caption="Immutable account ledger"
                rows={store.ledger.entries}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'date', header: 'Date', render: (r) => r.date },
                  {
                    key: 'entry',
                    header: 'Entry',
                    render: (r) => r.description,
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    render: (r) => formatMoney(r.amount),
                  },
                ]}
              />
            </Card>
            {store.clearance ? (
              <Card>
                <h2>Account clearance · {store.clearance.code}</h2>
                <p>
                  Termination {store.clearance.terminationDate} ·{' '}
                  {store.clearance.status}
                </p>
                <p>
                  Deposit applied {formatMoney(store.clearance.depositOffset)}
                </p>
                <p>
                  Refund due {formatMoney(store.clearance.refundDue)} ·
                  Collection due {formatMoney(store.clearance.collectionDue)}
                </p>
                {store.clearance.refundDue !== '0.00' && (
                  <Button
                    disabled={store.locked}
                    onClick={() => setRefundOpen(true)}
                  >
                    Record confirmed refund
                  </Button>
                )}
              </Card>
            ) : (
              person.status !== 'CLOSED' && (
                <Button
                  disabled={store.locked}
                  onClick={() => setClearanceOpen(true)}
                >
                  Prepare account clearance
                </Button>
              )
            )}
          </div>
        </>
      ) : (
        <DataState
          kind="empty"
          title={
            store.residents.length
              ? 'Choose a resident account'
              : 'No resident accounts'
          }
          description={
            store.residents.length
              ? 'Select the account whose receipts you want to review.'
              : 'Add a resident before recording receipts.'
          }
        />
      )}
      {pendingPayment && (
        <ReconcileDialog
          key={pendingPayment.id}
          store={store}
          payment={pendingPayment}
          onClose={() => setReconcileId('')}
        />
      )}{' '}
      {clearanceOpen && person?.status !== 'CLOSED' && (
        <ClearanceDialog
          store={store}
          onClose={() => setClearanceOpen(false)}
        />
      )}{' '}
      {refundOpen &&
        store.clearance &&
        store.clearance.refundDue !== '0.00' && (
          <RefundDialog store={store} onClose={() => setRefundOpen(false)} />
        )}
    </div>
  );
});

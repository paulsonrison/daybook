'use client';
import { ResidentContact } from '../communications/resident-contact';
import { useEffect, useState } from 'react';
import { FieldCollectionDrafts, type FieldDraft } from './field-drafts';
import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import {
  AssetImage,
  Button,
  Card,
  Checkbox,
  DataState,
  Field,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import { usePaymentsStore } from './hooks';
import { PendingRecovery } from './screen';
import type { PaymentsStore, Sheet } from './store';
const PaymentIdentity = observer(function PaymentIdentity({
  store,
  busy,
}: {
  store: PaymentsStore;
  busy: boolean;
}) {
  const [upi, setUpi] = useState(store.settings.upiId ?? ''),
    [name, setName] = useState(store.settings.payeeName ?? ''),
    [owns, setOwns] = useState(false);
  return (
    <Card>
      <h2>Agency payment identity</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void store.saveUpi({
            upiId: upi,
            payeeName: name,
            confirmOwnership: owns,
          });
        }}
      >
        <fieldset
          className="db-stack"
          style={{ border: 0, padding: 0 }}
          disabled={store.locked || store.sheetBusy || busy}
        >
          <div className="db-row">
            <Field
              label="Agency UPI address"
              required
              value={upi}
              onChange={(e) => {
                setUpi(e.target.value);
                setOwns(false);
              }}
            />
            <Field
              label="Payee name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setOwns(false);
              }}
            />
          </div>
          <Checkbox
            label="I confirm this UPI address belongs to my agency"
            checked={owns}
            onChange={(e) => setOwns(e.target.checked)}
          />
          <Button type="submit" disabled={!owns} loading={store.busy}>
            Save payment identity
          </Button>
        </fieldset>
      </form>
      <p>
        A QR request opens a payment app. Funds stay unconfirmed until the
        agency verifies receipt.
      </p>
    </Card>
  );
});
const FieldBatch = observer(function FieldBatch({
  store,
  sheet,
  onRefresh,
  batch,
}: {
  store: PaymentsStore;
  sheet: Sheet;
  onRefresh: () => Promise<boolean>;
  batch: FieldCollectionDrafts;
}) {
  const drafts = batch.drafts,
    evidence = batch.evidence,
    confirmed = batch.confirmed;
  useEffect(() => {
    if (store.lastPayment) batch.observePayment(store.lastPayment);
  }, [store.lastPayment, batch]);
  function change(id: string, key: keyof FieldDraft, value: string | boolean) {
    batch.change(id, key, value);
  }
  async function record() {
    if (store.locked || batch.busy || batch.needsRefresh) return;
    const selected = sheet.rows.filter(
      (row) =>
        batch.drafts[row.residentId]?.selected &&
        !batch.completed(row.residentId),
    );
    if (!selected.length) {
      runInAction(() => {
        store.error =
          'Select the returned collection entries you want to record.';
      });
      return;
    }
    batch.setBusy(true);
    let recorded = 0,
      pending = 0;
    for (const row of selected) {
      const draft = batch.drafts[row.residentId],
        ok = await store.execute(
          'record',
          {
            requestId: draft.requestId,
            residentId: row.residentId,
            purpose: 'ACCOUNT',
            method: draft.method,
            amount: draft.amount,
            date: sheet.date,
            reference: draft.reference || null,
            confirmReceived:
              draft.method === 'CHEQUE' ? false : batch.confirmed,
            confirmationNote: batch.evidence,
          },
          row.residentId,
        );
      if (!ok) {
        batch.failed(row.residentId, store.error, Boolean(store.pending));
        break;
      }
      if (store.lastPayment) {
        batch.recorded(row.residentId, store.lastPayment);
        if (store.lastPayment.status === 'CONFIRMED') recorded++;
        else pending++;
      }
    }
    if (recorded || pending) {
      await onRefresh();
      runInAction(() => {
        store.notice = recorded
          ? `${recorded} collection${recorded === 1 ? '' : 's'} recorded${pending ? `; ${pending} pending confirmation` : ''}`
          : `${pending} collection${pending === 1 ? '' : 's'} pending confirmation`;
      });
    }
    batch.setBusy(false);
  }
  return (
    <div className="db-stack">
      <div className="db-no-print">
        <h2>Returned field collections</h2>
        <p>
          Select recorded field entries. Payment-mode marks on paper do not
          change balances.
        </p>
      </div>
      {sheet.rows.length === 0 ? (
        <DataState
          kind="empty"
          title="No active residents have a collection balance in this range"
        />
      ) : (
        sheet.rows.map((row) => {
          const draft = drafts[row.residentId];
          if (!draft)
            return (
              <DataState
                key={row.residentId}
                kind="loading"
                title="Preparing collection entry�"
              />
            );
          return (
            <Card key={row.residentId}>
              <div
                className="db-row"
                style={{
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <div className="db-stack">
                  <h3>
                    {row.sequence} · {row.name}
                  </h3>
                  <p>
                    {row.code} · {row.address}
                  </p>
                  <p>
                    {row.phone} · Door {row.door ?? row.sequence}
                  </p>
                  <ResidentContact
                    key={row.residentId}
                    residentId={row.residentId}
                    name={row.name}
                  />
                  <p>
                    Total due {formatMoney(row.balance)} · Overdue{' '}
                    {formatMoney(row.overdueAmount)} · {row.overdueDays} days
                  </p>
                  <div
                    className="db-row"
                    aria-label={`Paper payment modes for ${row.name}`}
                  >
                    {['Cash', 'UPI', 'Bank', 'Cheque'].map((method) => (
                      <Checkbox
                        key={method}
                        label={method}
                        defaultChecked={false}
                      />
                    ))}
                  </div>
                  <div className="db-no-print">
                    {row.upiUri && <a href={row.upiUri}>Open UPI request</a>}
                  </div>
                </div>
                <AssetImage
                  src={row.qrDataUrl ?? undefined}
                  width={192}
                  height={192}
                  alt={`UPI QR for ${row.name}`}
                  fallback={
                    <Notification
                      title="Payment QR unavailable"
                      description="Configure the agency UPI identity to include a payment request."
                    />
                  }
                />
              </div>
              <fieldset
                className="db-stack db-no-print"
                style={{ border: 0, padding: 0, marginTop: 16 }}
                disabled={
                  store.locked ||
                  batch.busy ||
                  batch.needsRefresh ||
                  batch.completed(row.residentId)
                }
              >
                <Checkbox
                  label={`Collect from ${row.name}`}
                  checked={draft.selected}
                  onChange={(e) =>
                    change(row.residentId, 'selected', e.target.checked)
                  }
                />
                <div className="db-row">
                  <Field
                    label={`Collected amount for ${row.name}`}
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) =>
                      change(row.residentId, 'amount', e.target.value)
                    }
                  />
                  <Select
                    label={`Collection method for ${row.name}`}
                    value={draft.method}
                    options={['CASH', 'UPI', 'BANK', 'CHEQUE'].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(e) =>
                      change(row.residentId, 'method', e.target.value)
                    }
                  />
                  <Field
                    label={`Collection reference for ${row.name}`}
                    value={draft.reference}
                    onChange={(e) =>
                      change(row.residentId, 'reference', e.target.value)
                    }
                  />
                </div>
              </fieldset>
              {batch.outcomes[row.residentId] && (
                <div className="db-no-print">
                  <Notification
                    tone={
                      batch.outcomes[row.residentId].status === 'ERROR'
                        ? 'error'
                        : 'info'
                    }
                    title={
                      batch.outcomes[row.residentId].status === 'ERROR'
                        ? `${row.name} collection not confirmed`
                        : `${row.name} collection ${batch.outcomes[row.residentId].status.toLowerCase()}`
                    }
                    description={
                      batch.outcomes[row.residentId].error ??
                      batch.outcomes[row.residentId].receiptCode ??
                      'Funds remain pending confirmation.'
                    }
                  />
                </div>
              )}
            </Card>
          );
        })
      )}
      <form
        className="db-no-print"
        onSubmit={(e) => {
          e.preventDefault();
          void record();
        }}
      >
        <fieldset
          className="db-stack"
          style={{ border: 0, padding: 0 }}
          disabled={store.locked || batch.busy || batch.needsRefresh}
        >
          <Checkbox
            label="I confirmed selected funds were received"
            checked={confirmed}
            onChange={(e) => batch.setConfirmed(e.target.checked)}
          />
          <Field
            label="Field collection confirmation evidence"
            required
            value={evidence}
            onChange={(e) => batch.setEvidence(e.target.value)}
            hint="UPI and bank confirmation require a transaction reference. Cheques remain pending until cleared."
          />
          <Button type="submit" loading={batch.busy}>
            Record selected collections
          </Button>
        </fieldset>
      </form>
      <Button
        className="db-no-print"
        variant="secondary"
        disabled={store.locked || batch.busy || batch.needsRefresh}
        onClick={() => batch.reset(sheet)}
      >
        Reset field entry draft
      </Button>
      {batch.needsRefresh && (
        <Notification
          title="Collection balances need refreshing"
          description="Generate the sheet again before recording more entries. Pending funds must be reconciled in Payments & accounts."
        />
      )}
    </div>
  );
});
export const CollectionSheetScreen = observer(function CollectionSheetScreen() {
  const store = usePaymentsStore(),
    [route, setRoute] = useState(''),
    [from, setFrom] = useState('1'),
    [to, setTo] = useState('99999'),
    [batch] = useState(() => new FieldCollectionDrafts());
  if (store.state === 'loading')
    return <DataState kind="loading" title="Loading collection routes…" />;
  if (store.state === 'error')
    return (
      <DataState
        kind="error"
        title="Collection sheets unavailable"
        description={store.error}
        onRetry={() => void store.load()}
      />
    );
  async function build() {
    const okay = await store.buildSheet(route, Number(from), Number(to));
    if (okay && store.sheet) batch.prepare(store.sheet);
    return okay;
  }
  return (
    <div className="db-stack" style={{ gap: 24 }}>
      <div className="db-stack db-no-print" style={{ gap: 24 }}>
        <header>
          <p className="db-eyebrow">Field collections</p>
          <h1>Route collection sheets</h1>
          <p>
            Print route-ordered balances and QR requests, then record returned
            collections.
          </p>
          <Link href="/payments">Payments & accounts</Link> ·{' '}
          <Link href="/settings/credit">Credit control</Link>
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
        <PaymentIdentity store={store} busy={batch.busy} />
        <Card>
          <div className="db-row">
            <Select
              label="Collection route"
              value={route}
              disabled={store.locked || store.sheetBusy || batch.busy}
              options={store.routes
                .filter((r) => r.active)
                .map((r) => ({ value: r.id, label: r.name }))}
              onChange={(e) => setRoute(e.target.value)}
            />
            <Field
              label="First collection door"
              type="number"
              min={1}
              value={from}
              disabled={store.locked || store.sheetBusy || batch.busy}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Field
              label="Last collection door"
              type="number"
              min={1}
              value={to}
              disabled={store.locked || store.sheetBusy || batch.busy}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="db-row">
            <Button
              disabled={!route || store.locked || batch.busy}
              loading={store.sheetBusy}
              onClick={() => void build()}
            >
              Generate collection sheet
            </Button>
            {store.sheet && (
              <Button
                variant="secondary"
                disabled={store.locked || batch.busy || batch.needsRefresh}
                onClick={() => window.print()}
              >
                Print collection sheet
              </Button>
            )}
          </div>
        </Card>
        {store.sheetError && (
          <Notification
            tone="error"
            title="Collection sheet unavailable"
            description={store.sheetError}
          />
        )}
      </div>
      {store.sheet && (
        <>
          <header>
            <h2>{store.sheet.routeName} · Collection sheet</h2>
            <p>
              Prepared {store.sheet.date}. Balances reflect confirmed entries at
              preparation time.
            </p>
          </header>
          <FieldBatch
            store={store}
            sheet={store.sheet}
            batch={batch}
            onRefresh={async () => {
              const okay = await store.refreshSheet();
              if (okay && store.sheet) batch.prepare(store.sheet);
              return okay;
            }}
          />
        </>
      )}
    </div>
  );
});

'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Card, Select } from '@daybook/ui';
import type { PaymentsStore } from '../payments/store';
const labels: Record<string, string> = {
  NOT_CONFIGURED: 'Not configured',
  NO_CONSENT: 'Consent required',
  MISSING_TEMPLATE: 'Approved template required',
  NOT_DUE: 'No overdue balance',
  WAITING_DOCUMENT: 'Preparing document',
  PENDING: 'Queued',
  ACCEPTED: 'Accepted by provider; delivery unconfirmed',
  UNRESOLVED: 'Earlier send requires review',
  COOLDOWN: 'Recipient cooldown',
};
export const ManualReminderPanel = observer(function ManualReminderPanel({
  store,
  residentId,
}: {
  store: PaymentsStore;
  residentId: string;
}) {
  const [channel, setChannel] = useState('WHATSAPP');
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready';
  const result =
    store.lastCompletedKind === 'manualReminder'
      ? (store.lastOperationResult as { residentId: string; status: string })
      : null;
  return (
    <Card title="Overdue account reminder">
      <div className="db-stack">
        <p>
          Prepare an explicit reminder for this resident. Current overdue debt,
          channel consent, provider setup, documents and cooldown are checked.
          Automatic reminder scheduling can stay disabled.
        </p>
        <Select
          label="Reminder channel"
          value={channel}
          disabled={locked}
          options={[
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'SMS', label: 'SMS' },
          ]}
          onChange={(event) => setChannel(event.target.value)}
        />
        <Button
          disabled={locked}
          loading={store.busy}
          onClick={() =>
            void store.execute(
              'manualReminder',
              { requestId: crypto.randomUUID(), residentId, channel },
              residentId,
            )
          }
        >
          Prepare overdue reminder
        </Button>
        {result?.residentId === residentId ? (
          <p role="status">
            Reminder status: {labels[result.status] ?? 'Check dispatch history'}
          </p>
        ) : null}
        <p>
          Preparation is not delivery confirmation. Review later outcomes in
          documents and dispatch.
        </p>
      </div>
    </Card>
  );
});

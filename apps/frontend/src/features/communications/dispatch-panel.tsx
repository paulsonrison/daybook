'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  DataTable,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import type { PaymentsStore } from '../payments/store';
import type { InvoiceCandidate, MessageDispatch } from './document-model';
import { MessageResolutionPanel } from './resolution-panel';
const fields =
  'id residentId invoiceId documentId documentStatus kind channel recipient providerMessageId status reason attempts createdAt';
const statuses: Record<string, string> = {
  PENDING: 'Queued',
  CLAIMED: 'Preparing',
  SUBMITTING: 'Submitting',
  ACCEPTED: 'Accepted by provider',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  UNKNOWN: 'Outcome unknown',
  UNKNOWN_CLOSED: 'Closed with outcome unknown',
  OWNER_NOT_SENT: 'Not sent — verified by owner',
  OWNER_ACCEPTED: 'Acceptance verified by owner',
  CANCELLED: 'Cancelled',
  NO_CONSENT: 'Consent required',
  MISSING_TEMPLATE: 'Template required',
  STALE: 'Snapshot changed',
  WAITING_DOCUMENT: 'Document required',
  NOT_DUE: 'No outstanding balance',
  NOT_CONFIGURED: 'Not configured',
  COOLDOWN: 'Cooldown',
  UNRESOLVED: 'Earlier send unresolved',
  INVALID_RECIPIENT: 'Phone number required',
  SENT: 'Sent (legacy record)',
};
const reasons: Record<string, string> = {
  DOCUMENT_GENERATION_FAILED:
    'PDF generation exhausted its retries; prepare a new document before another explicit request',
  PREVIOUS_REMINDER_DATE:
    'An older unsent reminder was replaced by current-date evaluation',
  PAYMENT_OR_PUBLIC_DOCUMENT_CONFIGURATION_REQUIRED:
    'Configure the agency payment identity and secure document links',
  REMINDERS_DISABLED:
    'Automatic reminder scheduling was disabled before submission',
  APPROVED_TEMPLATE_REQUIRED:
    'Configure an approved template for this message and language',
  APPROVED_REMINDER_TEMPLATE_REQUIRED:
    'Configure an approved reminder template for this language',
  CHANNEL_CONSENT_WITHDRAWN:
    'Resident withdrew channel consent before submission',
  PROVIDER_NOT_CONFIGURED: 'Provider not configured',
  PROVIDER_CONFIGURATION_ERROR: 'Provider configuration needs attention',
  CURRENT_CHANNEL_CONSENT_REQUIRED: 'Confirm current channel consent',
  APPROVED_INVOICE_TEMPLATE_REQUIRED: 'Configure an approved invoice template',
  GENERATED_DOCUMENT_AND_LINK_REQUIRED: 'Prepare a PDF and share link',
  DOCUMENT_NOT_READY: 'Generate the PDF',
  SECURE_ACTIVE_DOCUMENT_LINK_REQUIRED: 'Create an active secure share link',
  DOCUMENT_FINANCIAL_SNAPSHOT_CHANGED:
    'Prepare a new document with current figures',
  PAYMENT_IDENTITY_NOT_CONFIGURED: 'Confirm agency payment details',
  PAYMENT_QR_MISSING: 'Prepare a new document with a payment QR',
  PAYMENT_IDENTITY_OR_AMOUNT_CHANGED: 'Payment details or amount changed',
  EXISTING_SEND_REQUIRES_RESOLUTION:
    'Check the earlier send before preparing another',
  RECIPIENT_COOLDOWN: 'Wait for the recipient cooldown',
  PREPARED_MESSAGE_CHANGED: 'Refresh the contact and document snapshot',
  INVOICE_REVISED: 'Prepare the current invoice revision',
  NO_OUTSTANDING_BALANCE: 'No positive outstanding balance',
  INTERNATIONAL_PHONE_REQUIRED: 'Add a valid international phone number',
  SUBMISSION_UNCERTAIN:
    'Check the provider; this message will not be resent automatically',
  PREPARATION_FAILED: 'Refresh the source and provider settings',
  HTTP_401: 'Provider authentication was rejected',
  HTTP_403: 'Provider permission was rejected',
  HTTP_429: 'Provider rate limit; retry is scheduled when eligible',
  ATTEMPTS_EXHAUSTED: 'Retry limit reached',
};
export const DispatchPanel = observer(function DispatchPanel({
  store,
  candidates,
  onRemove,
  onQueued,
}: {
  store: PaymentsStore;
  candidates: InvoiceCandidate[];
  onRemove: (residentId: string) => void;
  onQueued: () => void;
}) {
  const [channel, setChannel] = useState('WHATSAPP');
  const [history, setHistory] = useState<MessageDispatch[]>([]);
  const [currentBatch, setCurrentBatch] = useState<MessageDispatch[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reviewId, setReviewId] = useState('');
  const [older, setOlder] = useState<MessageDispatch[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const submitted = useRef<{ requestId: string; signature: string } | null>(
    null,
  );
  const priorityIds = useRef<string[]>([]),
    generation = useRef(0),
    reading = useRef(false);
  const load = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    setRefreshing(true);
    const request = ++generation.current;
    try {
      const data = await graphqlRequest<{
        messageDispatches: MessageDispatch[];
      }>(`{messageDispatches{${fields}}}`);
      const batch = priorityIds.current.length
        ? await graphqlRequest<{ messageDispatchStatuses: MessageDispatch[] }>(
            `query($ids:[ID!]!){messageDispatchStatuses(ids:$ids){${fields}}}`,
            { ids: priorityIds.current },
          )
        : null;
      if (request !== generation.current) return;
      setHistory(data.messageDispatches);
      setOlder([]);
      setHasOlder(data.messageDispatches.length === 200);
      if (batch) setCurrentBatch(batch.messageDispatchStatuses);
      setState('ready');
      setError('');
    } catch (e) {
      if (request === generation.current) {
        setError((e as Error).message);
        setState('error');
      }
    } finally {
      if (request === generation.current) {
        reading.current = false;
        setRefreshing(false);
      }
    }
  }, []);
  const cancelReads = useCallback(() => {
    generation.current++;
    reading.current = false;
  }, []);
  useEffect(() => {
    if (
      store.lastCompletedKind === 'invoiceBatch' &&
      Array.isArray(store.lastOperationResult)
    ) {
      const result = store.lastOperationResult as MessageDispatch[];
      priorityIds.current = result.map((row) => row.id);
      setCurrentBatch(result);
    }
    void load();
    return cancelReads;
  }, [
    load,
    cancelReads,
    store.lastCompletedRequestId,
    store.lastCompletedKind,
    store.lastOperationResult,
  ]);
  const batchIds = new Set(currentBatch.map((row) => row.id));
  const rows = [
    ...currentBatch,
    ...[...history, ...older].filter((row) => !batchIds.has(row.id)),
  ];
  const hasPendingOutcome = rows.some((row) =>
    [
      'PENDING',
      'CLAIMED',
      'SUBMITTING',
      'UNKNOWN',
      'ACCEPTED',
      'DELIVERED',
    ].includes(row.status),
  );
  useEffect(() => {
    if (!hasPendingOutcome || state !== 'ready' || older.length || loadingOlder)
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasPendingOutcome, state, load, older.length, loadingOlder]);
  const items = candidates.map((row) => ({
    invoiceId: row.invoiceId,
    version: row.version,
    documentId: row.documentId,
    linkId: row.linkId,
  }));
  const signature = JSON.stringify({ channel, items });
  useEffect(() => {
    if (
      store.lastCompletedKind !== 'invoiceBatch' ||
      !submitted.current ||
      submitted.current.requestId !== store.lastCompletedRequestId
    )
      return;
    const original = submitted.current;
    submitted.current = null;
    if (original.signature === signature) onQueued();
  }, [
    store.lastCompletedKind,
    store.lastCompletedRequestId,
    signature,
    onQueued,
  ]);
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready';
  async function queue() {
    if (
      store.busy ||
      store.pending ||
      store.recoveryUnavailable ||
      store.state !== 'ready' ||
      !candidates.length ||
      state !== 'ready'
    )
      return;
    const input = {
      requestId: crypto.randomUUID(),
      channel,
      items,
    };
    submitted.current = { requestId: input.requestId, signature };
    if (!(await store.execute('invoiceBatch', input, '')) && !store.pending)
      submitted.current = null;
  }
  async function loadOlder() {
    if (reading.current || loadingOlder || refreshing || !hasOlder) return;
    const last = [...history, ...older].at(-1);
    if (!last) return;
    const request = generation.current;
    reading.current = true;
    setLoadingOlder(true);
    try {
      const data = await graphqlRequest<{
        dispatchHistory: { items: MessageDispatch[]; hasMore: boolean };
      }>(
        `query($input:DispatchHistoryInput!){dispatchHistory(input:$input){hasMore items{${fields}}}}`,
        { input: { beforeCreatedAt: last.createdAt, beforeId: last.id } },
      );
      if (request !== generation.current) return;
      setOlder((previous) => [...previous, ...data.dispatchHistory.items]);
      setHasOlder(data.dispatchHistory.hasMore);
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      reading.current = false;
      setLoadingOlder(false);
    }
  }
  return (
    <div className="db-stack">
      <Card title="Invoice message batch">
        <div className="db-stack">
          <p>
            Review each resident, prepared amount and link expiry. Queuing
            starts eligible messages; missing consent, setup or current
            documents keep recipients blocked.
          </p>
          <Select
            label="Message channel"
            value={channel}
            disabled={locked}
            options={[
              { value: 'WHATSAPP', label: 'WhatsApp' },
              { value: 'SMS', label: 'SMS' },
            ]}
            onChange={(e) => setChannel(e.target.value)}
          />
          <DataTable
            caption="Selected invoices"
            rows={candidates}
            rowKey={(row) => row.residentId}
            emptyTitle="No invoices selected for this batch"
            columns={[
              {
                key: 'resident',
                header: 'Resident',
                render: (row) => row.residentName,
              },
              {
                key: 'invoice',
                header: 'Invoice',
                render: (row) => `${row.reference} · ${row.locale}`,
              },
              {
                key: 'amount',
                header: 'Outstanding at preparation',
                render: (row) => formatMoney(row.amount),
              },
              {
                key: 'expiry',
                header: 'Link expiry',
                render: (row) => new Date(row.expiresAt).toLocaleString(),
              },
              {
                key: 'remove',
                header: 'Selection',
                render: (row) => (
                  <Button
                    variant="secondary"
                    disabled={locked}
                    onClick={() => onRemove(row.residentId)}
                  >
                    Remove {row.residentName}
                  </Button>
                ),
              },
            ]}
          />
          <Button
            disabled={locked || !candidates.length || state !== 'ready'}
            loading={store.busy}
            onClick={() => void queue()}
          >
            Queue selected invoices
          </Button>
          <p>
            Provider acceptance is not delivery confirmation. An uncertain
            submission will not be resent automatically. Replaying an
            unconfirmed batch checks its original recipient records.
          </p>
        </div>
      </Card>
      <Card title="Dispatch history">
        <Button
          variant="secondary"
          loading={refreshing}
          onClick={() => void load()}
        >
          Refresh dispatch history
        </Button>
        <p>
          Current batch and recent dispatches show the last recorded provider
          outcome, rather than a live delivery guarantee.
        </p>
        <p>Owner verification does not confirm delivery.</p>
        {older.length ? (
          <p>
            Older history is a recorded snapshot. Refresh dispatch history to
            return to automatic status updates.
          </p>
        ) : null}
        {error ? (
          <Notification
            tone="error"
            title="Dispatch history unavailable"
            description={error}
            action={
              <Button onClick={() => void load()}>
                Retry dispatch history
              </Button>
            }
          />
        ) : null}
        <DataTable
          caption="Current batch and recent dispatches"
          rows={rows}
          rowKey={(row) => row.id}
          state={state === 'error' && rows.length ? 'partial' : state}
          onRetry={() => void load()}
          emptyTitle="No message dispatches recorded"
          columns={[
            {
              key: 'resident',
              header: 'Resident',
              render: (row) =>
                store.residents.find((person) => person.id === row.residentId)
                  ?.name ?? 'Resident',
            },
            {
              key: 'kind',
              header: 'Message',
              render: (row) =>
                `${row.kind === 'INVOICE' ? 'Invoice' : row.kind === 'CREDIT_HOLD' ? 'Credit hold' : 'Reminder'} · ${row.channel}`,
            },
            {
              key: 'status',
              header: 'Recorded status',
              render: (row) => statuses[row.status] ?? 'Check status',
            },
            {
              key: 'reason',
              header: 'Details',
              render: (row) =>
                row.reason
                  ? (reasons[row.reason] ??
                    'Check source and provider settings')
                  : '—',
            },
            {
              key: 'review',
              header: 'Outcome review',
              render: (row) =>
                [
                  'UNKNOWN',
                  'UNKNOWN_CLOSED',
                  'OWNER_NOT_SENT',
                  'OWNER_ACCEPTED',
                ].includes(row.status) && !row.providerMessageId ? (
                  <Button
                    variant="secondary"
                    onClick={() => setReviewId(row.id)}
                  >
                    Review uncertain outcome
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setReviewId(row.id)}
                  >
                    View outcome history
                  </Button>
                ),
            },
            {
              key: 'document',
              header: 'Source PDF',
              render: (row) =>
                row.documentId && row.documentStatus === 'READY' ? (
                  <a
                    href={`/api/documents/owner/${row.documentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download recorded PDF
                  </a>
                ) : row.documentStatus === 'FAILED' ? (
                  'Generation failed'
                ) : row.documentStatus ? (
                  'Preparing document'
                ) : (
                  'No document prepared'
                ),
            },
            {
              key: 'date',
              header: 'Prepared',
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
          ]}
        />
        {hasOlder ? (
          <Button
            variant="secondary"
            loading={loadingOlder}
            disabled={refreshing}
            onClick={() => void loadOlder()}
          >
            Load older dispatches
          </Button>
        ) : null}
        {reviewId && rows.find((row) => row.id === reviewId) ? (
          <MessageResolutionPanel
            key={reviewId}
            message={rows.find((row) => row.id === reviewId)!}
            store={store}
            onRefresh={load}
          />
        ) : null}
      </Card>
    </div>
  );
});

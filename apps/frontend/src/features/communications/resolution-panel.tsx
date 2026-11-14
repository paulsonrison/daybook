'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  Field,
  Notification,
  Select,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import type { PaymentsStore } from '../payments/store';
import type { MessageDispatch } from './document-model';
interface Resolution {
  id: string;
  decision: string;
  evidence: string;
  providerReference: string | null;
  agentName: string;
  createdAt: string;
}
const decisions = [
  {
    value: 'CLOSE_UNKNOWN',
    label: 'Close review; outcome remains unknown and resend blocked',
  },
  {
    value: 'CONFIRMED_NOT_SENT',
    label: 'Provider verified not accepted; allow a new explicit preparation',
  },
  {
    value: 'CONFIRMED_ACCEPTED',
    label: 'Owner verified provider acceptance; delivery unconfirmed',
  },
];
export const MessageResolutionPanel = observer(function MessageResolutionPanel({
  message,
  store,
  onRefresh,
}: {
  message: MessageDispatch;
  store: PaymentsStore;
  onRefresh: () => Promise<void>;
}) {
  const [decision, setDecision] = useState('CLOSE_UNKNOWN');
  const [evidence, setEvidence] = useState(''),
    [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<Resolution[]>([]),
    [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setState('loading');
    void graphqlRequest<{ messageResolutions: Resolution[] }>(
      'query($id:ID!){messageResolutions(messageId:$id){id decision evidence providerReference agentName createdAt}}',
      { id: message.id },
    )
      .then((data) => {
        if (live) {
          setHistory(data.messageResolutions);
          setState('ready');
        }
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [message.id, reload, store.lastCompletedRequestId]);
  useEffect(() => {
    if (store.lastCompletedKind !== 'messageResolution') return;
    setConfirmed(false);
    void onRefresh();
  }, [store.lastCompletedKind, store.lastCompletedRequestId, onRefresh]);
  const eligible =
    ['UNKNOWN', 'UNKNOWN_CLOSED', 'OWNER_NOT_SENT', 'OWNER_ACCEPTED'].includes(
      message.status,
    ) && !message.providerMessageId;
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      locked ||
      !eligible ||
      !confirmed ||
      !evidence.trim() ||
      (decision === 'CONFIRMED_ACCEPTED' && !reference.trim())
    )
      return;
    await store.execute(
      'messageResolution',
      {
        requestId: crypto.randomUUID(),
        messageId: message.id,
        decision,
        evidence: evidence.trim(),
        providerReference:
          decision === 'CONFIRMED_ACCEPTED' ? reference.trim() : null,
        confirmedEvidence: true,
      },
      '',
    );
  }
  return (
    <Card title="Review message outcome">
      <div className="db-stack">
        <p>{message.recipient}</p>
        <p>
          Check this exact recipient and submission in the provider account.
          Closing an unknown outcome keeps resend blocked. A verified
          not-accepted decision permits a new explicit preparation; it never
          retries this submission.
        </p>
        {eligible ? (
          <form className="db-stack" onSubmit={(event) => void submit(event)}>
            <Select
              label="Owner decision"
              value={decision}
              disabled={locked}
              options={decisions}
              onChange={(event) => {
                setDecision(event.target.value);
                setConfirmed(false);
              }}
            />
            <Field
              label="Verification evidence"
              required
              maxLength={1000}
              value={evidence}
              disabled={locked}
              onChange={(event) => {
                setEvidence(event.target.value);
                setConfirmed(false);
              }}
            />
            {decision === 'CONFIRMED_ACCEPTED' ? (
              <Field
                label="Provider reference"
                required
                maxLength={255}
                value={reference}
                disabled={locked}
                onChange={(event) => {
                  setReference(event.target.value);
                  setConfirmed(false);
                }}
              />
            ) : null}
            <Checkbox
              label="I checked this recipient and the supporting provider evidence"
              checked={confirmed}
              disabled={locked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <Button
              type="submit"
              loading={store.busy}
              disabled={
                locked ||
                !confirmed ||
                !evidence.trim() ||
                (decision === 'CONFIRMED_ACCEPTED' && !reference.trim())
              }
            >
              Record owner decision
            </Button>
          </form>
        ) : (
          <Notification
            title="Recorded provider evidence takes precedence"
            description="An owner decision cannot overwrite a provider-confirmed outcome."
          />
        )}
        <DataTable
          caption="Owner decision history"
          rows={history}
          rowKey={(row) => row.id}
          state={state}
          onRetry={() => setReload((value) => value + 1)}
          emptyTitle="No owner decisions recorded"
          columns={[
            {
              key: 'decision',
              header: 'Decision',
              render: (row) =>
                decisions.find((option) => option.value === row.decision)
                  ?.label ?? row.decision,
            },
            {
              key: 'evidence',
              header: 'Evidence',
              render: (row) => row.evidence,
            },
            {
              key: 'reference',
              header: 'Owner reference',
              render: (row) => row.providerReference ?? '—',
            },
            {
              key: 'agent',
              header: 'Recorded by',
              render: (row) => row.agentName,
            },
            {
              key: 'date',
              header: 'Recorded',
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
          ]}
        />
      </div>
    </Card>
  );
});

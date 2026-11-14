'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  Checkbox,
  ContactActions,
  DataState,
  Field,
  Notification,
  Select,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import { usePaymentsStore } from '../payments/hooks';
import { PendingRecovery } from '../payments/screen';
import { ContactAttemptQueue, type ContactAttemptInput } from './attempts';
import { ManualReminderPanel } from './manual-reminder';
type Preference = {
  locale: string;
  whatsapp: boolean;
  sms: boolean;
  evidence: string;
  version: number;
  needsConsentRenewal: boolean;
};
type History = {
  attemptsHasMore: boolean;
  messagesHasMore: boolean;
  attempts: {
    id: string;
    channel: string;
    outcome: string;
    createdAt: string;
  }[];
  messages: {
    id: string;
    kind: string;
    channel: string;
    status: string;
    createdAt: string;
  }[];
};
const historyQuery =
  'query($id:ID!){communicationHistory(residentId:$id){attemptsHasMore messagesHasMore attempts{id channel outcome createdAt}messages{id kind channel status createdAt}}}';
const languages = [
  { value: 'en', label: 'English' },
  { value: 'ml', label: 'മലയാളം' },
  { value: 'hi', label: 'हिन्दी' },
];
export const CommunicationsScreen = observer(function CommunicationsScreen() {
  const store = usePaymentsStore();
  const [residentId, setResidentId] = useState('');
  const preferenceRevision =
    store.lastContactPreference?.residentId === residentId
      ? store.lastContactPreference.requestId
      : '';
  const selected = useRef(residentId);
  selected.current = residentId;
  const [preference, setPreference] = useState<Preference | null>(null);
  const [history, setHistory] = useState<History>({
    attemptsHasMore: false,
    messagesHasMore: false,
    attempts: [],
    messages: [],
  });
  const historyGeneration = useRef(0);
  const [historyPaging, setHistoryPaging] = useState<
    'attempts' | 'messages' | null
  >(null);
  const [links, setLinks] = useState<{ tel: string; whatsapp: string } | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState('empty');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [providers, setProviders] = useState<{
    whatsappStatus: string;
    smsStatus: string;
  } | null>(null);
  const queueRef = useRef<ContactAttemptQueue | null>(null);
  const sendingAttempts = useRef(new Set<string>());
  const [pendingAttempts, setPendingAttempts] = useState<ContactAttemptInput[]>(
    [],
  );
  const [attemptErrors, setAttemptErrors] = useState<Record<string, string>>(
    {},
  );
  const [attemptsBusy, setAttemptsBusy] = useState<string[]>([]);
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  useEffect(() => {
    if (!store.agencyId) return;
    const queue = new ContactAttemptQueue(store.agencyId, {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
    });
    queueRef.current = queue;
    setPendingAttempts(queue.items);
    setRecoveryAvailable(queue.available);
    return () => {
      queueRef.current = null;
    };
  }, [store.agencyId]);
  useEffect(() => {
    let live = true;
    void graphqlRequest<{
      communicationSettings: NonNullable<typeof providers>;
    }>('{communicationSettings{whatsappStatus smsStatus}}')
      .then((d) => {
        if (live) setProviders(d.communicationSettings);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setPreference(null);
    setHistory({
      attempts: [],
      messages: [],
      attemptsHasMore: false,
      messagesHasMore: false,
    });
    setLinks(null);
    setConfirmed(false);
    if (!residentId) {
      setState('empty');
      return;
    }
    setState('loading');
    setError('');
    void graphqlRequest<{
      contactPreference: Preference;
    }>(
      'query($id:ID!){contactPreference(residentId:$id){locale whatsapp sms evidence version needsConsentRenewal}}',
      { id: residentId },
    )
      .then((d) => {
        if (live) {
          setPreference(d.contactPreference);
          setState('ready');
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setState('error');
        }
      });
    void graphqlRequest<{ contactLinks: { tel: string; whatsapp: string } }>(
      'query($id:ID!){contactLinks(residentId:$id){tel whatsapp}}',
      { id: residentId },
    )
      .then((d) => {
        if (live) setLinks(d.contactLinks);
      })
      .catch(() => {
        if (live) setLinks(null);
      });
    return () => {
      live = false;
    };
  }, [residentId, reload, preferenceRevision]);
  useEffect(() => {
    if (!residentId) return;
    let live = true;
    const generation = ++historyGeneration.current;
    void graphqlRequest<{ communicationHistory: History }>(historyQuery, {
      id: residentId,
    })
      .then((data) => {
        if (live && generation === historyGeneration.current) {
          setHistory(data.communicationHistory);
          setHistoryPaging(null);
        }
      })
      .catch((e) => {
        if (live)
          setError(
            `Contact history could not refresh: ${(e as Error).message}`,
          );
      });
    return () => {
      live = false;
    };
  }, [residentId, reload, store.lastCompletedRequestId]);
  async function loadOlderHistory(kind: 'attempts' | 'messages') {
    if (historyPaging) return;
    const last = history[kind].at(-1);
    if (!last) return;
    const generation = historyGeneration.current;
    setHistoryPaging(kind);
    try {
      const argument =
        kind === 'attempts' ? 'attemptsBefore' : 'messagesBefore';
      const data = await graphqlRequest<{ communicationHistory: History }>(
        `query($id:ID!,$cursor:CommunicationCursorInput!){communicationHistory(residentId:$id,${argument}:$cursor){attemptsHasMore messagesHasMore attempts{id channel outcome createdAt}messages{id kind channel status createdAt}}}`,
        { id: residentId, cursor: { id: last.id, createdAt: last.createdAt } },
      );
      if (
        generation !== historyGeneration.current ||
        selected.current !== residentId
      )
        return;
      setHistory((old) =>
        kind === 'attempts'
          ? {
              ...old,
              attempts: [
                ...old.attempts,
                ...data.communicationHistory.attempts,
              ],
              attemptsHasMore: data.communicationHistory.attemptsHasMore,
            }
          : {
              ...old,
              messages: [
                ...old.messages,
                ...data.communicationHistory.messages,
              ],
              messagesHasMore: data.communicationHistory.messagesHasMore,
            },
      );
    } catch (e) {
      if (generation === historyGeneration.current)
        setError(
          `Older contact history could not load: ${(e as Error).message}`,
        );
    } finally {
      if (generation === historyGeneration.current) setHistoryPaging(null);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!preference || state !== 'ready') return;
    const saved = await store.execute(
      'contactPreference',
      {
        requestId: crypto.randomUUID(),
        residentId,
        version: preference.version,
        locale: preference.locale,
        whatsapp: preference.whatsapp,
        sms: preference.sms,
        confirmedConsent: confirmed,
        evidence: preference.evidence,
      },
      residentId,
    );
    if (saved && selected.current === residentId)
      setNotice('Contact preferences saved');
  }
  async function recordAttempt(input: ContactAttemptInput, retry = false) {
    const queue = queueRef.current;
    if (!queue || sendingAttempts.current.has(input.requestId)) return;
    sendingAttempts.current.add(input.requestId);
    setAttemptsBusy([...sendingAttempts.current]);
    try {
      if (retry && !queue.available) queue.retryPersistence();
      queue.add(input);
      setPendingAttempts(queue.items);
      await graphqlRequest(
        'mutation($input:ContactAttemptInput!){recordContactAttempt(input:$input){id outcome}}',
        { input },
      );
      if (queueRef.current !== queue) return;
      queue.acknowledge(input.requestId);
      setPendingAttempts(queue.items);
      setAttemptErrors((old) => {
        const next = { ...old };
        delete next[input.requestId];
        return next;
      });
      if (selected.current === input.residentId) {
        setNotice('Contact attempt recorded');
        try {
          const updated = await graphqlRequest<{
            communicationHistory: History;
          }>(historyQuery, { id: input.residentId });
          if (
            queueRef.current === queue &&
            selected.current === input.residentId
          ) {
            historyGeneration.current++;
            setHistory(updated.communicationHistory);
            setHistoryPaging(null);
          }
        } catch (e) {
          if (queueRef.current === queue)
            setError(
              `The attempt was recorded, but history could not refresh: ${(e as Error).message}`,
            );
        }
      }
    } catch (e) {
      if (queueRef.current === queue) {
        setPendingAttempts(queue.items);
        setAttemptErrors((old) => ({
          ...old,
          [input.requestId]: (e as Error).message,
        }));
      }
    } finally {
      sendingAttempts.current.delete(input.requestId);
      if (queueRef.current === queue) {
        setRecoveryAvailable(queue.available);
        setAttemptsBusy([...sendingAttempts.current]);
      }
    }
  }
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready' ||
    state !== 'ready';
  return (
    <section className="db-stack">
      <header>
        <p className="db-eyebrow">Resident contact</p>
        <h1>Communications</h1>
        <p>Manage consent, preferred language and contact history.</p>
        <Link href="/settings/communications">Messaging settings</Link>
        <Link href="/communications/documents">Documents and dispatch</Link>
      </header>
      <PendingRecovery store={store} />
      {!recoveryAvailable ? (
        <Notification
          tone="warning"
          title="Contact recovery storage unavailable"
          description="Contact links still open, but their logs require working browser storage. Restore access before retrying saved attempts."
        />
      ) : null}
      {pendingAttempts.map((input) => (
        <Notification
          key={input.requestId}
          tone="warning"
          title={
            attemptErrors[input.requestId]
              ? 'Contact attempt could not be recorded'
              : 'Contact attempt unconfirmed'
          }
          description={`${store.residents.find((r) => r.id === input.residentId)?.name ?? 'Resident'} · ${input.channel === 'CALL' ? 'Call' : 'WhatsApp'}${attemptErrors[input.requestId] ? ` · ${attemptErrors[input.requestId]}` : ''}`}
          action={
            <Button
              loading={attemptsBusy.includes(input.requestId)}
              onClick={() => void recordAttempt(input, true)}
            >
              Retry recording this attempt
            </Button>
          }
        />
      ))}
      {store.error || error ? (
        <Notification
          tone="error"
          title="Unable to load or save communications"
          description={store.error || error}
        />
      ) : null}
      {notice ? <Notification tone="success" title={notice} /> : null}
      <Card title="Messaging services">
        <p>
          {providers
            ? providers.whatsappStatus === 'CONFIGURED'
              ? 'WhatsApp configured'
              : providers.whatsappStatus === 'CONFIGURATION_ERROR'
                ? 'WhatsApp configuration needs attention'
                : 'WhatsApp not configured'
            : 'Checking WhatsApp configuration…'}
        </p>
        <p>
          {providers
            ? providers.smsStatus === 'CONFIGURED'
              ? 'SMS configured'
              : providers.smsStatus === 'CONFIGURATION_ERROR'
                ? 'SMS configuration needs attention'
                : 'SMS not configured'
            : 'Checking SMS configuration…'}
        </p>
        <p>Provider setup does not confirm consent or message delivery.</p>
      </Card>
      <Select
        label="Resident"
        value={residentId}
        disabled={store.busy || Boolean(store.pending)}
        options={[
          { value: '', label: 'Choose a resident' },
          ...store.residents.map((r) => ({
            value: r.id,
            label: `${r.name} · ${r.code}`,
          })),
        ]}
        onChange={(e) => {
          setResidentId(e.target.value);
          setNotice('');
        }}
      />
      {state === 'loading' ? (
        <DataState kind="loading" />
      ) : state === 'error' ? (
        <Button onClick={() => setReload((v) => v + 1)}>
          Retry contact details
        </Button>
      ) : !residentId ? (
        <p>Choose a resident to view contact preferences.</p>
      ) : preference ? (
        <>
          <Card title="Contact preferences">
            {preference.needsConsentRenewal ? (
              <Notification
                tone="warning"
                title="Phone number changed"
                description="Confirm permission for the current number before sending automated messages."
              />
            ) : null}
            <form onSubmit={(event) => void save(event)}>
              <fieldset
                className="db-stack"
                disabled={locked}
                style={{ border: 0, padding: 0 }}
              >
                <Select
                  label="Preferred message language"
                  value={preference.locale}
                  options={languages}
                  onChange={(e) =>
                    setPreference({ ...preference, locale: e.target.value })
                  }
                />
                <Checkbox
                  label="Allow WhatsApp messages"
                  checked={preference.whatsapp}
                  onChange={(e) =>
                    setPreference({ ...preference, whatsapp: e.target.checked })
                  }
                />
                <Checkbox
                  label="Allow SMS messages"
                  checked={preference.sms}
                  onChange={(e) =>
                    setPreference({ ...preference, sms: e.target.checked })
                  }
                />
                <Checkbox
                  label="Resident explicitly agreed to the selected channels"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <Field
                  label="Consent evidence"
                  value={preference.evidence}
                  required
                  onChange={(e) =>
                    setPreference({ ...preference, evidence: e.target.value })
                  }
                />
                <Button type="submit" loading={store.busy}>
                  Save contact preferences
                </Button>
              </fieldset>
            </form>
          </Card>
          <ManualReminderPanel
            key={residentId}
            residentId={residentId}
            store={store}
          />
          <Card title="Direct contact">
            <ContactActions
              tel={links?.tel}
              whatsapp={links?.whatsapp}
              onAttempt={(channel) => {
                void recordAttempt({
                  requestId: crypto.randomUUID(),
                  residentId,
                  channel,
                });
              }}
            />
            <p>
              Opening a link records an attempt; it does not prove the call
              connected or a message arrived.
            </p>
          </Card>
          <Card title="Contact history">
            {history.attempts.length > 200 || history.messages.length > 200 ? (
              <p>
                Older contact records are a snapshot. New contact actions
                refresh the recent history.
              </p>
            ) : null}
            {!history.attempts.length && !history.messages.length ? (
              <p>No contact attempts or automated messages recorded.</p>
            ) : (
              <ul>
                {history.attempts.map((a) => (
                  <li key={a.id}>
                    {a.channel === 'CALL' ? 'Call' : 'WhatsApp'} · Attempted ·{' '}
                    {new Date(a.createdAt).toLocaleString()}
                  </li>
                ))}
                {history.messages.map((m) => (
                  <li key={m.id}>
                    {m.kind.replaceAll('_', ' ')} · {m.channel} ·{' '}
                    {m.status.replaceAll('_', ' ')} ·{' '}
                    {new Date(m.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
            {history.attemptsHasMore ? (
              <Button
                variant="secondary"
                loading={historyPaging === 'attempts'}
                disabled={Boolean(historyPaging)}
                onClick={() => void loadOlderHistory('attempts')}
              >
                Load older contact attempts
              </Button>
            ) : null}
            {history.messagesHasMore ? (
              <Button
                variant="secondary"
                loading={historyPaging === 'messages'}
                disabled={Boolean(historyPaging)}
                onClick={() => void loadOlderHistory('messages')}
              >
                Load older resident messages
              </Button>
            ) : null}
          </Card>
        </>
      ) : null}
    </section>
  );
});

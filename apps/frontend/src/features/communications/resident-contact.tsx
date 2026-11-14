'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, ContactActions, Notification } from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import { ContactAttemptQueue, type ContactAttemptInput } from './attempts';
/** Lazy contact controls avoid fetching links for every row in a run sheet. */
export function ResidentContact({
  residentId,
  name,
}: {
  residentId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false),
    [reload, setReload] = useState(0);
  const [links, setLinks] = useState<{ tel: string; whatsapp: string } | null>(
    null,
  );
  const [state, setState] = useState('loading'),
    [error, setError] = useState('');
  const [pending, setPending] = useState<ContactAttemptInput[]>([]),
    [busy, setBusy] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const queueRef = useRef<ContactAttemptQueue | null>(null),
    sending = useRef(new Set<string>());
  useEffect(() => {
    if (!open) return;
    let live = true;
    void graphqlRequest<{
      me: { agencyId: string };
      contactLinks: { tel: string; whatsapp: string };
    }>(
      'query($id:ID!){me{agencyId}contactLinks(residentId:$id){tel whatsapp}}',
      { id: residentId },
    )
      .then((data) => {
        if (!live) return;
        const queue = new ContactAttemptQueue(data.me.agencyId, {
          getItem: (key) => window.sessionStorage.getItem(key),
          setItem: (key, value) => window.sessionStorage.setItem(key, value),
        });
        queueRef.current = queue;
        setPending(
          queue.items.filter((item) => item.residentId === residentId),
        );
        setLinks(data.contactLinks);
        setState('ready');
        if (!queue.available)
          setError(
            'Contact recovery storage is unavailable. Restore it before retrying saved attempts.',
          );
      })
      .catch((e) => {
        if (live) {
          setState('error');
          setError((e as Error).message);
        }
      });
    return () => {
      live = false;
      queueRef.current = null;
    };
  }, [open, reload, residentId]);
  async function record(input: ContactAttemptInput, retry = false) {
    const queue = queueRef.current;
    if (!queue || sending.current.has(input.requestId)) return;
    sending.current.add(input.requestId);
    setBusy([...sending.current]);
    try {
      if (retry && !queue.available) queue.retryPersistence();
      queue.add(input);
      setPending(queue.items.filter((item) => item.residentId === residentId));
      await graphqlRequest(
        'mutation($input:ContactAttemptInput!){recordContactAttempt(input:$input){id outcome}}',
        { input },
      );
      if (queueRef.current !== queue) return;
      queue.acknowledge(input.requestId);
      setPending(queue.items.filter((item) => item.residentId === residentId));
      setNotice('Contact attempt recorded');
      setError('');
    } catch (e) {
      if (queueRef.current === queue) {
        setPending(
          queue.items.filter((item) => item.residentId === residentId),
        );
        setError((e as Error).message);
      }
    } finally {
      sending.current.delete(input.requestId);
      if (queueRef.current === queue) setBusy([...sending.current]);
    }
  }
  return (
    <div className="db-stack">
      <Button
        variant="tertiary"
        onClick={() => {
          setLinks(null);
          setState('loading');
          setError('');
          setNotice('');
          setOpen((value) => !value);
        }}
        aria-expanded={open}
      >
        Contact {name}
      </Button>
      {open ? (
        <>
          {state === 'loading' ? (
            <p role="status">Loading contact options…</p>
          ) : null}
          {state === 'error' ? (
            <Button
              onClick={() => {
                setLinks(null);
                setState('loading');
                setError('');
                setReload((value) => value + 1);
              }}
            >
              Retry contact options
            </Button>
          ) : null}
          {links ? (
            <ContactActions
              tel={links.tel}
              whatsapp={links.whatsapp}
              labels={{
                call: `Call ${name}`,
                whatsapp: `WhatsApp ${name}`,
                unavailable: 'Contact unavailable',
              }}
              onAttempt={(channel) => {
                setNotice('');
                void record({
                  requestId: crypto.randomUUID(),
                  residentId,
                  channel,
                });
              }}
            />
          ) : null}
          {pending.map((input) => (
            <Notification
              key={input.requestId}
              tone="warning"
              title="Contact attempt unconfirmed"
              description="Retry checks the original contact log; it does not reopen the call or chat."
              action={
                <Button
                  loading={busy.includes(input.requestId)}
                  onClick={() => void record(input, true)}
                >
                  Retry original contact attempt
                </Button>
              }
            />
          ))}
          {error ? (
            <Notification
              tone="error"
              title="Contact logging unavailable"
              description={error}
            />
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          <p className="db-muted">
            Opening a link records an attempt, not a connected call or delivered
            message.
          </p>
        </>
      ) : null}
    </div>
  );
}

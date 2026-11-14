'use client';
import Link from 'next/link';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DataState, Notification } from '@daybook/ui';
import { usePaymentsStore } from '../payments/hooks';
import { PendingRecovery } from '../payments/screen';
import { DocumentSourcePicker } from './source-picker';
import { DocumentPanel } from './document-panel';
import { DispatchPanel } from './dispatch-panel';
import type { DocumentContext, InvoiceCandidate } from './document-model';
export const DocumentsDispatchScreen = observer(
  function DocumentsDispatchScreen() {
    const store = usePaymentsStore();
    const [context, setContext] = useState<DocumentContext | null>(null);
    const [candidates, setCandidates] = useState<InvoiceCandidate[]>([]);
    const [notice, setNotice] = useState(''),
      [error, setError] = useState('');
    function add(candidate: InvoiceCandidate) {
      if (
        !candidates.some((row) => row.residentId === candidate.residentId) &&
        candidates.length >= 100
      ) {
        setError(
          'Queue this batch of one hundred before adding more residents.',
        );
        return;
      }
      setCandidates((rows) => [
        ...rows.filter((row) => row.residentId !== candidate.residentId),
        candidate,
      ]);
      setNotice('Invoice added to batch');
      setError('');
    }
    return (
      <section className="db-stack">
        <header>
          <p className="db-eyebrow">Documents and communications</p>
          <h1>Documents and dispatch</h1>
          <div className="db-row">
            <Link href="/communications">
              Resident consent and contact history
            </Link>
            <Link href="/settings/communications">Messaging settings</Link>
          </div>
        </header>
        <PendingRecovery store={store} />
        {notice ? <Notification tone="success" title={notice} /> : null}
        {error || store.error ? (
          <Notification
            tone="error"
            title="Document or dispatch action unavailable"
            description={error || store.error}
          />
        ) : null}
        {store.state === 'loading' ? (
          <DataState kind="loading" />
        ) : store.state === 'error' ? (
          <DataState kind="error" onRetry={() => void store.load()} />
        ) : (
          <>
            <DocumentSourcePicker store={store} onSelect={setContext} />
            {context ? (
              <DocumentPanel
                key={`${context.kind}:${context.source.id}:${context.locale}`}
                context={context}
                store={store}
                onAdd={add}
                onNotice={setNotice}
              />
            ) : null}
            <DispatchPanel
              store={store}
              candidates={candidates}
              onRemove={(residentId) =>
                setCandidates((rows) =>
                  rows.filter((row) => row.residentId !== residentId),
                )
              }
              onQueued={() => {
                setCandidates([]);
                setNotice(
                  'Message batch prepared; review each recipient status below.',
                );
              }}
            />
          </>
        )}
      </section>
    );
  },
);

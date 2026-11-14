'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  DataState,
  Field,
  Notification,
  Select,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import type { PaymentsStore } from '../payments/store';
import {
  documentLanguages,
  type DocumentContext,
  type DocumentKind,
  type DocumentSource,
} from './document-model';
const kinds = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'PAYMENT_RECEIPT', label: 'Payment receipt' },
  { value: 'PAYSLIP', label: 'Payslip' },
  { value: 'CLEARANCE_REFUND', label: 'Clearance refund receipt' },
];
export const DocumentSourcePicker = observer(function DocumentSourcePicker({
  store,
  onSelect,
}: {
  store: PaymentsStore;
  onSelect: (context: DocumentContext | null) => void;
}) {
  const [kind, setKind] = useState<DocumentKind>('INVOICE');
  const [residentId, setResidentId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [locale, setLocale] = useState('en');
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [state, setState] = useState('empty');
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [filter, setFilter] = useState({ from: '', to: '', revision: 0 });
  const initializedAgency = useRef('');
  const generation = useRef(0);
  const partyId = kind === 'PAYSLIP' ? staffId : residentId;
  const scope = `${kind}:${partyId}:${filter.from}:${filter.to}:${filter.revision}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    if (
      store.state === 'ready' &&
      initializedAgency.current !== store.agencyId
    ) {
      initializedAgency.current = store.agencyId;
      setResidentId(store.selectedResidentId || store.residents[0]?.id || '');
    }
  }, [store.state, store.agencyId, store.selectedResidentId, store.residents]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const load = useCallback(
    async (cursor?: DocumentSource) => {
      if (!partyId) return;
      const requestScope = currentScope.current,
        requestGeneration = ++generation.current;
      setState('loading');
      setError('');
      try {
        const data = await graphqlRequest<{
          documentSources: { items: DocumentSource[]; hasMore: boolean };
        }>(
          'query($input:DocumentSourcesInput!){documentSources(input:$input){items{id kind title date version}hasMore}}',
          {
            input: {
              kind,
              ...(kind === 'PAYSLIP'
                ? { staffId: partyId }
                : { residentId: partyId }),
              ...(filter.from ? { from: filter.from } : {}),
              ...(filter.to ? { to: filter.to } : {}),
              ...(cursor
                ? { beforeDate: cursor.date, beforeId: cursor.id }
                : {}),
            },
          },
        );
        if (
          requestScope !== currentScope.current ||
          requestGeneration !== generation.current
        )
          return;
        setSources((previous) =>
          cursor
            ? [
                ...new Map(
                  [...previous, ...data.documentSources.items].map((row) => [
                    row.id,
                    row,
                  ]),
                ).values(),
              ]
            : data.documentSources.items,
        );
        setHasMore(data.documentSources.hasMore);
        setState('ready');
      } catch (e) {
        if (
          requestScope === currentScope.current &&
          requestGeneration === generation.current
        ) {
          setError((e as Error).message);
          setState('error');
        }
      }
    },
    [kind, partyId, filter.from, filter.to],
  );
  useEffect(() => {
    setSourceId('');
    setSources([]);
    setHasMore(false);
    onSelect(null);
    if (partyId) void load();
    else setState('empty');
  }, [load, partyId, onSelect, filter.revision]);
  function publish(id: string, language = locale) {
    setSourceId(id);
    const source = sources.find((row) => row.id === id);
    onSelect(
      source
        ? {
            source,
            kind,
            locale: language,
            residentId: kind === 'PAYSLIP' ? '' : residentId,
            staffId: kind === 'PAYSLIP' ? staffId : '',
            partyName:
              kind === 'PAYSLIP'
                ? (store.staffCollectors.find((row) => row.id === staffId)
                    ?.name ?? 'Staff member')
                : (store.residents.find((row) => row.id === residentId)?.name ??
                  'Resident'),
          }
        : null,
    );
  }
  return (
    <Card title="Choose a financial record">
      <div className="db-stack">
        <Select
          label="Document type"
          value={kind}
          disabled={store.busy}
          options={kinds}
          onChange={(e) => {
            onSelect(null);
            setKind(e.target.value as DocumentKind);
          }}
        />
        {kind === 'PAYSLIP' ? (
          <Select
            label="Staff member"
            value={staffId}
            disabled={store.busy}
            options={store.staffCollectors.map((row) => ({
              value: row.id,
              label: row.name,
            }))}
            onChange={(e) => {
              onSelect(null);
              setStaffId(e.target.value);
            }}
          />
        ) : (
          <Select
            label="Resident"
            value={residentId}
            disabled={store.busy}
            options={store.residents.map((row) => ({
              value: row.id,
              label: `${row.name} · ${row.code}`,
            }))}
            onChange={(e) => {
              onSelect(null);
              setResidentId(e.target.value);
            }}
          />
        )}
        <div className="db-row">
          <Field
            label="Source date from"
            type="date"
            value={from}
            disabled={store.busy}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Field
            label="Source date to"
            type="date"
            value={to}
            disabled={store.busy}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={store.busy}
            onClick={() => {
              onSelect(null);
              setFilter({ from, to, revision: filter.revision + 1 });
            }}
          >
            Apply source dates
          </Button>
        </div>
        {error ? (
          <Notification
            tone="error"
            title="Financial records unavailable"
            description={error}
            action={
              <Button onClick={() => void load()}>
                Retry financial records
              </Button>
            }
          />
        ) : null}
        {state === 'loading' && !sources.length ? (
          <DataState kind="loading" title="Loading financial records…" />
        ) : !partyId ? (
          <p>
            Choose {kind === 'PAYSLIP' ? 'a staff member' : 'a resident'} to
            view eligible records.
          </p>
        ) : state === 'ready' && !sources.length ? (
          <p>No eligible records in this date range.</p>
        ) : sources.length ? (
          <Select
            label="Financial record"
            value={sourceId}
            disabled={store.busy}
            options={sources.map((row) => ({
              value: row.id,
              label: `${row.title} · ${row.date} · Revision ${row.version}`,
            }))}
            onChange={(e) => publish(e.target.value)}
          />
        ) : null}
        {hasMore ? (
          <Button
            variant="secondary"
            loading={state === 'loading'}
            onClick={() => void load(sources.at(-1))}
          >
            Load older financial records
          </Button>
        ) : null}
        <Select
          label="Document language"
          value={locale}
          disabled={store.busy}
          options={documentLanguages}
          onChange={(e) => {
            setLocale(e.target.value);
            publish(sourceId, e.target.value);
          }}
        />
        <p>
          Only issued invoices, confirmed receipts and refunds, and posted
          payslips are listed. A payslip can still be awaiting payout.
        </p>
      </div>
    </Card>
  );
});

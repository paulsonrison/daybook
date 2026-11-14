'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  AssetImage,
  Button,
  Card,
  DataState,
  Field,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import type { FinancialDocumentModel } from '@daybook/ui/documents';
import { graphqlRequest } from '@/lib/graphql/client';
import type { Operation, PaymentsStore } from '../payments/store';
import type {
  DocumentContext,
  FinancialDocument,
  InvoiceCandidate,
  SharedDocumentLink,
} from './document-model';
export const DocumentPanel = observer(function DocumentPanel({
  context,
  store,
  onAdd,
  onNotice,
}: {
  context: DocumentContext;
  store: PaymentsStore;
  onAdd: (item: InvoiceCandidate) => void;
  onNotice: (message: string) => void;
}) {
  const [documents, setDocuments] = useState<FinancialDocument[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [links, setLinks] = useState<SharedDocumentLink[]>([]);
  const [state, setState] = useState('loading');
  const [linkState, setLinkState] = useState('empty');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [lifetime, setLifetime] = useState('7');
  const documentGeneration = useRef(0),
    linkGeneration = useRef(0),
    reading = useRef(false);
  const appliedCompletion = useRef('');
  const loadDocuments = useCallback(
    async (newest = false) => {
      if (reading.current) return;
      reading.current = true;
      const generation = ++documentGeneration.current;
      setError('');
      try {
        const result = await graphqlRequest<{ documents: FinancialDocument[] }>(
          'query($id:ID!){documents(sourceId:$id){id kind sourceId sourceVersion locale status filename createdAt attempts lastError snapshot}}',
          { id: context.source.id },
        );
        if (generation !== documentGeneration.current) return;
        const rows = result.documents.filter(
          (row) => row.locale === context.locale && row.kind === context.kind,
        );
        const completed = store.lastOperationResult as {
          id?: string;
          sourceId?: string;
          locale?: string;
        } | null;
        const completedId =
          appliedCompletion.current !== store.lastCompletedRequestId &&
          ['documentPrepare', 'documentGenerate'].includes(
            store.lastCompletedKind ?? '',
          ) &&
          completed?.sourceId === context.source.id &&
          completed.locale === context.locale
            ? completed.id
            : undefined;
        if (completedId && !rows.some((row) => row.id === completedId)) {
          const original = await graphqlRequest<{
            document: FinancialDocument;
          }>(
            'query($id:ID!){document(id:$id){id kind sourceId sourceVersion locale status filename createdAt attempts lastError snapshot}}',
            { id: completedId },
          );
          if (generation !== documentGeneration.current) return;
          if (
            original.document.sourceId === context.source.id &&
            original.document.kind === context.kind &&
            original.document.locale === context.locale
          )
            rows.unshift(original.document);
        }
        if (completedId)
          appliedCompletion.current = store.lastCompletedRequestId;
        setDocuments(rows);
        setDocumentId((previous) =>
          completedId && rows.some((row) => row.id === completedId)
            ? completedId
            : !newest && rows.some((row) => row.id === previous)
              ? previous
              : (rows[0]?.id ?? ''),
        );
        setState('ready');
      } catch (e) {
        if (generation === documentGeneration.current) {
          setError((e as Error).message);
          setState('error');
        }
      } finally {
        if (generation === documentGeneration.current) reading.current = false;
      }
    },
    [context.source.id, context.locale, context.kind, store],
  );
  const cancelDocuments = useCallback(() => {
    documentGeneration.current++;
    reading.current = false;
  }, []);
  useEffect(() => {
    void loadDocuments();
    return cancelDocuments;
  }, [loadDocuments, cancelDocuments, store.lastCompletedRequestId]);
  useEffect(() => {
    if (
      !documents.some((row) => ['PREPARED', 'GENERATING'].includes(row.status))
    )
      return;
    const timer = setInterval(() => {
      void loadDocuments();
    }, 4000);
    return () => clearInterval(timer);
  }, [documents, loadDocuments]);
  const document = documents.find((row) => row.id === documentId);
  useEffect(() => {
    let live = true;
    const generation = ++linkGeneration.current;
    setLinks([]);
    setLinkError('');
    if (!documentId) {
      setLinkState('empty');
      return;
    }
    setLinkState('loading');
    void graphqlRequest<{ documentLinks: SharedDocumentLink[] }>(
      'query($id:ID!){documentLinks(documentId:$id){id documentId status urlStatus url expiresAt createdAt}}',
      { id: documentId },
    )
      .then((data) => {
        if (live && generation === linkGeneration.current) {
          setLinks(data.documentLinks);
          setLinkState('ready');
        }
      })
      .catch((e) => {
        if (live && generation === linkGeneration.current) {
          setLinkError(e.message);
          setLinkState('error');
        }
      });
    return () => {
      live = false;
    };
  }, [documentId, store.lastCompletedRequestId]);
  const currentLinks = links.filter((row) => row.documentId === documentId);
  const activeLink = currentLinks.find(
    (row) => row.status === 'ACTIVE' && row.urlStatus === 'READY' && row.url,
  );
  const model = useMemo<FinancialDocumentModel | null>(() => {
    try {
      const value = JSON.parse(document?.snapshot ?? 'null');
      return value &&
        value.kind === context.kind &&
        value.locale === context.locale &&
        Array.isArray(value.totals)
        ? value
        : null;
    } catch {
      return null;
    }
  }, [document?.snapshot, context.kind, context.locale]);
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready';
  async function perform(
    operation: Operation,
    input: Record<string, unknown>,
    notice: string,
  ) {
    if (locked) return false;
    const completed = await store.execute(
      operation,
      { ...input, requestId: crypto.randomUUID() },
      context.residentId,
    );
    if (completed) {
      onNotice(notice);
      await loadDocuments(operation === 'documentPrepare');
    }
    return completed;
  }
  async function share() {
    const days = Number(lifetime);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      setLinkError('Choose a link lifetime of one to thirty days.');
      return;
    }
    if (document)
      await perform(
        'documentLink',
        { documentId: document.id, expiryDays: days },
        'Share link created',
      );
  }
  const qr =
    typeof model?.qrDataUrl === 'string' &&
    model.qrDataUrl.startsWith('data:image/png;base64,')
      ? model.qrDataUrl
      : undefined;
  const canAdd =
    context.kind === 'INVOICE' &&
    document?.status === 'READY' &&
    document.sourceVersion === context.source.version &&
    activeLink &&
    model &&
    qr &&
    state === 'ready' &&
    linkState === 'ready';
  return (
    <Card title={`${context.source.title} · ${context.partyName}`}>
      <div className="db-stack">
        <p>
          Figures are fixed at document preparation. Later payments and
          corrections do not rewrite an existing PDF.
        </p>
        {error ? (
          <Notification
            tone="error"
            title="Document history unavailable"
            description={error}
            action={
              <Button onClick={() => void loadDocuments()}>
                Retry document history
              </Button>
            }
          />
        ) : null}
        <Button
          disabled={locked || state !== 'ready'}
          loading={store.busy}
          onClick={() =>
            void perform(
              'documentPrepare',
              {
                kind: context.kind,
                sourceId: context.source.id,
                sourceVersion: context.source.version,
                locale: context.locale,
              },
              'Document snapshot prepared',
            )
          }
        >
          Prepare new document
        </Button>
        {state === 'loading' ? (
          <DataState kind="loading" title="Loading document snapshots…" />
        ) : !documents.length && state === 'ready' ? (
          <p>No document snapshot prepared in this language.</p>
        ) : documents.length ? (
          <Select
            label="Document snapshot"
            value={documentId}
            disabled={store.busy}
            options={documents.map((row) => ({
              value: row.id,
              label: `${row.filename} · ${new Date(row.createdAt).toLocaleString()} · ${row.status.toLowerCase()}`,
            }))}
            onChange={(e) => setDocumentId(e.target.value)}
          />
        ) : null}
        {document ? (
          <>
            <p role="status">
              {document.status === 'READY'
                ? 'PDF ready'
                : document.status === 'GENERATING'
                  ? 'Generating PDF…'
                  : document.status === 'FAILED'
                    ? 'PDF generation failed'
                    : 'Snapshot prepared; PDF generation pending'}
            </p>
            {document.lastError ? (
              <Notification
                tone="error"
                title="PDF could not be generated"
                description={document.lastError}
              />
            ) : null}
            {document.sourceVersion !== context.source.version ? (
              <Notification
                tone="warning"
                title="Older source revision"
                description="Download or share this historical snapshot, or prepare a new document before adding it to a message batch."
              />
            ) : null}
            {document.status !== 'READY' ? (
              <Button
                disabled={
                  locked ||
                  document.status === 'GENERATING' ||
                  document.attempts >= 3
                }
                loading={store.busy}
                onClick={() =>
                  void perform(
                    'documentGenerate',
                    { documentId: document.id },
                    'PDF generation checked',
                  )
                }
              >
                Generate PDF
              </Button>
            ) : (
              <a
                className="db-button db-button--secondary db-button--medium"
                href={`/api/documents/owner/${document.id}`}
                download
              >
                Download PDF
              </a>
            )}
            {document.attempts >= 3 && document.status !== 'READY' ? (
              <p>
                Generation reached its retry limit. Fix the browser or font
                setup, then prepare a new snapshot.
              </p>
            ) : null}
            {model ? (
              <dl>
                {model.totals.map((total, index) => (
                  <div key={index}>
                    <dt>{total.label}</dt>
                    <dd>{formatMoney(total.amount)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <Notification
                tone="error"
                title="Document preview unavailable"
                description="The stored PDF can still be downloaded when ready."
              />
            )}
            {context.kind === 'INVOICE' ? (
              qr ? (
                <div>
                  <AssetImage
                    src={qr}
                    width={192}
                    height={192}
                    alt="UPI payment QR"
                  />
                  <p>Payment request only; not proof of payment.</p>
                </div>
              ) : (
                <p>
                  No payment QR is available for this snapshot. Zero or credit
                  balances and missing payment details do not create payment
                  requests.
                </p>
              )
            ) : null}
            {model?.note ? <p>{model.note}</p> : null}
            <h3>Document share links</h3>
            <p>
              Anyone with an active link can read this document. The default
              lifetime is seven days; revoke a link when it should no longer be
              available.
            </p>
            <Field
              label="Share link lifetime (days)"
              type="number"
              min={1}
              max={30}
              value={lifetime}
              disabled={locked}
              onChange={(e) => setLifetime(e.target.value)}
            />
            <Button
              disabled={locked || document.status !== 'READY'}
              onClick={() => void share()}
            >
              Create share link
            </Button>
            {linkError ? (
              <Notification
                tone="error"
                title="Share links unavailable"
                description={linkError}
              />
            ) : null}
            {linkState === 'loading' ? (
              <p role="status">Checking share links…</p>
            ) : currentLinks.length ? (
              <ul>
                {currentLinks.map((link, index) => (
                  <li key={link.id}>
                    <p>
                      Link {index + 1} · {link.status.toLowerCase()} · Expires{' '}
                      {new Date(link.expiresAt).toLocaleString()}
                    </p>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open shared document
                      </a>
                    ) : (
                      <span>
                        {link.urlStatus === 'KEY_CHANGED'
                          ? 'The signing key changed; create a new link or revoke this existing capability.'
                          : 'Link unavailable'}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      disabled={locked || link.status !== 'ACTIVE'}
                      onClick={() =>
                        void perform(
                          'documentRevoke',
                          { linkId: link.id },
                          'Share link revoked',
                        )
                      }
                    >
                      Revoke link {index + 1}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : linkState === 'ready' ? (
              <p>No share links created.</p>
            ) : null}
            {context.kind === 'INVOICE' ? (
              <>
                <Button
                  disabled={locked || !canAdd}
                  onClick={() => {
                    if (!canAdd || !document || !activeLink || !model) return;
                    onAdd({
                      invoiceId: context.source.id,
                      version: context.source.version,
                      documentId: document.id,
                      linkId: activeLink.id,
                      residentId: context.residentId,
                      residentName: context.partyName,
                      reference: context.source.title,
                      amount: model.totals[2]?.amount ?? '',
                      expiresAt: activeLink.expiresAt,
                      locale: context.locale,
                    });
                  }}
                >
                  Add invoice to batch
                </Button>
                <p>
                  A ready current-revision PDF, payment QR and active share link
                  are required. Consent, current figures and provider settings
                  are checked again before sending.
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
});

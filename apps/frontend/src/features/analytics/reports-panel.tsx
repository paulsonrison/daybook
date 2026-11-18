'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Select } from '@daybook/ui';
import { useI18n } from '@daybook/ui/i18n';
import { reportRequest } from '@/lib/graphql/client';

type Format = 'PDF' | 'XLSX';
type Kind = 'OPERATIONS' | 'SALES' | 'TAX';
type Operation = {
  requestId: string;
  generateRequestId: string;
  reportId?: string;
  kind: Kind;
  format: Format;
  month: string;
  locale: string;
};
type State = {
  operation?: Operation;
  status: 'idle' | 'busy' | 'ready' | 'error';
};
const prepare = `mutation($input:ExportReportInput!){exportReport(input:$input){id}}`;
const generate = `mutation($input:GenerateReportInput!){generateReport(input:$input){id artifacts{format status}}}`;

export function ReportsPanel({ month }: { month: string }) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<Kind>('OPERATIONS');
  const [state, setState] = useState<State>({ status: 'idle' });
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function run(operation: Operation) {
    const current = ++generation.current;
    let active = operation;
    setState({ operation, status: 'busy' });
    try {
      if (!active.reportId) {
        const prepared = await reportRequest<{
          exportReport: { id: string };
        }>(prepare, {
          input: {
            requestId: active.requestId,
            kind: active.kind,
            month: active.month,
            locale: active.locale,
          },
        });
        active = { ...active, reportId: prepared.exportReport.id };
        if (current === generation.current)
          setState({ operation: active, status: 'busy' });
      }
      const result = await reportRequest<{
        generateReport: {
          artifacts: { format: string; status: string }[];
        };
      }>(generate, {
        input: {
          requestId: active.generateRequestId,
          reportId: active.reportId,
          format: active.format,
        },
      });
      const ready = result.generateReport.artifacts.some(
        (artifact) =>
          artifact.format === active.format && artifact.status === 'READY',
      );
      if (!ready) throw new Error('Report generation is still in progress.');
      if (current === generation.current)
        setState({ operation: active, status: 'ready' });
    } catch {
      if (current === generation.current)
        setState({ operation: active, status: 'error' });
    }
  }
  function start(format: Format) {
    void run({
      requestId: crypto.randomUUID(),
      generateRequestId: crypto.randomUUID(),
      kind,
      format,
      month,
      locale,
    });
  }
  const operation = state.operation;
  return (
    <Card
      title={t('Monthly exports')}
      description={t(
        'Prepare an immutable monthly report from recorded agency data, then download a private PDF or spreadsheet.',
      )}
    >
      <div className="db-row">
        <Select
          label={t('Report type')}
          value={kind}
          disabled={state.status === 'busy'}
          onChange={(event) => setKind(event.target.value as Kind)}
          options={[
            { value: 'OPERATIONS', label: t('Operations report') },
            { value: 'SALES', label: t('Sales report') },
            { value: 'TAX', label: t('Recorded tax report') },
          ]}
        />
        <Button
          disabled={!month || state.status === 'busy'}
          onClick={() => start('PDF')}
        >
          {t('Prepare PDF')}
        </Button>
        <Button
          disabled={!month || state.status === 'busy'}
          onClick={() => start('XLSX')}
        >
          {t('Prepare spreadsheet')}
        </Button>
      </div>
      {state.status === 'busy' && (
        <p role="status" aria-live="polite">
          {t('Preparing report…')}
        </p>
      )}
      {state.status === 'error' && operation && (
        <div role="alert">
          <p>{t('Report preparation failed. Your request is preserved.')}</p>
          <Button onClick={() => void run(operation)}>
            {t('Retry report')}
          </Button>
        </div>
      )}
      {state.status === 'ready' && operation?.reportId && (
        <p role="status">
          {t('Report ready')}{' '}
          <a
            href={`/api/reports/owner/${operation.reportId}/${operation.format.toLowerCase()}`}
          >
            {t('Download {format}', { format: operation.format })}
          </a>
        </p>
      )}
    </Card>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, DataState } from '@daybook/ui';
import { useI18n } from '@daybook/ui/i18n';
type Status =
  | { state: 'NOT_CONFIGURED' }
  | {
      state: 'READY';
      protected: boolean;
      latestRunState?: string | null;
      destinations: {
        name: 'neon' | 'b2';
        healthy: boolean;
        configured: boolean;
        verifiedAt: string | null;
      }[];
    };
export function BackupStatus() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<Status | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(false);
    setStatus(null);
    try {
      const response = await fetch('/api/operations/backups', {
        cache: 'no-store',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55000),
        ]),
      });
      if (!response.ok) throw new Error('Unavailable');
      const value: Status = await response.json();
      if (
        value.state !== 'NOT_CONFIGURED' &&
        (value.state !== 'READY' ||
          typeof value.protected !== 'boolean' ||
          !Array.isArray(value.destinations) ||
          value.destinations.length !== 2 ||
          new Set(value.destinations.map((d) => d.name)).size !== 2 ||
          value.destinations.some(
            (d) =>
              !['neon', 'b2'].includes(d.name) ||
              typeof d.healthy !== 'boolean' ||
              (d.verifiedAt !== null &&
                !Number.isFinite(Date.parse(d.verifiedAt))),
          ))
      )
        throw new Error('Invalid status');
      if (!controller.signal.aborted) setStatus(value);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      active.current?.abort();
    };
  }, [refresh]);
  return (
    <section aria-label={t('Backup protection')}>
      <Card title={t('Backup protection')}>
        {loading ? (
          <DataState kind="loading" />
        ) : error ? (
          <p role="alert">{t('Backup status could not be checked.')}</p>
        ) : status?.state === 'NOT_CONFIGURED' ? (
          <p>{t('Automatic backups are not configured.')}</p>
        ) : status?.state === 'READY' ? (
          <>
            <p role="status">
              {status.protected
                ? t('Two recent verified copies')
                : t('Protection needs attention')}
            </p>
            {status.latestRunState === 'FAILED' && (
              <p>{t('Latest backup attempt failed.')}</p>
            )}
            <dl>
              {status.destinations.map((d) => (
                <div key={d.name}>
                  <dt>{d.name === 'neon' ? 'Neon' : 'Backblaze B2'}</dt>
                  <dd>
                    {!d.configured
                      ? t('Not configured')
                      : d.healthy
                        ? t('Recent verified copy')
                        : t('No recent verified copy')}
                  </dd>
                  <dd>
                    {d.verifiedAt
                      ? t('Last verified: {time}', {
                          time: new Intl.DateTimeFormat(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(d.verifiedAt)),
                        })
                      : t('No verified copy')}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
        <p>
          {t(
            'Encrypted recovery copies are managed by the operator. This screen does not provide access to other agencies or backup files.',
          )}
        </p>
        <Button onClick={() => void refresh()} disabled={loading}>
          {t('Refresh backup status')}
        </Button>
      </Card>
    </section>
  );
}

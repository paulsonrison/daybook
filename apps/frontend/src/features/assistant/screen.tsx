'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Card, Field, Notification } from '@daybook/ui';
import { useI18n } from '@daybook/ui/i18n';
import { formatMoney } from '@daybook/ui/money';
import { translateRendered } from '@daybook/ui/messages';
import { AssistantStore } from './store';
function verifiedFacts(value: string | null) {
  if (!value || value.length > 20000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export const AssistantScreen = observer(function AssistantScreen() {
  const [store] = useState(() => new AssistantStore());
  useEffect(() => store.dispose, [store]);
  const { t, locale } = useI18n();
  const status = store.reply?.status,
    facts = status === 'READY' ? verifiedFacts(store.reply!.facts) : null;
  const messages: Record<string, string> = {
    NOT_CONFIGURED: t('AI is not configured.'),
    CONFIGURATION_ERROR: t('AI configuration needs attention.'),
    QUOTA_EXCEEDED: t('AI service limit reached. Try again later.'),
    BUSY: t('AI is busy. Try again shortly.'),
    UNAVAILABLE: t('AI is temporarily unavailable.'),
    INVALID_RESPONSE: t('The AI response could not be verified.'),
    UNVERIFIED_ANSWER: t('The AI response could not be verified.'),
    INVALID_TOOL: t('The AI requested an unsupported operation.'),
    REFUSED: t('This request cannot be answered by the agency assistant.'),
    LIMIT_REACHED: t(
      'The assistant could not complete the answer within its limit.',
    ),
    INPUT_TOO_LARGE: t('This request exceeds the AI input limit.'),
  };
  const money = (value: unknown) =>
    typeof value === 'string' &&
    value.length <= 128 &&
    /^-?\d+\.\d{2}$/.test(value)
      ? formatMoney(value, 'INR', locale + '-IN')
      : t('Unavailable');
  function submit(event: FormEvent) {
    event.preventDefault();
    void store.ask();
  }
  return (
    <div className="agency-page">
      <header className="agency-page-heading">
        <div>
          <p className="db-eyebrow">{t('Your agency only')}</p>
          <h1>{t('Agency assistant')}</h1>
          <p className="db-muted">
            {t(
              'Ask about recorded sales, arrears, daily copies and supplier reconciliation.',
            )}
          </p>
        </div>
      </header>
      <Notification
        tone="info"
        title={t('Read-only assistance')}
        description={t(
          'Questions are processed by a hosted AI provider when configured. The assistant cannot post payments, change records or access another agency.',
        )}
      />
      <Card>
        <form onSubmit={submit} className="db-stack">
          <Field
            label={t('Your question')}
            value={store.question}
            maxLength={2000}
            required
            disabled={store.busy}
            onChange={(event) => store.setQuestion(event.target.value)}
            hint={t(
              'Do not include passwords or unnecessary personal information.',
            )}
          />
          <Field
            label={t('Report month (optional)')}
            type="month"
            value={store.month}
            disabled={store.busy}
            onChange={(event) => store.setMonth(event.target.value)}
            hint={t(
              'Leave blank for the current agency month. Current balances always have their own date.',
            )}
          />
          <Button
            type="submit"
            loading={store.busy}
            loadingLabel={t('Preparing answer…')}
            disabled={!store.question.trim()}
          >
            {t('Ask assistant')}
          </Button>
        </form>
      </Card>
      {store.error && (
        <Notification
          tone="error"
          title={t('Assistant request unavailable')}
          description={translateRendered(locale, store.error)}
        />
      )}
      {status && status !== 'READY' && (
        <Notification
          tone="warning"
          title={
            messages[status] ?? t('The AI response could not be verified.')
          }
          description={t(
            'Your question is retained. No business records were changed.',
          )}
        />
      )}
      {status === 'READY' && (
        <>
          <Card
            title={t('Generated explanation')}
            description={t(
              'AI text may contain errors. Use the verified figures below for financial amounts.',
            )}
          >
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {store.reply?.answer}
            </p>
          </Card>
          {facts ? (
            <Card
              title={t('Verified agency figures')}
              data-testid="assistant-verified-facts"
            >
              <p>
                {t('Selected sales month: {month}', {
                  month:
                    typeof facts.month === 'string'
                      ? facts.month
                      : t('Unavailable'),
                })}
              </p>
              <p>
                {t('Current balances as of {date}', {
                  date:
                    typeof facts.balanceAsOf === 'string'
                      ? facts.balanceAsOf
                      : t('Unavailable'),
                })}
              </p>
              <dl className="db-report-facts">
                {[
                  ['outstanding', t('Outstanding arrears')],
                  ['credit', t('Credit balances')],
                  ['overdue', t('Net overdue')],
                  ['recordedSales', t('Recorded monthly sales')],
                  ['accountReceipts', t('Confirmed account receipts')],
                  ['cashReceipts', t('Collected cash')],
                  ['supplyPurchases', t('Recorded supply purchases')],
                  [
                    'supplyReturnCredits',
                    t('Recorded supplier return credits'),
                  ],
                  ['netSupplyPurchases', t('Net recorded supply purchases')],
                ].map(([key, label]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{label}</dt>
                    <dd>{money(facts[key])}</dd>
                  </div>
                ))}
              </dl>
              <p>
                {t('Scheduled daily copies')}:{' '}
                {typeof facts.scheduledCopies === 'string' &&
                /^\d{1,24}$/.test(facts.scheduledCopies)
                  ? new Intl.NumberFormat(locale + '-IN').format(
                      BigInt(facts.scheduledCopies),
                    )
                  : t('Unavailable')}
              </p>
              <p className="db-muted">
                {t('Report source snapshot: {time}', {
                  time: store.reply?.asOf ?? t('Unavailable'),
                })}
              </p>
              <p className="db-muted">
                {t(
                  'Agency purchases are not proof of route consumption. Shared expenses and supplier returns are not allocated to routes.',
                )}
              </p>
            </Card>
          ) : (
            <Notification
              tone="warning"
              title={t('Verified figures are unavailable.')}
            />
          )}
        </>
      )}
    </div>
  );
});

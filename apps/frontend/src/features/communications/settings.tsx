'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  Checkbox,
  DataState,
  Field,
  Notification,
  Select,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import { usePaymentsStore } from '../payments/hooks';
import { PendingRecovery } from '../payments/screen';
type Template = {
  kind: string;
  locale: string;
  name: string;
  language: string;
  qrHeader: boolean;
};
type Settings = {
  version: number;
  remindersEnabled: boolean;
  frequencyDays: number;
  cooldownHours: number;
  reminderChannel: string;
  whatsappStatus: string;
  smsStatus: string;
  templates: Template[];
};
const kinds = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'REMINDER', label: 'Overdue reminder' },
  { value: 'CREDIT_HOLD', label: 'Credit hold' },
];
const locales = [
  { value: 'en', label: 'English' },
  { value: 'ml', label: 'മലയാളം' },
  { value: 'hi', label: 'हिन्दी' },
];
export const MessagingSettingsScreen = observer(
  function MessagingSettingsScreen() {
    const store = usePaymentsStore();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [state, setState] = useState('loading');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [reload, setReload] = useState(0);
    useEffect(() => {
      let live = true;
      setState('loading');
      setError('');
      setConfirmed(false);
      void graphqlRequest<{ communicationSettings: Settings }>(
        '{communicationSettings{version remindersEnabled frequencyDays cooldownHours reminderChannel whatsappStatus smsStatus templates{kind locale name language qrHeader}}}',
      )
        .then((d) => {
          if (live) {
            setSettings(d.communicationSettings);
            setState('ready');
          }
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setState('error');
          }
        });
      return () => {
        live = false;
      };
    }, [reload, store.lastCompletedRequestId]);
    const locked =
      store.busy ||
      Boolean(store.pending) ||
      store.recoveryUnavailable ||
      store.state !== 'ready' ||
      state !== 'ready';
    function changeTemplate(index: number, change: Partial<Template>) {
      setSettings((old) =>
        old
          ? {
              ...old,
              templates: old.templates.map((row, i) =>
                i === index ? { ...row, ...change } : row,
              ),
            }
          : old,
      );
      setConfirmed(false);
    }
    async function save(event: FormEvent) {
      event.preventDefault();
      if (!settings || locked) return;
      const saved = await store.execute(
        'communicationSettings',
        {
          requestId: crypto.randomUUID(),
          version: settings.version,
          remindersEnabled: settings.remindersEnabled,
          frequencyDays: settings.frequencyDays,
          cooldownHours: settings.cooldownHours,
          reminderChannel: settings.reminderChannel,
          templates: settings.templates,
          confirmTemplatesApproved: confirmed,
        },
        '',
      );
      if (saved) setNotice('Messaging settings saved');
    }
    return (
      <section className="db-stack">
        <header>
          <p className="db-eyebrow">Communication preferences</p>
          <h1>Messaging settings</h1>
          <Link href="/communications">
            Resident consent and contact history
          </Link>
        </header>
        <PendingRecovery store={store} />
        {error || store.error ? (
          <Notification
            tone="error"
            title="Messaging settings unavailable"
            description={error || store.error}
          />
        ) : null}
        {notice ? <Notification tone="success" title={notice} /> : null}
        {state === 'loading' ? (
          <DataState kind="loading" />
        ) : state === 'error' ? (
          <Button onClick={() => setReload((v) => v + 1)}>
            Retry messaging settings
          </Button>
        ) : settings ? (
          <form onSubmit={(event) => void save(event)}>
            <fieldset
              className="db-stack"
              disabled={locked}
              style={{ border: 0, padding: 0 }}
            >
              <Card title="Overdue reminders">
                <div className="db-stack">
                  <Checkbox
                    label="Enable overdue reminders"
                    checked={settings.remindersEnabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        remindersEnabled: e.target.checked,
                      })
                    }
                  />
                  <Field
                    label="Reminder frequency (days)"
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    required
                    value={settings.frequencyDays || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        frequencyDays: Number(e.target.value),
                      })
                    }
                  />
                  <Field
                    label="Minimum cooldown (hours)"
                    type="number"
                    min={1}
                    max={720}
                    step={1}
                    required
                    value={settings.cooldownHours || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        cooldownHours: Number(e.target.value),
                      })
                    }
                  />
                  <Select
                    label="Reminder channel"
                    value={settings.reminderChannel}
                    options={[
                      { value: 'WHATSAPP', label: 'WhatsApp' },
                      { value: 'SMS', label: 'SMS' },
                    ]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reminderChannel: e.target.value,
                      })
                    }
                  />
                  <p>
                    Reminders require a configured provider, current resident
                    consent and an outstanding overdue balance. Enabling this
                    schedule does not confirm that any message was sent.
                  </p>
                  <p>
                    WhatsApp:{' '}
                    {settings.whatsappStatus === 'CONFIGURED'
                      ? 'Configured'
                      : settings.whatsappStatus === 'CONFIGURATION_ERROR'
                        ? 'Configuration needs attention'
                        : 'Not configured'}
                    . SMS:{' '}
                    {settings.smsStatus === 'CONFIGURED'
                      ? 'Configured'
                      : settings.smsStatus === 'CONFIGURATION_ERROR'
                        ? 'Configuration needs attention'
                        : 'Not configured'}
                    .
                  </p>
                </div>
              </Card>
              <Card title="Approved WhatsApp templates">
                <div className="db-stack">
                  <p>
                    Use the exact template name and language approved in your
                    provider account. Saving a name does not obtain provider
                    approval.
                  </p>
                  {settings.templates.map((template, index) => (
                    <fieldset className="db-stack" key={index}>
                      <legend>Template {index + 1}</legend>
                      <Select
                        label="Message type"
                        value={template.kind}
                        options={kinds}
                        onChange={(e) =>
                          changeTemplate(index, { kind: e.target.value })
                        }
                      />
                      <Select
                        label="Template language"
                        value={template.locale}
                        options={locales}
                        onChange={(e) =>
                          changeTemplate(index, {
                            locale: e.target.value,
                            language: e.target.value,
                          })
                        }
                      />
                      <Field
                        label="Provider template name"
                        required
                        maxLength={512}
                        value={template.name}
                        onChange={(e) =>
                          changeTemplate(index, { name: e.target.value })
                        }
                      />
                      <Field
                        label="Provider language code"
                        required
                        value={template.language}
                        hint="Match the approved language, for example ml, hi or en_US."
                        onChange={(e) =>
                          changeTemplate(index, { language: e.target.value })
                        }
                      />
                      <Checkbox
                        label="QR image header"
                        checked={template.qrHeader}
                        onChange={(e) =>
                          changeTemplate(index, { qrHeader: e.target.checked })
                        }
                      />
                      <p>
                        {template.kind === 'INVOICE'
                          ? 'Body order: resident, agency, invoice reference, outstanding amount, document link, payment link.'
                          : template.kind === 'REMINDER'
                            ? 'Body order: resident, agency, outstanding amount, document link, payment link.'
                            : 'Body order: resident, agency, outstanding amount, document link.'}
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSettings({
                            ...settings,
                            templates: settings.templates.filter(
                              (_, i) => i !== index,
                            ),
                          });
                          setConfirmed(false);
                        }}
                      >
                        Remove template {index + 1}
                      </Button>
                    </fieldset>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={settings.templates.length >= 9}
                    onClick={() => {
                      setSettings({
                        ...settings,
                        templates: [
                          ...settings.templates,
                          {
                            kind: 'INVOICE',
                            locale: 'en',
                            name: '',
                            language: 'en',
                            qrHeader: false,
                          },
                        ],
                      });
                      setConfirmed(false);
                    }}
                  >
                    Add approved template
                  </Button>
                  {settings.templates.length ? (
                    <Checkbox
                      label="I confirmed these templates are approved in the provider account"
                      checked={confirmed}
                      required
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                  ) : (
                    <p>No automated WhatsApp templates configured.</p>
                  )}
                </div>
              </Card>
              <Button type="submit" loading={store.busy}>
                Save messaging settings
              </Button>
            </fieldset>
          </form>
        ) : null}
      </section>
    );
  },
);

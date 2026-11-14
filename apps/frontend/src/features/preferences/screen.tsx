'use client';
import { useState, type FormEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  ColorSchemePicker,
  DataState,
  DisplayModePicker,
  Select,
  Theme,
  TypographyControls,
} from '@daybook/ui';
import type { PreferenceValues } from '@daybook/ui/preferences';
import { usePreferences } from './provider';
import type { PreferencesStore } from './store';
const AppearanceForm = observer(function AppearanceForm({
  store,
}: {
  store: PreferencesStore;
}) {
  const [draft, setDraft] = useState<PreferenceValues>(() => ({
    ...store.values,
    layout: store.effectiveLayout,
    typography: { ...store.values.typography },
  }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await store.save({ ...draft, locale: store.values.locale }))
      setDraft({ ...store.values, typography: { ...store.values.typography } });
  }
  return (
    <form className="db-stack" onSubmit={(event) => void save(event)}>
      <fieldset
        className="db-stack"
        disabled={store.locked}
        style={{ border: 0, padding: 0 }}
      >
        <Card title="Display mode">
          <DisplayModePicker
            value={draft.mode}
            onChange={(mode) => setDraft({ ...draft, mode })}
          />
        </Card>
        <Card title="Color scheme">
          <ColorSchemePicker
            value={draft.scheme}
            onChange={(scheme) => setDraft({ ...draft, scheme })}
          />
        </Card>
        <Card title="Typography">
          <TypographyControls
            value={draft.typography}
            onChange={(typography) => setDraft({ ...draft, typography })}
          />
        </Card>
        <Card title="Operational layout">
          <Select
            label="Operational layout"
            value={draft.layout}
            options={[
              { value: 'TABLE', label: 'Table / compact grid' },
              { value: 'CARDS', label: 'Detailed cards' },
              { value: 'ROUTE', label: 'Route sequence' },
            ]}
            onChange={(event) =>
              setDraft({
                ...draft,
                layout: event.target.value as PreferenceValues['layout'],
              })
            }
          />
          <p>
            The layout is retained for this agent and device. Route sequence
            uses recorded delivery order.
          </p>
        </Card>
        <Theme
          mode={draft.mode}
          scheme={draft.scheme}
          typography={draft.typography}
          data-db-preference-preview="true"
        >
          <Card title="Workspace preview">
            <p>Review your reading size, spacing and colors before saving.</p>
            <p lang="ml">മലയാളം വായനാ മാതൃക</p>
            <p lang="hi">हिन्दी पठन नमूना</p>
          </Card>
        </Theme>
        <Button type="submit" loading={store.busy}>
          Save appearance preferences
        </Button>
      </fieldset>
    </form>
  );
});
export const AppearanceScreen = observer(function AppearanceScreen() {
  const store = usePreferences();
  return (
    <section className="db-stack">
      <header>
        <p className="db-eyebrow">Workspace settings</p>
        <h1>Appearance</h1>
        <p>
          Choose a readable workspace for this agent. Language is available in
          the console header.
        </p>
      </header>
      {store.state === 'loading' ? (
        <DataState kind="loading" />
      ) : store.state === 'error' ? (
        <DataState kind="error" onRetry={() => void store.load()} />
      ) : (
        <AppearanceForm store={store} />
      )}
    </section>
  );
});

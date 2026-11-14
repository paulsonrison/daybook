'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Notification, Select, Theme } from '@daybook/ui';
import { PreferencesStore } from './store';
const PreferencesContext = createContext<PreferencesStore | null>(null);
export function usePreferences() {
  const store = useContext(PreferencesContext);
  if (!store) throw new Error('Preference context is unavailable.');
  return store;
}
const PreferenceFrame = observer(function PreferenceFrame({
  store,
  children,
}: {
  store: PreferencesStore;
  children: ReactNode;
}) {
  return (
    <PreferencesContext.Provider value={store}>
      <Theme
        data-db-agent-preferences={store.scope.agentId}
        mode={store.values.mode}
        scheme={store.values.scheme}
        typography={store.values.typography}
      >
        {children}
      </Theme>
    </PreferencesContext.Provider>
  );
});
export function PreferencesProvider({
  scope,
  children,
}: {
  scope: { agencyId: string; agentId: string };
  children: ReactNode;
}) {
  const [store] = useState(
    () =>
      new PreferencesStore(scope, {
        session: {
          getItem: (key) => window.sessionStorage.getItem(key),
          setItem: (key, value) => window.sessionStorage.setItem(key, value),
          removeItem: (key) => window.sessionStorage.removeItem(key),
        },
        device: {
          getItem: (key) => window.localStorage.getItem(key),
          setItem: (key, value) => window.localStorage.setItem(key, value),
          removeItem: (key) => window.localStorage.removeItem(key),
        },
      }),
  );
  useEffect(() => {
    store.resume();
    void store.load();
    return store.dispose;
  }, [store]);
  return <PreferenceFrame store={store}>{children}</PreferenceFrame>;
}
export const WorkspaceLanguage = observer(function WorkspaceLanguage() {
  const store = usePreferences();
  return (
    <Select
      label="Interface language"
      value={store.values.locale}
      disabled={store.locked}
      options={[
        { value: 'en', label: 'English' },
        { value: 'ml', label: 'മലയാളം' },
        { value: 'hi', label: 'हिन्दी' },
      ]}
      onChange={(event) =>
        void store.save(
          { ...store.values, locale: event.target.value as 'en' | 'ml' | 'hi' },
          'language',
        )
      }
    />
  );
});
export const PreferenceNotices = observer(function PreferenceNotices() {
  const store = usePreferences();
  return (
    <>
      {store.pending ? (
        <Notification
          tone="warning"
          title="Preference save unconfirmed"
          description="Check the original save before changing preferences again. Its original choices and request are retained."
          action={
            <Button
              loading={store.busy}
              onClick={() => void store.checkOriginal()}
            >
              Check original preference save
            </Button>
          }
        />
      ) : null}
      {store.recoveryUnavailable ? (
        <Notification
          tone="warning"
          title="Preference recovery storage unavailable"
          description={store.error}
          action={
            <Button onClick={store.retryRecovery}>
              Restore preference recovery
            </Button>
          }
        />
      ) : null}
      {store.error && !store.pending && !store.recoveryUnavailable ? (
        <Notification
          tone="error"
          title="Preferences unavailable"
          description={store.error}
          action={
            <Button onClick={() => void store.load()}>
              Reload saved preferences
            </Button>
          }
        />
      ) : null}
      {store.deviceWarning ? (
        <Notification
          tone="warning"
          title="Device layout not retained"
          description={store.deviceWarning}
        />
      ) : null}
      {store.lastSaved ? (
        <Notification tone="success" title="Preferences saved" />
      ) : null}
    </>
  );
});

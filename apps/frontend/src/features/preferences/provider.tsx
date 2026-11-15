'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type ComponentProps,
} from 'react';
import { observer } from 'mobx-react-lite';
import { AppShell, Button, Notification, Select, Theme } from '@daybook/ui';
import { I18nProvider, useI18n } from '@daybook/ui/i18n';
import { translateRendered } from '@daybook/ui/messages';
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
      <I18nProvider locale={store.values.locale}>
        <Theme
          lang={store.values.locale}
          data-db-agent-preferences={store.scope.agentId}
          mode={store.values.mode}
          scheme={store.values.scheme}
          typography={store.values.typography}
        >
          {children}
        </Theme>
      </I18nProvider>
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
  const { t } = useI18n();
  return (
    <Select
      label={t('Interface language')}
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
  const { t, locale } = useI18n();
  return (
    <>
      {store.pending ? (
        <Notification
          tone="warning"
          title={t('Preference save unconfirmed')}
          description={t(
            'Check the original save before changing preferences again. Its original choices and request are retained.',
          )}
          action={
            <Button
              loading={store.busy}
              onClick={() => void store.checkOriginal()}
            >
              {t('Check original preference save')}
            </Button>
          }
        />
      ) : null}
      {store.recoveryUnavailable ? (
        <Notification
          tone="warning"
          title={t('Preference recovery storage unavailable')}
          description={translateRendered(locale, store.error)}
          action={
            <Button onClick={store.retryRecovery}>
              {t('Restore preference recovery')}
            </Button>
          }
        />
      ) : null}
      {store.error && !store.pending && !store.recoveryUnavailable ? (
        <Notification
          tone="error"
          title={t('Preferences unavailable')}
          description={translateRendered(locale, store.error)}
          action={
            <Button onClick={() => void store.load()}>
              {t('Reload saved preferences')}
            </Button>
          }
        />
      ) : null}
      {store.deviceWarning ? (
        <Notification
          tone="warning"
          title={t('Device layout not retained')}
          description={translateRendered(locale, store.deviceWarning)}
        />
      ) : null}
      {store.lastSaved ? (
        <Notification tone="success" title={t('Preferences saved')} />
      ) : null}
    </>
  );
});
export function WorkspaceShell(props: ComponentProps<typeof AppShell>) {
  const { t } = useI18n();
  return (
    <AppShell
      {...props}
      tagline={props.tagline ?? t('The agency workspace')}
      navigation={props.navigation.map((group) => ({
        ...group,
        label: t(group.label),
        items: group.items.map((item) => ({ ...item, label: t(item.label) })),
      }))}
    />
  );
}
export function WorkspaceSignOut({
  busy,
  onLogout,
}: {
  busy: boolean;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="secondary"
      loading={busy}
      loadingLabel={t('Loading') + '…'}
      onClick={onLogout}
    >
      {t('Sign out')}
    </Button>
  );
}

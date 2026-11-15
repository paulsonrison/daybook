'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Locale, type MessageValues } from './messages.js';
interface MessageContext {
  locale: Locale;
  t: (key: string, values?: MessageValues) => string;
}
const Context = createContext<MessageContext>({
  locale: 'en',
  t: (key, values) => translate('en', key, values),
});
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<MessageContext>(
    () => ({ locale, t: (key, values) => translate(locale, key, values) }),
    [locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  return useContext(Context);
}

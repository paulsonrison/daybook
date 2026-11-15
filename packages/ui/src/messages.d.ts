export type Locale = 'en' | 'ml' | 'hi';
export type MessageValues = Record<string, string | number | bigint>;
export const dictionaries: Readonly<
  Record<Locale, Readonly<Record<string, string>>>
>;
export function hasTranslation(locale: Locale, key: string): boolean;
export function translate(
  locale: Locale,
  key: string,
  values?: MessageValues,
): string;
/** Localize an existing operational message while retaining interpolated data. */
export function translateRendered(locale: Locale, text: string): string;

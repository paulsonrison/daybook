import en from './i18n/en.js';
import ml from './i18n/ml.js';
import hi from './i18n/hi.js';
export const dictionaries = Object.freeze({
  en: Object.freeze(en),
  ml: Object.freeze(ml),
  hi: Object.freeze(hi),
});
const keyOf = (key) => key.replace(/\s+/g, ' ').trim();
export function hasTranslation(locale, key) {
  return (
    Object.hasOwn(dictionaries, locale) &&
    Object.hasOwn(dictionaries[locale], keyOf(key))
  );
}
/** Fallback is explicit through hasTranslation; coverage must be verified separately. */
export function translate(locale, key, values = {}) {
  const selected = Object.hasOwn(dictionaries, locale) ? locale : 'en',
    id = keyOf(key);
  const template = hasTranslation(selected, id)
    ? dictionaries[selected][id]
    : id;
  const text = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) => {
    if (!Object.hasOwn(values, name))
      throw new Error(`Missing message parameter: ${name}`);
    return String(values[name]);
  });
  return (key.match(/^\s*/)?.[0] ?? '') + text + (key.match(/\s*$/)?.[0] ?? '');
}
const parameterPattern = /\{([A-Za-z0-9_]+)\}/g;
const escapePattern = (text) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
const templates = Object.keys(en)
  .filter((key) => /\{[A-Za-z0-9_]+\}/.test(key))
  .map((key) => {
    let source = '^',
      offset = 0;
    const names = [];
    for (const match of key.matchAll(parameterPattern)) {
      source += escapePattern(key.slice(offset, match.index)) + '([\\s\\S]*?)';
      names.push(match[1]);
      offset = match.index + match[0].length;
    }
    source += escapePattern(key.slice(offset)) + '$';
    return {
      key,
      names,
      pattern: new RegExp(source, 'u'),
      specificity: key.replace(/\{[A-Za-z0-9_]+\}/g, '').length,
    };
  })
  .sort((a, b) => b.specificity - a.specificity);
/** For controlled operational messages, not for user names or free text alone. */
export function translateRendered(locale, text) {
  if (locale === 'en' || !text || text.length > 8192) return text;
  const id = keyOf(text);
  if (hasTranslation('en', id) && !/\{[A-Za-z0-9_]+\}/.test(id))
    return translate(locale, id);
  for (const template of templates) {
    const match = template.pattern.exec(text.trim());
    if (!match) continue;
    const values = Object.fromEntries(
      template.names.map((name, index) => [name, match[index + 1]]),
    );
    return translate(locale, template.key, values);
  }
  return text;
}

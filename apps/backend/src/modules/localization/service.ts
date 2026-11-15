import { GraphQLError } from 'graphql';
import { isAsyncIterable, mapAsyncIterator, type Plugin } from 'graphql-yoga';
import {
  translate,
  translateRendered,
  type Locale,
} from '@daybook/ui/messages';
import type { ValidationMessage } from '../context.js';
type Result = Parameters<NonNullable<Plugin['onResultProcess']>>[0]['result'];
type Item = Exclude<Result, unknown[] | AsyncIterable<unknown>>;
export function requestLocale(request: Request): Locale {
  const header = request.headers.get('accept-language') ?? '';
  if (header.length > 128) return 'en';
  const primary = header.split(/[,;-]/)[0].trim().toLowerCase();
  return primary === 'ml' || primary === 'hi' ? primary : 'en';
}
export function localizationPlugin(locales: WeakMap<Request, Locale>): Plugin {
  return {
    onResultProcess({ request, result, setResult }) {
      const locale = locales.get(request) ?? requestLocale(request);
      const rewrite = (item: Item): Item =>
        item.errors?.length
          ? {
              ...item,
              errors: item.errors.map((error) => {
                const { daybookMessage, ...extensions } = error.extensions;
                const descriptor = daybookMessage as
                  ValidationMessage | undefined;
                let message = translateRendered(locale, error.message);
                if (
                  descriptor &&
                  typeof descriptor.key === 'string' &&
                  descriptor.values &&
                  Array.isArray(descriptor.labelParams)
                ) {
                  const values = { ...descriptor.values };
                  for (const key of descriptor.labelParams)
                    if (typeof values[key] === 'string')
                      values[key] = translateRendered(locale, values[key]);
                  message = translate(locale, descriptor.key, values);
                }
                const localized = new GraphQLError(message, {
                  nodes: error.nodes,
                  source: error.source,
                  positions: error.positions,
                  path: error.path,
                  extensions,
                  originalError: error.originalError,
                });
                if (error.locations)
                  Object.defineProperty(localized, 'locations', {
                    value: error.locations,
                    enumerable: true,
                  });
                return localized;
              }),
            }
          : item;
      if (isAsyncIterable(result)) setResult(mapAsyncIterator(result, rewrite));
      else if (Array.isArray(result)) setResult(result.map(rewrite));
      else setResult(rewrite(result));
    },
  };
}

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInventory } from './i18n-inventory.mjs';
import { dictionaries } from '../packages/ui/src/messages.js';
// These are endonyms, product/font names, international acronyms and date formats.
// They still require explicit entries in every catalogue; absence is never exempt.
export const localeNeutralKeys = new Set([
  'English',
  'Daybook',
  'WhatsApp',
  'Inter',
  'Manrope',
  'Nunito',
  'Lora',
  'Noto Sans Malayalam',
  'Noto Sans Devanagari',
  'Nord',
  'Catppuccin',
  'Tako',
  'Yotsuba',
  'Tokyo Night',
  'UPI',
  'SMS',
  'PDF',
  'Excel',
  'XLSX',
  'GST',
  'INR',
  'YYYY-MM-DD',
  'YYYY-MM',
]);
const parameters = (text) =>
  [
    ...new Set(
      [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]),
    ),
  ]
    .sort()
    .join(',');
export function inspectCoverage(inventory, catalogues) {
  const issues = [];
  for (const item of inventory) {
    const key = item.message;
    for (const locale of ['en', 'ml', 'hi']) {
      const table = catalogues[locale] ?? {};
      if (!Object.hasOwn(table, key)) {
        issues.push({
          locale,
          message: key,
          kind: 'missing',
          locations: item.locations,
        });
        continue;
      }
      const value = table[key];
      if (typeof value !== 'string' || !value.trim()) {
        issues.push({
          locale,
          message: key,
          kind: 'empty',
          locations: item.locations,
        });
        continue;
      }
      if (
        locale !== 'en' &&
        value === catalogues.en?.[key] &&
        !localeNeutralKeys.has(key)
      )
        issues.push({
          locale,
          message: key,
          kind: 'unchanged',
          locations: item.locations,
        });
      if (parameters(value) !== parameters(key))
        issues.push({
          locale,
          message: key,
          kind: 'parameters',
          locations: item.locations,
        });
    }
  }
  return {
    complete: issues.length === 0,
    totalMessages: inventory.length,
    issues,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = inspectCoverage(await collectInventory(), dictionaries);
  await writeFile(
    new URL('../.cache/p11-translation-coverage.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  const missing = Object.fromEntries(
    ['en', 'ml', 'hi'].map((locale) => [
      locale,
      report.issues.filter((issue) => issue.locale === locale).length,
    ]),
  );
  process.stdout.write(
    JSON.stringify({
      complete: report.complete,
      totalMessages: report.totalMessages,
      issues: missing,
    }) + '\n',
  );
  if (process.argv.includes('--check') && !report.complete)
    process.exitCode = 1;
}

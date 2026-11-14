import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import {
  renderFinancialDocument,
  type FinancialDocumentModel,
} from '@daybook/ui/documents';
let active = 0;
let assets: Promise<string> | undefined;
async function documentCss() {
  if (!assets)
    assets = (async () => {
      const css = await readFile(
        new URL(import.meta.resolve('@daybook/ui/styles.css')),
        'utf8',
      );
      const faces = [
        [
          'Inter Variable',
          '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
        ],
        [
          'Noto Sans Malayalam Variable',
          '@fontsource-variable/noto-sans-malayalam/files/noto-sans-malayalam-malayalam-wght-normal.woff2',
        ],
        [
          'Noto Sans Devanagari Variable',
          '@fontsource-variable/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-wght-normal.woff2',
        ],
      ];
      let fonts = '';
      for (const [family, file] of faces) {
        const data = await readFile(new URL(import.meta.resolve(file)));
        fonts += `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');}`;
      }
      return `${fonts}\n${css}\nbody{margin:0;background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact} .db-document{border:0;padding:0;box-shadow:none} @page{size:A4;margin:12mm}`;
    })().catch((e) => {
      assets = undefined;
      throw e;
    });
  return assets;
}
/** Reserving before a database claim keeps capacity pressure from consuming document retries. */
export function reserveDocumentRenderer() {
  if (active >= 2) return null;
  active++;
  let released = false;
  return {
    release() {
      if (!released) {
        released = true;
        active--;
      }
    },
    async render(model: FinancialDocumentModel) {
      const css = await documentCss();
      const browser = await chromium.launch({
        channel: process.env.PDF_BROWSER_CHANNEL ?? 'chrome',
        ...(process.env.PDF_BROWSER_PATH
          ? { executablePath: process.env.PDF_BROWSER_PATH }
          : {}),
        headless: true,
        chromiumSandbox: true,
        timeout: 10000,
      });
      const deadline = setTimeout(() => {
        void browser.close().catch(() => {});
      }, 20000);
      try {
        const context = await browser.newContext({
          javaScriptEnabled: false,
          serviceWorkers: 'block',
          acceptDownloads: false,
        });
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.setContent(
          `<!doctype html><html lang="${model.locale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>Daybook document</title><style>${css}</style></head><body class="db-theme">${renderFinancialDocument(model)}</body></html>`,
          { waitUntil: 'load', timeout: 10000 },
        );
        await page.evaluate('document.fonts.ready');
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        });
        if (pdf.length > 10485760 || pdf.subarray(0, 5).toString() !== '%PDF-')
          throw new Error('Invalid generated document');
        return pdf;
      } finally {
        clearTimeout(deadline);
        await browser.close();
      }
    },
  };
}

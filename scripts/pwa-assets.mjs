import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const directory = 'apps/frontend/public/pwa';
await mkdir(directory, { recursive: true });
for (const [source, target] of [
  ['packages/ui/src/styles.css', 'shared.css'],
  ['packages/ui/src/assets/icons/brand.svg', 'brand.svg'],
  [
    'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    'inter.woff2',
  ],
])
  await copyFile(source, `${directory}/${target}`);
const hash = createHash('sha256');
for (const name of [
  'field.html',
  'pwa/field.js',
  'pwa/database.js',
  'pwa/field.css',
  'pwa/shared.css',
  'pwa/inter.woff2',
  'pwa/brand.svg',
  'pwa/icon-192.png',
  'pwa/icon-512.png',
])
  hash.update(await readFile(`apps/frontend/public/${name}`));
const path = 'apps/frontend/public/sw.js';
await writeFile(
  path,
  (await readFile(path, 'utf8')).replace(
    /const VERSION = '[^']+';/,
    `const VERSION = 'daybook-shell-${hash.digest('hex').slice(0, 16)}';`,
  ),
);

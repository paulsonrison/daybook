import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../apps/backend/', import.meta.url));
const files = (await readdir(`${root}/src`, { recursive: true }))
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => `${root}/src/${name}`);
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  { cwd: root, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;

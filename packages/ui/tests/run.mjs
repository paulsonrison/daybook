import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(import.meta.resolve('tsx/cli'));
const result = spawnSync(
  process.execPath,
  [runner, '--tsconfig', 'tests/tsconfig.json', '--test', 'tests/ui.test.tsx'],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);

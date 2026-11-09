import { build } from 'vite';
import { spawnSync } from 'node:child_process';
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [
    {
      name: 'test-client-directives',
      transform(code, id) {
        if (id.includes('/src/') && /\.[jt]sx?$/.test(id))
          return {
            code: code.replace(/^['"]use client['"];\s*/, ''),
            map: null,
          };
      },
    },
  ],
  build: {
    ssr: 'tests/ui.test.tsx',
    outDir: '.cache/tests',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'ui.test.mjs' } },
  },
});
const result = spawnSync(
  process.execPath,
  ['--test', '.cache/tests/ui.test.mjs'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);

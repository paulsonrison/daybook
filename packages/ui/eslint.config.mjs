import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default [
  { ignores: ['storybook-static/**', '.cache/**'] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
];

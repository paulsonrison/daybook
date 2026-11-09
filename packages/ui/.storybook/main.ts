import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  viteFinal(config) {
    config.plugins ??= [];
    // Storybook is entirely client rendered; preserve these directives in package source for Next.js.
    config.plugins.push({
      name: 'storybook-client-directives',
      enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\', '/').includes('/packages/ui/src/'))
          return {
            code: code.replace(/^['"]use client['"];\s*/, ''),
            map: null,
          };
      },
    });
    return config;
  },
};
export default config;

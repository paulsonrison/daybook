import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import { Theme } from '../src/theme';
import '../src/fonts.css';
import '../src/styles.css';
const preview: Preview = {
  decorators: [(Story) => createElement(Theme, null, createElement(Story))],
  parameters: { controls: { expanded: true }, a11y: { test: 'error' } },
};
export default preview;

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/application',
  timeout: 60000,
  use: { baseURL: process.env.TEST_APP_URL, channel: 'chrome', headless: true },
  outputDir: '.cache/application-results',
});

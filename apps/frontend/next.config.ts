import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@daybook/ui'],
  distDir: process.env.DAYBOOK_BUILD_DIR || '.next',
};
export default config;

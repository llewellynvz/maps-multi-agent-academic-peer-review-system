import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['server', '@mara/shared'],
  serverExternalPackages: ['better-sqlite3'],
};

export default config;

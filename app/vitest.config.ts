import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  resolve: {
    alias: { '@': resolve(here, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

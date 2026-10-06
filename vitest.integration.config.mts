import { defineConfig } from 'vitest/config';
import base from './vitest.config.mjs';

// Integration tests run against a real Supabase stack (`pnpm db:start`), not mocks.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/support/load-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

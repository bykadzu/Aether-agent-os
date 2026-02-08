import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(__dirname);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'kernel/src/__tests__/**/*.test.ts',
      'runtime/src/__tests__/**/*.test.ts',
      'shared/src/__tests__/**/*.test.ts',
      'server/src/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.{ts,tsx}',
      'sdk/__tests__/**/*.test.ts',
    ],
    environmentMatchGlobs: [['components/**/__tests__/**', 'jsdom']],
    coverage: {
      provider: 'v8',
      include: ['kernel/src/**', 'runtime/src/**', 'shared/src/**', 'server/src/**'],
      exclude: ['**/node_modules/**', '**/__tests__/**', '**/index.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@aether/shared': path.join(root, 'shared/src/index.ts'),
      '@aether/kernel': path.join(root, 'kernel/src/index.ts'),
      '@aether/runtime': path.join(root, 'runtime/src/index.ts'),
    },
  },
});

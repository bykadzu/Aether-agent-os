import { defineConfig } from 'vitest/config';

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
      '@aether/shared': '/home/user/Aether-agent-os/shared/src/index.ts',
      '@aether/kernel': '/home/user/Aether-agent-os/kernel/src/index.ts',
      '@aether/runtime': '/home/user/Aether-agent-os/runtime/src/index.ts',
    },
  },
});

import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(__dirname);

const sharedResolve = {
  alias: {
    '@aether/shared': path.join(root, 'shared/src/index.ts'),
    '@aether/kernel': path.join(root, 'kernel/src/index.ts'),
    '@aether/runtime': path.join(root, 'runtime/src/index.ts'),
    '@aether/sdk': path.join(root, 'sdk/src/index.ts'),
  },
};

export default defineConfig({
  test: {
    globals: true,
    // Projects allow scoped test runs: npm run test:kernel, test:runtime, etc.
    // Not all 1300+ tests need to run every time — use scoped commands for fast feedback.
    projects: [
      {
        extends: true,
        test: {
          name: 'kernel',
          environment: 'node',
          include: ['kernel/src/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'runtime',
          environment: 'node',
          include: ['runtime/src/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'shared',
          environment: 'node',
          include: ['shared/src/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/src/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['components/**/__tests__/**/*.test.{ts,tsx}'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'sdk',
          environment: 'node',
          include: ['sdk/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'cli',
          environment: 'node',
          include: ['cli/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'embed',
          environment: 'node',
          include: ['embed/__tests__/**/*.test.ts'],
        },
        resolve: sharedResolve,
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['kernel/src/**', 'runtime/src/**', 'shared/src/**', 'server/src/**'],
      exclude: ['**/node_modules/**', '**/__tests__/**', '**/index.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: sharedResolve,
});

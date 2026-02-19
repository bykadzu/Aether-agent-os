import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Relax rules that produce too much noise in this codebase
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // These React rules produce false positives in legitimate patterns
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'no-case-declarations': 'warn',
      'no-useless-assignment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      'preserve-caught-error': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'kernel/node_modules/',
      'runtime/node_modules/',
      'server/node_modules/',
      'shared/node_modules/',
      '**/*.test.ts',
      '**/*.test.tsx',
      'coverage/',
      'vendor/',
      'public/',
    ],
  },
);

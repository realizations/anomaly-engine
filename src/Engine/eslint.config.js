import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * ESLint flat config.
 *
 * Kept deliberately small and not type-aware: `tsc --noEmit` already catches
 * type errors, so duplicating them through the type checker here would only slow
 * the lint job down. This config catches what the compiler does not: unused
 * values, accidental `any`, and sloppy comparisons.
 *
 * Core rules are listed explicitly rather than pulled from `@eslint/js`, so the
 * lint job depends only on packages we actually declare.
 */
export default [
  {
    ignores: ['dist/**', 'renderer/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        ImageData: 'readonly',
        Uint8ClampedArray: 'readonly',
        process: 'readonly',
        navigator: 'readonly',
        screen: 'readonly',
        devicePixelRatio: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript already reports unused locals via noUnusedLocals in tsconfig.
      'no-unused-vars': 'off',
      'no-undef': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off',
      // Core correctness rules, stated explicitly so we do not depend on
      // @eslint/js being resolvable from a fresh install.
      'no-async-promise-executor': 'error',
      'no-duplicate-case': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
];

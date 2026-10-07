import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'coverage/**',
      'android/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      '.dev/**',
      'scripts/textures/preview/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // The game core must stay pure: no DOM, no Pixi, no platform.
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'pixi.js',
            '@capacitor/*',
            '@capacitor-community/*',
            '@capgo/*',
            '../ui/*',
            '../render/*',
            '../platform/*',
            '../audio/*',
            '../game/*',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'performance'],
    },
  },
  {
    files: ['src/sim/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);

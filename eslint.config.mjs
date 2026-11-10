import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '.work/**', '.context/**', 'projects/**', 'output/**'] },
  {
    files: ['**/*.{js,mjs}', 'bin/programmatic-video', 'bin/pixel-video'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Shared render modules and tests contain browser callbacks executed by Playwright.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
];

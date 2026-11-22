import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const blankLines = [
  'error',
  { blankLine: 'always', prev: '*', next: ['function', 'class', 'multiline-block-like', 'multiline-expression'] },
  { blankLine: 'always', prev: ['function', 'class', 'multiline-block-like', 'multiline-expression'], next: '*' },
];

export default tseslint.config(
  { ignores: ['web/dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'simple-import-sort': simpleImportSort, '@stylistic': stylistic },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // The web remote: React, browser, and the size limits of the project conventions.
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      '@stylistic/padding-line-between-statements': blankLines,
    },
  },
  { files: ['web/public/**/*.js'], languageOptions: { globals: globals.serviceworker } },
  // The server keeps its existing shape; the integration tests drive it with loose data.
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'tools/**/*.ts', 'test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  { files: ['test/**/*.ts', 'tools/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  prettier,
);

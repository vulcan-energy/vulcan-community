// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ESLint for this repository's TypeScript source.
//
// The config is rooted here deliberately so a standalone checkout always has lint coverage.
// Import-boundary policy is enforced separately from ESLint because it checks dependency
// direction and package resolution rather than a fixed list of path spellings.
//
// eslint-plugin-react-hooks is pinned to an exact 7.1.1 rather than a range. 5.2.0 drops the
// compiler-backed recommended rules, which turns the 272 recorded errors into zero — so a
// floating version would silently change what this gate measures rather than what the code
// does. Pin it, and change it deliberately or not at all.
//
// react-refresh is loaded even though its only rule is a Vite HMR ergonomics check, because
// 11 files still carry `eslint-disable react-refresh/only-export-components` comments from
// earlier revisions. Without the plugin ESLint raises "Definition for rule ... was not found"
// rather than checking the code those comments annotate.
//
// The raw lint command exits non-zero while known debt remains. scripts/quality-gate.mjs
// compares these results with quality-baseline.json and fails only when a metric worsens.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // .vite-cache holds Vite's dependency pre-bundles: third-party code whose inline eslint
  // directives report against unloaded plugins. It is gitignored, so linting it makes the
  // quality gate's result depend on whether the dev server has run on that machine.
  { ignores: ['**/dist', '**/coverage', '**/node_modules', '**/.vite-cache', 'crates', 'data', 'third_party'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'no-case-declarations': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)

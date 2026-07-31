// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Runs this repository's tests from the repository root. Keeping the harness here makes
// every test beside the source it covers runnable from a standalone checkout.
//
// No resolve.alias. The tests import their subjects by relative path, exactly as the
// modules beside them do, so the harness does not need a package-to-disk alias table.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      `{apps,packages}/*/src/**/${configDefaults.include[0]}`,
    ],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

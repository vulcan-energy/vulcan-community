// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: '.vite-cache',
  define: {
    __VULCAN_COMMUNITY_REVISION__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
  },
  build: {
    ssr: 'src/cli.ts',
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The editor modules the CLI reaches import these packages, but none of the code
      // the CLI uses calls them. Keep them external and drop the bare imports so the
      // published CLI needs no runtime dependencies; a real use would keep its import.
      external: ['three', 'polygon-clipping', 'lucide', /^node:/],
      treeshake: { moduleSideEffects: 'no-external' },
      output: {
        format: 'es',
        entryFileNames: 'cli.js',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});

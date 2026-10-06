// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vite';

// The model WASM glue is loaded at run time, not bundled: CI builds the CLI without the
// WASM, and the 11 MB binary is read from disk. The wasm-pack output is copied next to
// cli.js (when built) and the source import is pointed there.
const MODEL_WASM_GLUE = /\/generated\/model-wasm\/vulcan_model_wasm\.js$/;

export default defineConfig({
  cacheDir: '.vite-cache',
  publicDir: '../geometry-editor/src/generated/model-wasm',
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
      external: ['three', 'polygon-clipping', 'lucide', /^node:/, MODEL_WASM_GLUE],
      treeshake: { moduleSideEffects: 'no-external' },
      output: {
        format: 'es',
        entryFileNames: 'cli.js',
        banner: '#!/usr/bin/env node',
        paths: (id) => (MODEL_WASM_GLUE.test(id) ? './vulcan_model_wasm.js' : id),
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});

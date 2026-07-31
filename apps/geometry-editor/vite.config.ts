// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vite';
import {
  developmentSecurityHeaders,
  productionSecurityHeaders,
  renderStaticHeaders,
} from './securityHeaders';

export default defineConfig({
  cacheDir: '.vite-cache',
  plugins: [{
    name: 'community-deployment-headers',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderStaticHeaders(productionSecurityHeaders),
      });
    },
  }],
  server: {
    port: 5176,
    strictPort: true,
    headers: developmentSecurityHeaders,
  },
  preview: {
    port: 4176,
    strictPort: true,
    headers: productionSecurityHeaders,
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
  },
});

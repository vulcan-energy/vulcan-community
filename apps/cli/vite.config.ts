// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Upstream MIT data the CLI embeds, with the notice its licence-manifest entry requires preserved. */
const UPSTREAM_DATA_NOTICES: Record<string, { name: string; licence: string }> = {
  'data/schemas/core-input.schema.json': { name: 'Home Energy Model (HEM) input schema', licence: 'hem_engine_upstream/LICENSE.md' },
  'data/schemas/input_fhs.schema.json': { name: 'HEM Future Homes Standard wrapper input schema', licence: 'LICENSES/MIT-HEM-FHS-wrapper.txt' },
};
const REPO_ROOT = resolve(__dirname, '../..');

/** The licence-manifest entry covering a repo path (exact path, else the longest matching `dir/**`). */
function manifestLicence(path: string, entries: { path: string; license: string }[]): string | undefined {
  const exact = entries.find((entry) => entry.path === path);
  if (exact) return exact.license;
  return entries
    .filter((entry) => entry.path.endsWith('/**') && path.startsWith(entry.path.slice(0, -2)))
    .sort((a, b) => b.path.length - a.path.length)[0]?.license;
}

/**
 * THIRD_PARTY_NOTICES.md for what Rollup actually bundled into cli.js (npm packages and
 * upstream MIT data files), with each licence text, so the notices cannot drift.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle(_options, bundle) {
      const { entries } = JSON.parse(readFileSync(join(REPO_ROOT, 'licence-manifest.json'), 'utf8')) as { entries: { path: string; license: string }[] };
      const packages = new Map<string, string>();
      const upstream = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          if (id.startsWith('\0')) continue; // Rollup/plugin virtual helpers, not repo files
          const match = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(id.replace(/\\/g, '/'));
          if (match) {
            packages.set(match[2]!, match[1]!);
            continue;
          }
          const relative = id.replace(/\?.*$/, '').replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
          if (UPSTREAM_DATA_NOTICES[relative]) {
            upstream.add(relative);
            continue;
          }
          // Fail closed: any other bundled repo file must be ours (AGPL) or it needs a notice here.
          const licence = manifestLicence(relative, entries);
          if (licence !== 'AGPL-3.0-only') {
            throw new Error(`cli.js bundles ${relative} (${licence ?? 'not in licence-manifest.json'}); add its notice to UPSTREAM_DATA_NOTICES or keep it out of the CLI`);
          }
        }
      }
      const sections = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, root]) => {
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string; license?: string };
        const licenceFile = readdirSync(root).find((file) => /^licen[cs]e(\.(md|txt))?$/i.test(file));
        if (!licenceFile) throw new Error(`Bundled package ${name} has no licence file to reproduce`);
        return `## ${name} ${manifest.version ?? ''} (${manifest.license ?? 'see licence'})\n\n${readFileSync(join(root, licenceFile), 'utf8').trim()}\n`;
      });
      const upstreamSections = [...upstream].sort().map((file) => {
        const { name, licence } = UPSTREAM_DATA_NOTICES[file]!;
        return `## ${name} (${file}, MIT)\n\n${readFileSync(join(REPO_ROOT, licence), 'utf8').trim()}\n`;
      });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.md',
        source: `# Third-party notices\n\ncli.js bundles the following third-party material. polygon-clipping is a runtime dependency and carries its own licence.\n\n${[...upstreamSections, ...sections].join('\n')}`,
      });
    },
  };
}

// The model WASM glue is loaded at run time, not bundled: CI builds the CLI without the
// WASM, and the 11 MB binary is read from disk. The wasm-pack output is copied next to
// cli.js (when built) and the source import is pointed there.
const MODEL_WASM_GLUE = /\/generated\/model-wasm\/vulcan_model_wasm\.js$/;

export default defineConfig({
  plugins: [thirdPartyNotices()],
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

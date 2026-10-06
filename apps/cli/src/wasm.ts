// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Loads the Community model WASM (scripts/build-model-wasm.sh) under Node. Node has no
// workers, so the rayon thread pool is never initialised: FHS preflight runs on this thread.

import { existsSync, readFileSync } from 'node:fs';

// Built: vite.config.ts copies the wasm-pack output next to dist/cli.js.
// From source (vitest, vite-node): the directory the build script writes.
const WASM_URL = import.meta.url.endsWith('.ts')
  ? new URL('../../geometry-editor/src/generated/model-wasm/vulcan_model_wasm_bg.wasm', import.meta.url)
  : new URL('./vulcan_model_wasm_bg.wasm', import.meta.url);

export function modelWasmAvailable(): boolean {
  return existsSync(WASM_URL);
}

export async function loadModelWasm() {
  if (!modelWasmAvailable()) {
    throw new Error(
      `Community model WASM not found at ${WASM_URL.pathname}. Run scripts/build-model-wasm.sh, then rebuild the CLI.`,
    );
  }
  // The glue's rayon worker helper listens on `self` when it loads; Node has none.
  (globalThis as { self?: unknown }).self ??= new EventTarget();
  // vite.config.ts rewrites this import to ./vulcan_model_wasm.js in the bundle.
  const wasm = await import('../../geometry-editor/src/generated/model-wasm/vulcan_model_wasm.js');
  wasm.initSync({ module: readFileSync(WASM_URL) });
  return wasm;
}

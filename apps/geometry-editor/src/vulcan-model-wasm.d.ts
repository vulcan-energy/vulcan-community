// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

declare module '*vulcan_model_wasm.js' {
  export default function init(moduleOrPath?: unknown): Promise<unknown>;

  export function convert_geometry_csv_request(requestJson: string): string;
  export function fhs_wrapper_version(): string;
  export function hem_core_version(): string;
  export function initialize_rayon_thread_pool(numThreads: number): Promise<unknown>;
  export function validate_fhs_preflight(modelJson: string): string;
}

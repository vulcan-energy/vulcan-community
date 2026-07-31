// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import initModelWasm, {
  convert_geometry_csv_request,
  fhs_wrapper_version,
  hem_core_version,
  initialize_rayon_thread_pool,
  validate_fhs_preflight,
} from './generated/model-wasm/vulcan_model_wasm.js';

import type {
  CommunityModelBuildInput,
  CommunityModelBuildResult,
  CommunityModelPreflight,
  CommunityModelValidation,
} from './communityModelBuildDocumentHost';

type WorkerRequest = Readonly<{
  id: number;
  input: CommunityModelBuildInput;
}>;

type WasmConversionResponse =
  | Readonly<{
      ok: true;
      json: unknown;
      validation: CommunityModelValidation;
    }>
  | Readonly<{
      ok: false;
      error: string;
      validation?: CommunityModelValidation | null;
    }>;

const workerScope = globalThis as unknown as Readonly<{
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
  postMessage(value: unknown): void;
}>;

let runtimePromise: Promise<void> | null = null;
let threadPoolPromise: Promise<void> | null = null;

const FHS_CROSS_ORIGIN_ISOLATION_ERROR =
  'FHS preflight is unavailable because this deployment is missing the cross-origin isolation headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp. See docs/DEPLOYMENT.md.';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error) || 'Community model build failed';
}

async function ensureRuntime(profile: CommunityModelBuildInput['profile']): Promise<void> {
  if (profile === 'fhs' && globalThis.crossOriginIsolated !== true) {
    throw new Error(FHS_CROSS_ORIGIN_ISOLATION_ERROR);
  }
  if (!runtimePromise) {
    runtimePromise = initModelWasm().then(() => undefined);
  }
  await runtimePromise;
  if (profile !== 'fhs') return;
  if (!threadPoolPromise) {
    const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 2;
    const threadCount = Math.max(1, hardwareConcurrency - 1);
    threadPoolPromise = initialize_rayon_thread_pool(threadCount).then(() => undefined);
  }
  await threadPoolPromise;
}

function parseResponse<T>(json: string, label: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${messageFromUnknown(error)}`);
  }
}

async function build(input: CommunityModelBuildInput): Promise<CommunityModelBuildResult> {
  await ensureRuntime(input.profile);
  const request = JSON.stringify({
    csv: input.csv,
    schema_json: input.schemaJson,
    defaults_json: input.defaultsJson,
    profile: input.profile,
    version_metadata: {
      hem_core_version: hem_core_version(),
      ...(input.profile === 'fhs'
        ? { fhs_wrapper_version: fhs_wrapper_version() }
        : {}),
    },
  });
  const converted = parseResponse<WasmConversionResponse>(
    convert_geometry_csv_request(request),
    'Community model converter',
  );
  if (!converted.ok) return converted;
  const preflight = input.profile === 'fhs'
    ? parseResponse<CommunityModelPreflight>(
        validate_fhs_preflight(JSON.stringify(converted.json)),
        'Community FHS preflight',
      )
    : undefined;
  return Object.freeze({
    ok: true,
    model: converted.json,
    validation: converted.validation,
    ...(preflight === undefined ? {} : { preflight }),
  });
}

workerScope.addEventListener('message', (event) => {
  const { id, input } = event.data;
  void build(input).then(
    (result) => workerScope.postMessage({ id, result }),
    (error) => workerScope.postMessage({ id, error: messageFromUnknown(error) }),
  );
});

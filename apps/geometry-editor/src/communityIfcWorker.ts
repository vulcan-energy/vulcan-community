// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IfcImportMode,
  IfcImportProgress,
  IfcImportProgressPhase,
} from '../../../packages/geometry-document/src';
import ifcParserSource from './assets/ifc/ifc_parser.py?raw';

type WorkerRequest = Readonly<{
  type: 'convert';
  id: number;
  bytes: ArrayBuffer;
  mode: IfcImportMode;
  delayeringEnabled: boolean;
  wallThicknessMetres?: number;
}>;

type PythonResult = Readonly<{
  get(index: number): unknown;
  destroy?(): void;
}>;

type PythonRuntime = Readonly<{
  loadPackage(packages: readonly string[]): Promise<unknown>;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<PythonResult>;
  globals: Readonly<{
    set(name: string, value: unknown): void;
    delete(name: string): void;
  }>;
  FS: Readonly<{
    writeFile(path: string, bytes: Uint8Array): void;
    unlink(path: string): void;
  }>;
}>;

type PyodideModule = Readonly<{
  loadPyodide(options: Readonly<{ indexURL: string }>): Promise<PythonRuntime>;
}>;

type WorkerScope = Readonly<{
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown): void;
}>;

const workerScope = globalThis as unknown as WorkerScope;

// Runtime and executable dependencies are fixed by this source file. The UI
// deliberately exposes no URL override because these assets execute locally.
const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/';
const IFC_WHEEL_FILE_NAME = 'ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl';
const IFC_OPEN_SHELL_WHEEL_URL = new URL(
  `${import.meta.env.BASE_URL}ifc/${IFC_WHEEL_FILE_NAME}`,
  self.location.origin,
).href;
const IFC_INPUT_PATH = '/tmp/vulcan-community-input.ifc';

const INSTALL_IFC_OPEN_SHELL = `
import micropip
await micropip.install([__vulcan_ifc_wheel_url])
`;

// User-controlled values are bound through Pyodide globals. They are never
// interpolated into this fixed Python program.
const CONVERT_IFC = `
import inspect

with open('${IFC_INPUT_PATH}', 'r') as source_file:
    ifc_content = source_file.read()

def progress_wrapper(status, current, total):
    __vulcan_ifc_progress(status, current, total)

signature = inspect.signature(convert_ifc_to_csv_browser)
arguments = dict(
    ifc_content=ifc_content,
    progress_callback=progress_wrapper,
    audit_level='standard',
)
if 'delayering_enabled' in signature.parameters:
    arguments['delayering_enabled'] = __vulcan_ifc_delayering
if 'import_mode' in signature.parameters:
    arguments['import_mode'] = __vulcan_ifc_mode
if (
    'wall_thickness_m' in signature.parameters
    and __vulcan_ifc_wall_thickness is not None
):
    arguments['wall_thickness_m'] = __vulcan_ifc_wall_thickness

convert_ifc_to_csv_browser(**arguments)
`;

let runtimePromise: Promise<PythonRuntime> | null = null;

function messageFromUnknown(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Community IFC conversion failed';
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function captureRequest(value: unknown): WorkerRequest {
  if (
    !isRecord(value)
    || value.type !== 'convert'
    || !Number.isSafeInteger(value.id)
    || !(value.bytes instanceof ArrayBuffer)
    || (value.mode !== 'internal'
      && value.mode !== 'external'
      && value.mode !== 'raw')
    || typeof value.delayeringEnabled !== 'boolean'
  ) {
    throw new Error('Community IFC worker request is invalid');
  }
  const wallThicknessMetres = value.wallThicknessMetres;
  if (
    value.mode === 'external'
    && (
      typeof wallThicknessMetres !== 'number'
      || !Number.isFinite(wallThicknessMetres)
      || wallThicknessMetres < 0.01
      || wallThicknessMetres > 10
    )
  ) {
    throw new Error('Community IFC wall thickness is invalid');
  }
  if (value.mode !== 'external' && wallThicknessMetres !== undefined) {
    throw new Error('Community IFC wall thickness is invalid');
  }
  return Object.freeze({
    type: 'convert',
    id: value.id as number,
    bytes: value.bytes,
    mode: value.mode,
    delayeringEnabled: value.delayeringEnabled,
    ...(wallThicknessMetres === undefined
      ? {}
      : { wallThicknessMetres: wallThicknessMetres as number }),
  });
}

async function importPyodideModule(): Promise<PyodideModule> {
  return await import(
    /* @vite-ignore */
    'https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.mjs'
  ) as PyodideModule;
}

async function loadRuntime(
  report: (progress: IfcImportProgress) => void,
): Promise<PythonRuntime> {
  if (runtimePromise !== null) return runtimePromise;
  runtimePromise = (async () => {
    report({ phase: 'runtime' });
    const { loadPyodide } = await importPyodideModule();
    const runtime = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

    report({ phase: 'dependencies' });
    await runtime.loadPackage(['micropip', 'numpy', 'packaging', 'shapely']);
    runtime.globals.set(
      '__vulcan_ifc_wheel_url',
      IFC_OPEN_SHELL_WHEEL_URL,
    );
    try {
      await runtime.runPythonAsync(INSTALL_IFC_OPEN_SHELL);
    } finally {
      runtime.globals.delete('__vulcan_ifc_wheel_url');
    }

    report({ phase: 'parser' });
    runtime.runPython(ifcParserSource);
    return runtime;
  })();
  runtimePromise.catch(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

function phaseFromParserStatus(status: unknown): IfcImportProgressPhase {
  if (typeof status !== 'string') return 'conversion';
  if (/floor|roof|slab/i.test(status)) return 'floors-roofs';
  if (/window/i.test(status)) return 'windows';
  if (/door/i.test(status)) return 'doors';
  if (/space/i.test(status)) return 'spaces';
  if (/wall/i.test(status)) return 'walls';
  if (/assembl/i.test(status)) return 'assembly';
  if (/csv|writ/i.test(status)) return 'csv';
  return 'conversion';
}

function progressFromParser(
  status: unknown,
  current: unknown,
  total: unknown,
): IfcImportProgress {
  const phase = phaseFromParserStatus(status);
  if (
    Number.isSafeInteger(current)
    && Number.isSafeInteger(total)
    && (current as number) >= 0
    && (total as number) >= 0
    && (current as number) <= (total as number)
  ) {
    return Object.freeze({
      phase,
      current: current as number,
      total: total as number,
    });
  }
  return Object.freeze({ phase });
}

async function convert(request: WorkerRequest): Promise<void> {
  const report = (progress: IfcImportProgress): void => {
    workerScope.postMessage({
      type: 'progress',
      id: request.id,
      progress,
    });
  };
  const runtime = await loadRuntime(report);
  runtime.globals.set(
    '__vulcan_ifc_progress',
    (status: unknown, current: unknown, total: unknown) => {
      report(progressFromParser(status, current, total));
    },
  );
  runtime.globals.set('__vulcan_ifc_mode', request.mode);
  runtime.globals.set('__vulcan_ifc_delayering', request.delayeringEnabled);
  runtime.globals.set(
    '__vulcan_ifc_wall_thickness',
    request.wallThicknessMetres ?? null,
  );
  runtime.FS.writeFile(IFC_INPUT_PATH, new Uint8Array(request.bytes));
  let result: PythonResult | null = null;
  try {
    report({ phase: 'conversion' });
    result = await runtime.runPythonAsync(CONVERT_IFC);
    const modelCsv = result.get(0);
    const auditJsonl = result.get(1);
    if (typeof modelCsv !== 'string' || typeof auditJsonl !== 'string') {
      throw new Error('Community IFC parser returned an invalid result');
    }
    workerScope.postMessage({
      type: 'result',
      id: request.id,
      modelCsv,
      auditJsonl,
    });
  } finally {
    result?.destroy?.();
    runtime.FS.unlink(IFC_INPUT_PATH);
    runtime.globals.delete('__vulcan_ifc_progress');
    runtime.globals.delete('__vulcan_ifc_mode');
    runtime.globals.delete('__vulcan_ifc_delayering');
    runtime.globals.delete('__vulcan_ifc_wall_thickness');
  }
}

workerScope.addEventListener('message', (event) => {
  let id = 0;
  try {
    const request = captureRequest(event.data);
    id = request.id;
    void convert(request).catch((error) => {
      workerScope.postMessage({
        type: 'error',
        id: request.id,
        error: messageFromUnknown(error),
      });
    });
  } catch (error) {
    if (isRecord(event.data) && Number.isSafeInteger(event.data.id)) {
      id = event.data.id as number;
    }
    workerScope.postMessage({
      type: 'error',
      id,
      error: messageFromUnknown(error),
    });
  }
});

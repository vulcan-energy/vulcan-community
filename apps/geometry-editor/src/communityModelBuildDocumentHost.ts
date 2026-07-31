// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createSerializedGeometryDocumentHostPort,
  type GeometryDocumentHostDestructiveRequest,
  type GeometryDocumentHostDriver,
  type GeometryDocumentHostDriverSnapshot,
  type GeometryDocumentHostNewRequest,
  type GeometryDocumentHostOpenRequest,
  type GeometryDocumentHostPort,
  type GeometryDocumentHostPreparedOperation,
  type GeometryDocumentHostResult,
  type GeometryDocumentSession,
  type GeometryDocumentSnapshot,
} from '../../../packages/geometry-document/src';
import type { GeometryWorkspaceResourcePort } from '../../../packages/geometry-editor-host/src';
import type { BuildErrorItem } from '../../../packages/geometry-editor/src/types/buildErrors';

export type CommunityModelProfile = 'core' | 'fhs';

export type CommunityModelValidationError = Readonly<{
  path: string;
  code: string;
  message: string;
  schema_path?: string;
  keyword?: string;
}>;

export type CommunityModelPreflightError = Readonly<{
  path: string;
  code: string;
  category: string;
  message: string;
  user_message?: string;
  technical_message?: string;
}>;

export type CommunityModelValidation = Readonly<{
  is_valid: boolean;
  errors: readonly CommunityModelValidationError[];
}>;

export type CommunityModelPreflight = Readonly<{
  ok: boolean;
  is_valid: boolean;
  errors: readonly CommunityModelPreflightError[];
  raw_engine_error?: string;
}>;

export type CommunityModelBuildInput = Readonly<{
  csv: string;
  schemaJson: string;
  defaultsJson: string;
  profile: CommunityModelProfile;
}>;

export type CommunityModelBuildResult =
  | Readonly<{
      ok: true;
      model: unknown;
      validation: CommunityModelValidation;
      preflight?: CommunityModelPreflight;
    }>
  | Readonly<{
      ok: false;
      error: string;
      validation?: CommunityModelValidation | null;
    }>;

export interface CommunityModelBuilder {
  build(input: CommunityModelBuildInput): Promise<CommunityModelBuildResult>;
  dispose(): void;
}

export type CommunityModelBuildSnapshot = Readonly<{
  status: 'building' | 'ready';
  buildError: string | null;
  buildErrorItems: readonly BuildErrorItem[];
}>;

export type CommunityModelBuildDocumentHostOptions = Readonly<{
  documentHost: GeometryDocumentHostPort;
  flush(): GeometryDocumentSnapshot;
  session: GeometryDocumentSession;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  getDefaultsPath(): string | undefined;
  getProfile(): CommunityModelProfile;
  loadSchemaText(profile: CommunityModelProfile): Promise<string>;
  builder: CommunityModelBuilder;
}>;

export interface CommunityModelBuildDocumentHost {
  readonly documentHost: GeometryDocumentHostPort;
  getSnapshot(): CommunityModelBuildSnapshot;
  subscribe(listener: () => void): () => void;
}

const READY: CommunityModelBuildSnapshot = Object.freeze({
  status: 'ready',
  buildError: null,
  buildErrorItems: Object.freeze([]),
});

const HEM_MODEL_RESOURCE_ID = 'hem-model';

function messageFromUnknown(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error) || 'HEM model build failed';
}

function schemaItems(
  validation: CommunityModelValidation | null | undefined,
): BuildErrorItem[] {
  return (validation?.errors ?? []).map((error) => ({
    source: 'schema',
    message: error.message,
    path: error.path,
    code: error.code,
    schemaPath: error.schema_path,
    keyword: error.keyword,
  }));
}

function preflightItems(
  preflight: CommunityModelPreflight | undefined,
): BuildErrorItem[] {
  return (preflight?.errors ?? []).map((error) => ({
    source: 'fhs_preflight',
    message: error.message,
    path: error.path,
    code: error.code,
    category: error.category,
    userMessage: error.user_message,
    technicalMessage: error.technical_message,
  }));
}

function buildIssueSummary(items: readonly BuildErrorItem[]): string | null {
  if (items.length === 0) return null;
  const first = items[0]?.message ?? 'See build details';
  return `${items.length} build issue${items.length === 1 ? '' : 's'}. ${first} (model CSV was saved)`;
}

function updateGeneratedModel(
  session: GeometryDocumentSession,
  model: unknown | null,
): void {
  const current = session.getSnapshot();
  const retained = current.derivedResources.filter(
    ({ id, role }) => id !== HEM_MODEL_RESOURCE_ID && role !== 'hem-model',
  );
  if (model === null) {
    session.updateDocument({ derivedResources: retained });
    return;
  }
  const json = `${JSON.stringify(model, null, 2)}\n`;
  session.updateDocument({
    derivedResources: [
      ...retained,
      Object.freeze({
        id: HEM_MODEL_RESOURCE_ID,
        slots: Object.freeze(['model.hem-json']),
        role: 'hem-model',
        required: false,
        mediaType: 'application/json',
        bytes: new TextEncoder().encode(json),
      }),
    ],
  });
}

function prepared(
  run: () => Promise<GeometryDocumentHostResult>,
): GeometryDocumentHostPreparedOperation {
  return Object.freeze({ run });
}

function activeDocumentsEqual(
  left: GeometryDocumentHostDriverSnapshot['activeDocument'],
  right: GeometryDocumentHostDriverSnapshot['activeDocument'],
): boolean {
  return left === right || (
    left !== null &&
    right !== null &&
    left.id === right.id &&
    left.fileName === right.fileName &&
    left.storageVersion === right.storageVersion
  );
}

/** Adds local HEM build/preflight to Save while preserving CSV persistence. */
export function createCommunityModelBuildDocumentHost(
  options: CommunityModelBuildDocumentHostOptions,
): CommunityModelBuildDocumentHost {
  const listeners = new Set<() => void>();
  let snapshot = READY;
  let disposed = false;

  const publish = (next: CommunityModelBuildSnapshot) => {
    if (disposed) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const build = async (document: GeometryDocumentSnapshot): Promise<void> => {
    publish(Object.freeze({
      status: 'building',
      buildError: null,
      buildErrorItems: Object.freeze([]),
    }));
    try {
      const defaultsPath = options.getDefaultsPath()?.trim();
      if (!defaultsPath) {
        throw new Error('Select a defaults file before building the HEM model');
      }
      const profile = options.getProfile();
      const [schemaJson, defaultsJson] = await Promise.all([
        options.loadSchemaText(profile),
        options.workspaceResourcePort.readText(defaultsPath),
      ]);
      const result = await options.builder.build({
        csv: document.text,
        schemaJson,
        defaultsJson,
        profile,
      });
      if (disposed) return;
      if (!result.ok) {
        updateGeneratedModel(options.session, null);
        const items = schemaItems(result.validation);
        if (items.length === 0) {
          items.push({ source: 'build', message: result.error });
        }
        publish(Object.freeze({
          status: 'ready',
          buildError: `${result.error} (model CSV was saved)`,
          buildErrorItems: Object.freeze(items),
        }));
        return;
      }

      updateGeneratedModel(options.session, result.model);
      const items = [...schemaItems(result.validation), ...preflightItems(result.preflight)];
      publish(Object.freeze({
        status: 'ready',
        buildError: buildIssueSummary(items),
        buildErrorItems: Object.freeze(items),
      }));
    } catch (error) {
      if (disposed) return;
      updateGeneratedModel(options.session, null);
      const message = messageFromUnknown(error);
      const buildErrorItems: readonly BuildErrorItem[] = Object.freeze([
        { source: 'build', message },
      ]);
      publish(Object.freeze({
        status: 'ready',
        buildError: `${message} (model CSV was saved)`,
        buildErrorItems,
      }));
    }
  };

  const saveDocument = async (
    document: GeometryDocumentSnapshot,
  ): Promise<GeometryDocumentHostResult> => {
    const workspaceAvailable = () =>
      options.workspaceResourcePort.availability === 'available';
    if (!workspaceAvailable()) {
      const initialSave = await options.documentHost.save();
      if (initialSave.status !== 'completed') return initialSave;
      if (!workspaceAvailable()) {
        const message = 'Choose a local workspace folder to build the HEM model';
        publish(Object.freeze({
          status: 'ready',
          buildError: `${message} (model CSV was saved)`,
          buildErrorItems: Object.freeze([
            { source: 'build' as const, message },
          ]),
        }));
        return initialSave;
      }
      await build(document);
      return options.documentHost.save();
    }
    await build(document);
    return options.documentHost.save();
  };

  let sourceHostSnapshot = options.documentHost.getSnapshot();
  let driverSnapshot: GeometryDocumentHostDriverSnapshot = Object.freeze({
    document: sourceHostSnapshot.document,
    activeDocument: sourceHostSnapshot.activeDocument,
  });
  const getDriverSnapshot = (): GeometryDocumentHostDriverSnapshot => {
    const nextSourceHostSnapshot = options.documentHost.getSnapshot();
    if (nextSourceHostSnapshot === sourceHostSnapshot) return driverSnapshot;
    sourceHostSnapshot = nextSourceHostSnapshot;
    if (
      nextSourceHostSnapshot.document === driverSnapshot.document &&
      activeDocumentsEqual(
        nextSourceHostSnapshot.activeDocument,
        driverSnapshot.activeDocument,
      )
    ) {
      return driverSnapshot;
    }
    driverSnapshot = Object.freeze({
      document: nextSourceHostSnapshot.document,
      activeDocument: nextSourceHostSnapshot.activeDocument,
    });
    return driverSnapshot;
  };

  const driver: GeometryDocumentHostDriver = Object.freeze({
    getSnapshot: getDriverSnapshot,
    subscribe: (listener: () => void) => options.documentHost.subscribe(listener),
    updateFileName: (fileName: string) => options.documentHost.updateFileName(fileName),
    isDirty: () => options.documentHost.isDirty(),
    prepareSave: () => {
      const captured = (() => {
        try {
          return Object.freeze({ ok: true as const, document: options.flush() });
        } catch (error) {
          return Object.freeze({ ok: false as const, error });
        }
      })();
      return prepared(async () => {
        if (!captured.ok) throw captured.error;
        return saveDocument(captured.document);
      });
    },
    prepareNew: (request: GeometryDocumentHostNewRequest) => prepared(async () => {
      const result = await options.documentHost.newDocument(request);
      if (result.status === 'completed') publish(READY);
      return result;
    }),
    prepareOpen: (request: GeometryDocumentHostOpenRequest) => prepared(async () => {
      const result = await options.documentHost.open(request);
      if (result.status === 'completed') publish(READY);
      return result;
    }),
    prepareDelete: (request: GeometryDocumentHostDestructiveRequest) => prepared(() =>
      options.documentHost.delete(request)),
    prepareDuplicate: (request: GeometryDocumentHostDestructiveRequest) => prepared(() =>
      options.documentHost.duplicate(request)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      options.builder.dispose();
      options.documentHost.dispose();
    },
  });

  const documentHost = createSerializedGeometryDocumentHostPort({ driver });

  return Object.freeze({
    documentHost,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

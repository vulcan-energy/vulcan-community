// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryDocumentContents } from '../../../packages/geometry-document/src/contracts';
import {
  GeometryWorkspaceProviderError,
} from '../../../packages/geometry-document/src/providerContracts';
import type {
  BrowserDirectoryWorkspaceAccess,
  BrowserDirectoryWorkspaceConnected,
  BrowserDirectoryWorkspaceResourceAccess,
} from '../../../packages/geometry-document/src/browserDirectoryWorkspaceContracts';
import type {
  GeometryWorkspaceResourceEntry,
  GeometryWorkspaceResourceListOptions,
  GeometryWorkspaceResourcePort,
} from '../../../packages/geometry-editor-host/src/workspaceResourcePort';
import {
  geometryDocumentWorkspaceReferencePaths,
  projectDurableGeometryDocumentToEditor,
  type GeometryDocumentVirtualResourceRegistration,
} from './geometryDocumentResourceProjection';
import { createProjectedGeometryWorkspaceProvider } from './projectedGeometryWorkspaceProvider';
import { COMMUNITY_STARTER_RESOURCES } from './communityStarterWorkspace';

const VIRTUAL_ROOT = '__vulcan_document__';

type VirtualFile = Readonly<{
  fileName: string;
  mediaType: string;
  resourceId: string;
  bytes: Uint8Array;
}>;

export type CommunityGeometryWorkspaceResourcesSnapshot = Readonly<{
  version: number;
  availability: GeometryWorkspaceResourcePort['availability'];
  /** Exact resource access supplied by the current directory connection. */
  current: BrowserDirectoryWorkspaceResourceAccess | null;
  virtualResourceCount: number;
}>;

export interface CommunityGeometryWorkspaceResources {
  /** Stable delegate installed into one geometry store for its mounted life. */
  readonly port: GeometryWorkspaceResourcePort;
  /** Editable vanilla resources used before a user-owned directory is connected. */
  readonly fallbackPort: GeometryWorkspaceResourcePort;
  getSnapshot(): CommunityGeometryWorkspaceResourcesSnapshot;
  subscribe(listener: () => void): () => void;
  bind(resourceAccess: BrowserDirectoryWorkspaceResourceAccess): void;
  unbind(): void;
  replaceDocumentResources(
    registrations: readonly GeometryDocumentVirtualResourceRegistration[],
  ): void;
  activateDocument(contents: GeometryDocumentContents): GeometryDocumentContents;
  clearDocumentResources(): void;
}

export type CommunityGeometryWorkspaceAccessOptions = Readonly<{
  access: BrowserDirectoryWorkspaceAccess;
  resources: CommunityGeometryWorkspaceResources;
  initializeConnectedWorkspace?: (
    workspaceResourcePort: GeometryWorkspaceResourcePort,
    fallbackResourcePort: GeometryWorkspaceResourcePort,
  ) => Promise<void>;
}>;

function resourceError(
  code: 'invalid-request' | 'not-found' | 'operation-failed',
  message: string,
  path: string,
  cause?: unknown,
): GeometryWorkspaceProviderError {
  return new GeometryWorkspaceProviderError(code, message, {
    resource: 'document',
    id: path,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isVirtualPath(path: string): boolean {
  return path === VIRTUAL_ROOT || path.startsWith(`${VIRTUAL_ROOT}/`);
}

function captureVirtualPath(path: string, allowRoot: boolean): readonly string[] {
  if (
    typeof path !== 'string'
    || !isVirtualPath(path)
    || path.normalize('NFC') !== path
    || path.trim() !== path
    || path.endsWith('/')
    || path.includes('\\')
  ) {
    throw resourceError('invalid-request', 'Virtual document resource path is unsafe', path);
  }
  const segments = path.split('/');
  if (
    (!allowRoot && segments.length === 1)
    || segments.some((segment) =>
      !segment || segment === '.' || segment === '..' || segment.trim() !== segment)
  ) {
    throw resourceError('invalid-request', 'Virtual document resource path is unsafe', path);
  }
  return segments;
}

function parentDirectories(path: string): readonly string[] {
  const segments = path.split('/');
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join('/'));
  }
  return directories;
}

function compareName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function captureListWithKind(
  options: GeometryWorkspaceResourceListOptions | undefined,
  path: string,
): boolean {
  if (options === undefined) return false;
  if (
    typeof options !== 'object'
    || options === null
    || (options.withKind !== undefined && typeof options.withKind !== 'boolean')
  ) {
    throw resourceError(
      'invalid-request',
      'Workspace resource list options are invalid',
      path,
    );
  }
  return options.withKind === true;
}

function bytesFromBufferSource(value: BufferSource, path: string): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw resourceError(
    'invalid-request',
    'Workspace resource bytes must be a Blob or BufferSource',
    path,
  );
}

async function captureBytes(value: Blob | BufferSource, path: string): Promise<Uint8Array> {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    try {
      return new Uint8Array(await value.arrayBuffer());
    } catch (cause) {
      throw resourceError(
        'operation-failed',
        'Workspace resource Blob could not be read',
        path,
        cause,
      );
    }
  }
  return bytesFromBufferSource(value as BufferSource, path);
}

function captureFallbackPath(path: string, allowRoot: boolean): readonly string[] {
  if (
    typeof path !== 'string'
    || path.normalize('NFC') !== path
    || path.trim() !== path
    || path.startsWith('/')
    || path.endsWith('/')
    || path.includes('\\')
    || isVirtualPath(path)
  ) {
    throw resourceError('invalid-request', 'Fallback resource path is unsafe', path);
  }
  if (path === '') {
    if (allowRoot) return Object.freeze([]);
    throw resourceError('invalid-request', 'Fallback resource path is unsafe', path);
  }
  const segments = path.split('/');
  if (segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || segment.trim() !== segment)) {
    throw resourceError('invalid-request', 'Fallback resource path is unsafe', path);
  }
  return Object.freeze(segments);
}

function starterMediaType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.csv')) return 'text/csv;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

function createFallbackResourcePort(): GeometryWorkspaceResourcePort {
  const files = new Map<string, VirtualFile>(
    COMMUNITY_STARTER_RESOURCES.map(({ path, content }) => [
      path,
      Object.freeze({
        fileName: path.slice(path.lastIndexOf('/') + 1),
        mediaType: starterMediaType(path),
        resourceId: `fallback:${path}`,
        bytes: new TextEncoder().encode(content),
      }),
    ]),
  );
  const directories = new Set<string>();
  for (const path of files.keys()) {
    for (const directory of parentDirectories(path)) directories.add(directory);
  }

  const requireFile = (path: string): VirtualFile => {
    captureFallbackPath(path, false);
    const file = files.get(path);
    if (!file) throw resourceError('not-found', 'Fallback resource was not found', path);
    return file;
  };

  const setFile = (path: string, file: VirtualFile): void => {
    captureFallbackPath(path, false);
    files.set(path, file);
    for (const directory of parentDirectories(path)) directories.add(directory);
  };

  return Object.freeze({
    availability: 'available' as const,
    async readText(path: string) {
      return new TextDecoder().decode(requireFile(path).bytes);
    },
    async readFile(path: string) {
      const resource = requireFile(path);
      return new File([Uint8Array.from(resource.bytes)], resource.fileName, {
        type: resource.mediaType,
      });
    },
    async writeText(path: string, content: string) {
      if (typeof content !== 'string') {
        throw resourceError('invalid-request', 'Fallback resource text must be a string', path);
      }
      const existing = files.get(path);
      setFile(path, Object.freeze({
        fileName: existing?.fileName ?? path.slice(path.lastIndexOf('/') + 1),
        mediaType: existing?.mediaType ?? starterMediaType(path),
        resourceId: existing?.resourceId ?? `fallback:${path}`,
        bytes: new TextEncoder().encode(content),
      }));
    },
    async writeBytes(path: string, content: Blob | BufferSource) {
      const bytes = await captureBytes(content, path);
      const existing = files.get(path);
      setFile(path, Object.freeze({
        fileName: existing?.fileName ?? path.slice(path.lastIndexOf('/') + 1),
        mediaType: existing?.mediaType ?? 'application/octet-stream',
        resourceId: existing?.resourceId ?? `fallback:${path}`,
        bytes,
      }));
    },
    async removeFile(path: string) {
      requireFile(path);
      files.delete(path);
    },
    async ensureDirectory(path: string) {
      captureFallbackPath(path, true);
      for (const directory of [...parentDirectories(`${path}/placeholder`), path]) {
        if (directory) directories.add(directory);
      }
    },
    async exists(path: string) {
      captureFallbackPath(path, false);
      return files.has(path);
    },
    async list(path: string, options?: GeometryWorkspaceResourceListOptions) {
      captureFallbackPath(path, true);
      const withKind = captureListWithKind(options, path);
      if (path !== '' && !directories.has(path)) {
        throw resourceError('not-found', 'Fallback resource directory was not found', path);
      }
      const prefix = path ? `${path}/` : '';
      const entries = new Map<string, GeometryWorkspaceResourceEntry['kind']>();
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue;
        const relative = directory.slice(prefix.length);
        if (relative && !relative.includes('/')) entries.set(relative, 'directory');
      }
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const relative = filePath.slice(prefix.length);
        if (relative && !relative.includes('/')) entries.set(relative, 'file');
      }
      const sorted = [...entries]
        .sort(([left], [right]) => compareName(left, right))
        .map(([name, kind]) => Object.freeze({ name, kind }));
      return Object.freeze(withKind ? sorted : sorted.map(({ name }) => name));
    },
  });
}

function registrationFiles(
  registrations: readonly GeometryDocumentVirtualResourceRegistration[],
): ReadonlyMap<string, VirtualFile> {
  if (!Array.isArray(registrations)) {
    throw resourceError(
      'invalid-request',
      'Document virtual resource registrations must be an array',
      VIRTUAL_ROOT,
    );
  }
  const files = new Map<string, VirtualFile>();
  for (const registration of registrations) {
    captureVirtualPath(registration.path, false);
    if (files.has(registration.path)) {
      throw resourceError(
        'invalid-request',
        'Document virtual resource paths must be unique',
        registration.path,
      );
    }
    files.set(registration.path, {
      fileName: registration.fileName,
      mediaType: registration.mediaType,
      resourceId: registration.resourceId,
      bytes: Uint8Array.from(registration.bytes),
    });
  }
  return files;
}

/** Creates one document-scoped virtual namespace over a replaceable folder access. */
export function createCommunityGeometryWorkspaceResources(): CommunityGeometryWorkspaceResources {
  let current: BrowserDirectoryWorkspaceResourceAccess | null = null;
  const fallbackPort = createFallbackResourcePort();
  let virtualFiles = new Map<string, VirtualFile>();
  let virtualDirectories = new Set<string>();
  let version = 0;
  const listeners = new Set<() => void>();
  let snapshot: CommunityGeometryWorkspaceResourcesSnapshot;

  const availability = (): GeometryWorkspaceResourcePort['availability'] =>
    'available';

  const activeResourcePort = (): GeometryWorkspaceResourcePort =>
    current ?? fallbackPort;

  const makeSnapshot = (): CommunityGeometryWorkspaceResourcesSnapshot => Object.freeze({
    version,
    availability: availability(),
    current,
    virtualResourceCount: virtualFiles.size,
  });
  snapshot = makeSnapshot();

  const publish = (): void => {
    version += 1;
    snapshot = makeSnapshot();
    for (const listener of [...listeners]) listener();
  };

  const requireVirtualFile = (path: string): VirtualFile => {
    captureVirtualPath(path, false);
    const resource = virtualFiles.get(path);
    if (!resource) {
      throw resourceError('not-found', 'Virtual document resource was not found', path);
    }
    return resource;
  };

  const setVirtualFile = (path: string, file: VirtualFile): void => {
    captureVirtualPath(path, false);
    virtualFiles.set(path, file);
    for (const directory of parentDirectories(path)) virtualDirectories.add(directory);
    publish();
  };

  const listVirtual = (
    path: string,
    options?: GeometryWorkspaceResourceListOptions,
  ): readonly (string | GeometryWorkspaceResourceEntry)[] => {
    captureVirtualPath(path, true);
    const withKind = captureListWithKind(options, path);
    if (!virtualDirectories.has(path)) {
      throw resourceError('not-found', 'Virtual document resource directory was not found', path);
    }
    const prefix = `${path}/`;
    const entries = new Map<string, GeometryWorkspaceResourceEntry['kind']>();
    for (const directory of virtualDirectories) {
      if (!directory.startsWith(prefix)) continue;
      const relative = directory.slice(prefix.length);
      if (relative && !relative.includes('/')) entries.set(relative, 'directory');
    }
    for (const filePath of virtualFiles.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const relative = filePath.slice(prefix.length);
      if (relative && !relative.includes('/')) entries.set(relative, 'file');
    }
    const sorted = [...entries]
      .sort(([left], [right]) => compareName(left, right))
      .map(([name, kind]) => Object.freeze({ name, kind }));
    return Object.freeze(withKind ? sorted : sorted.map(({ name }) => name));
  };

  const port: GeometryWorkspaceResourcePort = Object.freeze({
    get availability() {
      return availability();
    },

    async readText(path: string) {
      if (!isVirtualPath(path)) {
        return activeResourcePort().readText(path);
      }
      const resource = requireVirtualFile(path);
      return new TextDecoder().decode(resource.bytes);
    },

    async readFile(path: string) {
      if (!isVirtualPath(path)) {
        return activeResourcePort().readFile(path);
      }
      const resource = requireVirtualFile(path);
      return new File([Uint8Array.from(resource.bytes)], resource.fileName, {
        type: resource.mediaType,
      });
    },

    async writeText(path: string, content: string) {
      if (!isVirtualPath(path)) {
        await activeResourcePort().writeText(path, content);
        publish();
        return;
      }
      if (typeof content !== 'string') {
        throw resourceError(
          'invalid-request',
          'Workspace resource text must be a string',
          path,
        );
      }
      const existing = virtualFiles.get(path);
      setVirtualFile(path, {
        fileName: existing?.fileName ?? path.slice(path.lastIndexOf('/') + 1),
        mediaType: existing?.mediaType ?? 'text/plain;charset=utf-8',
        resourceId: existing?.resourceId ?? `virtual:${path}`,
        bytes: new TextEncoder().encode(content),
      });
    },

    async writeBytes(path: string, content: Blob | BufferSource) {
      if (!isVirtualPath(path)) {
        await activeResourcePort().writeBytes(path, content);
        publish();
        return;
      }
      const bytes = await captureBytes(content, path);
      const existing = virtualFiles.get(path);
      setVirtualFile(path, {
        fileName: existing?.fileName ?? path.slice(path.lastIndexOf('/') + 1),
        mediaType: existing?.mediaType ?? 'application/octet-stream',
        resourceId: existing?.resourceId ?? `virtual:${path}`,
        bytes,
      });
    },

    async removeFile(path: string) {
      if (!isVirtualPath(path)) {
        await activeResourcePort().removeFile(path);
        publish();
        return;
      }
      requireVirtualFile(path);
      virtualFiles.delete(path);
      publish();
    },

    async ensureDirectory(path: string) {
      if (!isVirtualPath(path)) {
        await activeResourcePort().ensureDirectory(path);
        publish();
        return;
      }
      captureVirtualPath(path, true);
      for (const directory of [...parentDirectories(`${path}/placeholder`), path]) {
        virtualDirectories.add(directory);
      }
      publish();
    },

    async exists(path: string) {
      if (!isVirtualPath(path)) {
        return activeResourcePort().exists(path);
      }
      captureVirtualPath(path, false);
      return virtualFiles.has(path);
    },

    async list(path: string, options?: GeometryWorkspaceResourceListOptions) {
      if (path !== '' && !isVirtualPath(path)) {
        return activeResourcePort().list(path, options);
      }
      if (isVirtualPath(path)) return listVirtual(path, options);

      const withKind = captureListWithKind(options, path);
      const folderEntries = await activeResourcePort().list(path, { withKind: true });
      const entries = new Map<string, GeometryWorkspaceResourceEntry['kind']>();
      for (const entry of folderEntries) {
        if (typeof entry === 'string') entries.set(entry, 'file');
        else entries.set(entry.name, entry.kind);
      }
      if (virtualDirectories.has(VIRTUAL_ROOT)) entries.set(VIRTUAL_ROOT, 'directory');
      const sorted = [...entries]
        .sort(([left], [right]) => compareName(left, right))
        .map(([name, kind]) => Object.freeze({ name, kind }));
      return Object.freeze(withKind ? sorted : sorted.map(({ name }) => name));
    },
  });

  const replaceDocumentResources = (
    registrations: readonly GeometryDocumentVirtualResourceRegistration[],
  ): void => {
    const nextFiles = registrationFiles(registrations);
    const nextDirectories = new Set<string>();
    for (const path of nextFiles.keys()) {
      for (const directory of parentDirectories(path)) nextDirectories.add(directory);
    }
    virtualFiles = new Map(nextFiles);
    virtualDirectories = nextDirectories;
    publish();
  };

  return Object.freeze({
    port,
    fallbackPort,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bind(resourceAccess: BrowserDirectoryWorkspaceResourceAccess) {
      if (resourceAccess.availability !== 'available') {
        throw resourceError(
          'invalid-request',
          'Connected workspace resource access must be available',
          '',
        );
      }
      if (current === resourceAccess) return;
      current = resourceAccess;
      publish();
    },
    unbind() {
      if (current === null) return;
      current = null;
      publish();
    },
    replaceDocumentResources,
    activateDocument(contents: GeometryDocumentContents) {
      const referencePaths = geometryDocumentWorkspaceReferencePaths(contents);
      if (referencePaths.length > 0) {
        const documentResourceIds = new Set([
          ...contents.derivedResources.map(({ id }) => id),
          ...contents.sourceFiles.map(({ id }) => id),
        ]);
        const ownsEveryVirtualReference = referencePaths.every((path) => {
          if (!isVirtualPath(path)) return false;
          const file = virtualFiles.get(path);
          if (file !== undefined) return documentResourceIds.has(file.resourceId);
          if (!virtualDirectories.has(path)) return false;
          const prefix = `${path}/`;
          const descendants = [...virtualFiles.entries()]
            .filter(([filePath]) => filePath.startsWith(prefix))
            .map(([, descendant]) => descendant);
          return descendants.length > 0
            && descendants.every(({ resourceId }) =>
              documentResourceIds.has(resourceId),
            );
        });
        if (!ownsEveryVirtualReference) replaceDocumentResources([]);
        return contents;
      }
      const projection = projectDurableGeometryDocumentToEditor(contents);
      replaceDocumentResources(projection.registrations);
      return projection.contents;
    },
    clearDocumentResources() {
      replaceDocumentResources([]);
    },
  });
}

async function decorateConnected(
  result: BrowserDirectoryWorkspaceConnected,
  resources: CommunityGeometryWorkspaceResources,
  initializeConnectedWorkspace?: (
    workspaceResourcePort: GeometryWorkspaceResourcePort,
    fallbackResourcePort: GeometryWorkspaceResourcePort,
  ) => Promise<void>,
): Promise<BrowserDirectoryWorkspaceConnected> {
  const provider = createProjectedGeometryWorkspaceProvider({
    provider: result.provider,
    workspaceResourcePort: resources.port,
  });
  await initializeConnectedWorkspace?.(
    result.resourceAccess,
    resources.fallbackPort,
  );
  resources.bind(result.resourceAccess);
  return Object.freeze({ ...result, provider });
}

/** Binds directory resources and write projection to one Community access flow. */
export function createCommunityGeometryWorkspaceAccess(
  options: CommunityGeometryWorkspaceAccessOptions,
): BrowserDirectoryWorkspaceAccess {
  const { access, initializeConnectedWorkspace, resources } = options;
  return Object.freeze({
    capabilities: access.capabilities,
    async choose() {
      const result = await access.choose();
      return result.status === 'connected'
        ? decorateConnected(result, resources, initializeConnectedWorkspace)
        : result;
    },
    async restore() {
      const result = await access.restore();
      if (result.status === 'connected') {
        return decorateConnected(result, resources, initializeConnectedWorkspace);
      }
      resources.unbind();
      return result;
    },
    async reconnect() {
      const result = await access.reconnect();
      if (result.status === 'connected') {
        return decorateConnected(result, resources, initializeConnectedWorkspace);
      }
      resources.unbind();
      return result;
    },
    async forget() {
      await access.forget();
      resources.unbind();
    },
  });
}

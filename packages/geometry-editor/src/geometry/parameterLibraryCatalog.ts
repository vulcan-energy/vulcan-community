// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/workspaceResourcePort';

export type LibraryManifest = Record<string, string[]>;
export type WorkspaceSnippetSource = 'library' | 'user';

export interface WorkspaceSnippetOption {
  id: string;
  file: string;
  label: string;
  source: WorkspaceSnippetSource;
}

export interface ElementPresetCatalogOption extends WorkspaceSnippetOption {
  type: string;
}

const BATCH_PARAMETERS_DIR = 'input/batch_parameters';
const MANIFEST_PATH = `${BATCH_PARAMETERS_DIR}/manifest.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeJsonFileName(fileOrId: string): string {
  const trimmed = fileOrId.trim();
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}

function stripJsonSuffix(file: string): string {
  return file.replace(/\.json$/, '');
}

function formatOptionLabel(id: string): string {
  return id.replace(/_/g, ' ');
}

function readEntryName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (!isRecord(entry) || typeof entry.name !== 'string') return null;
  if (typeof entry.kind === 'string' && entry.kind !== 'file') return null;
  return entry.name;
}

export async function loadLibraryManifest(
  resources: GeometryWorkspaceResourcePort,
): Promise<LibraryManifest> {
  try {
    const content = await resources.readText(MANIFEST_PATH);
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return {};
    const manifest: LibraryManifest = {};
    for (const [category, files] of Object.entries(parsed)) {
      if (!Array.isArray(files)) continue;
      manifest[category] = files.filter((file): file is string => typeof file === 'string');
    }
    return manifest;
  } catch {
    return {};
  }
}

export function manifestIncludesSnippet(
  manifest: LibraryManifest,
  category: string,
  fileOrId: string,
): boolean {
  const fileName = normalizeJsonFileName(fileOrId);
  return !!manifest[category]?.includes(fileName);
}

export async function isLibrarySnippet(
  resources: GeometryWorkspaceResourcePort,
  category: string,
  id: string,
): Promise<boolean> {
  const manifest = await loadLibraryManifest(resources);
  return manifestIncludesSnippet(manifest, category, id);
}

async function listCategoryJsonFileNames(
  resources: GeometryWorkspaceResourcePort,
  category: string,
): Promise<string[]> {
  try {
    const entries = await resources.list(`${BATCH_PARAMETERS_DIR}/${category}`, { withKind: true });
    if (!Array.isArray(entries)) return [];
    return entries
      .map(readEntryName)
      .filter((name): name is string => !!name && name.endsWith('.json'));
  } catch {
    return [];
  }
}

export async function listCategoryJsonOptions(
  resources: GeometryWorkspaceResourcePort,
  category: string,
): Promise<WorkspaceSnippetOption[]> {
  const [manifest, fileNames] = await Promise.all([
    loadLibraryManifest(resources),
    listCategoryJsonFileNames(resources, category),
  ]);
  const manifestFiles = manifest[category] ?? [];
  const manifestOrder = new Map(manifestFiles.map((file, index) => [file, index]));

  return fileNames
    .map((file) => {
      const id = stripJsonSuffix(file);
      const source: WorkspaceSnippetSource = manifestOrder.has(file) ? 'library' : 'user';
      return {
        id,
        file,
        label: formatOptionLabel(id),
        source,
      };
    })
    .sort((a, b) => {
      const aManifestIndex = manifestOrder.get(a.file);
      const bManifestIndex = manifestOrder.get(b.file);
      if (aManifestIndex !== undefined && bManifestIndex !== undefined) {
        return aManifestIndex - bManifestIndex;
      }
      if (aManifestIndex !== undefined) return -1;
      if (bManifestIndex !== undefined) return 1;
      return a.label.localeCompare(b.label);
    });
}

export async function listElementPresetOptions(
  resources: GeometryWorkspaceResourcePort,
  elementType: string,
): Promise<ElementPresetCatalogOption[]> {
  const candidates = await listCategoryJsonOptions(resources, 'element_presets');
  const options = await Promise.all(candidates.map(async (candidate) => {
    try {
      const content = await resources.readText(`${BATCH_PARAMETERS_DIR}/element_presets/${candidate.file}`);
      const data = JSON.parse(content);
      if (!isRecord(data) || data.type !== elementType) return null;
      return {
        ...candidate,
        label: typeof data.label === 'string' && data.label.trim() ? data.label : candidate.label,
        type: elementType,
      } satisfies ElementPresetCatalogOption;
    } catch {
      return null;
    }
  }));
  return options.filter((option): option is ElementPresetCatalogOption => option !== null);
}

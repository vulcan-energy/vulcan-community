// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryProjectKind = 'collection' | 'development';

export type GeometryProjectContextProject = Readonly<{
  id: string;
  name: string;
  kind: GeometryProjectKind;
  baseModelStems: readonly string[];
}>;

export type GeometryProjectContextSnapshot =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{
      status: 'ready';
      projects: readonly GeometryProjectContextProject[];
      selectedProjectId: string | null;
      geometryListFilter: 'all' | 'unassigned' | string;
    }>;

export interface GeometryProjectContextPort {
  getSnapshot(): GeometryProjectContextSnapshot;
  subscribe(listener: () => void): () => void;
  loadModelText(modelId: string): Promise<string>;
}

const UNAVAILABLE_GEOMETRY_PROJECT_CONTEXT_SNAPSHOT = Object.freeze({
  status: 'unavailable' as const,
});

/** Explicit local-only composition for editors without cross-model context. */
export const unavailableGeometryProjectContextPort: GeometryProjectContextPort =
  Object.freeze({
    getSnapshot: () => UNAVAILABLE_GEOMETRY_PROJECT_CONTEXT_SNAPSHOT,
    subscribe: () => () => undefined,
    loadModelText: async () => {
      throw new Error('Cross-model project context is unavailable in this editor composition');
    },
  });

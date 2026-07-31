// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryModelSchemaProfileElement = Readonly<{
  type?: string;
  extra_json?: unknown;
}>;

/** Optional host metadata contributed when a model needs a non-public schema profile. */
export interface GeometryModelSchemaProfilePort {
  readonly availability: 'available' | 'unavailable';
  metadataValueForElements(
    elements: readonly GeometryModelSchemaProfileElement[],
  ): string;
}

/** Explicit no-profile composition; the public CSV omits the optional metadata row. */
export const unavailableGeometryModelSchemaProfilePort: GeometryModelSchemaProfilePort =
  Object.freeze({
    availability: 'unavailable',
    metadataValueForElements: () => {
      throw new Error('Geometry model schema profile metadata is unavailable');
    },
  });

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometrySchemaMode,
  GeometrySchemaNode,
  GeometrySchemaParameterInfo,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import * as schemaCache from './schemaCache';
import { findParameterInSchema } from './schemaUtils';

const usesFhsSchema = (mode: GeometrySchemaMode): boolean => mode === 'fhs';

/**
 * Canonical public Core/FHS schema implementation used by every editor host.
 * The host configures asset loading once with configureGeometrySchemaAssetSource.
 */
export const canonicalGeometrySchemaPort = Object.freeze<GeometrySchemaPort>({
  availability: 'available',
  preload: (mode) => usesFhsSchema(mode)
    ? schemaCache.preloadFHSSchema()
    : schemaCache.preloadSchema(),
  getRootSchema: (mode) =>
    schemaCache.getSchemaObjectForMode(usesFhsSchema(mode)) as GeometrySchemaNode | null,
  getElementSubschema: (mode, elementType, subtype) =>
    schemaCache.getElementSubschemaForMode(
      usesFhsSchema(mode),
      elementType,
      subtype,
    ) as GeometrySchemaNode | null,
  getBaseFieldsForElementType: (elementType) =>
    schemaCache.getBaseFieldsForElementType(elementType),
  getApplianceKeys: (mode) =>
    schemaCache.getApplianceKeysForMode(usesFhsSchema(mode)),
  getStrictestIntegerKeysForElementType: (elementType, subtype) =>
    schemaCache.getStrictestIntegerKeysForElementType(elementType, subtype),
  getSchemaSubtypeForElementData: (elementType, elementData) =>
    schemaCache.getSchemaSubtypeForElementData(
      elementType,
      elementData as Record<string, unknown> | null | undefined,
    ),
  getConditionalRequiredFields: (mode, elementType, elementData, subtype) =>
    schemaCache.getConditionalRequiredFieldsForMode(
      usesFhsSchema(mode),
      elementType,
      elementData as Record<string, unknown> | null | undefined,
      subtype,
    ),
  validateProperty: (mode, elementType, subtype, propertyName, value) =>
    schemaCache.validatePropertyValueForMode(
      usesFhsSchema(mode),
      elementType,
      subtype,
      propertyName,
      value,
    ),
  findParameter: (paramId, contextPath, elementType, mode = 'core') =>
    findParameterInSchema(
      paramId,
      contextPath ? [...contextPath] : undefined,
      elementType,
      usesFhsSchema(mode),
    ) as GeometrySchemaParameterInfo | null,
});

export {
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
  type GeometrySchemaAssetSource,
} from './schemaCache';

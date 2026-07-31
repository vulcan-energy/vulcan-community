// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometrySchemaMode,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import {
  fieldUnitForAdornment,
  resolveFieldPresentation,
  type ResolvedFieldPresentation,
} from '../lib/fieldPresentation';
import { getSchemaParamIdForField } from '../lib/fieldTooltipMap';
import { classifyOpaqueFabricVariant } from '../lib/opaqueFabricVariant';

export interface ElementCreatorFieldPresentationContext {
  mode: GeometrySchemaMode;
  schemaPort: GeometrySchemaPort;
  elementType?: string;
  floorType?: string;
  wetEmitterSubtype?: string;
  hotWaterSubtype?: string;
  ventilationSubtype?: string;
  systemSubtype?: string;
  pitch: number;
  isExternalDoor: boolean;
}

export interface ElementCreatorFieldPresentationResolver {
  resolve(
    fieldLabel: string,
    targetElementType?: string,
    propertyKey?: string,
  ): ResolvedFieldPresentation | null;
  unit(propertyKey: string, targetElementType?: string): string | undefined;
}

/**
 * Keep schema lookup outside the large ElementCreator render function. Besides
 * sharing label/adornment results, this prevents presentation lookup from
 * changing the React Compiler's analysis of unrelated editor callbacks.
 */
export function createElementCreatorFieldPresentationResolver(
  context: ElementCreatorFieldPresentationContext,
): ElementCreatorFieldPresentationResolver {
  const cache = new Map<string, ResolvedFieldPresentation>();

  const resolve = (
    fieldLabel: string,
    targetElementType = context.elementType,
    propertyKey?: string,
  ): ResolvedFieldPresentation | null => {
    const resolvedPropertyKey = propertyKey ?? getSchemaParamIdForField(fieldLabel, targetElementType);
    if (!resolvedPropertyKey) return null;
    const subtype = targetElementType === 'BuildingElementGround'
      ? context.floorType
      : targetElementType === 'WetEmitter'
        ? context.wetEmitterSubtype
        : targetElementType === 'HotWaterDemand'
          ? context.hotWaterSubtype
          : targetElementType === 'MechanicalVentilation'
            ? context.ventilationSubtype
            : targetElementType === 'System'
              ? context.systemSubtype
              : undefined;
    const opaqueFabricVariant = targetElementType === 'BuildingElementOpaque'
      ? classifyOpaqueFabricVariant({
          pitch: context.pitch,
          is_external_door: context.isExternalDoor,
        })
      : undefined;
    const cacheKey = [
      context.mode,
      targetElementType ?? '',
      subtype ?? '',
      opaqueFabricVariant ?? '',
      resolvedPropertyKey,
      fieldLabel,
    ].join('|');
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const presentation = resolveFieldPresentation({
      mode: context.mode,
      propertyKey: resolvedPropertyKey,
      elementType: targetElementType,
      subtype,
      opaqueFabricVariant,
      label: fieldLabel,
    }, context.schemaPort);
    cache.set(cacheKey, presentation);
    return presentation;
  };

  return {
    resolve,
    unit(propertyKey, targetElementType = context.elementType) {
      const presentation = resolve(propertyKey, targetElementType, propertyKey);
      return presentation ? fieldUnitForAdornment(presentation) : undefined;
    },
  };
}

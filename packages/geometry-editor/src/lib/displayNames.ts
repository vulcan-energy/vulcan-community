// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { ELEMENT_TYPE_COMPACT_LABELS } from './elementTypeMetadata';
import type { ElementType } from '../geometry/types';

export type { ElementType } from '../geometry/types';

const DISPLAY_NAME_MAP: Record<ElementType, string> = ELEMENT_TYPE_COMPACT_LABELS;

const BASE_NAME_MAP: Record<ElementType, string> = {
  BuildingElementOpaque: 'Wall',
  BuildingElementTransparent: 'Window',
  BuildingElementGround: 'Floor',
  BuildingElementAdjacentConditionedSpace: 'Internal Element',
  BuildingElementAdjacentUnconditionedSpace_Simple: 'Unheated Element',
  BuildingElementPartyWall: 'Party Wall',
  ThermalBridgeLinear: 'Thermal Bridge',
  ThermalBridgePoint: 'Thermal Bridge',
  WindowShading: 'Shading',
  Lighting: 'Light',
  MechanicalVentilationDuctwork: 'Duct',
  MechanicalVentilationTerminal: 'Terminal',
  WaterPipework: 'Pipe',
  WetEmitter: 'Radiator',
  Appliance: 'Appliance',
  HotWaterDemand: 'Hot Water',
  ContextShading: 'Context',
  Vents: 'Vent',
  MechanicalVentilation: 'Ventilation',
  CombustionAppliances: 'Heater',
  OnSiteGeneration: 'Solar Panel',
  ElectricBattery: 'Electric Battery',
  System: 'System',
};

export function getElementTypeDisplayName(type: ElementType): string {
  return DISPLAY_NAME_MAP[type] || (type as string);
}

export type ContextualElementDisplayInput = {
  type?: ElementType | string;
  pitch?: number | null;
  is_external_door?: boolean | null;
};

function readPitch(element: ContextualElementDisplayInput): number | null {
  return typeof element.pitch === 'number' && Number.isFinite(element.pitch)
    ? Math.round(element.pitch)
    : null;
}

export function getContextualElementDisplayName(element: ContextualElementDisplayInput): string {
  const type = element.type as ElementType | undefined;
  if (!type) return '';

  const pitch = readPitch(element);
  if (type === 'BuildingElementOpaque') {
    if (element.is_external_door) return 'External Door';
    if (pitch !== null && pitch >= 0 && pitch < 85) return pitch === 0 ? 'Flat Roof' : 'Roof';
    if (pitch !== null && pitch > 95) return 'Exposed Floor';
    return 'External Wall';
  }
  if (type === 'BuildingElementTransparent') {
    if (pitch !== null && pitch >= 0 && pitch < 85) return 'Roof Window';
    return 'Window';
  }
  return getElementTypeDisplayName(type);
}

export function getElementTypeBaseName(type: ElementType): string {
  return BASE_NAME_MAP[type] || (type as string);
}

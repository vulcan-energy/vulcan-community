// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from './jsonTypes';

export type DefaultsCompatibility = Readonly<{
  warnings: string[];
  foundTypes: string[];
  hasRequiredRootSections: boolean;
}>;

const ELEMENT_TYPES = Object.freeze([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
  'ThermalBridgeLinear',
  'ThermalBridgePoint',
]);

const MECHANICAL_VENTILATION_TYPES = Object.freeze([
  'Intermittent MEV',
  'Centralised continuous MEV',
  'Decentralised continuous MEV',
  'MVHR',
]);

/** Public, side-effect-free compatibility check for editable defaults JSON. */
export function inspectDefaultsCompatibility(
  defaultsJson: string,
): DefaultsCompatibility {
  const warnings: string[] = [];
  const foundTypes = new Set<string>();

  try {
    const parsed: unknown = JSON.parse(defaultsJson);
    const zones = isRecord(parsed) ? parsed.Zone : undefined;

    if (!isRecord(zones)) {
      warnings.push('No Zone section found in defaults');
      return {
        warnings,
        foundTypes: [],
        hasRequiredRootSections: false,
      };
    }

    for (const zoneData of Object.values(zones)) {
      if (!isRecord(zoneData)) continue;
      const buildingElements = zoneData.BuildingElement;
      if (isRecord(buildingElements)) {
        for (const element of Object.values(buildingElements)) {
          if (isRecord(element) && typeof element.type === 'string') {
            foundTypes.add(element.type);
          }
        }
      }

      const thermalBridging = zoneData.ThermalBridging;
      if (isRecord(thermalBridging)) {
        for (const bridge of Object.values(thermalBridging)) {
          if (isRecord(bridge) && typeof bridge.type === 'string') {
            foundTypes.add(bridge.type);
          }
        }
      }
    }

    const missingTypes = ELEMENT_TYPES.filter((type) => !foundTypes.has(type));
    if (missingTypes.length > 0) {
      warnings.push(`Missing type templates: ${missingTypes.join(', ')}`);
    }

    const requiredRootSections = [
      { key: 'InfiltrationVentilation', required: true },
      { key: 'HotWaterSource', required: false },
      { key: 'HotWaterDemand', required: false },
      { key: 'SpaceHeatSystem', required: false },
      { key: 'ExternalConditions', required: false },
    ] as const;

    let hasRequiredRootSections = true;
    for (const section of requiredRootSections) {
      if (!isRecord(parsed) || !parsed[section.key]) {
        if (section.required) {
          warnings.push(`Missing required root section: ${section.key}`);
          hasRequiredRootSections = false;
        } else {
          warnings.push(`Missing optional root section: ${section.key}`);
        }
      }
    }

    if (Object.keys(zones).length === 0) {
      warnings.push('No zones found in defaults - zone property inheritance may fail');
    }

    const infiltrationVentilation = isRecord(parsed) && isRecord(parsed.InfiltrationVentilation)
      ? parsed.InfiltrationVentilation
      : undefined;
    const mechanicalVentilation = infiltrationVentilation?.MechanicalVentilation;
    const entries = isRecord(mechanicalVentilation)
      ? Object.values(mechanicalVentilation)
      : [];
    const presentVentTypes = new Set(
      entries
        .map((entry) => (isRecord(entry) ? entry.vent_type : undefined))
        .filter((value): value is string => typeof value === 'string'),
    );
    for (const ventType of MECHANICAL_VENTILATION_TYPES) {
      if (!presentVentTypes.has(ventType)) {
        warnings.push(
          `Missing MechanicalVentilation template for vent_type='${ventType}' (required for strict CSV merges)`,
        );
      }
    }

    return {
      warnings,
      foundTypes: Array.from(foundTypes),
      hasRequiredRootSections,
    };
  } catch (error: unknown) {
    warnings.push(
      `Failed to parse defaults JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      warnings,
      foundTypes: [],
      hasRequiredRootSections: false,
    };
  }
}

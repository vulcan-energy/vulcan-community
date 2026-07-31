// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from './jsonTypes';
import { isSchemaNode, type SchemaNode } from './schemaTypes';

export type FabricSection = {
  label: string;
  // Path inside the snippet (dot path; supports nested keys like ThermalBridging.TB_linear)
  snippetPath: string;
  // JSON pointer inside input.schema.json that holds the base for the subschema
  schemaPointer: string;
  // Optional: prefer a specific variant title within oneOf/anyOf
  preferVariantTitle?: string;
  // Optional allowlist to show in guided mode
  allowlist?: string[];
  // Keys that are structural/baseline-only
  structuralRequired?: string[];
};

// Mapping mirrors merge logic in hem-batch-core/src/batch_runner.rs
// schemaPointer values are legacy anchors; resolveFabricSchemaPointer() maps them to
// `#/$defs/Zone/...` or other current root-schema locations.
export const SIMPLIFIED_FABRIC_SECTIONS: FabricSection[] = [
  { label: 'Window', snippetPath: 'window', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementTransparent' },
  { label: 'Wall', snippetPath: 'wall', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementOpaque' },
  { label: 'Door', snippetPath: 'door', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementOpaque', allowlist: ['is_external_door'] },
  { label: 'Roof', snippetPath: 'roof', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementOpaque' },
  { label: 'Ground', snippetPath: 'ground', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementGround' },
  { label: 'Party wall', snippetPath: 'party_wall', schemaPointer: '#/$defs/BuildingElement', preferVariantTitle: 'BuildingElementAdjacentConditionedSpace' },
  // Thermal bridging subsections
  { label: 'Thermal bridging (linear)', snippetPath: 'ThermalBridging.TB_linear', schemaPointer: '#/$defs/ThermalBridgingDetails', preferVariantTitle: 'ThermalBridgeLinear', allowlist: ['junction_type', 'length', 'linear_thermal_transmittance'] },
  { label: 'Thermal bridging (point)', snippetPath: 'ThermalBridging.TB_point', schemaPointer: '#/$defs/ThermalBridgingDetails', preferVariantTitle: 'ThermalBridgePoint' },
];

/**
 * Current HEM schemas do not define `#/$defs/BuildingElement` or `#/$defs/ThermalBridgingDetails`.
 * Fabric unions live under Zone. Core publishes Zone under `$defs.Zone`; FHS publishes it as
 * root `properties.Zone.additionalProperties`.
 *
 * For each zone key, `BuildingElement` is `type: object` with the real union under
 * `additionalProperties` (oneOf + discriminator). Pointers must end in
 * `.../BuildingElement/additionalProperties` so `selectVariant` sees a top-level oneOf — same idea
 * as TB. A bare `.../BuildingElement` leaves only the wrapper object schema and the Form renders
 * blank. Top-level `#/$defs/BuildingElement` (input.schema.json) is already a oneOf union.
 */
export function resolveFabricSchemaPointer(fullSchema: unknown, section: FabricSection): string {
  const legacy = section.schemaPointer;
  const schema = isSchemaNode(fullSchema) ? fullSchema : null;
  const defs = schema?.$defs;
  const zoneLike = (be: SchemaNode) => {
    const additionalProperties = be.additionalProperties;
    return isSchemaNode(additionalProperties) &&
      !!(additionalProperties.oneOf || additionalProperties.anyOf || additionalProperties.allOf);
  };

  const shellPaths = new Set(['window', 'wall', 'door', 'roof', 'ground', 'party_wall']);
  if (schema && (legacy === '#/$defs/BuildingElement' || shellPaths.has(section.snippetPath))) {
    const rootZone = schema.properties?.Zone;
    const rootZoneProperties = isSchemaNode(rootZone?.additionalProperties)
      ? rootZone.additionalProperties.properties
      : undefined;
    if (rootZoneProperties?.BuildingElement) {
      const be = rootZoneProperties.BuildingElement;
      return zoneLike(be)
        ? '#/properties/Zone/additionalProperties/properties/BuildingElement/additionalProperties'
        : '#/properties/Zone/additionalProperties/properties/BuildingElement';
    }
    if (defs?.ZoneFHS?.properties?.BuildingElement) {
      const be = defs.ZoneFHS.properties.BuildingElement;
      return zoneLike(be)
        ? '#/$defs/ZoneFHS/properties/BuildingElement/additionalProperties'
        : '#/$defs/ZoneFHS/properties/BuildingElement';
    }
    if (defs?.Zone?.properties?.BuildingElement) {
      const be = defs.Zone.properties.BuildingElement;
      return zoneLike(be)
        ? '#/$defs/Zone/properties/BuildingElement/additionalProperties'
        : '#/$defs/Zone/properties/BuildingElement';
    }
    // input.schema.json style (ZoneInput, top-level BuildingElement union)
    if (defs?.ZoneInput?.properties?.BuildingElement) {
      const be = defs.ZoneInput.properties.BuildingElement;
      return zoneLike(be)
        ? '#/$defs/ZoneInput/properties/BuildingElement/additionalProperties'
        : '#/$defs/ZoneInput/properties/BuildingElement';
    }
    if (defs?.BuildingElement) {
      return '#/$defs/BuildingElement';
    }
  }

  if (schema && (legacy === '#/$defs/ThermalBridgingDetails' || section.snippetPath.startsWith('ThermalBridging.'))) {
    const rootZone = schema.properties?.Zone;
    const rootZoneProperties = isSchemaNode(rootZone?.additionalProperties)
      ? rootZone.additionalProperties.properties
      : undefined;
    const rootThermalBridging = rootZoneProperties?.ThermalBridging;
    if (isSchemaNode(rootThermalBridging?.additionalProperties)) {
      return '#/properties/Zone/additionalProperties/properties/ThermalBridging/additionalProperties';
    }
    if (isSchemaNode(rootThermalBridging?.anyOf?.[1]?.additionalProperties)) {
      return '#/properties/Zone/additionalProperties/properties/ThermalBridging/anyOf/1/additionalProperties';
    }
    if (defs?.ZoneFHS?.properties?.ThermalBridging?.additionalProperties) {
      return '#/$defs/ZoneFHS/properties/ThermalBridging/additionalProperties';
    }
    if (defs?.ZoneFHS?.properties?.ThermalBridging?.anyOf?.[1]?.additionalProperties) {
      return '#/$defs/ZoneFHS/properties/ThermalBridging/anyOf/1/additionalProperties';
    }
    if (defs?.Zone?.properties?.ThermalBridging?.additionalProperties) {
      return '#/$defs/Zone/properties/ThermalBridging/additionalProperties';
    }
    if (defs?.Zone?.properties?.ThermalBridging?.anyOf?.[1]?.additionalProperties) {
      return '#/$defs/Zone/properties/ThermalBridging/anyOf/1/additionalProperties';
    }
    if (defs?.ThermalBridgingDetails) {
      return '#/$defs/ThermalBridgingDetails';
    }
  }

  return legacy;
}

// Junction type codes (Table 3.7 E/P/R only)
export const JUNCTION_TYPE_ENUM: string[] = [
  // E-series
  'E1','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12','E13','E14','E15','E16','E17','E18','E19','E20','E21','E22','E23','E24','E25',
  // P-series
  'P1','P2','P3','P4','P5','P6','P7','P8',
  // R-series
  'R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11',
];

// Descriptions (Table 3.7)
export const JUNCTION_TYPE_DESCRIPTIONS: Record<string, string> = {
  // E-series: Junctions with an external wall
  'E1': 'Steel lintel with perforated steel base plate',
  'E2': 'Other lintels (including other steel lintels)',
  'E3': 'Sill',
  'E4': 'Jamb',
  'E5': 'Ground floor (normal)',
  'E6': 'Intermediate floor within a dwelling',
  'E7': 'Party floor between dwellings (in blocks of flats)',
  'E8': 'Balcony within a dwelling, wall insulation continuous',
  'E9': 'Balcony between dwellings, wall insulation continuous',
  'E10': 'Eaves (insulation at ceiling level)',
  'E11': 'Eaves (insulation at rafter level)',
  'E12': 'Gable (insulation at ceiling level)',
  'E13': 'Gable (insulation at rafter level)',
  'E14': 'Flat roof',
  'E15': 'Flat roof with parapet',
  'E16': 'Corner (normal)',
  'E17': 'Corner (inverted – internal area greater than external area)',
  'E18': 'Party wall between dwellings',
  'E19': 'Ground floor (inverted)',
  'E20': 'Exposed floor (normal)',
  'E21': 'Exposed floor (inverted)',
  'E22': 'Basement floor',
  'E23': 'Balcony within or between dwellings, balcony support penetrates wall insulation',
  'E24': 'Eaves (insulation at ceiling level - inverted)',
  'E25': 'Staggered party wall between dwellings',
  // P-series: Junctions with a party wall
  'P1': 'Ground floor',
  'P2': 'Intermediate floor within a dwelling',
  'P3': 'Intermediate floor between dwellings (in blocks of flats)',
  'P4': 'Roof (insulation at ceiling level)',
  'P5': 'Roof (insulation at rafter level)',
  'P6': 'Ground floor (inverted)',
  'P7': 'Exposed floor (normal)',
  'P8': 'Exposed floor (inverted)',
  // R-series: Junctions within a roof or with a room-in-roof
  'R1': 'Head of roof window',
  'R2': 'Sill of roof window',
  'R3': 'Jamb of roof window',
  'R4': 'Ridge (vaulted ceiling)',
  'R5': 'Ridge (inverted)',
  'R6': 'Flat ceiling',
  'R7': 'Flat ceiling (inverted)',
  'R8': 'Roof to wall (rafter)',
  'R9': 'Roof to wall (flat ceiling)',
  'R10': 'All other roof or room-in-roof junctions',
  'R11': 'Upstands or kerbs of rooflights',
};

/** Built-in Table 3.7 default ψ (W/m·K); shipped CSV mirrors this. */
export const JUNCTION_TYPE_TO_PSI_TABLE_37: Record<string, number> = {
  E1: 1.0, E2: 1.0, E3: 0.1, E4: 0.1, E5: 0.32,
  E6: 0.14, E7: 0.28, E8: 0.1, E9: 0.15, E10: 0.12, E11: 0.15, E12: 0.25, E13: 0.25, E14: 0.16, E15: 0.3, E16: 0.18, E17: 0.0, E18: 0.24, E19: 0.1, E20: 0.32, E21: 0.32, E22: 0.22, E23: 1.0, E24: 0.15, E25: 0.24,
  P1: 0.32, P2: 0.0, P3: 0.0, P4: 0.48, P5: 0.48, P6: 0.32, P7: 0.48, P8: 0.48,
  R1: 0.24, R2: 0.24, R3: 0.24, R4: 0.12, R5: 0.12, R6: 0.12, R7: 0.12, R8: 0.12, R9: 0.32, R10: 0.32, R11: 0.24,
};

export const JUNCTION_TYPE_TO_PSI: Record<string, number> = JUNCTION_TYPE_TO_PSI_TABLE_37;

export function getPsiForJunctionType(junctionType: string | undefined): number | undefined {
  if (!junctionType) return undefined;
  return JUNCTION_TYPE_TO_PSI[junctionType];
}

export function inferPsiSourceFromValue(
  junctionType: string | undefined,
  psiValue: unknown,
): 'table_3_7' | 'custom' | undefined {
  if (typeof psiValue !== 'number' || !Number.isFinite(psiValue) || !junctionType) return undefined;
  const ref = getPsiForJunctionType(junctionType);
  if (ref === undefined) return 'custom';
  return Math.abs(psiValue - ref) < 1e-9 ? 'table_3_7' : 'custom';
}

export function getSnippetNode(snippet: unknown, path: string): unknown {
  const segs = path.split('.').filter(Boolean);
  let node: unknown = snippet;
  for (const s of segs) {
    if (!isRecord(node)) return undefined;
    node = node[s];
  }
  return node;
}

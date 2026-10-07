// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which bundled materials appear in the assembly calculator picker by element mode.
 * User-defined materials (`user:mat:…`) are always selectable.
 */

import type { GeometrySchemaMode, GeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';
import { dereferenceSchemaNodeInRoot } from './subschemaCache';
import type { BundledAssemblyLibrary } from './assemblyLibrary';
import type { AssemblyElementMode, MaterialRow } from './assemblyTypes';

/** Categories omitted for vertical / pitched opaque fabric (not ground-floor). */
export const OPAQUE_EXCLUDED_MATERIAL_CATEGORIES = new Set(['soils_subgrade', 'carpet']);

/**
 * Soils/subgrade λ rows are omitted for ground-floor assemblies too: HEM already applies a fixed
 * ground-layer resistance R_gr; summing soil as a solid layer would inflate
 * thermal_resistance_floor_construction and mislead users (see Assembly PRD §7.2).
 */
export const GROUND_EXCLUDED_MATERIAL_CATEGORIES = new Set(['soils_subgrade']);

/** UI-only: adjacent heated horizontal polygon fabric modelled as a party floor. Stored in extra_json; stripped before HEM merge. */
export const VULCAN_UI_PARTY_ELEMENT_KEY = '_vulcan_ui_party_element' as const;

type PartyFloorFlagCandidate = {
  type?: string;
  coordinates?: Array<{ x: number; y: number; z: number }>;
  pitch?: number | null;
  extra_json?: unknown;
};

/**
 * True when fabric U/R/areal should use the heated-side **half** of the layered construction.
 * HEM guidance applies this to party walls and internal elements adjacent to heated space.
 */
export function shouldUseHeatedAdjacentHalfConstructionFabric(
  elementMode: AssemblyElementMode,
): boolean {
  if (elementMode === 'BuildingElementPartyWall') return true;
  if (elementMode === 'BuildingElementAdjacentConditionedSpace') return true;
  return false;
}

/**
 * Heated-adjacent elements use the half construction for `thermal_resistance_construction`.
 * For party walls, cavity-specific effects are entered separately.
 */
export function adjustConstructionResistanceForHeatedAdjacentElement(
  elementMode: AssemblyElementMode,
  rMean: number,
  rSeries: number,
): { rMean: number; rSeries: number } {
  if (shouldUseHeatedAdjacentHalfConstructionFabric(elementMode)) {
    return {
      rMean: rMean / 2,
      rSeries: rSeries / 2,
    };
  }
  return { rMean, rSeries };
}

/**
 * Apply the same half-construction rule to raw areal heat capacity (J/(m²·K)) from the full layer sum.
 */
export function applyHeatedAdjacentHalfToArealJPerM2K(
  arealJPerM2K: number | null | undefined,
  elementMode: AssemblyElementMode,
): number | null {
  if (arealJPerM2K == null || !Number.isFinite(arealJPerM2K)) return null;
  if (shouldUseHeatedAdjacentHalfConstructionFabric(elementMode)) {
    return arealJPerM2K / 2;
  }
  return arealJPerM2K;
}

export function readVulcanUiPartyElementFromExtraJson(extra_json: unknown): boolean {
  if (!extra_json || typeof extra_json !== 'object' || Array.isArray(extra_json)) return false;
  return (extra_json as Record<string, unknown>)[VULCAN_UI_PARTY_ELEMENT_KEY] === true;
}

export function isVulcanUiPartyFloorElement(element: PartyFloorFlagCandidate | null | undefined): boolean {
  if (!element || element.type !== 'BuildingElementAdjacentConditionedSpace') return false;
  if (!readVulcanUiPartyElementFromExtraJson(element.extra_json)) return false;
  if (!Array.isArray(element.coordinates) || element.coordinates.length < 3) return false;
  const pitch = element.pitch ?? 0;
  return pitch === 0 || pitch === 180;
}

export function materialSelectableInAssemblyCalculator(
  elementMode: AssemblyElementMode,
  m: MaterialRow,
): boolean {
  if (m.id.startsWith('user:mat:')) return true;
  const cat = m.category ?? 'uncategorized';
  if (elementMode === 'BuildingElementGround') {
    if (GROUND_EXCLUDED_MATERIAL_CATEGORIES.has(cat)) return false;
    return true;
  }
  if (elementMode === 'ThermalBridgeJunctionRegion') {
    /** Like opaque for junction solids, but allow soils for explicit subgrade regions (still no carpet). */
    if (cat === 'carpet') return false;
    return true;
  }
  if (OPAQUE_EXCLUDED_MATERIAL_CATEGORIES.has(cat)) return false;
  return true;
}

function materialOption(m: MaterialRow): { value: string; label: string; description: string } {
  return {
    value: m.id,
    label: m.name,
    description: `λ ${m.lambda_W_mK} W/m·K${m.density_kg_m3 != null ? ` · ρ ${m.density_kg_m3} kg/m³` : ''}`,
  };
}

/**
 * Sections for the material dropdown: category order from the library, filtered by element mode.
 * If the layer already references a bundled material that is excluded for this mode, it is shown
 * in a top section so the user can see the name and change away.
 */
export function buildAssemblyMaterialPickerSections(
  library: BundledAssemblyLibrary,
  elementMode: AssemblyElementMode,
  legacySolidMaterialId: string | undefined,
): { title: string; options: { value: string; label: string; description: string }[] }[] {
  const order = library.materialCategories;
  const labelById = new Map(order.map((c) => [c.id, c.label]));

  const selectable = (m: MaterialRow) => materialSelectableInAssemblyCalculator(elementMode, m);

  const byCat = new Map<string, MaterialRow[]>();
  for (const m of library.materialsById.values()) {
    if (!selectable(m)) continue;
    const cid = m.category ?? 'uncategorized';
    if (!byCat.has(cid)) byCat.set(cid, []);
    byCat.get(cid)!.push(m);
  }

  const seen = new Set<string>();
  const sections: {
    title: string;
    options: { value: string; label: string; description: string }[];
  }[] = [];

  const legacy =
    legacySolidMaterialId && library.materialsById.has(legacySolidMaterialId)
      ? library.materialsById.get(legacySolidMaterialId)!
      : undefined;
  if (legacy && !selectable(legacy)) {
    sections.push({
      title: 'Current material (not in typical list for this element)',
      options: [materialOption(legacy)],
    });
  }

  for (const { id, label } of order) {
    const mats = byCat.get(id);
    if (!mats?.length) continue;
    seen.add(id);
    sections.push({
      title: label,
      options: [...mats].sort((a, b) => a.name.localeCompare(b.name)).map(materialOption),
    });
  }
  for (const [cid, mats] of byCat) {
    if (seen.has(cid)) continue;
    sections.push({
      title: labelById.get(cid) ?? cid.replace(/_/g, ' '),
      options: [...mats].sort((a, b) => a.name.localeCompare(b.name)).map(materialOption),
    });
  }
  return sections;
}

/** Authored party-wall facts stay in the document when another target hides a field. */
const PARTY_WALL_FABRIC_FIELDS = [
  { key: 'u_value', label: 'Half-construction U-value', unit: 'W/m²K', min: 0.01 },
  { key: 'u_value_whole_wall', label: 'Whole-wall U-value', unit: 'W/m²K', min: 0 },
  { key: 'thermal_resistance_construction', label: 'Construction resistance to midpoint', unit: 'm²K/W', min: 0.01 },
] as const;
export type PartyWallFabricField = typeof PARTY_WALL_FABRIC_FIELDS[number];

export function getPartyWallFabricFields(port: GeometrySchemaPort, mode: GeometrySchemaMode): readonly PartyWallFabricField[] {
  if (port.availability !== 'available') return [];
  const properties = port.getElementSubschema(mode, 'BuildingElementPartyWall')?.properties as Record<string, unknown> | undefined;
  return PARTY_WALL_FABRIC_FIELDS.filter(({ key }) => properties?.[key] != null && properties[key] !== false);
}

export function readPartyWallFabricValue(extra: Record<string, unknown>, key: PartyWallFabricField['key']): number | null {
  // An unresolved or whole-wall legacy U must never appear as a half-construction U.
  if (key === 'u_value' && extra.u_value_interpretation !== 'half_construction') return null;
  const value = extra[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function partyWallFabricPatch(key: PartyWallFabricField['key'], value: number): Record<string, unknown> {
  return {
    [key]: value,
    ...(key === 'u_value' ? { u_value_interpretation: 'half_construction', u_value_interpreted_value: value } : {}),
    ...(key === 'thermal_resistance_construction' ? { construction_basis: 'half' } : {}),
  };
}


const PARTY_WALL_CAVITY_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'unfilled_unsealed', label: 'Unfilled, unsealed' },
  { value: 'unfilled_sealed', label: 'Unfilled, sealed' },
  { value: 'filled_sealed', label: 'Filled, sealed' },
  { value: 'filled_unsealed', label: 'Filled, unsealed' },
  { value: 'defined_resistance', label: 'Defined resistance' },
];

export function getPartyWallCavityFields(port: GeometrySchemaPort, mode: GeometrySchemaMode) {
  const properties = port.availability === 'available'
    ? port.getElementSubschema(mode, 'BuildingElementPartyWall')?.properties as Record<string, unknown> | undefined : undefined;
  const root = port.availability === 'available' ? port.getRootSchema(mode) : null;
  const cavity = properties?.party_wall_cavity_type && root
    ? dereferenceSchemaNodeInRoot(properties.party_wall_cavity_type, root) as Record<string, unknown> : undefined;
  const values = Array.isArray(cavity?.enum) ? cavity.enum : [];
  return {
    options: PARTY_WALL_CAVITY_OPTIONS.filter(option => values.includes(option.value)),
    supportsResistance: properties?.thermal_resistance_cavity != null && properties.thermal_resistance_cavity !== false,
  };
}

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Saved-assembly apply + fabric fingerprint helpers for multi-select construction UX.
 * Mirrors {@link AssemblyCalculatorModal} handleApply semantics per element pitch.
 */

import type {
  AssemblyElementMode,
  AssemblyExample,
  AssemblyLayer,
  MaterialRow,
  VulcanAssemblyV1Envelope,
} from './assemblyTypes';
import type { BundledAssemblyLibrary } from './assemblyLibrary';
import { roundToTwoDecimals } from '../geometry/constants';
import { computeFabricUWritesFromConstructionR } from './fabricUWrites';
import { roundUValueToTwoSignificantFigures } from './iso6946AnnexF';
import {
  arealHeatCapacityJPerM2KFromBand,
  CALCULATION_ENGINE_VERSION,
  computeIso6946CombinedConstructionResistance,
  computeOpaqueUAndTotals,
  computeSuspendedGroundFloorConstructionMeansFromVoid,
  resolveFabricArealHeatCapacityForElement,
  sumAssemblyArealHeatCapacity,
  sumConstructionResistanceSeriesOnly,
  validateAssemblyLayerLayout,
} from './assemblyCalculator';
import {
  suggestMassDistributionClass,
  toFhsMassDistributionClass,
  fhsMassDistributionFromSuggestion,
} from './assemblyMassHeuristic';
import { libraryElementTypeForMode } from './assemblyUserLibrary';
import {
  adjustConstructionResistanceForHeatedAdjacentElement,
  applyHeatedAdjacentHalfToArealJPerM2K,
  shouldUseHeatedAdjacentHalfConstructionFabric,
} from './assemblyMaterialFabric';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import type { Element } from '../geometry/types';
import { getDefaultValueForElementField, type DefaultsLookup } from './defaultsCache';
import { classifyOpaqueFabricVariantFromElement } from './opaqueFabricVariant';
import { getElementShape } from './shapeUtils';
import { migrateLegacyCavityLayer, resolveAssemblyHeatTransferContext } from './assemblyCavityModel';

export function isFabricAssemblyElement(el: Element): boolean {
  const t = el.type;
  return (
    t === 'BuildingElementOpaque' ||
    t === 'BuildingElementGround' ||
    t === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    t === 'BuildingElementAdjacentConditionedSpace' ||
    t === 'BuildingElementPartyWall'
  );
}

export function assemblyElementMode(el: Element): AssemblyElementMode | null {
  const t = el.type;
  if (
    t === 'BuildingElementOpaque' ||
    t === 'BuildingElementGround' ||
    t === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    t === 'BuildingElementAdjacentConditionedSpace' ||
    t === 'BuildingElementPartyWall'
  ) {
    return t as AssemblyElementMode;
  }
  return null;
}

/** Match ElementCreator / AssemblyCalculatorModal pitch convention. */
export function assemblyPitchDegForElement(el: Element): number {
  if (el.type === 'BuildingElementGround') return 180;
  const p = (el as { pitch?: number }).pitch;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 90;
}

export function inferOpaqueSubtype(el: Element): 'wall' | 'roof' {
  const shape = getElementShape(el);
  if (shape === 'sloped-polygon') return 'roof';
  const p = (el as { pitch?: number }).pitch;
  if (typeof p === 'number' && p > 0 && p < 90) return 'roof';
  return 'wall';
}

export function libraryElementTypeForElement(el: Element): 'wall' | 'roof' | 'ground_floor' | null {
  const mode = assemblyElementMode(el);
  if (!mode) return null;
  return libraryElementTypeForMode(mode, inferOpaqueSubtype(el));
}

export function layersFromLibraryAssembly(
  row: AssemblyExample,
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
): AssemblyLayer[] {
  const out: AssemblyLayer[] = [];
  for (const L of row.layers) {
    if (L.kind === 'solid') {
      const mid = L.materialId ?? '';
      if (!mid || !materialsById.has(mid)) continue;
      out.push({
        kind: 'solid',
        materialId: mid,
        thickness_m: typeof L.thickness_m === 'number' && L.thickness_m > 0 ? L.thickness_m : 0.1,
        repeatingBridges: L.repeatingBridges,
      });
    } else {
      const ct = L.cavityType ?? '';
      const r =
        (ct ? cavityResistanceByType.get(ct) : undefined) ??
        (typeof L.fixedResistance_m2K_W === 'number' ? L.fixedResistance_m2K_W : 0.18);
      out.push(
        migrateLegacyCavityLayer({
          kind: 'cavity',
          cavityType: ct || undefined,
          ...(r > 0 ? { fixedResistance_m2K_W: r } : {}),
          ventilation: L.ventilation,
          gap_thickness_m: L.gap_thickness_m,
          surface_emissivity: L.surface_emissivity,
          annexFAirVoidLevelOverride: L.annexFAirVoidLevelOverride,
        }),
      );
    }
  }
  return out;
}

export interface FabricDisplayValues {
  u: number | null;
  r: number | null;
  mass: string;
  /** Areal heat capacity κ″ from extra_json / assembly envelope, kJ/(m²·K); null if unknown. */
  arealHeat_kJ_m2K: number | null;
  assemblyLabel: string;
}

/** Fabric columns with project defaults filled in where extra_json has no value. */
export interface EffectiveFabricDisplay extends FabricDisplayValues {
  uIsDefault: boolean;
  rIsDefault: boolean;
  massIsDefault: boolean;
  arealIsDefault: boolean;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function arealHeatCapacityJOrNull(v: unknown): number | null {
  const numeric = numOrNull(v);
  if (numeric != null) return numeric;
  const fromBand = arealHeatCapacityJPerM2KFromBand(v);
  return typeof fromBand === 'number' && Number.isFinite(fromBand) ? fromBand : null;
}

/** Read current fabric numbers from element extra_json / envelope (for grouping + table). */
export function readFabricDisplayValues(el: Element): FabricDisplayValues {
  const ex = el.extra_json;
  const extra = ex && typeof ex === 'object' && !Array.isArray(ex) ? (ex as Record<string, unknown>) : {};
  const v = parseVulcanAssemblyV1FromExtraJson(ex);
  const u =
    numOrNull(extra.u_value) ??
    (v ? numOrNull(v.correctedU_W_m2K) : null) ??
    (v ? numOrNull(v.uValueWrittenToElement_W_m2K) : null);
  const r =
    numOrNull(extra.thermal_resistance_construction) ??
    numOrNull(extra.thermal_resistance_floor_construction) ??
    (v ? numOrNull(v.thermalResistanceConstruction_m2K_W) : null);
  const massRaw = extra.mass_distribution_class ?? v?.massDistributionClass;
  const mass =
    typeof massRaw === 'string' && massRaw.length > 0
      ? toFhsMassDistributionClass(massRaw) ?? massRaw
      : '—';
  const ahcJ =
    arealHeatCapacityJOrNull(extra.areal_heat_capacity) ??
    (v ? numOrNull(v.arealHeatCapacityWrittenToElement_J_m2K) : null) ??
    (v ? numOrNull(v.arealHeatCapacity_J_m2K) : null);
  const arealHeat_kJ_m2K = ahcJ != null ? ahcJ / 1000 : null;
  let assemblyLabel = '—';
  if (v?.assemblyId) {
    assemblyLabel = String(v.assemblyId);
  }
  return {
    u: u,
    r: r,
    mass,
    arealHeat_kJ_m2K,
    assemblyLabel,
  };
}

function strMass(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 ? raw : '—';
}

/**
 * Values shown in the construction table: explicit extra_json / envelope first, else
 * the same project defaults the Advanced Element Editor uses ({@link getDefaultValueForElementField}).
 * Grouping still uses {@link fabricGroupKey} / {@link readFabricDisplayValues} only.
 */
export function effectiveFabricDisplayValues(
  el: Element,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): EffectiveFabricDisplay {
  const cur = readFabricDisplayValues(el);
  const t = el.type;
  const getDefault = defaultsLookup?.getDefaultValueForElementField ?? getDefaultValueForElementField;

  if (
    t !== 'BuildingElementOpaque' &&
    t !== 'BuildingElementGround' &&
    t !== 'BuildingElementAdjacentUnconditionedSpace_Simple' &&
    t !== 'BuildingElementAdjacentConditionedSpace' &&
    t !== 'BuildingElementPartyWall'
  ) {
    return {
      ...cur,
      uIsDefault: false,
      rIsDefault: false,
      massIsDefault: false,
      arealIsDefault: false,
    };
  }

  let defU: unknown;
  let defR: unknown;
  let defMass: unknown;
  let defAreal: unknown;

  if (t === 'BuildingElementGround') {
    defU = getDefault('u_value', t);
    defR = getDefault('thermal_resistance_floor_construction', t);
    defMass = getDefault('mass_distribution_class', t);
    defAreal = getDefault('areal_heat_capacity', t);
  } else {
    const opaqueFabricVariant =
      t === 'BuildingElementOpaque'
        ? classifyOpaqueFabricVariantFromElement(el as unknown as Record<string, unknown>)
        : undefined;
    defU = getDefault('u_value', t, opaqueFabricVariant);
    defR = getDefault('thermal_resistance_construction', t, opaqueFabricVariant);
    defMass = getDefault('mass_distribution_class', t, opaqueFabricVariant);
    defAreal = getDefault('areal_heat_capacity', t, opaqueFabricVariant);
  }

  const pickNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const uMerged = cur.u ?? pickNum(defU);
  const rMerged = cur.r ?? pickNum(defR);
  const massMerged = cur.mass !== '—' ? cur.mass : strMass(defMass);
  const defArealJ = arealHeatCapacityJOrNull(defAreal);
  const arealMerged =
    cur.arealHeat_kJ_m2K ?? (defArealJ != null ? defArealJ / 1000 : null);

  return {
    u: uMerged,
    r: rMerged,
    mass: massMerged,
    arealHeat_kJ_m2K: arealMerged,
    assemblyLabel: cur.assemblyLabel,
    uIsDefault: cur.u == null && uMerged != null,
    rIsDefault: cur.r == null && rMerged != null,
    massIsDefault: cur.mass === '—' && massMerged !== '—',
    arealIsDefault: cur.arealHeat_kJ_m2K == null && arealMerged != null,
  };
}

/** Internal grouping key when no assembly / U / R / mass is stored on the element. */
export const FABRIC_GROUP_KEY_DEFAULT = '—|U—|R—|—';

/** Stable key for grouping selected elements by current fabric snapshot. */
export function fabricGroupKey(el: Element): string {
  const v = readFabricDisplayValues(el);
  const u = v.u != null ? String(roundUValueToTwoSignificantFigures(v.u)) : '—';
  const r = v.r != null ? roundToTwoDecimals(v.r).toFixed(2) : '—';
  return `${v.assemblyLabel}|U${u}|R${r}|${v.mass}`;
}

/** Human-readable assembly name from library, or a short label for known ids. */
export function resolveAssemblyDisplayName(
  assemblyId: string,
  library: BundledAssemblyLibrary | null,
): string {
  if (!assemblyId || assemblyId === '—') return '';
  if (assemblyId === 'calculator:layered') return 'Custom layered assembly';
  const ex = library?.examples.find((e) => e.id === assemblyId);
  return ex?.name ?? assemblyId;
}

export interface SavedAssemblyComputation {
  patch: Record<string, unknown>;
  preview: { u: number; r: number; mass: string; arealHeat_kJ_m2K: number | null };
  errors: string[];
}

export interface ComputePatchFromSavedAssemblyOptions {
  /** When true (FHS validation mode), write `areal_heat_capacity` as the nearest FHS enum band. */
  fhsComplianceSnapArealHeat?: boolean;
  groundFloorType?: string | null;
}

/**
 * Build the same extra_json patch as AssemblyCalculatorModal handleApply for a saved library row.
 */
export function computePatchFromSavedAssembly(
  row: AssemblyExample,
  library: BundledAssemblyLibrary,
  elementMode: AssemblyElementMode,
  pitchDeg: number,
  options?: ComputePatchFromSavedAssemblyOptions,
): SavedAssemblyComputation | null {
  const fhsSnap = options?.fhsComplianceSnapArealHeat ?? false;
  const groundFloorType = options?.groundFloorType ?? null;
  const halfConstruction = shouldUseHeatedAdjacentHalfConstructionFabric(elementMode);
  const suspendedGroundAssembly =
    elementMode === 'BuildingElementGround' && groundFloorType === 'Suspended_floor';
  const layers = layersFromLibraryAssembly(row, library.materialsById, library.cavityResistanceByType);
  const layoutErrors = validateAssemblyLayerLayout(layers);
  const suspendedVoidSplit = suspendedGroundAssembly
    ? computeSuspendedGroundFloorConstructionMeansFromVoid(
        layers,
        library.materialsById,
        library.cavityResistanceByType,
        pitchDeg,
      )
    : null;
  const useSuspendedVoidSplit = !!suspendedVoidSplit?.hasVentilatedVoid;
  const suspendedGroundErrors =
    suspendedGroundAssembly && !useSuspendedVoidSplit
      ? ['Suspended floors need one well ventilated cavity to mark the underfloor void.']
      : [];
  const calcLayers = useSuspendedVoidSplit ? suspendedVoidSplit!.rfLayers : layers;
  const heatTransfer = resolveAssemblyHeatTransferContext(calcLayers, pitchDeg);
  const iso = computeIso6946CombinedConstructionResistance(
    calcLayers,
    library.materialsById,
    library.cavityResistanceByType,
    pitchDeg,
  );
  const { rLayers: rLayersSeries, errors: seriesErrors } = sumConstructionResistanceSeriesOnly(
    calcLayers,
    library.materialsById,
    library.cavityResistanceByType,
    pitchDeg,
  );
  const adjustedResistance = adjustConstructionResistanceForHeatedAdjacentElement(
    elementMode,
    iso.rConstructionMean_m2K_W,
    rLayersSeries,
  );
  const rLayers = adjustedResistance.rMean;
  const rLayersSeriesAdjusted = adjustedResistance.rSeries;
  const errors = [
    ...layoutErrors,
    ...iso.errors,
    ...seriesErrors,
    ...suspendedGroundErrors,
    ...(suspendedVoidSplit?.errors ?? []),
  ];
  if (errors.length > 0 || !(rLayers > 0)) {
    return { patch: {}, preview: { u: 0, r: 0, mass: '—', arealHeat_kJ_m2K: null }, errors };
  }

  const { u } = computeOpaqueUAndTotals(
    rLayers,
    pitchDeg,
    heatTransfer.externalSurfaceResistance_m2K_W,
  );
  if (!(u > 0)) {
    return {
      patch: {},
      preview: { u: 0, r: 0, mass: '—', arealHeat_kJ_m2K: null },
      errors: [...errors, 'Invalid U-value'],
    };
  }

  const uW = computeFabricUWritesFromConstructionR(
    rLayers,
    rLayersSeriesAdjusted,
    pitchDeg,
    heatTransfer.externalSurfaceResistance_m2K_W,
  );
  const uWrite = uW.uCombinedTwoSf_W_m2K;
  const rWrite = uW.thermalResistanceConstruction_m2K_W;
  const massSuggestion = suggestMassDistributionClass(heatTransfer.effectiveLayers, library.materialsById);
  const areal = sumAssemblyArealHeatCapacity(heatTransfer.effectiveLayers, library.materialsById);
  const arealJHalved = applyHeatedAdjacentHalfToArealJPerM2K(areal.jPerM2K, elementMode);
  const massDistributionClass = fhsMassDistributionFromSuggestion(massSuggestion);
  const arealRawJ = arealJHalved != null ? roundToTwoDecimals(arealJHalved) : undefined;
  const arealElementValue = resolveFabricArealHeatCapacityForElement(arealJHalved, fhsSnap);
  const arealElementJ = arealHeatCapacityJPerM2KFromBand(arealElementValue);
  const arealPreviewKj =
    arealElementJ != null ? Math.round((arealElementJ / 1000) * 100) / 100 : null;

  const envelope: VulcanAssemblyV1Envelope = {
    schemaVersion: 1,
    assemblyId: row.id,
    assemblySnapshot: {
      layers,
      pitchDegrees: pitchDeg,
      elementMode,
    },
    appliedAt: new Date().toISOString(),
    uncorrectedU_W_m2K: uW.uncorrectedU_twoSf_W_m2K,
    correctedU_W_m2K: uWrite,
    combinedMethodU_W_m2K: roundToTwoDecimals(uW.uCombinedFromRoundedConstruction_W_m2K),
    thermalResistanceConstruction_m2K_W: rWrite,
    rConstructionLowerLimit_m2K_W: roundToTwoDecimals(
      halfConstruction ? iso.rConstructionLower_m2K_W / 2 : iso.rConstructionLower_m2K_W,
    ),
    rConstructionUpperLimit_m2K_W: roundToTwoDecimals(
      halfConstruction ? iso.rConstructionUpper_m2K_W / 2 : iso.rConstructionUpper_m2K_W,
    ),
    massDistributionClass,
    calculationEngineVersion: CALCULATION_ENGINE_VERSION,
  };
  if (arealRawJ != null) {
    envelope.arealHeatCapacity_J_m2K = arealRawJ;
  }
  if (arealElementJ != null) {
    envelope.arealHeatCapacityWrittenToElement_J_m2K = arealElementJ;
  }
  if (elementMode !== 'BuildingElementGround') {
    envelope.uValueWrittenToElement_W_m2K = uWrite;
  }

  if (
    elementMode === 'BuildingElementGround' &&
    suspendedGroundAssembly &&
    useSuspendedVoidSplit &&
    suspendedVoidSplit!.heightUpperSurfaceM != null
  ) {
    envelope.suspendedHeightUpperSurfaceM = roundToTwoDecimals(suspendedVoidSplit!.heightUpperSurfaceM);
  }

  if (elementMode === 'BuildingElementGround') {
    const groundPatch =
      suspendedGroundAssembly && useSuspendedVoidSplit
        ? {
            thermal_resistance_floor_construction: rWrite,
            thermal_resist_insul: roundToTwoDecimals(suspendedVoidSplit!.rgMean_m2K_W),
            ...(suspendedVoidSplit!.heightUpperSurfaceM != null
              ? { height_upper_surface: roundToTwoDecimals(suspendedVoidSplit!.heightUpperSurfaceM) }
              : {}),
          }
        : {
            thermal_resistance_floor_construction: rWrite,
          };
    return {
      patch: {
        ...groundPatch,
        mass_distribution_class: massDistributionClass,
        ...(arealElementValue != null ? { areal_heat_capacity: arealElementValue } : {}),
        vulcan_assembly_v1: envelope,
      },
      preview: { u: uWrite, r: rWrite, mass: massDistributionClass ?? '—', arealHeat_kJ_m2K: arealPreviewKj },
      errors: [],
    };
  }

  return {
    patch: {
      u_value: uWrite,
      thermal_resistance_construction: rWrite,
      mass_distribution_class: massDistributionClass,
      ...(arealElementValue != null ? { areal_heat_capacity: arealElementValue } : {}),
      vulcan_assembly_v1: envelope,
    },
    preview: { u: uWrite, r: rWrite, mass: massDistributionClass ?? '—', arealHeat_kJ_m2K: arealPreviewKj },
    errors: [],
  };
}

export type CreationDefaultAssemblyIds = Partial<
  Record<'wall' | 'roof' | 'ground_floor', string>
>;

/** Stamp extra_json from Geometry Builder “default assembly” picks (new fabric elements only). */

/**
 * U-value (W/m²K) from a saved library assembly for an **exposed envelope** surface (not the
 * dwelling–buffer interface). Uses {@link BuildingElementOpaque} with pitch appropriate to the
 * catalog row’s `elementType` (wall 90°, roof 45°, ground 180°).
 */
export function computeUFromSavedAssembly(
  row: AssemblyExample,
  library: BundledAssemblyLibrary,
): { u: number | null; errors: string[] } {
  const mode: AssemblyElementMode = 'BuildingElementOpaque';
  const pitch =
    row.elementType === 'roof' ? 45 : row.elementType === 'ground_floor' ? 180 : 90;
  const comp = computePatchFromSavedAssembly(row, library, mode, pitch, {});
  if (!comp) return { u: null, errors: ['Computation failed'] };
  if (comp.errors.length > 0) return { u: null, errors: comp.errors };
  const u = comp.preview.u;
  if (!(u > 0)) return { u: null, errors: ['Invalid U-value'] };
  return { u, errors: [] };
}

export function applyCreationDefaultAssemblyToElement(
  element: Element,
  args: {
    library: BundledAssemblyLibrary | null;
    ids: CreationDefaultAssemblyIds;
    fhsComplianceSnapArealHeat?: boolean;
  },
): Element {
  const { library, ids, fhsComplianceSnapArealHeat = false } = args;
  if (!library || !ids || Object.keys(ids).length === 0) return element;
  const mode = assemblyElementMode(element);
  if (!mode) return element;
  const libType = libraryElementTypeForElement(element);
  if (!libType) return element;
  const chosenId = ids[libType]?.trim();
  if (!chosenId) return element;
  const row = library.examples.find((e) => e.id === chosenId);
  if (!row || row.elementType !== libType) return element;
  const pitch = assemblyPitchDegForElement(element);
  const comp = computePatchFromSavedAssembly(row, library, mode, pitch, {
    fhsComplianceSnapArealHeat,
  });
  if (!comp || comp.errors.length > 0 || Object.keys(comp.patch).length === 0) return element;
  const prev =
    element.extra_json && typeof element.extra_json === 'object' && !Array.isArray(element.extra_json)
      ? (element.extra_json as Record<string, unknown>)
      : {};
  return {
    ...element,
    extra_json: { ...prev, ...comp.patch },
  };
}

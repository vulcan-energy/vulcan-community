// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import {
  arealHeatCapacityBandFromJPerM2K,
  arealHeatCapacityJPerM2KFromBand,
  arealHeatCapacityWrite,
  resolveFabricArealHeatCapacityForElement,
} from './assemblyCalculator';
import type { ArealHeatCapacityInput } from '../../../geometry-editor-host/src/schemaPort';
import type { FhsMassDistributionClass } from './assemblyMassHeuristic';
import { toFhsMassDistributionClass } from './assemblyMassHeuristic';
import { shouldUseHeatedAdjacentHalfConstructionFabric } from './assemblyMaterialFabric';
import type { AssemblyElementMode, VulcanAssemblyV1Envelope } from './assemblyTypes';

/** Short labels aligned with HEM-TP-07 / BS EN ISO 52016-1 mass distribution classes. */
export const MASS_CLASS_MEANINGS: Record<'D' | 'I' | 'E' | 'IE' | 'M', string> = {
  I: 'Mass mainly on the room side (e.g. external insulation).',
  E: 'Mass mainly on the external side (e.g. internal insulation).',
  IE: 'Mass on both sides of the insulation (e.g. filled cavity).',
  D: 'Evenly distributed or negligible mass (e.g. uninsulated solid, lightweight).',
  M: 'Mass near the middle (insulation both sides of the structural leaf).',
};

/** Short option labels for the `MassDistributionClass` values, which do not fit a dropdown. */
export const MASS_CLASS_LABELS: Record<FhsMassDistributionClass, string> = {
  'I: Mass concentrated at internal side': 'I: Internal side',
  'E: Mass concentrated at external side': 'E: External side',
  'IE: Mass divided over internal and external side': 'IE: Both sides',
  'D: Mass equally distributed': 'D: Evenly spread',
  'M: Mass concentrated inside': 'M: Middle',
};

/** TP-07-style commentary keyed by the exact FHS `MassDistributionClass` string. */
export const FHS_MASS_CLASS_COMMENTARY: Record<FhsMassDistributionClass, string> = {
  'I: Mass concentrated at internal side': MASS_CLASS_MEANINGS.I,
  'E: Mass concentrated at external side': MASS_CLASS_MEANINGS.E,
  'IE: Mass divided over internal and external side': MASS_CLASS_MEANINGS.IE,
  'D: Mass equally distributed': MASS_CLASS_MEANINGS.D,
  'M: Mass concentrated inside': MASS_CLASS_MEANINGS.M,
};

export function parseVulcanAssemblyV1FromExtraJson(extra: unknown): VulcanAssemblyV1Envelope | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const raw = (extra as Record<string, unknown>).vulcan_assembly_v1;
  if (!raw || typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (v.schemaVersion !== 1) return null;
  if (typeof v.assemblyId !== 'string' || typeof v.appliedAt !== 'string') return null;
  if (typeof v.thermalResistanceConstruction_m2K_W !== 'number') return null;

  const legacyMass = v.massDistributionClass ?? v.massDistributionSuggestion;
  let massDistributionClass: FhsMassDistributionClass | undefined;
  if (typeof legacyMass === 'string' && legacyMass.trim()) {
    const coerced = toFhsMassDistributionClass(legacyMass.trim());
    if (coerced) massDistributionClass = coerced;
  }

  const normalized = { ...v } as Record<string, unknown>;
  delete normalized.massDistributionSuggestion;
  if (massDistributionClass) {
    normalized.massDistributionClass = massDistributionClass;
  } else {
    delete normalized.massDistributionClass;
  }

  return normalized as unknown as VulcanAssemblyV1Envelope;
}

/**
 * The fabric fields an applied assembly owns, each with the value the assembly wrote. A field the
 * envelope has no value for (e.g. `u_value_whole_wall`) is still owned: any edit to it overrides.
 * Ground U is left out: it is computed from the floor model, not written by the assembly.
 */
const ASSEMBLY_FABRIC_FIELDS: Record<string, (e: Record<string, unknown>) => unknown> = {
  u_value: (e) => e.uValueWrittenToElement_W_m2K,
  u_value_whole_wall: () => undefined,
  thermal_resistance_construction: (e) => e.thermalResistanceConstruction_m2K_W,
  thermal_resistance_floor_construction: (e) => e.thermalResistanceConstruction_m2K_W,
  thermal_resist_insul: (e) => e.thermalResistanceGroundInsulation_m2K_W,
  areal_heat_capacity: (e) => e.arealHeatCapacityWrittenToElement_J_m2K,
  mass_distribution_class: (e) => e.massDistributionClass,
  // The partition and party-wall mappings read R as half or full construction by this basis.
  // An envelope without a snapshot mode has no known basis, so any basis edit counts as an override.
  construction_basis: (e) => {
    const mode = (e.assemblySnapshot as { elementMode?: AssemblyElementMode } | undefined)?.elementMode;
    if (mode === undefined) return undefined;
    return shouldUseHeatedAdjacentHalfConstructionFabric(mode) ? 'half' : 'full';
  },
};

function comparableFabricValue(field: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (field === 'mass_distribution_class') return toFhsMassDistributionClass(String(value)) ?? value;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : value;
}

function sameFabricValue(field: string, a: unknown, b: unknown): boolean {
  // The envelope keeps the J/(m²·K) of the class it wrote, on its target's scale; the scales share no value.
  if (field === 'areal_heat_capacity' && typeof a !== typeof b && (typeof a === 'string' || typeof b === 'string')) {
    const [label, j] = typeof a === 'string' ? [a, b] : [b as string, a];
    return typeof j === 'number' && (['surface', 'full_depth'] as const)
      .some((scale) => Math.abs((arealHeatCapacityJPerM2KFromBand(label, scale) ?? Number.NaN) - j) <= 1e-6);
  }
  const x = comparableFabricValue(field, a);
  const y = comparableFabricValue(field, b);
  return typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-6 : x === y;
}

/**
 * Where an override keeps the layers it replaced: a UI-only key (the `_` prefix keeps it out of
 * the HEM input), so the converter sees an element with no build-up, as it did when an override
 * removed it. A field put back at the layers' value (a U-value or resistance also blank) brings them back.
 */
export const ASSEMBLY_SET_ASIDE_KEY = '_vulcan_assembly_v1_overridden';

/** The layers an override set aside, when the element has no applied ones. */
export function setAsideAssemblyEnvelope(extra: unknown): VulcanAssemblyV1Envelope | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const record = extra as Record<string, unknown>;
  return record.vulcan_assembly_v1 ? null : parseVulcanAssemblyV1FromExtraJson({ vulcan_assembly_v1: record[ASSEMBLY_SET_ASIDE_KEY] });
}

/**
 * The values layers give the element's fields, by field: U, R (a floor's under its own key),
 * ground insulation R, heat capacity (a class label where the target takes one) and mass class.
 */
export function envelopeFabricValues(
  envelope: VulcanAssemblyV1Envelope,
  elementType: string | undefined,
  subtype: string | undefined,
  arealHeatCapacity: ArealHeatCapacityInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof envelope.uValueWrittenToElement_W_m2K === 'number') {
    out.u_value = envelope.uValueWrittenToElement_W_m2K;
  }
  if (typeof envelope.thermalResistanceConstruction_m2K_W === 'number') {
    out[
      elementType === 'BuildingElementGround'
        ? 'thermal_resistance_floor_construction'
        : 'thermal_resistance_construction'
    ] = envelope.thermalResistanceConstruction_m2K_W;
  }
  if (typeof envelope.thermalResistanceGroundInsulation_m2K_W === 'number') {
    out.thermal_resist_insul = envelope.thermalResistanceGroundInsulation_m2K_W;
  }
  if (typeof envelope.arealHeatCapacityWrittenToElement_J_m2K === 'number' && elementType) {
    const jWritten = envelope.arealHeatCapacityWrittenToElement_J_m2K;
    // A target that takes a class stores its label; the envelope keeps the class's J/(m²·K).
    const write = arealHeatCapacityWrite(arealHeatCapacity, elementType);
    out.areal_heat_capacity = write === 'number' ? jWritten : arealHeatCapacityBandFromJPerM2K(jWritten, write);
  }
  if (typeof envelope.massDistributionClass === 'string') {
    out.mass_distribution_class = envelope.massDistributionClass;
  }
  if (
    elementType === 'BuildingElementGround' &&
    subtype === 'Suspended_floor' &&
    typeof envelope.suspendedHeightUpperSurfaceM === 'number' &&
    Number.isFinite(envelope.suspendedHeightUpperSurfaceM)
  ) {
    out.height_upper_surface = roundToTwoDecimals(envelope.suspendedHeightUpperSurfaceM);
  }
  return out;
}

/** The fields whose blank, like their layers' value, brings set-aside layers back. */
const BLANK_RESTORES = new Set(['u_value', 'thermal_resistance_construction']);

/**
 * An edit to an element whose layers are set aside. A row edit (new set-aside layers) moves
 * every value that still held the old layers' value. Otherwise, a U-value or resistance put back
 * at the layers' value (or blank) brings the layers back, with every value they give, whatever the
 * other fields say. A heat capacity or mass class put back does so only when the U-value and
 * resistance already follow the layers.
 */
function editWithLayersSetAside(
  elementType: string,
  prev: Record<string, unknown>,
  nextExtra: Record<string, unknown>,
  arealHeatCapacity: ArealHeatCapacityInput,
): Record<string, unknown> {
  const envelope = setAsideAssemblyEnvelope(nextExtra);
  if (!envelope || elementType === 'BuildingElementGround') return nextExtra;
  const sources = envelopeFabricValues(envelope, elementType, undefined, arealHeatCapacity);
  const before = setAsideAssemblyEnvelope(prev);
  if (before && JSON.stringify(prev[ASSEMBLY_SET_ASIDE_KEY]) !== JSON.stringify(nextExtra[ASSEMBLY_SET_ASIDE_KEY])) {
    const old = envelopeFabricValues(before, elementType, undefined, arealHeatCapacity);
    const next = { ...nextExtra };
    for (const [field, value] of Object.entries(sources)) {
      if (field in old && sameFabricValue(field, old[field], nextExtra[field])) next[field] = value;
    }
    return next;
  }
  const atLayers = (field: string) => sameFabricValue(field, sources[field], nextExtra[field])
    || (BLANK_RESTORES.has(field) && comparableFabricValue(field, nextExtra[field]) === undefined);
  const edited = Object.keys(sources).filter((field) => !sameFabricValue(field, prev[field], nextExtra[field]));
  // A U or R reset decides alone. A heat capacity or mass class back at the layers' value restores
  // them only once the U-value and resistance follow the layers too: otherwise it sets that field.
  const reset = edited.length > 0 && edited.every(atLayers)
    && (edited.some((field) => BLANK_RESTORES.has(field)) || [...BLANK_RESTORES].every((field) => !(field in sources) || atLayers(field)));
  if (!reset) return nextExtra;
  const rest: Record<string, unknown> = { ...nextExtra, ...sources, vulcan_assembly_v1: nextExtra[ASSEMBLY_SET_ASIDE_KEY] };
  delete rest[ASSEMBLY_SET_ASIDE_KEY];
  return rest;
}

/**
 * An applied assembly makes its fabric values derived. Changing one of them to anything but the
 * assembly's own value is an override, and the override sets `vulcan_assembly_v1` aside
 * (`ASSEMBLY_SET_ASIDE_KEY`) so the element has one unambiguous fabric source. An atomic write of
 * the assembly's own value (a fresh apply that brings its own envelope) keeps it, and replaces any
 * layers set aside. Returns `nextExtra` itself when nothing changes.
 *
 * An overridden U that is a number also removes the assembly's `thermal_resistance_construction`
 * (unless the same edit sets it; clearing U leaves R as the source): the converter keeps R and drops U when both are present, and the party-wall and
 * half-construction mappings derive R from U only when R is absent. The other values stay, now as
 * entered values: an overridden R already wins over U, whole-wall U is an input independent of R,
 * and areal heat capacity and mass class are independent of both.
 */
export function dropAssemblyEnvelopeOnFabricOverride(
  elementType: string,
  prevExtra: unknown,
  nextExtra: Record<string, unknown>,
  arealHeatCapacity: ArealHeatCapacityInput,
): Record<string, unknown> {
  const envelope = nextExtra.vulcan_assembly_v1;
  const prev = prevExtra && typeof prevExtra === 'object' ? (prevExtra as Record<string, unknown>) : {};
  if (!envelope || typeof envelope !== 'object') return editWithLayersSetAside(elementType, prev, nextExtra, arealHeatCapacity);
  if (nextExtra[ASSEMBLY_SET_ASIDE_KEY] !== undefined) {
    nextExtra = { ...nextExtra };
    delete nextExtra[ASSEMBLY_SET_ASIDE_KEY];
  }
  const changed = (field: string) => !sameFabricValue(field, prev[field], nextExtra[field]);
  const overridden = Object.entries(ASSEMBLY_FABRIC_FIELDS).flatMap(([field, assemblyValue]) =>
    !(field === 'u_value' && elementType === 'BuildingElementGround')
    && changed(field)
    && !sameFabricValue(field, assemblyValue(envelope as Record<string, unknown>), nextExtra[field])
      ? [field]
      : []);
  if (overridden.length === 0) return nextExtra;
  const rest: Record<string, unknown> = { ...nextExtra, [ASSEMBLY_SET_ASIDE_KEY]: envelope };
  delete rest.vulcan_assembly_v1;
  if (
    overridden.includes('u_value')
    && typeof comparableFabricValue('u_value', rest.u_value) === 'number'
    && !changed('thermal_resistance_construction')
  ) {
    delete rest.thermal_resistance_construction;
  }
  return rest;
}

/**
 * A loaded element's `extra_json` with its areal heat capacity fitted to its target, or undefined
 * when it already fits. A value an applied assembly wrote
 * (it still equals the envelope's) is derived: it is worked out again from the assembly's layer
 * sum, so a class written on another target's scale follows this target's. A user's own value has
 * no envelope (overriding removes it) and stays, except that a number where the target takes a
 * class becomes the nearest class on the target's scale.
 */
export function alignedArealHeatCapacity(
  element: { type: string; extra_json?: unknown },
  input: ArealHeatCapacityInput,
): Record<string, unknown> | undefined {
  const extra = element.extra_json;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const record = extra as Record<string, unknown>;
  const write = arealHeatCapacityWrite(input, element.type);
  const value = record.areal_heat_capacity;
  const envelope = record.vulcan_assembly_v1 as Record<string, unknown> | undefined;
  const layerSum = envelope?.arealHeatCapacity_J_m2K;
  const written = envelope?.arealHeatCapacityWrittenToElement_J_m2K;
  if (typeof layerSum === 'number' && typeof written === 'number' && sameFabricValue('areal_heat_capacity', value, written)) {
    const derived = resolveFabricArealHeatCapacityForElement(layerSum, write);
    const derivedJ = write === 'number' ? derived : arealHeatCapacityJPerM2KFromBand(derived, write);
    if (derived === value && derivedJ === written) return undefined;
    return { ...record, areal_heat_capacity: derived, vulcan_assembly_v1: { ...envelope, arealHeatCapacityWrittenToElement_J_m2K: derivedJ } };
  }
  if (typeof value === 'number' && write !== 'number') {
    const band = arealHeatCapacityBandFromJPerM2K(value, write);
    return band === undefined ? undefined : { ...record, areal_heat_capacity: band };
  }
  return undefined;
}

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { arealHeatCapacityJPerM2KFromBand } from './assemblyCalculator';
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
  construction_basis: (e) =>
    shouldUseHeatedAdjacentHalfConstructionFabric(
      (e.assemblySnapshot as { elementMode: AssemblyElementMode }).elementMode,
    ) ? 'half' : 'full',
};

function comparableFabricValue(field: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (field === 'areal_heat_capacity') return arealHeatCapacityJPerM2KFromBand(value) ?? value;
  if (field === 'mass_distribution_class') return toFhsMassDistributionClass(String(value)) ?? value;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : value;
}

function sameFabricValue(field: string, a: unknown, b: unknown): boolean {
  const x = comparableFabricValue(field, a);
  const y = comparableFabricValue(field, b);
  return typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-6 : x === y;
}

/**
 * An applied assembly makes its fabric values derived. Changing one of them to anything but the
 * assembly's own value is an override, and the override removes `vulcan_assembly_v1` so the
 * element has one unambiguous fabric source. An atomic write of the assembly's own value (Reset to
 * assembly, or a fresh apply that brings its own envelope) keeps it; a field committed keystroke
 * by keystroke has already overridden on the first differing keystroke, so typing the value back
 * does not restore the assembly. Returns `nextExtra` itself when nothing is removed.
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
): Record<string, unknown> {
  const envelope = nextExtra.vulcan_assembly_v1;
  if (!envelope || typeof envelope !== 'object') return nextExtra;
  const prev = prevExtra && typeof prevExtra === 'object' ? (prevExtra as Record<string, unknown>) : {};
  const changed = (field: string) => !sameFabricValue(field, prev[field], nextExtra[field]);
  const overridden = Object.entries(ASSEMBLY_FABRIC_FIELDS).flatMap(([field, assemblyValue]) =>
    !(field === 'u_value' && elementType === 'BuildingElementGround')
    && changed(field)
    && !sameFabricValue(field, assemblyValue(envelope as Record<string, unknown>), nextExtra[field])
      ? [field]
      : []);
  if (overridden.length === 0) return nextExtra;
  const rest = { ...nextExtra };
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

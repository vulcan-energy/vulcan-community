// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { FhsMassDistributionClass } from './assemblyMassHeuristic';
import { toFhsMassDistributionClass } from './assemblyMassHeuristic';
import type { VulcanAssemblyV1Envelope } from './assemblyTypes';

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

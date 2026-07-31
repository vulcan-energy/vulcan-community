// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { deleteProperties, hasAnyOwnProperty } from './mechanicalVentilationBranches';

// Radiator emitters have two mutually-exclusive parameter representations. This
// mirrors the MEV SFP-vs-measured pattern (see mechanicalVentilationBranches.ts)
// and the Rust merge in hem-batch-core build_wet_emitter_object, which keys a
// single coherent mode on the c representation and emits only the active branch:
//
//   per-metre: c_per_m + length (+ optional thermal_mass_per_m)
//   lumped:    c              (+ optional thermal_mass)
//
// The upstream FHS schema branches the whole emitter on `length`, so the two
// thermal-mass fields are NOT a free standalone either/or — they follow whichever
// c representation is in use.

export const RADIATOR_PER_METRE_FIELDS = ['c_per_m', 'length', 'thermal_mass_per_m'] as const;
export const RADIATOR_LUMPED_FIELDS = ['c', 'thermal_mass'] as const;

export type RadiatorThermalMode = 'per_metre' | 'lumped';

// The c representation defines the mode (matches the Rust determinant:
// per-metre iff c_per_m or length is present). thermal_mass_per_m alone — e.g.
// mid-edit before c_per_m/length is filled in — is treated as per-metre intent.
// Default is lumped, the branch the Rust builder falls back to (c = 0.08 × units).
export function inferRadiatorThermalMode(extraJson: Record<string, unknown>): RadiatorThermalMode {
  if (hasAnyOwnProperty(extraJson, ['c_per_m', 'length'])) return 'per_metre';
  if (hasAnyOwnProperty(extraJson, RADIATOR_LUMPED_FIELDS)) return 'lumped';
  if (hasAnyOwnProperty(extraJson, ['thermal_mass_per_m'])) return 'per_metre';
  return 'lumped';
}

// Drop the inactive branch's fields so only one representation is serialised to
// the CSV / merged JSON, matching what the Rust builder would emit.
export function pruneRadiatorEmitterExtraJson(
  extraJson: Record<string, unknown>,
  mode: RadiatorThermalMode,
): Record<string, unknown> {
  const next = { ...extraJson };
  if (mode === 'per_metre') {
    deleteProperties(next, RADIATOR_LUMPED_FIELDS);
  } else {
    deleteProperties(next, RADIATOR_PER_METRE_FIELDS);
  }
  return next;
}

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Release bar:** every junction code the façade auto TB tool can propose must have a full
 * {@link getJunctionContract} row, at least one proposer edge role, and must run through
 * {@link findLinearThermalBridgeIssues} without error on a minimal linear TB.
 */
import { describe, expect, it } from 'vitest';
import { JUNCTION_TYPE_ENUM } from '../../../lib/simplifiedFabricMap';
import { junctionCodesInFacadeAutoModal } from '../facadeAutoTbScope';
import { findLinearThermalBridgeIssues } from '../findLinearThermalBridgeIssues';
import { getJunctionContract } from '../junctionContractRegistry';
import type { ThermalBridgeLinear } from '../../types';

function minimalLinearTb(junctionType: string, idSuffix: string, offsetIndex = 0): ThermalBridgeLinear {
  const oy = offsetIndex * 3;
  return {
    type: 'ThermalBridgeLinear',
    id: `tb-${junctionType}-${idSuffix}`,
    name: `TB ${junctionType}`,
    zoneId: 'zone-z',
    parent_element: null,
    coordinates: [
      { x: 0, y: oy, z: 0 },
      { x: 1, y: oy, z: 0 },
    ],
    length: 1,
    linear_thermal_transmittance: 0.05,
    isPlaceholder: false,
    extra_json: { junction_type: junctionType },
  } as ThermalBridgeLinear;
}

describe('proposed junction contract coverage (façade auto tool)', () => {
  const proposed = junctionCodesInFacadeAutoModal();

  it('every proposed code is a valid Table 3.7 enum entry', () => {
    const enumSet = new Set(JUNCTION_TYPE_ENUM);
    for (const code of proposed) {
      expect(enumSet.has(code)).toBe(true);
    }
  });

  it.each(proposed)(
    'contract row with summary, auto-suggest flag, and ≥1 edge role for %s',
    (code) => {
      const c = getJunctionContract(code);
      expect(c).toBeDefined();
      expect(c!.junctionType).toBe(code);
      expect(c!.inFacadeAutoSuggestSet).toBe(true);
      expect(c!.validation.summary.trim().length).toBeGreaterThan(0);
      expect(c!.proposerEdgeRoles.length).toBeGreaterThan(0);
    },
  );

  it('issue finder accepts one minimal TB per proposed code in a single batch', () => {
    const elements = proposed.map((jt, i) => minimalLinearTb(jt, String(i), i));
    expect(() => findLinearThermalBridgeIssues(elements)).not.toThrow();
    const issues = findLinearThermalBridgeIssues(elements);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('issue finder accepts each proposed code individually', () => {
    for (let i = 0; i < proposed.length; i++) {
      const code = proposed[i]!;
      expect(() => findLinearThermalBridgeIssues([minimalLinearTb(code, `solo-${i}`)])).not.toThrow();
    }
  });
});

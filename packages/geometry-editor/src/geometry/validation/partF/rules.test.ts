// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Parity tests for partF.ts.
//
// Each `parity_*` test mirrors a `#[test]` in
//   hem_fhs_upstream/src/future_homes_standard/fhs_part_f_validation.rs:484-1808
// — same inputs, same expected outcome (pass/fail; specific failure rule(s)).
// Plus false-positive guards for cases unique to the panel UX (compliance off,
// missing dwelling counts, placeholder-only models, etc.).

import { describe, it, expect } from 'vitest';
import {
  evaluatePartF,
  minimumBackgroundAreaContinuousCm2,
  minimumBackgroundAreaIntermittentCm2,
  minimumBackgroundCountContinuous,
  minimumBackgroundCountIntermittent,
  minimumKitchenVentFlowRateLs,
  minimumWholeDwellingRateContinuousM3h,
  minimumWholeDwellingRateIntermittentM3h,
  partFInputFromContext,
  type PartFContextLike,
  type PartFInput,
} from './rules';
import type { Element, MechanicalVentilation, Vents } from '../../types';

// Test helper mirroring the production callers' "is this a valid evaluator input?" gate.
// Production uses `partFInputFromContext` after dwelling-count gating in
// `selectPartFData`/`detectMissingElements`; tests construct inputs directly.
function makePartFInputFromShape(shape: {
  complianceValidationEnabled?: boolean;
  bedrooms?: number;
  habitableRooms?: number;
  wetRooms?: number;
  bathrooms?: number;
  utilityRooms?: number;
  sanitaryAccommodations?: number;
  storeys?: number;
  isKitchenVentExternal?: boolean;
  totalFloorAreaM2?: number;
  elements: Element[];
}): PartFInput | null {
  if (shape.complianceValidationEnabled === false) return null;
  const ctx: PartFContextLike = {
    bedrooms: shape.bedrooms,
    habitableRooms: shape.habitableRooms,
    wetRooms: shape.wetRooms,
    bathrooms: shape.bathrooms,
    utilityRooms: shape.utilityRooms,
    sanitaryAccommodations: shape.sanitaryAccommodations,
    storeys: shape.storeys,
    isKitchenVentExternal: shape.isKitchenVentExternal,
    totalFloorAreaM2: shape.totalFloorAreaM2 ?? 0,
  };
  return partFInputFromContext(ctx, shape.elements);
}

// ---------------- helpers ----------------

let nextId = 0;
const newId = () => `el-${++nextId}`;

function makeVent(area_cm2: number, midHeight = 1.5): Vents {
  return {
    id: newId(),
    name: `vent-${nextId}`,
    type: 'Vents',
    area_cm2,
    mid_height_air_flow_path: midHeight,
    parent_element: '',
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
  };
}

function makeMv(
  vent_type: MechanicalVentilation['vent_type'],
  flowM3h: number,
): MechanicalVentilation {
  return {
    id: newId(),
    name: `mv-${nextId}`,
    type: 'MechanicalVentilation',
    vent_type,
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
    extra_json: { design_outdoor_air_flow_rate: flowM3h },
  };
}

const baseInput = (overrides: Partial<PartFInput> = {}): PartFInput => ({
  bedrooms: 4,
  habitableRooms: 5,
  wetRooms: 3,
  bathrooms: 2,
  utilityRooms: 0,
  sanitaryAccommodations: 0,
  storeys: 2,
  isKitchenVentExternal: true,
  totalFloorAreaM2: 100,
  vents: [],
  mechanicalVentilation: [],
  ...overrides,
});

const findRule = (input: PartFInput, rule: string) =>
  evaluatePartF(input).find((f) => f.rule === rule);

// ---------------- threshold parity ----------------

describe('Part F threshold helpers (parity with upstream)', () => {
  // upstream: test_mwdvr_when_bedroom_based_value_is_greater (line 489)
  it('whole-dwelling continuous = 133.2 m³/h when bedroom term dominates (100 m², 4 bed)', () => {
    expect(minimumWholeDwellingRateContinuousM3h(100, 4)).toBeCloseTo(133.2, 5);
  });

  // upstream: test_mwdvr_when_floor_area_based_value_is_greater (line 498)
  it('whole-dwelling continuous = 162.0 m³/h when floor-area term dominates (150 m², 4 bed)', () => {
    expect(minimumWholeDwellingRateContinuousM3h(150, 4)).toBeCloseTo(162.0, 5);
  });

  // upstream: test_one_habitable_room (line 506)
  it('background area continuous: 1 habitable room → 40 cm²', () => {
    expect(minimumBackgroundAreaContinuousCm2(1)).toBe(40);
  });

  // upstream: test_five_habitable_rooms (line 512)
  it('background area continuous: 5 habitable rooms → 200 cm²', () => {
    expect(minimumBackgroundAreaContinuousCm2(5)).toBe(200);
  });

  // upstream: test_no_bedrooms (line 518)
  it('background count continuous: 0 bedrooms → 2 vents', () => {
    expect(minimumBackgroundCountContinuous(0)).toBe(2);
  });

  // upstream: test_five_bedrooms (line 525)
  it('background count continuous: 5 bedrooms → 7 vents', () => {
    expect(minimumBackgroundCountContinuous(5)).toBe(7);
  });

  it('background count intermittent: <2 bedrooms → 4 vents (Part F §1.57)', () => {
    expect(minimumBackgroundCountIntermittent(0)).toBe(4);
    expect(minimumBackgroundCountIntermittent(1)).toBe(4);
    expect(minimumBackgroundCountIntermittent(2)).toBe(5);
    expect(minimumBackgroundCountIntermittent(5)).toBe(5);
  });

  it('kitchen extract minimum: 30 l/s if external, 60 l/s if not', () => {
    expect(minimumKitchenVentFlowRateLs(true)).toBe(30);
    expect(minimumKitchenVentFlowRateLs(false)).toBe(60);
  });

  it('background area intermittent: 5 hab + 2 bath, 1 storey → 5*100 + 2*40 + 100 = 680', () => {
    expect(minimumBackgroundAreaIntermittentCm2(5, 2, 1)).toBe(680);
  });

  it('background area intermittent: 5 hab + 2 bath, 2 storey → 5*80 + 2*40 + 80 = 560', () => {
    expect(minimumBackgroundAreaIntermittentCm2(5, 2, 2)).toBe(560);
  });

  it('whole-dwelling intermittent: 2 bath + 0 utility + 0 sanitary + 30 (kitchen ext) = 60 l/s → 216 m³/h', () => {
    expect(minimumWholeDwellingRateIntermittentM3h(2, 0, 0, true)).toBeCloseTo(216, 5);
  });
});

// ---------------- pathway parity (mirror of upstream test cases) ----------------

describe('Part F pathway parity', () => {
  // upstream: test_does_not_raise_if_sufficient_cmev_and_background_vents (line 533)
  it('cMEV + 3×100 cm² vents passes (100 m², 1 bed, 5 hab, 3 wet, 2 bath)', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 3,
      bathrooms: 2,
      vents: [makeVent(100), makeVent(100), makeVent(100)],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 133.2)],
    });
    expect(evaluatePartF(input)).toHaveLength(0);
  });

  // upstream: test_raises_if_sufficient_cmev_but_insufficient_background_vents (line 577)
  it('cMEV alone, no vents → raises both background area + count', () => {
    const input = baseInput({
      bedrooms: 4,
      habitableRooms: 5,
      vents: [],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 133.2)],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    expect(rules).toContain('background_area_continuous');
    expect(rules).toContain('background_count_continuous');
  });

  // upstream: test_raises_if_no_mechanical_vents (line 607) — we DON'T emit our own
  // finding here because detectMissingElements.ts already covers the "no MV" case.
  it('no mechanical vents → empty findings (handled by detectMissingElements)', () => {
    const input = baseInput({
      vents: [makeVent(100), makeVent(100)],
      mechanicalVentilation: [],
    });
    expect(evaluatePartF(input)).toHaveLength(0);
  });

  // upstream: test_raises_if_neither_background_nor_cmev_ventilation_sufficient (line 642)
  it('underflowing cMEV + no vents → raises whole-dwelling + background area + count', () => {
    const input = baseInput({
      bedrooms: 4,
      habitableRooms: 5,
      vents: [],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 50)],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    expect(rules).toContain('whole_dwelling_continuous');
    expect(rules).toContain('background_area_continuous');
    expect(rules).toContain('background_count_continuous');
  });

  // upstream: test_does_not_raise_if_sufficient_mvhr_and_no_background_vents (line 677)
  it('sufficient MVHR + no vents passes', () => {
    const input = baseInput({
      vents: [],
      mechanicalVentilation: [makeMv('MVHR', 133.2)],
    });
    expect(evaluatePartF(input)).toHaveLength(0);
  });

  it('MVHR + any background vents → mvhr_no_background_vents conflict', () => {
    const input = baseInput({
      vents: [makeVent(80)],
      mechanicalVentilation: [makeMv('MVHR', 133.2)],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    expect(rules).toContain('mvhr_no_background_vents');
  });

  it('iMEV count below wet rooms triggers imev_count', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 3,
      bathrooms: 2,
      storeys: 2,
      vents: Array.from({ length: 5 }, () => makeVent(150)),
      mechanicalVentilation: [makeMv('Intermittent MEV', 200)],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    expect(rules).toContain('imev_count');
  });

  it('iMEV count meets wet rooms but largest under kitchen threshold → large_imev', () => {
    // kitchen external = 30 l/s = 108 m³/h
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 2,
      bathrooms: 2,
      storeys: 2,
      isKitchenVentExternal: true,
      vents: Array.from({ length: 5 }, () => makeVent(150)),
      mechanicalVentilation: [makeMv('Intermittent MEV', 100), makeMv('Intermittent MEV', 100)],
    });
    expect(findRule(input, 'large_imev')).toBeTruthy();
  });

  it('iMEV with one large unit ≥ kitchen threshold passes large_imev', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 2,
      bathrooms: 2,
      storeys: 2,
      isKitchenVentExternal: true,
      vents: Array.from({ length: 5 }, () => makeVent(150)),
      mechanicalVentilation: [makeMv('Intermittent MEV', 110), makeMv('Intermittent MEV', 100)],
    });
    expect(findRule(input, 'large_imev')).toBeFalsy();
  });

  it('decentralised cMEV without centralised: count enforced vs wet rooms', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 4,
      bathrooms: 2,
      vents: Array.from({ length: 5 }, () => makeVent(80)),
      mechanicalVentilation: [
        makeMv('Decentralised continuous MEV', 50),
        makeMv('Decentralised continuous MEV', 50),
      ],
    });
    expect(findRule(input, 'decentralised_cmev_count')).toBeTruthy();
  });

  it('decentralised + centralised mix: decentralised count not enforced', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 4,
      bathrooms: 2,
      vents: Array.from({ length: 5 }, () => makeVent(80)),
      mechanicalVentilation: [
        makeMv('Centralised continuous MEV', 100),
        makeMv('Decentralised continuous MEV', 50),
      ],
    });
    expect(findRule(input, 'decentralised_cmev_count')).toBeFalsy();
  });

  it('OR-of-pathways: both pathways present, intermittent passes → no findings', () => {
    // 1-bed dwelling, 4 hab rooms; intermittent area threshold (4*80+2*40+80 = 480)
    // is hit by 6×100 = 600. iMEV count = 3 ≥ 3 wet rooms, large iMEV present.
    // cMEV pathway is short on flow → would normally fire — but intermittent passes.
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 4,
      wetRooms: 3,
      bathrooms: 1,
      utilityRooms: 0,
      sanitaryAccommodations: 1,
      storeys: 2,
      isKitchenVentExternal: true,
      vents: Array.from({ length: 6 }, () => makeVent(100)),
      mechanicalVentilation: [
        // Intermittent: 3 iMEV, large enough kitchen
        makeMv('Intermittent MEV', 110),
        makeMv('Intermittent MEV', 60),
        makeMv('Intermittent MEV', 60),
        // Continuous: tiny, would fail on its own
        makeMv('Centralised continuous MEV', 5),
      ],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    // Whole-dwelling continuous extract is "always" evaluated when continuous mech is present.
    // cMEV is undersize → that one IS surfaced.
    expect(rules).toContain('whole_dwelling_continuous');
    // …but pathway-scoped continuous rules are suppressed because intermittent passed.
    expect(rules).not.toContain('background_count_continuous');
    expect(rules).not.toContain('decentralised_cmev_count');
  });

  it('OR-of-pathways: both fail → both pathways surface', () => {
    // intermittent fails (small iMEV, no large), continuous fails (no vents).
    const input = baseInput({
      bedrooms: 4,
      habitableRooms: 5,
      wetRooms: 3,
      bathrooms: 2,
      vents: [],
      mechanicalVentilation: [
        makeMv('Intermittent MEV', 5),
        makeMv('Centralised continuous MEV', 50),
      ],
    });
    const rules = evaluatePartF(input).map((f) => f.rule);
    expect(rules).toContain('whole_dwelling_intermittent');
    expect(rules).toContain('background_count_continuous');
  });
});

// ---------------- false-positive guards ----------------

describe('Part F false-positive guards', () => {
  const realElement = (): Element => ({
    id: 'real-1',
    name: 'Wall',
    type: 'BuildingElementOpaque',
    width: 1,
    height: 1,
    area: 1,
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
  } as Element);

  it('returns null when compliance validation is disabled', () => {
    const result = makePartFInputFromShape({
      complianceValidationEnabled: false,
      bedrooms: 4, habitableRooms: 5, wetRooms: 3, bathrooms: 2,
      utilityRooms: 0, sanitaryAccommodations: 0, storeys: 2,
      totalFloorAreaM2: 100,
      elements: [realElement()],
    });
    expect(result).toBeNull();
  });

  it('returns null when any required dwelling count is missing', () => {
    const result = makePartFInputFromShape({
      complianceValidationEnabled: true,
      bedrooms: 4,
      // habitableRooms intentionally omitted
      wetRooms: 3, bathrooms: 2, utilityRooms: 0, sanitaryAccommodations: 0, storeys: 2,
      totalFloorAreaM2: 100,
      elements: [realElement()],
    });
    expect(result).toBeNull();
  });

  it('returns null when there are no real elements (placeholder-only model)', () => {
    const placeholder = { ...realElement(), isPlaceholder: true } as Element;
    const result = makePartFInputFromShape({
      complianceValidationEnabled: true,
      bedrooms: 4, habitableRooms: 5, wetRooms: 3, bathrooms: 2,
      utilityRooms: 0, sanitaryAccommodations: 0, storeys: 2,
      totalFloorAreaM2: 100,
      elements: [placeholder],
    });
    expect(result).toBeNull();
  });

  it('placeholder Vents and MV are filtered out of input', () => {
    const real = realElement();
    const placeholderVent = { ...makeVent(999), isPlaceholder: true } as Element;
    const placeholderMv = {
      ...makeMv('MVHR', 999),
      isPlaceholder: true,
    } as Element;
    const result = makePartFInputFromShape({
      complianceValidationEnabled: true,
      bedrooms: 4, habitableRooms: 5, wetRooms: 3, bathrooms: 2,
      utilityRooms: 0, sanitaryAccommodations: 0, storeys: 2,
      totalFloorAreaM2: 100,
      elements: [real, placeholderVent, placeholderMv],
    });
    expect(result).not.toBeNull();
    expect(result!.vents).toHaveLength(0);
    expect(result!.mechanicalVentilation).toHaveLength(0);
  });

  it('zero habitable rooms → background area threshold is 0, no false-positive', () => {
    const input = baseInput({
      habitableRooms: 0,
      vents: [],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 200)],
    });
    expect(findRule(input, 'background_area_continuous')).toBeFalsy();
  });

  it('vent area exactly equal to threshold is sufficient (not a false positive)', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      vents: [makeVent(100), makeVent(100)], // 200, exactly the 5*40 threshold
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 200)],
    });
    expect(findRule(input, 'background_area_continuous')).toBeFalsy();
  });

  it('MV flow exactly at threshold passes whole_dwelling_continuous', () => {
    const input = baseInput({
      bedrooms: 4,
      totalFloorAreaM2: 100,
      vents: Array.from({ length: 6 }, () => makeVent(50)),
      // bedroom term dominates: 13 + 4*6 = 37 l/s = 133.2 m³/h
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 133.2)],
    });
    expect(findRule(input, 'whole_dwelling_continuous')).toBeFalsy();
  });

  it('iMEV exactly at wet-room count is sufficient', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      wetRooms: 2,
      bathrooms: 2,
      storeys: 2,
      vents: Array.from({ length: 5 }, () => makeVent(150)),
      mechanicalVentilation: [
        makeMv('Intermittent MEV', 110),
        makeMv('Intermittent MEV', 60),
      ],
    });
    expect(findRule(input, 'imev_count')).toBeFalsy();
  });

  it('non-finite MV flow (no extra_json) is treated as 0 — no NaN findings', () => {
    const noFlowMv: MechanicalVentilation = {
      id: newId(),
      name: 'mv-no-flow',
      type: 'MechanicalVentilation',
      vent_type: 'Centralised continuous MEV',
      parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const input = baseInput({
      mechanicalVentilation: [noFlowMv],
    });
    const wd = findRule(input, 'whole_dwelling_continuous');
    expect(wd).toBeTruthy();
    expect(Number.isFinite(wd!.supplied)).toBe(true);
    expect(wd!.supplied).toBe(0);
  });

  it('MV without explicit design_outdoor_air_flow_rate uses passed-in defaults', () => {
    // Mirrors live editor state: user adds a cMEV but hasn't typed a flow rate yet —
    // defaults file supplies 80 m³/h. Validation must use 80, not 0, otherwise it
    // wrongly reports the dwelling under-extracts when the simulation would actually pass.
    // Now pure: defaults pass through the function arg, no global cache.
    const liveMv: MechanicalVentilation = {
      id: newId(),
      name: 'mv-no-flow',
      type: 'MechanicalVentilation',
      vent_type: 'Centralised continuous MEV',
      parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const partFInput = partFInputFromContext(
      {
        totalFloorAreaM2: 50,
        bedrooms: 1,
        habitableRooms: 5,
        wetRooms: 1,
        bathrooms: 1,
        utilityRooms: 0,
        sanitaryAccommodations: 0,
        storeys: 1,
        isKitchenVentExternal: true,
      },
      [liveMv, ...Array.from({ length: 5 }, () => makeVent(150))],
      {
        mechVentFlowFor: (vt) =>
          vt === 'Centralised continuous MEV' ? 80 : undefined,
      },
    );
    expect(partFInput).not.toBeNull();
    const findings = evaluatePartF(partFInput!);
    expect(findings.find((f) => f.rule === 'whole_dwelling_continuous')).toBeFalsy();
  });

  it('Vents without explicit area_cm2 uses passed-in defaults', () => {
    const blankVent: Vents = {
      id: newId(),
      name: 'blank',
      type: 'Vents',
      area_cm2: 0,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const partFInput = partFInputFromContext(
      {
        totalFloorAreaM2: 50,
        bedrooms: 0,
        habitableRooms: 2,
        wetRooms: 1,
        bathrooms: 1,
        utilityRooms: 0,
        sanitaryAccommodations: 0,
        storeys: 1,
        isKitchenVentExternal: true,
      },
      [
        blankVent,
        { ...blankVent, id: newId(), name: 'blank-2' },
        {
          id: newId(),
          name: 'cmev',
          type: 'MechanicalVentilation',
          vent_type: 'Centralised continuous MEV',
          parent_element: null,
          coordinates: [{ x: 0, y: 0, z: 0 }],
          isPlaceholder: false,
          extra_json: { design_outdoor_air_flow_rate: 200 },
        },
      ],
      { ventArea: 100 },
    );
    expect(partFInput).not.toBeNull();
    const findings = evaluatePartF(partFInput!);
    expect(findings.find((f) => f.rule === 'background_area_continuous')).toBeFalsy();
  });

  it('partFInputFromContext is pure when defaults arg is omitted (no global cache read)', () => {
    // Live cMEV with no flow + no defaults passed → supplied flow is 0, finding fires.
    const liveMv: MechanicalVentilation = {
      id: newId(),
      name: 'mv-no-flow',
      type: 'MechanicalVentilation',
      vent_type: 'Centralised continuous MEV',
      parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const partFInput = partFInputFromContext(
      {
        totalFloorAreaM2: 50,
        bedrooms: 1,
        habitableRooms: 5,
        wetRooms: 1,
        bathrooms: 1,
        utilityRooms: 0,
        sanitaryAccommodations: 0,
        storeys: 1,
        isKitchenVentExternal: true,
      },
      [liveMv, ...Array.from({ length: 5 }, () => makeVent(150))],
    );
    const findings = evaluatePartF(partFInput!);
    const wd = findings.find((f) => f.rule === 'whole_dwelling_continuous');
    expect(wd).toBeTruthy();
    expect(wd!.supplied).toBe(0);
  });

  it('one Vents element + insufficient area: per-element issue gets the vent id', () => {
    const v = makeVent(50);
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      vents: [v],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 200)],
    });
    const finding = findRule(input, 'background_area_continuous');
    expect(finding).toBeTruthy();
    expect(finding!.affectedElementIds).toEqual([v.id]);
  });

  it('multiple Vents + insufficient area: dwelling-wide (no affected element ids)', () => {
    const input = baseInput({
      bedrooms: 1,
      habitableRooms: 5,
      vents: [makeVent(40), makeVent(40)],
      mechanicalVentilation: [makeMv('Centralised continuous MEV', 200)],
    });
    const finding = findRule(input, 'background_area_continuous');
    expect(finding).toBeTruthy();
    expect(finding!.affectedElementIds).toEqual([]);
  });
});

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  arealHeatCapacityBandFromJPerM2K,
  arealHeatCapacityJPerM2KFromBand,
  arealHeatCapacityParallelSolidLayer,
  areaFractionFromBridgeDefinition,
  computeSuspendedGroundFloorConstructionMeansFromVoid,
  convertUvalueToResistance,
  computeOpaqueUAndTotals,
  equivalentResistanceParallelSolidLayer,
  moveLayerToGap,
  normalizeAssemblyLayers,
  R_SE,
  R_SI_DOWNWARDS,
  R_SI_UPWARDS,
  resistanceFromSolidLayer,
  rSiForPitch,
  resolveFabricArealHeatCapacityForElement,
  snapToNearestFhsArealHeatCapacity,
  sumAssemblyArealHeatCapacity,
  computeIso6946CombinedConstructionResistance,
  ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO,
  iso6946Formula10MaxRelativeErrorPercent,
  sumConstructionResistance,
  sumConstructionResistanceSeriesOnly,
  validateAssemblyLayerLayout,
  volumetricHeatCapacityJPerM3K,
} from '../assemblyCalculator';
import type { AssemblyLayer, AssemblyLayerSolid, MaterialRow } from '../assemblyTypes';

describe('assemblyCalculator — hem_engine parity', () => {
  it('convertUvalueToResistance matches hem_engine test (u=2, pitch=40)', () => {
    expect(convertUvalueToResistance(2, 40)).toBeCloseTo(0.35985829616804244, 12);
  });

  it('rSiForPitch: vertical wall 90° uses horizontal R_si', () => {
    const r90 = rSiForPitch(90);
    const rHoriz = rSiForPitch(60);
    expect(r90).toBe(rHoriz);
  });

  it('rSiForPitch: roof (low pitch) uses upward R_si; floor uses downward', () => {
    expect(rSiForPitch(30)).toBe(R_SI_UPWARDS);
    expect(rSiForPitch(130)).toBe(R_SI_DOWNWARDS);
  });

  it('computeOpaqueUAndTotals: simple wall', () => {
    const rLayers = 2.0;
    const { u, rTot, rSi, rSe } = computeOpaqueUAndTotals(rLayers, 90);
    expect(rSe).toBe(R_SE);
    const expectedU = 1 / (rSi + rLayers + rSe);
    expect(u).toBeCloseTo(expectedU, 10);
    expect(rTot).toBeCloseTo(rSi + rLayers + rSe, 10);
  });
});

describe('areal heat capacity', () => {
  it('volumetricHeatCapacityJPerM3K from ρ and c', () => {
    const m: MaterialRow = {
      id: 'x',
      name: 'X',
      shortName: 'X',
      lambda_W_mK: 1,
      density_kg_m3: 1000,
      specific_heat_J_kg_K: 840,
    };
    expect(volumetricHeatCapacityJPerM3K(m)).toBeCloseTo(840000, 6);
  });

  it('volumetricHeatCapacityJPerM3K from MJ tabulated', () => {
    const m: MaterialRow = {
      id: 'x',
      name: 'X',
      shortName: 'X',
      lambda_W_mK: 1,
      volumetric_heat_capacity_MJ_m3K: 1.5,
    };
    expect(volumetricHeatCapacityJPerM3K(m)).toBeCloseTo(1.5e6, 6);
  });

  it('sumAssemblyArealHeatCapacity: brick layer + cavity', () => {
    const brick: MaterialRow = {
      id: 'b',
      name: 'Brick',
      shortName: 'Brick',
      lambda_W_mK: 0.77,
      density_kg_m3: 1700,
      specific_heat_J_kg_K: 800,
    };
    const materials = new Map<string, MaterialRow>([['b', brick]]);
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'c', fixedResistance_m2K_W: 0.18 },
    ];
    const { jPerM2K, errors } = sumAssemblyArealHeatCapacity(layers, materials);
    expect(errors.length).toBe(0);
    const cv = 1700 * 800;
    expect(jPerM2K).toBeCloseTo(0.1 * cv, 6);
  });

  it('arealHeatCapacityParallelSolidLayer matches area-weighted Cv × d', () => {
    const insul: MaterialRow = {
      id: 'ins',
      name: 'Ins',
      shortName: 'Ins',
      lambda_W_mK: 0.04,
      density_kg_m3: 30,
      specific_heat_J_kg_K: 1000,
    };
    const timber: MaterialRow = {
      id: 'tim',
      name: 'Timber',
      shortName: 'Timber',
      lambda_W_mK: 0.13,
      density_kg_m3: 513,
      specific_heat_J_kg_K: 1381,
    };
    const mats = new Map<string, MaterialRow>([
      ['ins', insul],
      ['tim', timber],
    ]);
    const layer: AssemblyLayer = {
      kind: 'solid',
      materialId: 'ins',
      thickness_m: 0.1,
      repeatingBridges: [
        {
          id: '1',
          bridgeMaterialId: 'tim',
          definition: { mode: 'framing_fraction', framingFraction: 0.15 },
        },
      ],
    };
    const { jPerM2K, errors } = arealHeatCapacityParallelSolidLayer(layer, mats);
    expect(errors.length).toBe(0);
    const CvIns = 30 * 1000;
    const CvTim = 513 * 1381;
    const weighted = 0.85 * CvIns + 0.15 * CvTim;
    expect(jPerM2K).toBeCloseTo(0.1 * weighted, 6);
  });
});

describe('FHS areal heat capacity bands', () => {
  it('snapToNearestFhsArealHeatCapacity picks nearest band (ties → smaller)', () => {
    expect(snapToNearestFhsArealHeatCapacity(60_000)).toBe(50_000);
    expect(snapToNearestFhsArealHeatCapacity(62_500)).toBe(50_000);
    expect(snapToNearestFhsArealHeatCapacity(62_501)).toBe(75_000);
    expect(snapToNearestFhsArealHeatCapacity(92_500)).toBe(75_000);
    expect(snapToNearestFhsArealHeatCapacity(92_501)).toBe(110_000);
  });

  it('resolveFabricArealHeatCapacityForElement rounds when FHS snap off', () => {
    expect(resolveFabricArealHeatCapacityForElement(114_450.2, false)).toBe(114_450);
  });

  it('resolveFabricArealHeatCapacityForElement snaps when FHS snap on', () => {
    expect(resolveFabricArealHeatCapacityForElement(114_450, true)).toBe('Medium');
  });

  it('maps areal heat capacity bands to and from J/(m²·K)', () => {
    expect(arealHeatCapacityBandFromJPerM2K(110_000)).toBe('Medium');
    expect(arealHeatCapacityJPerM2KFromBand('Medium')).toBe(110_000);
    expect(arealHeatCapacityJPerM2KFromBand(110_000)).toBe(110_000);
  });
});

describe('sumConstructionResistance', () => {
  const brick: MaterialRow = {
    id: 'b',
    name: 'Brick',
    shortName: 'Brick',
    lambda_W_mK: 0.77,
  };
  const materials = new Map<string, MaterialRow>([['b', brick]]);
  const cavities = new Map<string, number>([['unventilated_wall_cavity_high_emissivity', 0.18]]);

  it('sums solid and cavity', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'unventilated_wall_cavity_high_emissivity', fixedResistance_m2K_W: 0.18 },
    ];
    const { rLayers, errors } = sumConstructionResistance(layers, materials, cavities);
    expect(errors.length).toBe(0);
    expect(rLayers).toBeCloseTo(0.1 / 0.77 + 0.18, 8);
  });

  it('well ventilated cavity omits itself and outer layers from construction resistance', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      {
        kind: 'cavity',
        ventilation: 'well_ventilated',
        gap_thickness_m: 0.05,
        surface_emissivity: 'high',
      },
      { kind: 'solid', materialId: 'b', thickness_m: 0.02 },
    ];
    const { rLayers, errors } = sumConstructionResistance(layers, materials, cavities, 90);
    expect(errors).toEqual([]);
    expect(rLayers).toBeCloseTo(0.1 / 0.77, 8);
  });

  const insul: MaterialRow = { id: 'ins', name: 'Ins', shortName: 'Ins', lambda_W_mK: 0.04 };
  const timber: MaterialRow = { id: 'tim', name: 'Timber', shortName: 'Timber', lambda_W_mK: 0.13 };
  const matsParallel = new Map<string, MaterialRow>([
    ['ins', insul],
    ['tim', timber],
  ]);

  it('parallel-path solid layer: 85% insulation 15% timber same thickness', () => {
    const layer: AssemblyLayer = {
      kind: 'solid',
      materialId: 'ins',
      thickness_m: 0.1,
      repeatingBridges: [
        {
          id: '1',
          bridgeMaterialId: 'tim',
          definition: { mode: 'framing_fraction', framingFraction: 0.15 },
        },
      ],
    };
    const { r, errors } = equivalentResistanceParallelSolidLayer(layer, matsParallel);
    expect(errors.length).toBe(0);
    const Rins = 0.1 / 0.04;
    const Rtim = 0.1 / 0.13;
    const G = 0.85 / Rins + 0.15 / Rtim;
    expect(r).toBeCloseTo(1 / G, 8);
  });

  it('rejects total bridge fraction over 100%', () => {
    const layer: AssemblyLayer = {
      kind: 'solid',
      materialId: 'ins',
      thickness_m: 0.1,
      repeatingBridges: [
        {
          id: '1',
          bridgeMaterialId: 'tim',
          definition: { mode: 'framing_fraction', framingFraction: 0.6 },
        },
        {
          id: '2',
          bridgeMaterialId: 'tim',
          definition: { mode: 'framing_fraction', framingFraction: 0.5 },
        },
      ],
    };
    const { r, errors } = equivalentResistanceParallelSolidLayer(layer, matsParallel);
    expect(r).toBe(0);
    expect(errors.some((e) => e.includes('exceed'))).toBe(true);
  });

  it('sumConstructionResistanceSeriesOnly ignores bridges', () => {
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          {
            id: '1',
            bridgeMaterialId: 'tim',
            definition: { mode: 'framing_fraction', framingFraction: 0.15 },
          },
        ],
      },
    ];
    const par = sumConstructionResistance(layers, matsParallel, new Map());
    const ser = sumConstructionResistanceSeriesOnly(layers, matsParallel, new Map());
    expect(ser.rLayers).toBeCloseTo(0.1 / 0.04, 8);
    expect(par.rLayers).toBeLessThan(ser.rLayers);
  });

  it('full stack: inner leaf + cavity + bridged insulation leaf matches manual sum', () => {
    const inner: AssemblyLayer = { kind: 'solid', materialId: 'b', thickness_m: 0.1025 };
    const cav: AssemblyLayer = {
      kind: 'cavity',
      cavityType: 'unventilated_wall_cavity_high_emissivity',
      fixedResistance_m2K_W: 0.18,
    };
    const outerInsul: AssemblyLayer = {
      kind: 'solid',
      materialId: 'ins',
      thickness_m: 0.1,
      repeatingBridges: [
        {
          id: 't',
          bridgeMaterialId: 'tim',
          definition: { mode: 'framing_fraction', framingFraction: 0.12 },
        },
      ],
    };
    const layers = [inner, cav, outerInsul];
    const mats = new Map<string, MaterialRow>([
      ['b', { id: 'b', name: 'Brick', shortName: 'Brick', lambda_W_mK: 0.77 }],
      ['ins', insul],
      ['tim', timber],
    ]);
    const { rLayers, errors } = sumConstructionResistance(layers, mats, cavities);
    expect(errors.length).toBe(0);
    const rInner = 0.1025 / 0.77;
    const { r: rOuterPar } = equivalentResistanceParallelSolidLayer(outerInsul, mats);
    expect(rLayers).toBeCloseTo(rInner + 0.18 + rOuterPar, 7);
  });

  it('sumConstructionResistance: cavity without valid R reports error', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'unknown_type_xyz', fixedResistance_m2K_W: 0 },
    ];
    const { errors } = sumConstructionResistance(layers, materials, new Map());
    expect(errors.some((e) => e.includes('no valid'))).toBe(true);
  });

  it('opaque U: bridged construction has higher U (lower R) than series-only clear field', () => {
    const insul: MaterialRow = { id: 'ins', name: 'Ins', shortName: 'Ins', lambda_W_mK: 0.04 };
    const timber: MaterialRow = { id: 'tim', name: 'Timber', shortName: 'Timber', lambda_W_mK: 0.13 };
    const mats = new Map<string, MaterialRow>([
      ['b', brick],
      ['ins', insul],
      ['tim', timber],
    ]);
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: '1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.2 } },
        ],
      },
    ];
    const par = sumConstructionResistance(layers, mats, new Map());
    const ser = sumConstructionResistanceSeriesOnly(layers, mats, new Map());
    const uPar = computeOpaqueUAndTotals(par.rLayers, 90).u;
    const uSer = computeOpaqueUAndTotals(ser.rLayers, 90).u;
    expect(uPar).toBeGreaterThan(uSer);
  });
});

describe('suspended ground floor void split', () => {
  it('uses a ventilated cavity as the underfloor void and splits R_f / R_g around it', () => {
    const materials = new Map<string, MaterialRow>([
      ['deck', { id: 'deck', name: 'Deck', shortName: 'Deck', lambda_W_mK: 0.13 }],
      ['ins', { id: 'ins', name: 'Insulation', shortName: 'Ins', lambda_W_mK: 0.04 }],
      ['slab', { id: 'slab', name: 'Slab', shortName: 'Slab', lambda_W_mK: 1.2 }],
    ]);
    const out = computeSuspendedGroundFloorConstructionMeansFromVoid(
      [
        { kind: 'solid', materialId: 'deck', thickness_m: 0.025 },
        { kind: 'solid', materialId: 'ins', thickness_m: 0.1 },
        {
          kind: 'cavity',
          ventilation: 'well_ventilated',
          gap_thickness_m: 0.15,
          surface_emissivity: 'high',
        },
        { kind: 'solid', materialId: 'slab', thickness_m: 0.05 },
      ],
      materials,
      new Map(),
      180,
    );

    expect(out.errors).toEqual([]);
    expect(out.hasVentilatedVoid).toBe(true);
    expect(out.heightUpperSurfaceM).toBeCloseTo(0.15, 6);
    expect(out.rfLayers).toHaveLength(2);
    expect(out.rgLayers).toHaveLength(1);
    expect(out.rfMean_m2K_W).toBeCloseTo((0.025 / 0.13 + 0.1 / 0.04), 6);
    expect(out.rgMean_m2K_W).toBeCloseTo(0.05 / 1.2, 6);
  });
});

describe('equivalentResistanceParallelSolidLayer — errors and two bridges', () => {
  const insul: MaterialRow = { id: 'ins', name: 'Ins', shortName: 'Ins', lambda_W_mK: 0.04 };
  const timber: MaterialRow = { id: 'tim', name: 'Timber', shortName: 'Timber', lambda_W_mK: 0.13 };
  const steel: MaterialRow = { id: 'stl', name: 'Steel', shortName: 'Steel', lambda_W_mK: 50 };
  const mats = new Map<string, MaterialRow>([
    ['ins', insul],
    ['tim', timber],
    ['stl', steel],
  ]);

  it('no bridges equals homogeneous R = d/lambda', () => {
    const layer: AssemblyLayer = { kind: 'solid', materialId: 'ins', thickness_m: 0.09 };
    const { r, errors } = equivalentResistanceParallelSolidLayer(layer, mats);
    expect(errors.length).toBe(0);
    expect(r).toBeCloseTo(0.09 / 0.04, 10);
  });

  it('unknown base material returns error', () => {
    const layer: AssemblyLayer = { kind: 'solid', materialId: 'missing', thickness_m: 0.1 };
    const { r, errors } = equivalentResistanceParallelSolidLayer(layer, mats);
    expect(r).toBe(0);
    expect(errors.some((e) => e.includes('base'))).toBe(true);
  });

  it('two bridge rows: conductances add', () => {
    const layer: AssemblyLayer = {
      kind: 'solid',
      materialId: 'ins',
      thickness_m: 0.1,
      repeatingBridges: [
        { id: '1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.1 } },
        { id: '2', bridgeMaterialId: 'stl', definition: { mode: 'framing_fraction', framingFraction: 0.02 } },
      ],
    };
    const { r, errors } = equivalentResistanceParallelSolidLayer(layer, mats);
    expect(errors.length).toBe(0);
    const Rins = 0.1 / 0.04;
    const Rtim = 0.1 / 0.13;
    const Rstl = 0.1 / 50;
    const G = 0.88 / Rins + 0.1 / Rtim + 0.02 / Rstl;
    expect(r).toBeCloseTo(1 / G, 7);
  });
});

describe('areaFractionFromBridgeDefinition', () => {
  it('spacing_width: width/spacing', () => {
    const { fraction, error } = areaFractionFromBridgeDefinition({
      mode: 'spacing_width',
      spacing_m: 0.6,
      width_m: 0.045,
    });
    expect(error).toBeUndefined();
    expect(fraction).toBeCloseTo(0.075, 10);
  });

  it('framing_fraction: rejects zero or > 1', () => {
    expect(areaFractionFromBridgeDefinition({ mode: 'framing_fraction', framingFraction: 0 }).error).toBeDefined();
    expect(areaFractionFromBridgeDefinition({ mode: 'framing_fraction', framingFraction: 1.01 }).error).toBeDefined();
  });

  it('spacing_width: rejects width > spacing or non-positive inputs', () => {
    expect(
      areaFractionFromBridgeDefinition({ mode: 'spacing_width', spacing_m: 0.5, width_m: 0.6 }).error,
    ).toBeDefined();
    expect(
      areaFractionFromBridgeDefinition({ mode: 'spacing_width', spacing_m: 0, width_m: 0.1 }).error,
    ).toBeDefined();
  });
});

describe('normalizeAssemblyLayers', () => {
  it('adds stable id to bridge rows missing id', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'x',
        thickness_m: 0.1,
        repeatingBridges: [{ id: '', bridgeMaterialId: 'y', definition: { mode: 'framing_fraction', framingFraction: 0.1 } }],
      },
    ];
    const out = normalizeAssemblyLayers(layers);
    const b = (out[0] as AssemblyLayerSolid).repeatingBridges?.[0];
    expect(b?.id?.startsWith('bridge-migrated-0-')).toBe(true);
    vi.restoreAllMocks();
  });

  it('preserves existing bridge id', () => {
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'x',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'keep-me', bridgeMaterialId: 'y', definition: { mode: 'framing_fraction', framingFraction: 0.1 } },
        ],
      },
    ];
    expect(normalizeAssemblyLayers(layers)[0]).toEqual(layers[0]);
  });
});

describe('validateAssemblyLayerLayout', () => {
  const solid: AssemblyLayer = { kind: 'solid', materialId: 'b', thickness_m: 0.1 };
  const cav: AssemblyLayer = {
    kind: 'cavity',
    cavityType: 'unventilated_wall_cavity_high_emissivity',
    fixedResistance_m2K_W: 0.18,
  };

  it('allows brick–cavity–brick', () => {
    const layers: AssemblyLayer[] = [solid, cav, { ...solid, thickness_m: 0.1 }];
    expect(validateAssemblyLayerLayout(layers)).toEqual([]);
  });

  it('rejects cavity on inside', () => {
    const err = validateAssemblyLayerLayout([cav, solid]);
    expect(err.some((m) => m.includes('innermost'))).toBe(true);
  });

  it('rejects cavity on outside', () => {
    const err = validateAssemblyLayerLayout([solid, cav]);
    expect(err.some((m) => m.includes('outermost'))).toBe(true);
  });

  it('rejects adjacent cavities', () => {
    const err = validateAssemblyLayerLayout([solid, cav, cav, solid]);
    expect(err.some((m) => m.includes('adjacent'))).toBe(true);
  });

  it('rejects only cavity', () => {
    const err = validateAssemblyLayerLayout([cav]);
    expect(err.length).toBeGreaterThan(0);
  });

  it('rejects solid without material', () => {
    const err = validateAssemblyLayerLayout([{ kind: 'solid', materialId: '', thickness_m: 0.1 }]);
    expect(err.some((m) => m.includes('select a material'))).toBe(true);
  });
});

describe('moveLayerToGap', () => {
  const L = (id: string): AssemblyLayer => ({ kind: 'solid', materialId: id, thickness_m: 0.1 });

  it('moves first to gap after last', () => {
    const layers = [L('a'), L('b'), L('c')];
    expect(moveLayerToGap(layers, 0, 3).map((x) => (x as AssemblyLayer & { kind: 'solid' }).materialId)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('moves last to gap before first', () => {
    const layers = [L('a'), L('b'), L('c')];
    expect(moveLayerToGap(layers, 2, 0).map((x) => (x as AssemblyLayer & { kind: 'solid' }).materialId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('moves middle item to gap after last (one step down past next)', () => {
    const layers = [L('a'), L('b'), L('c')];
    expect(moveLayerToGap(layers, 1, 3).map((x) => (x as AssemblyLayer & { kind: 'solid' }).materialId)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('no-ops on invalid indices', () => {
    const layers = [L('a'), L('b')];
    expect(moveLayerToGap(layers, -1, 1)).toBe(layers);
    expect(moveLayerToGap(layers, 0, 99)).toBe(layers);
  });
});

describe('ISO 6946 combined construction resistance', () => {
  const mats = new Map<string, MaterialRow>([
    ['lambda2', { id: 'lambda2', name: 'A', shortName: 'A', lambda_W_mK: 2 }],
    ['lambda1', { id: 'lambda1', name: 'B', shortName: 'B', lambda_W_mK: 1 }],
    ['ins', { id: 'ins', name: 'Ins', shortName: 'Ins', lambda_W_mK: 0.04 }],
    ['tim', { id: 'tim', name: 'Timber', shortName: 'Timber', lambda_W_mK: 0.13 }],
  ]);

  it('homogeneous stack: lower equals upper equals series sum', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    const series = 1 / 2 + 0.3 / 1;
    expect(iso.rConstructionLower_m2K_W).toBeCloseTo(series, 10);
    expect(iso.rConstructionUpper_m2K_W).toBeCloseTo(series, 10);
    expect(iso.rConstructionMean_m2K_W).toBeCloseTo(series, 10);
  });

  it('sandwich with one bridged layer: mean lies between lower and upper limits', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    const rLower = iso.rConstructionLower_m2K_W;
    const rUpper = iso.rConstructionUpper_m2K_W;
    expect(rUpper).toBeGreaterThan(rLower);
    expect(iso.rConstructionMean_m2K_W).toBeCloseTo((rLower + rUpper) / 2, 10);
  });

  it('rejects bridged layers with mismatched framing fractions', () => {
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b2', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.2 } },
        ],
      },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.some((e) => e.includes('fractions must match'))).toBe(true);
  });

  /**
   * ISO 6946:2017 — simplified method: inhomogeneous layers use the **arithmetic mean of the upper and
   * lower limits** of thermal resistance (see §6.4, referring to §6.7.2.2; local preview extract in repo:
   * `BR 497/ISO_6946_2017_extracted.txt` around the §6.4 bullets).
   *
   * Expected R′ / R″ below use the same `resistanceFromSolidLayer` primitives as production so floating-point
   * paths match: R′ — parallel paths in the bridged layer then series; R″ — column series then parallel.
   */
  it('golden: sandwich stack matches ISO 6946-style R′, R″, and mean (same primitives as implementation)', () => {
    const d = 0.1;
    const R_ins = resistanceFromSolidLayer(d, 0.04);
    const R_tim = resistanceFromSolidLayer(d, 0.13);
    const r1 = resistanceFromSolidLayer(1, 2);
    const r3 = resistanceFromSolidLayer(0.3, 1);
    const fClear = 0.85;
    const fTim = 0.15;
    const rLowerExpected = r1 + 1 / (fClear / R_ins + fTim / R_tim) + r3;
    const rUpperExpected = 1 / (fClear / (r1 + R_ins + r3) + fTim / (r1 + R_tim + r3));
    const rMeanExpected = (rLowerExpected + rUpperExpected) / 2;

    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    expect(iso.rConstructionLower_m2K_W).toBeCloseTo(rLowerExpected, 12);
    expect(iso.rConstructionUpper_m2K_W).toBeCloseTo(rUpperExpected, 12);
    expect(iso.rConstructionMean_m2K_W).toBeCloseTo(rMeanExpected, 12);
  });

  /** Single inhomogeneous layer: lower and upper limits coincide (one layer, two parallel paths). */
  it('golden: single bridged solid layer has R′ equal to R″', () => {
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    expect(iso.rConstructionLower_m2K_W).toBeCloseTo(iso.rConstructionUpper_m2K_W, 12);
    expect(iso.rConstructionMean_m2K_W).toBeCloseTo(iso.rConstructionLower_m2K_W, 12);
  });

  it('total U from mean construction R matches 1/(R_si + R_c + R_se) at 90° pitch', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    const { u, rTot } = computeOpaqueUAndTotals(iso.rConstructionMean_m2K_W, 90);
    const rSi = rSiForPitch(90);
    const expectedRtot = rSi + iso.rConstructionMean_m2K_W + R_SE;
    expect(rTot).toBeCloseTo(expectedRtot, 10);
    expect(u).toBeCloseTo(1 / expectedRtot, 10);
  });

  /** ISO 6946:2017 §6.6 — R_c,op = 1/U − R_si − R_se (same surface films as used for U). */
  it('§6.6: construction R round-trips through U at 90° pitch', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    const pitch = 90;
    const { u } = computeOpaqueUAndTotals(iso.rConstructionMean_m2K_W, pitch);
    const rBack = convertUvalueToResistance(u, pitch);
    expect(rBack).toBeCloseTo(iso.rConstructionMean_m2K_W, 10);
  });

  /** Annex formula (10): e = (R_tot,upper − R_tot,lower) / (2 R_tot) × 100 % with R_tot from the combined mean. */
  it('Annex formula (10): max relative error matches manual total-resistance form', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    const pitch = 90;
    const rSi = rSiForPitch(pitch);
    const rTot = rSi + iso.rConstructionMean_m2K_W + R_SE;
    const rTotU = rSi + iso.rConstructionUpper_m2K_W + R_SE;
    const rTotL = rSi + iso.rConstructionLower_m2K_W + R_SE;
    const eManual = ((rTotU - rTotL) / (2 * rTot)) * 100;
    expect(iso6946Formula10MaxRelativeErrorPercent(
      iso.rConstructionLower_m2K_W,
      iso.rConstructionUpper_m2K_W,
      iso.rConstructionMean_m2K_W,
      pitch,
    )).toBeCloseTo(eManual, 12);
    expect(eManual).toBeGreaterThan(0);
  });

  it('Annex formula (10): homogeneous stack has zero spread', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    expect(
      iso6946Formula10MaxRelativeErrorPercent(
        iso.rConstructionLower_m2K_W,
        iso.rConstructionUpper_m2K_W,
        iso.rConstructionMean_m2K_W,
        90,
      ),
    ).toBe(0);
  });

  /**
   * §6.7.2.1 — ratio of upper to lower construction resistance must not exceed 1.5 for the simplified
   * combined method. Synthetic high-conductivity bridge to force a wide spread.
   */
  it('§6.7.2.1: reports applicability error when upper/lower ratio exceeds 1.5', () => {
    const matsWide = new Map<string, MaterialRow>([
      ...Array.from(mats.entries()),
      ['highLambdaBridge', { id: 'highLambdaBridge', name: 'X', shortName: 'X', lambda_W_mK: 50 }],
    ]);
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'highLambdaBridge', definition: { mode: 'framing_fraction', framingFraction: 0.4 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, matsWide, new Map());
    expect(iso.rConstructionUpper_m2K_W / iso.rConstructionLower_m2K_W).toBeGreaterThan(
      ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO,
    );
    expect(iso.errors.some((e) => e.includes('6.7.2.1'))).toBe(true);
    expect(iso.errors.some((e) => e.includes(String(ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO)))).toBe(true);
  });

  it('§6.7.2.1: normal timber/insulation sandwich stays within ratio and has no applicability error', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'lambda2', thickness_m: 1 },
      {
        kind: 'solid',
        materialId: 'ins',
        thickness_m: 0.1,
        repeatingBridges: [
          { id: 'b1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.15 } },
        ],
      },
      { kind: 'solid', materialId: 'lambda1', thickness_m: 0.3 },
    ];
    const iso = computeIso6946CombinedConstructionResistance(layers, mats, new Map());
    expect(iso.errors.length).toBe(0);
    expect(iso.rConstructionUpper_m2K_W / iso.rConstructionLower_m2K_W).toBeLessThanOrEqual(
      ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO,
    );
  });
});

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  applyComputedGroundUValueAutofill,
  applyGroundThicknessWallsManualTracking,
  applySuspendedThermalTransmWallsManualTracking,
  assemblyTotalThicknessMFromOpaqueElement,
  computeWeightedExternalWallAssemblyThicknessDetails,
  computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement,
  computeWeightedExternalWallAssemblyThicknessForGroundElement,
  computeWeightedExternalWallAssemblyThicknessM,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
  GROUND_U_VALUE_MANUAL_KEY,
  syncGroundExposedPerimetersFromWalls,
  syncSuspendedGroundFabricFromWalls,
  THERMAL_TRANSM_WALLS_MANUAL_KEY,
  THICKNESS_WALLS_MANUAL_KEY,
  thicknessWallsManualFlag,
  totalSolidAssemblyThicknessMFromLayers,
  usesGroundThermalTransmWallsAutofill,
} from '../groundSuspendedFabricSync';
import { computeWeightedThermalTransmWallsFromZoneExternalWalls } from '../suspendedFloorThermalTransmWallsAutofill';
import {
  __resetDefaultsCacheForTests,
  __setDefaultsObjectForTests,
  createDefaultsLookup,
} from '../defaultsCache';

afterEach(() => {
  __resetDefaultsCacheForTests();
});

function minimalVulcanAssemblyV1(layers: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 1 as const,
    assemblyId: 'test-assembly',
    assemblySnapshot: {
      layers,
      pitchDegrees: 90,
      elementMode: 'BuildingElementOpaque' as const,
    },
    appliedAt: '2020-01-01T00:00:00.000Z',
    uncorrectedU_W_m2K: 0.35,
    correctedU_W_m2K: 0.35,
    thermalResistanceConstruction_m2K_W: 2.5,
    calculationEngineVersion: 'test',
  };
}

describe('usesGroundThermalTransmWallsAutofill', () => {
  it('matches only ground subtypes that use wall U-value autofill', () => {
    expect(usesGroundThermalTransmWallsAutofill('Suspended_floor')).toBe(true);
    expect(usesGroundThermalTransmWallsAutofill('Unheated_basement')).toBe(true);
    expect(usesGroundThermalTransmWallsAutofill('Slab_no_edge_insulation')).toBe(false);
    expect(usesGroundThermalTransmWallsAutofill(undefined)).toBe(false);
  });
});

describe('totalSolidAssemblyThicknessMFromLayers', () => {
  it('sums solid thickness and cavity gap thickness', () => {
    expect(
      totalSolidAssemblyThicknessMFromLayers([
        { kind: 'solid', materialId: 'm1', thickness_m: 0.1 },
        {
          kind: 'cavity',
          ventilation: 'unventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
        { kind: 'solid', materialId: 'm2', thickness_m: 0.09 },
      ] as any),
    ).toBeCloseTo(0.24, 6);
  });
});

describe('computeWeightedExternalWallAssemblyThicknessM', () => {
  it('returns area-weighted mean assembly thickness for vertical opaque walls in the zone', () => {
    const zoneId = 'z1';
    const wallA: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 10,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.3 }]),
      },
    } as any;
    const wallB: Element = {
      id: 'w2',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 88,
      area: 30,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.5 }]),
      },
    } as any;
    const t = computeWeightedExternalWallAssemblyThicknessM({ w1: wallA, w2: wallB }, zoneId);
    expect(t).toBeCloseTo((0.3 * 10 + 0.5 * 30) / 40, 2);
  });
});

describe('assemblyTotalThicknessMFromOpaqueElement', () => {
  it('returns null when no snapshot layers', () => {
    const el = { type: 'BuildingElementOpaque', extra_json: {} } as any;
    expect(assemblyTotalThicknessMFromOpaqueElement(el)).toBeNull();
  });
});

describe('applyComputedGroundUValueAutofill', () => {
  it('updates ground u_value from the computed value when it is auto-owned', () => {
    const out = applyComputedGroundUValueAutofill({ u_value: 0.4 }, 0.26789);
    expect(out.changed).toBe(true);
    expect(out.extra.u_value).toBe(0.2679);
  });

  it('does not overwrite a manually owned ground u_value', () => {
    const out = applyComputedGroundUValueAutofill(
      { u_value: 0.4, [GROUND_U_VALUE_MANUAL_KEY]: true },
      0.26789,
    );
    expect(out.changed).toBe(false);
    expect(out.extra.u_value).toBe(0.4);
    expect(out.extra[GROUND_U_VALUE_MANUAL_KEY]).toBe(true);
  });
});

describe('applySuspendedThermalTransmWallsManualTracking', () => {
  it('sets manual when thermal value changes to a finite number', () => {
    const out = applySuspendedThermalTransmWallsManualTracking(
      {},
      { thermal_transm_walls: 0.25 },
    );
    expect(out[THERMAL_TRANSM_WALLS_MANUAL_KEY]).toBe(true);
    expect(out.thermal_transm_walls).toBe(0.25);
  });

  it('clears manual when thermal is cleared', () => {
    const out = applySuspendedThermalTransmWallsManualTracking(
      { thermal_transm_walls: 0.2, [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true },
      { thermal_transm_walls: undefined },
    );
    expect(out[THERMAL_TRANSM_WALLS_MANUAL_KEY]).toBeUndefined();
  });

  it('clears manual when thermal matches the current automatic wall value', () => {
    const out = applySuspendedThermalTransmWallsManualTracking(
      { thermal_transm_walls: 0.11, [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true },
      { thermal_transm_walls: 0.25 },
      0.25,
    );
    expect(out[THERMAL_TRANSM_WALLS_MANUAL_KEY]).toBeUndefined();
    expect(out.thermal_transm_walls).toBe(0.25);
  });

  it('leaves manual untouched when thermal unchanged (JsonForms data preserves _ flags)', () => {
    const out = applySuspendedThermalTransmWallsManualTracking(
      { thermal_transm_walls: 0.2, [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true },
      {
        thermal_transm_walls: 0.2,
        shield_fact_location: 'Normal',
        [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true,
      },
    );
    expect(out[THERMAL_TRANSM_WALLS_MANUAL_KEY]).toBe(true);
  });
});

describe('applyGroundThicknessWallsManualTracking', () => {
  it('sets manual when thickness changes to a finite value different from auto', () => {
    const out = applyGroundThicknessWallsManualTracking({}, 0.18, 0.42);
    expect(out[THICKNESS_WALLS_MANUAL_KEY]).toBe(true);
  });

  it('clears manual when thickness is cleared', () => {
    const out = applyGroundThicknessWallsManualTracking(
      { [THICKNESS_WALLS_MANUAL_KEY]: true },
      '',
      0.42,
    );
    expect(out[THICKNESS_WALLS_MANUAL_KEY]).toBeUndefined();
  });

  it('clears manual when thickness matches the current automatic wall value', () => {
    const out = applyGroundThicknessWallsManualTracking(
      { [THICKNESS_WALLS_MANUAL_KEY]: true },
      0.42,
      0.42,
    );
    expect(out[THICKNESS_WALLS_MANUAL_KEY]).toBeUndefined();
  });
});

describe('syncSuspendedGroundFabricFromWalls', () => {
  it('uses the owning defaults lookup instead of ambient compatibility defaults', () => {
    __setDefaultsObjectForTests({
      ExposedElements: {
        wall: { type: 'BuildingElementOpaque', u_value: 9.99 },
      },
    });
    const defaultsLookup = createDefaultsLookup({
      ExposedElements: {
        wall: { type: 'BuildingElementOpaque', u_value: 0.18 },
      },
    });
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      floorId: '0',
      pitch: 90,
      area: 20,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floorId: '0',
      floor_type: 'Suspended_floor',
      extra_json: {},
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as any;
    const updateElement = vi.fn();

    syncSuspendedGroundFabricFromWalls({ w1: wall, g1: ground }, updateElement, defaultsLookup);

    expect(updateElement).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        extra_json: expect.objectContaining({ thermal_transm_walls: 0.18 }),
      }),
    );
  });

  it('updates thermal_transm_walls when wall U changes and manual is not set', () => {
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      floorId: '0',
      pitch: 90,
      area: 20,
      u_value: 0.5,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floorId: '0',
      floor_type: 'Suspended_floor',
      extra_json: {},
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as any;
    const map = { w1: wall, g1: ground };
    const updateElement = vi.fn();
    syncSuspendedGroundFabricFromWalls(map, updateElement);
    expect(updateElement).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        extra_json: expect.objectContaining({ thermal_transm_walls: 0.5 }),
      }),
    );
  });

  it('does not overwrite thermal_transm_walls when manual flag is set', () => {
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 20,
      u_value: 0.9,
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floor_type: 'Suspended_floor',
      extra_json: { thermal_transm_walls: 0.11, [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true },
    } as any;
    const updateElement = vi.fn();
    syncSuspendedGroundFabricFromWalls({ w1: wall, g1: ground }, updateElement);
    expect(updateElement).not.toHaveBeenCalled();
  });

  it('updates thermal_transm_walls for unheated basements from adjacent wall U', () => {
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      floorId: '0',
      pitch: 90,
      area: 20,
      u_value: 0.42,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floorId: '0',
      floor_type: 'Unheated_basement',
      extra_json: {},
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as any;
    const updateElement = vi.fn();
    syncSuspendedGroundFabricFromWalls({ w1: wall, g1: ground }, updateElement);
    expect(updateElement).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({
        extra_json: expect.objectContaining({ thermal_transm_walls: 0.42 }),
      }),
    );
  });

  it('updates thickness_walls from assemblies when thickness manual is not set', () => {
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 10,
      u_value: 0.4,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.44 }]),
      },
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floor_type: 'Suspended_floor',
      thickness_walls: 0.1,
      extra_json: { thermal_transm_walls: 0.4 },
    } as any;
    const updateElement = vi.fn();
    syncSuspendedGroundFabricFromWalls({ w1: wall, g1: ground }, updateElement);
    expect(updateElement).toHaveBeenCalled();
    const patch = updateElement.mock.calls[0][1] as any;
    expect(patch.thickness_walls).toBeCloseTo(0.44, 2);
    expect(thicknessWallsManualFlag(patch.extra_json)).toBe(false);
    const u = computeWeightedThermalTransmWallsFromZoneExternalWalls({ w1: wall, g1: ground }, zoneId);
    expect(patch.extra_json.thermal_transm_walls).toBe(u);
  });

  it('updates thickness_walls for slab ground without syncing thermal_transm_walls', () => {
    const zoneId = 'z1';
    const wall: Element = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 10,
      u_value: 0.4,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.33 }]),
      },
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floor_type: 'Slab_no_edge_insulation',
      thickness_walls: 0.05,
      extra_json: {},
    } as any;
    const updateElement = vi.fn();
    syncSuspendedGroundFabricFromWalls({ w1: wall, g1: ground }, updateElement);
    expect(updateElement).toHaveBeenCalledTimes(1);
    const patch = updateElement.mock.calls[0][1] as any;
    expect(patch.thickness_walls).toBeCloseTo(0.33, 2);
    expect(patch.extra_json).not.toHaveProperty('thermal_transm_walls');
  });

  it('returns source details for weighted wall thickness autofill', () => {
    const zoneId = 'z1';
    const wallA: Element = {
      id: 'w1',
      name: 'Wall A',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 10,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.3 }]),
      },
    } as any;
    const wallB: Element = {
      id: 'w2',
      name: 'Wall B',
      type: 'BuildingElementOpaque',
      zoneId,
      pitch: 90,
      area: 30,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.5 }]),
      },
    } as any;

    const result = computeWeightedExternalWallAssemblyThicknessDetails({ w1: wallA, w2: wallB }, zoneId);
    expect(result.valueM).toBeCloseTo(0.45, 2);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ elementId: 'w1', label: 'Wall A' });
    expect(result.sources[1]).toMatchObject({ elementId: 'w2', label: 'Wall B' });
  });

  it('filters weighted wall thickness autofill to walls on the same storey as the ground element', () => {
    const zoneId = 'z1';
    const wallA: Element = {
      id: 'w1',
      name: 'Ground wall',
      type: 'BuildingElementOpaque',
      zoneId,
      floorId: '0',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      pitch: 90,
      area: 10,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.3 }]),
      },
    } as any;
    const wallB: Element = {
      id: 'w2',
      name: 'Upper wall',
      type: 'BuildingElementOpaque',
      zoneId,
      floorId: '1',
      coordinates: [{ x: 0, y: 0, z: 1 }],
      pitch: 90,
      area: 30,
      extra_json: {
        vulcan_assembly_v1: minimalVulcanAssemblyV1([{ kind: 'solid', materialId: 'm', thickness_m: 0.5 }]),
      },
    } as any;
    const ground: Element = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId,
      floorId: '0',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      floor_type: 'Suspended_floor',
    } as any;

    expect(computeWeightedExternalWallAssemblyThicknessM({ w1: wallA, w2: wallB }, zoneId)).toBeCloseTo(0.45, 2);
    expect(computeWeightedExternalWallAssemblyThicknessForGroundElement({ w1: wallA, w2: wallB }, ground)).toBe(
      0.3,
    );
    const result = computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement(
      { w1: wallA, w2: wallB },
      ground,
    );
    expect(result.candidateCount).toBe(1);
    expect(result.sources.map((source) => source.elementId)).toEqual(['w1']);
  });
});

describe('syncGroundExposedPerimetersFromWalls', () => {
  const ground: Element = {
    id: 'g1',
    name: 'Ground floor',
    zoneId: 'z1',
    floorId: '0',
    type: 'BuildingElementGround',
    width: 5,
    height: 0,
    area: 20,
    total_area: 20,
    perimeter: 18,
    floor_type: 'Slab_no_edge_insulation',
    parent_element: null,
    extra_json: {},
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
  } as any;

  const southWall: Element = {
    id: 'w1',
    name: 'South wall',
    zoneId: 'z1',
    floorId: '0',
    type: 'BuildingElementOpaque',
    width: 5,
    height: 2.4,
    area: 12,
    pitch: 90,
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
  } as any;

  it('updates an auto-owned ground perimeter to the exposed wall-linked value', () => {
    const updateElement = vi.fn();
    syncGroundExposedPerimetersFromWalls({ g1: ground, w1: southWall }, updateElement);

    expect(updateElement).toHaveBeenCalledWith('g1', { perimeter: 5 });
  });

  it('does not overwrite a manually owned ground perimeter', () => {
    const manualGround = {
      ...ground,
      perimeter: 18,
      extra_json: { [GROUND_EXPOSED_PERIMETER_MANUAL_KEY]: true },
    } as Element;
    const updateElement = vi.fn();
    syncGroundExposedPerimetersFromWalls({ g1: manualGround, w1: southWall }, updateElement);

    expect(updateElement).not.toHaveBeenCalled();
  });

  it('preserves a manually owned zero perimeter', () => {
    const manualGround = {
      ...ground,
      perimeter: 0,
      extra_json: { [GROUND_EXPOSED_PERIMETER_MANUAL_KEY]: true },
    } as Element;
    const updateElement = vi.fn();

    syncGroundExposedPerimetersFromWalls({ g1: manualGround, w1: southWall }, updateElement);

    expect(updateElement).not.toHaveBeenCalled();
  });

  it('includes adjacent-unheated boundaries in the auto-owned ground perimeter', () => {
    const adjacent: Element = {
      ...southWall,
      id: 'a1',
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    } as Element;
    const westWall: Element = {
      ...southWall,
      id: 'w2',
      name: 'West wall',
      coordinates: [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    } as Element;
    const autoGround = { ...ground, perimeter: 4 } as Element;
    const updateElement = vi.fn();
    syncGroundExposedPerimetersFromWalls({ g1: autoGround, a1: adjacent, w2: westWall }, updateElement);

    expect(updateElement).toHaveBeenCalledWith('g1', { perimeter: 9 });
  });

  it('syncs to zero when the full ground outline is linked but none of it is exposed', () => {
    const party = (id: string, name: string, coordinates: Element['coordinates']): Element => ({
      id,
      name,
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementPartyWall',
      width: 1,
      height: 2.4,
      area: 2.4,
      parent_element: null,
      coordinates,
    } as Element);
    const autoGround = { ...ground, perimeter: 18 } as Element;
    const updateElement = vi.fn();
    syncGroundExposedPerimetersFromWalls({
      g1: autoGround,
      p1: party('p1', 'South party', [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]),
      p2: party('p2', 'East party', [{ x: 5, y: 0, z: 0 }, { x: 5, y: 4, z: 0 }]),
      p3: party('p3', 'North party', [{ x: 5, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]),
      p4: party('p4', 'West party', [{ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 0 }]),
    }, updateElement);

    expect(updateElement).toHaveBeenCalledWith('g1', { perimeter: 0 });
  });

  it('shares whole-floor area while retaining each unequal split fragment perimeter and U-value', () => {
    const west = {
      ...ground,
      area: 20,
      total_area: 20,
      perimeter: 1,
      thickness_walls: 0.3,
      extra_json: { thermal_resistance_floor_construction: 4.2, u_value: 0.1 },
    } as Element;
    const east = {
      ...west,
      id: 'g2',
      name: 'East ground floor',
      area: 15.6,
      total_area: 15.6,
      coordinates: [
        { x: 5, y: 0, z: 0 },
        { x: 8.9, y: 0, z: 0 },
        { x: 8.9, y: 4, z: 0 },
        { x: 5, y: 4, z: 0 },
      ],
    } as Element;
    const makeWall = (id: string, name: string, coordinates: Element['coordinates']): Element => ({
      ...southWall,
      id,
      name,
      coordinates,
    });
    const walls = [
      makeWall('south-west', 'South west', [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]),
      makeWall('south-east', 'South east', [{ x: 5, y: 0, z: 0 }, { x: 8.9, y: 0, z: 0 }]),
      makeWall('north-west', 'North west', [{ x: 5, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]),
      makeWall('north-east', 'North east', [{ x: 8.9, y: 4, z: 0 }, { x: 5, y: 4, z: 0 }]),
      makeWall('west', 'West', [{ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 0 }]),
      makeWall('east', 'East', [{ x: 8.9, y: 0, z: 0 }, { x: 8.9, y: 4, z: 0 }]),
    ];
    const elements = Object.fromEntries([west, east, ...walls].map((element) => [element.id, element]));
    const updateElement = vi.fn();

    syncGroundExposedPerimetersFromWalls(elements, updateElement);

    const patches = new Map(updateElement.mock.calls.map(([id, patch]) => [id, patch as Record<string, unknown>]));
    const westPatch = patches.get('g1')!;
    const eastPatch = patches.get('g2')!;
    expect(westPatch.total_area).toBe(35.6);
    expect(eastPatch.total_area).toBe(35.6);
    expect(westPatch.perimeter).toBe(14);
    expect(eastPatch.perimeter).toBe(11.8);
    expect((westPatch.extra_json as Record<string, unknown>).u_value).not.toBe(
      (eastPatch.extra_json as Record<string, unknown>).u_value,
    );
  });
});

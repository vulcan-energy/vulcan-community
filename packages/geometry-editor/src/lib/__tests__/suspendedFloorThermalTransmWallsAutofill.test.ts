// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  computeSuspendedThermalTransmWallsAutofillResult,
  computeSuspendedThermalTransmWallsAutofillResultForGroundElement,
  computeWeightedThermalTransmWallsFromGroundAdjacentWalls,
  computeWeightedThermalTransmWallsFromZoneExternalWalls,
  hasSuspendedFloorThermalTransmWallsAutofillSources,
  resolveOpaqueWallUValueForThermalTransmAutofill,
} from '../suspendedFloorThermalTransmWallsAutofill';
import type { BuildingElementOpaque, Element } from '../../geometry/types';

function wall(partial: Partial<BuildingElementOpaque> & Pick<BuildingElementOpaque, 'id' | 'name' | 'area'>): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    parent_element: null,
    coordinates: [],
    width: 1,
    height: 1,
    ...partial,
  } as BuildingElementOpaque;
}

describe('suspendedFloorThermalTransmWallsAutofill', () => {
  it('resolveOpaqueWallUValueForThermalTransmAutofill reads top-level then extra_json u_value', () => {
    expect(resolveOpaqueWallUValueForThermalTransmAutofill(wall({ id: 'a', name: 'a', area: 1, u_value: 0.25 }))).toBe(0.25);
    expect(
      resolveOpaqueWallUValueForThermalTransmAutofill(
        wall({ id: 'b', name: 'b', area: 1, extra_json: { u_value: 0.3 } }),
      ),
    ).toBe(0.3);
    expect(resolveOpaqueWallUValueForThermalTransmAutofill(wall({ id: 'c', name: 'c', area: 1, extra_json: {} }))).toBeNull();
  });

  it('hasSuspendedFloorThermalTransmWallsAutofillSources is false without zone or U', () => {
    const elements: Record<string, Element> = {
      w1: wall({
        id: 'w1',
        name: 'w1',
        zoneId: 'z1',
        area: 10,
        pitch: 90,
      }),
    };
    expect(hasSuspendedFloorThermalTransmWallsAutofillSources(elements, undefined)).toBe(false);
    expect(hasSuspendedFloorThermalTransmWallsAutofillSources(elements, 'z1')).toBe(false);
  });

  it('hasSuspendedFloorThermalTransmWallsAutofillSources is true with vertical wall, area, and u_value', () => {
    const elements: Record<string, Element> = {
      w1: wall({
        id: 'w1',
        name: 'w1',
        zoneId: 'z1',
        area: 10,
        pitch: 90,
        u_value: 0.2,
      } as BuildingElementOpaque),
    };
    expect(hasSuspendedFloorThermalTransmWallsAutofillSources(elements, 'z1')).toBe(true);
    expect(computeWeightedThermalTransmWallsFromZoneExternalWalls(elements, 'z1')).toBe(0.2);
  });

  it('returns source details for the area-weighted autofill result', () => {
    const elements: Record<string, Element> = {
      w1: wall({
        id: 'w1',
        name: 'North wall',
        zoneId: 'z1',
        area: 10,
        pitch: 90,
        u_value: 0.2,
      } as BuildingElementOpaque),
      w2: wall({
        id: 'w2',
        name: 'East wall',
        zoneId: 'z1',
        area: 20,
        pitch: 90,
        extra_json: { u_value: 0.35 },
      } as BuildingElementOpaque),
    };

    const result = computeSuspendedThermalTransmWallsAutofillResult(elements, 'z1');
    expect(result.value_W_m2K).toBeCloseTo(0.3, 2);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      elementId: 'w1',
      label: 'North wall',
      basis: 'top_level_u_value',
      basisLabel: 'wall U-value',
    });
    expect(result.sources[1]).toMatchObject({
      elementId: 'w2',
      label: 'East wall',
      basis: 'stored_fabric_u',
      basisLabel: 'stored fabric U',
    });
  });

  it('filters suspended-floor wall autofill to the same storey as the ground element', () => {
    const elements: Record<string, Element> = {
      w0: wall({
        id: 'w0',
        name: 'Ground wall',
        zoneId: 'z1',
        floorId: '0',
        area: 10,
        pitch: 90,
        u_value: 0.2,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ] as any,
      } as BuildingElementOpaque),
      w1: wall({
        id: 'w1',
        name: 'Upper wall',
        zoneId: 'z1',
        floorId: '1',
        area: 100,
        pitch: 90,
        u_value: 0.9,
        coordinates: [
          { x: 0, y: 0, z: 1 },
          { x: 5, y: 0, z: 1 },
        ] as any,
      } as BuildingElementOpaque),
    };
    const ground = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId: 'z1',
      floorId: '0',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as Element;

    expect(computeWeightedThermalTransmWallsFromZoneExternalWalls(elements, 'z1')).toBeCloseTo(0.84, 2);
    expect(computeWeightedThermalTransmWallsFromGroundAdjacentWalls(elements, ground)).toBe(0.2);

    const result = computeSuspendedThermalTransmWallsAutofillResultForGroundElement(elements, ground);
    expect(result.sources.map((source) => source.elementId)).toEqual(['w0']);
  });

  it('excludes walls that only touch the suspended floor polygon at one node', () => {
    const ground = {
      id: 'g1',
      type: 'BuildingElementGround',
      zoneId: 'z1',
      floorId: '0',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as Element;
    const elements: Record<string, Element> = {
      south: wall({
        id: 'south',
        name: 'South wall',
        zoneId: 'z1',
        floorId: '0',
        area: 12,
        pitch: 90,
        u_value: 0.2,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
      } as BuildingElementOpaque),
      pointOnly: wall({
        id: 'pointOnly',
        name: 'Point-only wall',
        zoneId: 'z1',
        floorId: '0',
        area: 20,
        pitch: 90,
        u_value: 0.9,
        coordinates: [
          { x: 5, y: 0, z: 0 },
          { x: 7, y: -2, z: 0 },
        ],
      } as BuildingElementOpaque),
      colinearPointOnly: wall({
        id: 'colinearPointOnly',
        name: 'Colinear point-only wall',
        zoneId: 'z1',
        floorId: '0',
        area: 30,
        pitch: 90,
        u_value: 1.2,
        coordinates: [
          { x: 5, y: 0, z: 0 },
          { x: 7, y: 0, z: 0 },
        ],
      } as BuildingElementOpaque),
    };

    const result = computeSuspendedThermalTransmWallsAutofillResultForGroundElement(elements, ground);
    expect(result.value_W_m2K).toBe(0.2);
    expect(result.sources.map((source) => source.elementId)).toEqual(['south']);
  });
});

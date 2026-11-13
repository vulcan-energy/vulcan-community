// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  calculateContextShadingAngularRangeFromCoordinates,
  calculateContextShadingDistanceFromCoordinates,
  rederiveContextShadingFromDrawing,
  contextShadingDistanceDetails,
} from '../contextShadingGeometry';

// 10 x 6 m floor drawn on the internal wall faces.
const floor = {
  coordinates: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
};
// 2 x 2 m block north of the floor, off-centre: its south face is 4 m from the north wall.
const block = {
  coordinates: [{ x: 2, y: 10 }, { x: 4, y: 10 }, { x: 4, y: 12 }, { x: 2, y: 12 }],
};

describe('context shading distance (FHS guidance 2.3.1)', () => {
  it('measures from the closest external wall to the closest face, perpendicular to the facade', () => {
    expect(calculateContextShadingDistanceFromCoordinates(block, floor, [])).toBe(4);
  });

  it('measures from the outside face when the floor gives a wall thickness', () => {
    expect(calculateContextShadingDistanceFromCoordinates(block, { ...floor, thickness_walls: 0.3 }, [])).toBe(3.7);
  });

  it('picks the facade the object faces, in any direction and winding', () => {
    const clockwise = { coordinates: [...floor.coordinates].reverse() };
    const east = { coordinates: [{ x: 13, y: 1 }, { x: 15, y: 1 }, { x: 15, y: 2 }, { x: 13, y: 2 }] };
    expect(calculateContextShadingDistanceFromCoordinates(east, clockwise, [])).toBe(3);
    expect(calculateContextShadingDistanceFromCoordinates({ coordinates: [{ x: 5, y: 23 }] }, floor, [])).toBe(17);
  });

  it('skips floor edges under a party wall or wall to an adjacent space', () => {
    const east = { coordinates: [{ x: 13, y: 1 }, { x: 15, y: 1 }, { x: 15, y: 2 }, { x: 13, y: 2 }] };
    for (const type of ['BuildingElementPartyWall', 'BuildingElementAdjacentConditionedSpace', 'BuildingElementAdjacentUnconditionedSpace_Simple']) {
      const wall = { type, coordinates: [{ x: 10.01, y: 6 }, { x: 10.01, y: 0 }] } as never;
      // The east edge is not external, so the closest external wall is the south one; the
      // object is beside that facade, not in front of it.
      expect(calculateContextShadingDistanceFromCoordinates(east, floor, [wall])).toBe(-1);
    }
    const external = { type: 'BuildingElementOpaque', coordinates: [{ x: 10, y: 0 }, { x: 10, y: 6 }] } as never;
    expect(calculateContextShadingDistanceFromCoordinates(east, floor, [external])).toBe(3);
  });

  it('ignores a horizontal ceiling to an adjacent space, and walls on another storey', () => {
    const house = { coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 8, y: 8, z: 0 }, { x: 0, y: 8, z: 0 }], thickness_walls: 0.3 };
    const west = { coordinates: [{ x: -10, y: 2 }, { x: -8, y: 2 }, { x: -8, y: 6 }, { x: -10, y: 6 }] };
    expect(calculateContextShadingDistanceFromCoordinates(west, house, [])).toBe(7.7);
    const ceiling = { type: 'BuildingElementAdjacentConditionedSpace', pitch: 0, coordinates: house.coordinates } as never;
    expect(calculateContextShadingDistanceFromCoordinates(west, house, [ceiling])).toBe(7.7);
    const groundFloorPartyWall = { type: 'BuildingElementPartyWall', coordinates: [{ x: 0, y: 8, z: 0 }, { x: 0, y: 0, z: 0 }] } as never;
    const upper = { ...house, coordinates: house.coordinates.map((p) => ({ ...p, z: 1 })) };
    expect(calculateContextShadingDistanceFromCoordinates(west, upper, [groundFloorPartyWall])).toBe(7.7);
  });

  it('takes the face nearest the wall, then measures from its midpoint', () => {
    const square = { coordinates: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], thickness_walls: 0.3 };
    const longBlock = { coordinates: [{ x: 15, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 45 }, { x: 15, y: 45 }] };
    expect(calculateContextShadingDistanceFromCoordinates(longBlock, square, [])).toBe(4.7);
  });

  it('moves each wall out by its own layers, else the floor, else the ground floor below', () => {
    const layered = {
      name: 'North wall', type: 'BuildingElementOpaque', pitch: 90,
      coordinates: [{ x: 10, y: 6, z: 0 }, { x: 0, y: 6, z: 0 }],
      extra_json: { vulcan_assembly_v1: {
        schemaVersion: 1, assemblyId: 'a', appliedAt: '2026-11-13T00:00:00Z', thermalResistanceConstruction_m2K_W: 2.5,
        assemblySnapshot: { layers: [{ kind: 'solid', materialId: 'm', thickness_m: 0.35 }] },
      } },
    } as never;
    const ground = { name: 'Ground', type: 'BuildingElementGround', thickness_walls: 0.3, coordinates: floor.coordinates } as never;
    expect(contextShadingDistanceDetails(block, { ...floor, thickness_walls: 0.2 }, [layered]))
      .toEqual({ distance: 3.65, thickness: { thicknessM: 0.35, source: 'wall_layers', name: 'North wall' } });
    expect(contextShadingDistanceDetails(block, { ...floor, thickness_walls: 0.2 }, []))
      .toEqual({ distance: 3.8, thickness: { thicknessM: 0.2, source: 'floor' } });
    const upper = { coordinates: floor.coordinates.map((p) => ({ ...p, z: 1 })) };
    expect(contextShadingDistanceDetails(block, upper, [ground]))
      .toEqual({ distance: 3.7, thickness: { thicknessM: 0.3, source: 'ground_floor', name: 'Ground' } });
    expect(contextShadingDistanceDetails(block, upper, [])?.thickness).toEqual({ thicknessM: 0, source: 'none' });
  });

  it('keeps the angles at the floor area centroid', () => {
    const { start_angle, end_angle } = calculateContextShadingAngularRangeFromCoordinates(
      block as never, floor as never,
    );
    // Corners (2,10) and (4,12) seen from the centroid (5,3).
    expect(start_angle).toBeCloseTo(450 - (Math.atan2(7, -3) * 180) / Math.PI, 6);
    expect(end_angle).toBeCloseTo(450 - (Math.atan2(9, -1) * 180) / Math.PI, 6);
  });

  it('re-derives a stored centroid distance on load', () => {
    const elements = [
      { id: 'f', name: 'Floor', type: 'BuildingElementGround', ...floor },
      { id: 's', name: 'Block', type: 'ContextShading', parent_element: 'Floor', distance: 8.25, ...block },
    ] as unknown as Element[];
    const next = rederiveContextShadingFromDrawing(elements, 0);
    expect((next[1] as unknown as { distance: number }).distance).toBe(4);
  });
});

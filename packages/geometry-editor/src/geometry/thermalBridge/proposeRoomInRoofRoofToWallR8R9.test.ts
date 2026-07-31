// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Room-in-roof roof × vertical adjacent → Table 3.7 R8 / R9 (topology inference).
 */
import { describe, expect, it } from 'vitest';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import type { BuildingElementAdjacentUnconditionedSpace_Simple, BuildingElementOpaque } from '../types';
import {
  proposeRoomInRoofRoofToWallR8R9ThermalBridges,
} from './proposeRoomInRoofRoofToWallR8R9';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';

function coldSlopedRoof(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'roof-cold',
    name: 'Loft cold deck',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 },
      { x: 6, y: 3, z: 1 },
      { x: 0, y: 3, z: 1 },
    ],
    width: 6,
    height: 2,
    area: 40,
    pitch: 45,
    is_unheated_pitched_roof: true,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function warmSlopedRoof(): BuildingElementOpaque {
  const r = coldSlopedRoof();
  return {
    ...r,
    id: 'roof-warm',
    name: 'Warm pitched roof',
    is_unheated_pitched_roof: false,
  } as BuildingElementOpaque;
}

function kneeWallAlongRoofBottomEdge(): BuildingElementAdjacentUnconditionedSpace_Simple {
  return {
    type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    id: 'uw-knee',
    name: 'Unheated knee',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 },
    ],
    width: 6,
    height: 1,
    area: 6,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementAdjacentUnconditionedSpace_Simple;
}

function dormerCheekOpaqueAlongRoofBottomEdge(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'cheek-opaque',
    name: 'Dormer left cheek',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 },
    ],
    width: 6,
    height: 1,
    area: 6,
    pitch: 90,
    isPlaceholder: false,
    extra_json: {
      dormer_bundle: {
        kind: 'dormer',
        role: 'left-cheek-wall',
      },
    },
  } as BuildingElementOpaque;
}

describe('proposeRoomInRoofRoofToWallR8R9ThermalBridges', () => {
  it('emits R9 when is_unheated_pitched_roof (cold deck / insulation at ceiling)', () => {
    const roof = coldSlopedRoof();
    const knee = kneeWallAlongRoofBottomEdge();
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, knee]);
    const bottomEdge = p.filter((x) => x.reason.includes('edge 0'));
    expect(bottomEdge.length).toBeGreaterThanOrEqual(1);
    expect(bottomEdge[0]!.junctionCode).toBe('R9');
    expect(bottomEdge[0]!.edgeRole).toBe('sloped_roof_to_adjacent_wall_r8_r9');
    expect(bottomEdge[0]!.parentElementForTb).toBe('Loft cold deck');
    expect(bottomEdge[0]!.openingId).toBe('uw-knee');
    expect(bottomEdge[0]!.roofAdjacentPairIds).toEqual(['roof-cold', 'uw-knee']);
    // Eaves edge: roof Z constant along edge → 3D length = plan overlap (6 m).
    expect(bottomEdge[0]!.suggestedLengthM).toBeCloseTo(6, 5);
    const [a, b] = bottomEdge[0]!.coordinates;
    expect(a!.z).toBeCloseTo(b!.z!, 5);
    expect(computeThermalBridgeLinearRunLengthM(bottomEdge[0]!.coordinates)).toBeCloseTo(bottomEdge[0]!.suggestedLengthM!, 5);
  });

  it('uses inferred ceiling boundary for cold R9 when roof base sits above the wall top', () => {
    const floors = [
      { id: 'f0', name: 'Ground', zIndex: 0, height: 2.8, isRoofSpace: false },
      { id: 'f1', name: 'First', zIndex: 1, height: 2.8, isRoofSpace: false },
      { id: 'f2', name: 'Roof', zIndex: 2, height: 0, isRoofSpace: true },
    ];
    const roof = {
      ...coldSlopedRoof(),
      floorId: 'f2',
      base_height: 6.2,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 6, y: 0, z: 2 },
        { x: 6, y: 3, z: 2 },
        { x: 0, y: 3, z: 2 },
      ],
    } as BuildingElementOpaque;
    const knee = {
      ...kneeWallAlongRoofBottomEdge(),
      floorId: 'f1',
      height: 2.8,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 6, y: 0, z: 1 },
      ],
    } as BuildingElementAdjacentUnconditionedSpace_Simple;

    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, knee], floors);
    const row = p.find((x) => x.openingId === 'uw-knee' && x.junctionCode === 'R9');

    expect(row).toBeDefined();
    expect(row!.suggestedLengthM).toBeCloseTo(6, 5);
    expect(row!.coordinates[0]!.z).toBeCloseTo(5.6, 5);
    expect(row!.coordinates[1]!.z).toBeCloseTo(5.6, 5);
  });

  it('emits R8 for warm roof (insulation at rafter line)', () => {
    const roof = warmSlopedRoof();
    const knee = kneeWallAlongRoofBottomEdge();
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, knee]);
    const bottomEdge = p.filter((x) => x.reason.includes('edge 0'));
    expect(bottomEdge.length).toBeGreaterThanOrEqual(1);
    expect(bottomEdge[0]!.junctionCode).toBe('R8');
  });

  it('pairs sloped roof edges with vertical opaque dormer cheek walls (not only BuildingElementAdjacent)', () => {
    const roof = coldSlopedRoof();
    const cheek = dormerCheekOpaqueAlongRoofBottomEdge();
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, cheek]);
    const bottomEdge = p.filter((x) => x.reason.includes('edge 0') && x.reason.includes('opaque wall'));
    expect(bottomEdge.length).toBeGreaterThanOrEqual(1);
    expect(bottomEdge[0]!.junctionCode).toBe('R9');
    expect(bottomEdge[0]!.openingId).toBe('cheek-opaque');
    expect(bottomEdge[0]!.roofAdjacentPairIds).toEqual(['roof-cold', 'cheek-opaque']);
  });

  it('returns nothing when adjacent is not plan-coincident with any roof edge', () => {
    const roof = coldSlopedRoof();
    const offset: BuildingElementAdjacentUnconditionedSpace_Simple = {
      ...kneeWallAlongRoofBottomEdge(),
      id: 'uw-off',
      coordinates: [
        { x: 0, y: 0.5, z: 1 },
        { x: 6, y: 0.5, z: 1 },
      ],
    };
    expect(proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, offset])).toHaveLength(0);
  });

  it('supports 2-point sloped roof segment + adjacent on same line', () => {
    const roof2: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'roof2',
      name: 'ridge roof',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 5, y: 0, z: 1 },
      ],
      width: 5,
      height: 1.5,
      area: 7.5,
      pitch: 40,
      is_unheated_pitched_roof: true,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const knee: BuildingElementAdjacentUnconditionedSpace_Simple = {
      ...kneeWallAlongRoofBottomEdge(),
      id: 'uw2',
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 5, y: 0, z: 1 },
      ],
      width: 5,
    } as BuildingElementAdjacentUnconditionedSpace_Simple;
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof2, knee]);
    expect(p.some((x) => x.junctionCode === 'R9')).toBe(true);
    const row = p.find((x) => x.junctionCode === 'R9')!;
    expect(row.suggestedLengthM).toBeCloseTo(5, 5);
    expect(row.coordinates[0]!.z).toBeCloseTo(row.coordinates[1]!.z!, 5);
  });

  it('uses projected ceiling boundary for cold R9 when Z differs along the shared edge', () => {
    const roof = coldSlopedRoof();
    const kneeLeft: BuildingElementAdjacentUnconditionedSpace_Simple = {
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
      id: 'uw-left',
      name: 'Unheated left',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 3, z: 1 },
      ],
      width: 3,
      height: 2,
      area: 6,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementAdjacentUnconditionedSpace_Simple;
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, kneeLeft]);
    const hit = p.find((r) => r.openingId === 'uw-left');
    expect(hit).toBeDefined();
    expect(hit!.junctionCode).toBe('R9');
    expect(hit!.suggestedLengthM).toBeCloseTo(3, 2);
    expect(hit!.coordinates[0]!.z).toBeCloseTo(hit!.coordinates[1]!.z, 5);
    expect(hit!.reason).toContain('projected ceiling boundary');
  });

  it('uses 3D length along roof plane for warm R8 when Z differs along the shared edge', () => {
    const roof = warmSlopedRoof();
    const kneeLeft: BuildingElementAdjacentUnconditionedSpace_Simple = {
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
      id: 'uw-left',
      name: 'Unheated left',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 3, z: 1 },
      ],
      width: 3,
      height: 2,
      area: 6,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementAdjacentUnconditionedSpace_Simple;
    const p = proposeRoomInRoofRoofToWallR8R9ThermalBridges([roof, kneeLeft]);
    const hit = p.find((r) => r.openingId === 'uw-left');
    expect(hit).toBeDefined();
    expect(hit!.junctionCode).toBe('R8');
    const z0 = roofTopElevationAtPlanM(roof, 0, 0, undefined);
    const z1 = roofTopElevationAtPlanM(roof, 0, 3, undefined);
    expect(z0).not.toBeNull();
    expect(z1).not.toBeNull();
    expect(Math.abs(z1! - z0!)).toBeGreaterThan(0.01);
    const expectedLen = computeThermalBridgeLinearRunLengthM(hit!.coordinates);
    expect(hit!.suggestedLengthM).toBeCloseTo(expectedLen, 2);
    expect(expectedLen).toBeGreaterThan(3 + 1e-3);
    const zs = [hit!.coordinates[0]!.z, hit!.coordinates[1]!.z].sort((a, b) => a - b);
    const ref = [z0!, z1!].sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(ref[0], 5);
    expect(zs[1]).toBeCloseTo(ref[1], 5);
  });
});

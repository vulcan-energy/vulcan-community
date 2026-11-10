// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Junctions of walls with a profiled face (`extra_json.geometry_face`): a wall standing on a roof
 * and a gable wall. Flat walls are covered by each proposer's own tests.
 */
import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, BuildingElementOpaque, BuildingElementTransparent, Element, Floor } from '../../types';
import { deriveWallEdgeFromRoofs } from '../../../lib/wallEdgeFromRoofs';
import { proposeWallGroundContinuous } from '../proposeWallGroundContinuous';
import { proposeDormerWallToHostRoofR8R9ThermalBridges } from '../proposeDormerWallToHostRoofR8R9';
import { proposeExternalCornerThermalBridges } from '../proposeExternalCorners';
import { proposeFacadeOpeningThermalBridges } from '../proposeFacadeOpenings';
import { syncThermalBridgeLinearLengthFromCoordinates } from '../../../lib/thermalBridgeLinearGeometry';

const floors: Floor[] = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 5, isRoofSpace: false } as Floor];

function wall(id: string, from: [number, number], to: [number, number], extra?: Record<string, unknown>): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id,
    name: `Wall ${id}`,
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: from[0], y: from[1], z: 0 },
      { x: to[0], y: to[1], z: 0 },
    ],
    width: Math.hypot(to[0] - from[0], to[1] - from[1]),
    height: 5,
    base_height: 0,
    pitch: 90,
    isPlaceholder: false,
    ...(extra ? { extra_json: extra } : {}),
  } as BuildingElementOpaque;
}

describe('wall standing on a roof', () => {
  // A 30° lean-to roof over x 0..4 with its eaves (1 m up) along x = 0, rising towards +x. The
  // wall along y = 0 stands on it for x 0..4 and on the ground slab for x 4..10.
  const roof = {
    type: 'BuildingElementOpaque',
    id: 'roof',
    name: 'Lean-to Roof',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 4, y: 1, z: 0 },
      { x: 4, y: -1, z: 0 },
    ],
    base_height: 1,
    pitch: 30,
    isPlaceholder: false,
  } as BuildingElementOpaque;
  const ground = {
    type: 'BuildingElementGround',
    id: 'gnd',
    name: 'Ground floor',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 8, z: 0 },
      { x: 0, y: 8, z: 0 },
    ],
    floor_type: 'Slab_no_edge_insulation',
    isPlaceholder: false,
  } as BuildingElementGround;
  const plain = wall('south', [0, 0], [10, 0]);
  const top = [{ t: 0, h: 5 }, { t: 1, h: 5 }];
  const bottom = deriveWallEdgeFromRoofs(plain, [plain, roof, ground], floors, 0, 'bottom', top)!.profile;
  const onRoof = wall('south', [0, 0], [10, 0], {
    geometry_face: { kind: 'profiled-line-face', top_profile: top, bottom_profile: bottom, bottom_mode: 'roof' },
  });
  const elements: Element[] = [onRoof, roof, ground];

  it('has a ground junction only where its bottom is on the floor', () => {
    const e5 = proposeWallGroundContinuous(elements, [], floors);
    expect(e5).toHaveLength(1);
    expect(e5[0]!.coordinates[0]!.x).toBeCloseTo(4, 1);
    expect(e5[0]!.suggestedLengthM).toBeCloseTo(6, 1);
    // The same wall without its face runs the whole 10 m.
    expect(proposeWallGroundContinuous([plain, roof, ground], [], floors)[0]!.suggestedLengthM).toBe(10);
  });

  it('meets the roof along its bottom edge (R8, on the roof plane)', () => {
    const r8 = proposeDormerWallToHostRoofR8R9ThermalBridges(elements, floors, 0);
    expect(r8).toHaveLength(1);
    expect(r8[0]!.junctionCode).toBe('R8');
    expect(r8[0]!.roofAdjacentPairIds).toEqual(['roof', 'south']);
    expect(r8[0]!.suggestedLengthM).toBeCloseTo(4 / Math.cos(Math.PI / 6), 1);
    expect(r8[0]!.coordinates[0]!.z).toBeCloseTo(1, 2);
    expect(r8[0]!.coordinates[1]!.z).toBeCloseTo(1 + 4 * Math.tan(Math.PI / 6), 2);
    expect(proposeDormerWallToHostRoofR8R9ThermalBridges([plain, roof, ground], floors, 0)).toEqual([]);
  });
});

describe('gable wall corner', () => {
  it('runs the corner to the gable height at that end, not its average height', () => {
    // A gable 1 m at its ends and 4 m at its ridge (stored height = 2.5, the average) meets a
    // flat 3 m side wall: the corner is 1 m.
    const gable = wall('gable', [0, 0], [6, 0], {
      geometry_face: {
        kind: 'profiled-line-face',
        top_profile: [{ t: 0, h: 1 }, { t: 0.5, h: 4 }, { t: 1, h: 1 }],
        bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }],
      },
    });
    gable.height = 2.5;
    const side = { ...wall('side', [6, 0], [6, 5]), height: 3 };
    const corners = proposeExternalCornerThermalBridges([gable, side]);
    expect(corners).toHaveLength(1);
    expect(corners[0]!.suggestedLengthM).toBe(1);
  });
});

describe('shaped window', () => {
  const window = (extra?: Record<string, unknown>) => ({
    type: 'BuildingElementTransparent',
    id: 'win',
    name: 'Window',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    width: 2,
    height: 1.5,
    base_height: 1,
    pitch: 90,
    isPlaceholder: false,
    ...(extra ? { extra_json: extra } : {}),
  }) as BuildingElementTransparent;
  const lengths = (w: BuildingElementTransparent) => Object.fromEntries(
    proposeFacadeOpeningThermalBridges([w], floors).map((p) => [p.edgeRole, p.suggestedLengthM]));

  it('runs the lintel along a sloped top and each jamb to the top at its end', () => {
    // Top rises from 1 m to 2 m above the sill across the 2 m width.
    const shaped = window({
      geometry_face: { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 1 }, { t: 1, h: 2 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] },
    });
    expect(lengths(shaped)).toEqual({ lintel: 2.24, sill: 2, jamb_first: 1, jamb_second: 2 });
    // A flat window keeps width and stored height.
    expect(lengths(window())).toEqual({ lintel: 2, sill: 2, jamb_first: 1.5, jamb_second: 1.5 });
  });

  it('runs an apex window lintel as one straight run per side, its points matching its length, and no jambs', () => {
    const apex = window({
      geometry_face: { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 0 }, { t: 0.5, h: 1 }, { t: 1, h: 0 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] },
    });
    const proposals = proposeFacadeOpeningThermalBridges([apex], floors);
    expect(proposals.map((p) => [p.edgeRole, p.suggestedLengthM])).toEqual([['lintel', 1.41], ['lintel', 1.41], ['sill', 2]]);
    for (const p of proposals) expect(syncThermalBridgeLinearLengthFromCoordinates(p)).toBe(p.suggestedLengthM);
  });
});

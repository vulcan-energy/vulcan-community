// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { deriveWallEdgeFromRoofs } from '../wallEdgeFromRoofs';
import { deriveRoofCutout, roofFootprintIssueMessage } from '../roofCutouts';
import { getElementEffectiveArea, getElementGrossArea } from '../elementArea';
import { proposeSlopedRoofEavesGableThermalBridges } from '../../geometry/thermalBridge/proposeSlopedRoofEavesGable';
import { proposeFlatRoofEdgeThermalBridges } from '../../geometry/thermalBridge/proposeFlatRoofEdge';
import type { BuildingElementOpaque, Element } from '../../geometry/types';

// Front roof of a house 8 m wide: eaves along y = 0 at 5 m, rising at 45° to the ridge at y = 3.
const roof = {
  id: 'roof',
  name: 'Front roof',
  type: 'BuildingElementOpaque',
  zoneId: 'z',
  pitch: 45,
  base_height: 5,
  coordinates: [[0, 0], [8, 0], [8, 3], [0, 3]].map(([x, y]) => ({ x, y, z: 0 })),
} as BuildingElementOpaque;

const wall = (name: string, a: [number, number], b: [number, number], top: number, onRoof = true): BuildingElementOpaque => {
  const plain = {
    id: name,
    name,
    type: 'BuildingElementOpaque',
    zoneId: 'z',
    pitch: 90,
    base_height: 5,
    height: top,
    coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  } as BuildingElementOpaque;
  if (!onRoof) return plain;
  const topProfile = [{ t: 0, h: top }, { t: 1, h: top }];
  const bottom = deriveWallEdgeFromRoofs(plain, [roof], [], 0, 'bottom', topProfile)!.profile;
  return {
    ...plain,
    extra_json: { geometry_face: { kind: 'profiled-line-face', top_profile: topProfile, bottom_profile: bottom, bottom_mode: 'roof' } },
  };
};

const byId = (elements: Element[]) => Object.fromEntries(elements.map((e) => [e.id, e]));
const edges = (elements: Element[], role: string) => proposeSlopedRoofEavesGableThermalBridges(elements, [], 0)
  .filter((p) => p.openingId === 'roof' && p.edgeRole === role)
  .map((p) => [p.coordinates[0]!.x, p.coordinates[1]!.x].sort((m, n) => m - n))
  .sort((m, n) => m[0]! - n[0]!);

describe('part of a roof inside walls standing on it', () => {
  it('a box dormer to the ridge: roof area drops by the footprint on the slope, no ridge inside', () => {
    // Front wall 1 m up the slope; cheeks from it to the ridge. Footprint 3 m × 2 m in plan.
    const elements = [roof, wall('Dormer front', [2, 1], [5, 1], 4), wall('Cheek L', [2, 1], [2, 3], 4), wall('Cheek R', [5, 1], [5, 3], 4)];
    const covered = 6 / Math.cos(Math.PI / 4);
    expect(getElementEffectiveArea(roof, byId(elements), [], 0))
      .toBeCloseTo(getElementGrossArea(roof, 0) - covered, 1);
    expect(deriveRoofCutout(roof, elements, [], 0)!.wallNames).toEqual(['Cheek L', 'Cheek R', 'Dormer front']);
    expect(edges(elements, 'sloped_roof_ridge')).toEqual([[0, 2], [5, 8]]);
    expect(edges(elements, 'sloped_roof_eaves')).toEqual([[0, 8]]);
  });

  it('an extension running past the eaves into the roof: closed by its front wall, no eaves inside', () => {
    // Side walls stand on the floor past the eaves and on the roof inside it, ending where their
    // 2.5 m top meets the slope (y = 2.5). The front wall at y = −3 stands on the floor.
    const elements = [
      roof,
      wall('Side L', [2, -3], [2, 2.5], 2.5),
      wall('Side R', [5, -3], [5, 2.5], 2.5),
      wall('Extension front', [2, -3], [5, -3], 2.5, false),
    ];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.issues).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(3 * 2.5, 2);
    expect(edges(elements, 'sloped_roof_eaves')).toEqual([[0, 2], [5, 8]]);
  });

  it('names an open footprint: where the gap is and what to do', () => {
    // Cheeks without a front wall: their front ends stand full height on the slope.
    const elements = [roof, wall('Loft wall', [2, 1], [2, 3], 4), wall('Loft wall 1', [5, 1], [5, 3], 4)];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.wallNames).toEqual([]);
    expect(getElementEffectiveArea(roof, byId(elements), [], 0)).toBe(getElementGrossArea(roof, 0));
    expect(cutout.issues.map((issue) => roofFootprintIssueMessage(roof.name, issue))).toEqual([
      'Walls standing on "Front roof" ("Loft wall", "Loft wall 1") do not close a footprint: the gap is between '
      + '"Loft wall" at (2.00, 1.00) and "Loft wall 1" at (5.00, 1.00). Add a wall there or set their bottoms to Flat.',
    ]);
  });

  it('closes along the roof outline, round the corner the walls enclose, not straight across', () => {
    // A corner dormer: front wall from the verge (x = 0) and a cheek to the ridge. The ends stop
    // on two roof edges; the footprint runs round the corner at (0, 3): 3 m × 2 m in plan.
    const elements = [roof, wall('Corner front', [0, 1], [3, 1], 4), wall('Corner cheek', [3, 1], [3, 3], 4)];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.issues).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(6, 2);
  });

  it('joins open ends through any number of walls of the zone standing on the floor', () => {
    // Side R starts 2 m behind the front: front wall and a short side wall on the floor join it.
    const elements = [
      roof,
      wall('Side L', [2, -3], [2, 2.5], 2.5),
      wall('Side R', [5, -1], [5, 2.5], 2.5),
      wall('Extension front', [2, -3], [5, -3], 2.5, false),
      wall('Extension side', [5, -3], [5, -1], 2.5, false),
    ];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.issues).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(3 * 2.5, 2);
  });

  it('names three walls meeting at one point instead of choosing between them', () => {
    const elements = [
      roof,
      wall('Dormer front', [2, 1], [5, 1], 4),
      wall('Cheek L', [2, 1], [2, 3], 4),
      wall('Cheek R', [5, 1], [5, 3], 4),
      wall('Partition', [2, 1], [3.5, 2], 4),
    ];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.wallNames).toEqual([]);
    expect(cutout.issues.map((issue) => roofFootprintIssueMessage(roof.name, issue))).toEqual([
      'Walls standing on "Front roof" ("Cheek L", "Dormer front", "Partition") meet at (2.00, 1.00), so the footprint is not clear. '
      + 'Make only two walls meet at each point.',
    ]);
  });
});

describe('part of a flat roof under a room built on it', () => {
  // Flat roof deck 6 m × 4 m at 3 m; a room on its west half, walls standing on the deck and
  // facing outward (each wall faces the right of its direction).
  const deck = {
    id: 'deck',
    name: 'Flat roof',
    type: 'BuildingElementOpaque',
    zoneId: 'z',
    pitch: 0,
    base_height: 3,
    height: 1,
    coordinates: [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, y]) => ({ x, y, z: 0 })),
  } as BuildingElementOpaque;
  const roomWall = (name: string, a: [number, number], b: [number, number]) => ({
    ...wall(name, a, b, 2.5, false),
    base_height: 3,
  });
  const elements: Element[] = [
    deck,
    roomWall('Room S', [0, 0], [3, 0]),
    roomWall('Room E', [3, 0], [3, 4]),
    roomWall('Room N', [3, 4], [0, 4]),
    roomWall('Room W', [0, 4], [0, 0]),
  ];

  it('drops the covered deck from the roof area, its edges under the room, and puts E6 under the walls', () => {
    expect(getElementEffectiveArea(deck, byId(elements), [], 0)).toBe(12);
    const proposals = proposeFlatRoofEdgeThermalBridges(elements, [], 0);
    const lengths = (role: string) => proposals.filter((p) => p.edgeRole === role).map((p) => p.suggestedLengthM).sort();
    expect(lengths('flat_roof_edge')).toEqual([3, 3, 4]);
    expect(lengths('wall_intermediate_continuous')).toEqual([3, 3, 4, 4]);
    expect(proposals.filter((p) => p.edgeRole === 'wall_intermediate_continuous').every((p) => p.junctionCode === 'E6')).toBe(true);
  });
});

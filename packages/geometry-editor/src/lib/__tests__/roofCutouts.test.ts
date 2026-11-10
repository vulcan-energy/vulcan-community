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

// Flat roof of the extensions below, over their walls' 2.5 m tops (7.5 m).
const extensionRoof = {
  id: 'ext-roof',
  name: 'Extension roof',
  type: 'BuildingElementOpaque',
  zoneId: 'z',
  pitch: 0,
  base_height: 7.5,
  height: 1,
  coordinates: [[2, -3], [5, -3], [5, 2.5], [2, 2.5]].map(([x, y]) => ({ x, y, z: 0 })),
} as BuildingElementOpaque;

const byId = (elements: Element[]) => Object.fromEntries(elements.map((e) => [e.id, e]));
const edges = (elements: Element[], role: string) => proposeSlopedRoofEavesGableThermalBridges(elements, [], 0)
  .filter((p) => p.openingId === 'roof' && p.edgeRole === role)
  .map((p) => [p.coordinates[0]!.x, p.coordinates[1]!.x].sort((m, n) => m - n))
  .sort((m, n) => m[0]! - n[0]!);

describe('part of a roof inside walls standing on it', () => {
  it('a box dormer to the ridge: roof area drops by the footprint on the slope, no ridge inside', () => {
    // Front wall 1 m up the slope; cheeks from it to the ridge. Footprint 3 m × 2 m in plan.
    const elements = [roof, wall('Dormer front', [2, 1], [5, 1], 4), wall('Cheek L', [2, 3], [2, 1], 4), wall('Cheek R', [5, 1], [5, 3], 4)];
    const covered = 6 / Math.cos(Math.PI / 4);
    expect(getElementEffectiveArea(roof, byId(elements), [], 0))
      .toBeCloseTo(getElementGrossArea(roof, 0) - covered, 1);
    expect(deriveRoofCutout(roof, elements, [], 0)!.wallNames).toEqual(['Cheek L', 'Cheek R', 'Dormer front']);
    expect(edges(elements, 'sloped_roof_ridge')).toEqual([[0, 2], [5, 8]]);
    expect(edges(elements, 'sloped_roof_eaves')).toEqual([[0, 8]]);
  });

  it('an extension running past the eaves into the roof: closed by its front wall, no eaves inside', () => {
    // Side walls stand on the floor past the eaves and on the roof inside it, ending where their
    // 2.5 m top meets the slope (y = 2.5) under the extension's flat roof, whose back edge closes
    // the footprint. The front wall at y = −3 stands on the floor.
    const elements = [
      roof,
      extensionRoof,
      wall('Side L', [2, 2.5], [2, -3], 2.5),
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
      extensionRoof,
      wall('Side L', [2, 2.5], [2, -3], 2.5),
      wall('Side R', [5, -1], [5, 2.5], 2.5),
      wall('Extension front', [2, -3], [5, -3], 2.5, false),
      wall('Extension side', [5, -3], [5, -1], 2.5, false),
    ];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.issues).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(3 * 2.5, 2);
  });

  it('cuts the majority side but names a wall that faces into its footprint', () => {
    const elements = [roof, wall('Dormer front', [2, 1], [5, 1], 4), wall('Cheek L', [2, 1], [2, 3], 4), wall('Cheek R', [5, 1], [5, 3], 4)];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.planArea).toBeCloseTo(6, 2);
    expect(cutout.issues.map((issue) => roofFootprintIssueMessage(roof.name, issue))).toEqual([
      '"Cheek L" faces into the space it encloses on "Front roof". Flip the wall so it faces outward.',
    ]);
  });

  it('closes a gable dormer along the valleys of its roof, not straight across', () => {
    // Cheeks with a 2.5 m top meet the slope at y = 2.5; the dormer's two 11.3° roof planes rise
    // from them to a ridge at x = 3.5 that meets the slope at y = 2.8. Footprint: 3 × 1.5 m plus
    // the valley triangle 3 × 0.3 / 2.
    const pitch = (Math.atan(0.2) * 180) / Math.PI;
    const plane = (id: string, pts: Array<[number, number]>) => ({
      id, name: id, type: 'BuildingElementOpaque', zoneId: 'z', pitch, base_height: 7.5,
      coordinates: pts.map(([x, y]) => ({ x, y, z: 0 })),
    }) as BuildingElementOpaque;
    const elements = [
      roof,
      plane('Dormer roof L', [[2, 1], [2, 2.5], [3.5, 2.8], [3.5, 1]]),
      plane('Dormer roof R', [[5, 2.5], [5, 1], [3.5, 1], [3.5, 2.8]]),
      wall('Dormer front', [2, 1], [5, 1], 2.5),
      wall('Cheek L', [2, 2.5], [2, 1], 2.5),
      wall('Cheek R', [5, 1], [5, 2.5], 2.5),
    ];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.issues).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(4.5 + 0.45, 2);
    expect(getElementGrossArea(roof, 0) - getElementEffectiveArea(roof, byId(elements), [], 0))
      .toBeCloseTo(4.95 / Math.cos(Math.PI / 4), 1);
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

describe('walls on a flat roof: decks, links and partitions', () => {
  const opaque = (name: string, a: [number, number], b: [number, number], base: number, z: number, type = 'BuildingElementOpaque') => ({
    id: name, name, type, zoneId: 'z', pitch: 90, base_height: base, height: 2.6,
    coordinates: [{ x: a[0], y: a[1], z }, { x: b[0], y: b[1], z }],
  }) as unknown as Element;
  const lengths = (proposals: ReturnType<typeof proposeFlatRoofEdgeThermalBridges>, code: string) =>
    proposals.filter((p) => p.junctionCode === code).map((p) => p.suggestedLengthM).sort((m, n) => m - n);

  it.each([['0', 0], ['blank', undefined]])('a bungalow roof with base_height %s is the top of its storey, not under its walls', (_label, base) => {
    const roof = {
      id: 'roof', name: 'Flat Roof', type: 'BuildingElementOpaque', zoneId: 'z', pitch: 0, base_height: base, height: 8,
      coordinates: [[0, 0], [10, 0], [10, 8], [0, 8]].map(([x, y]) => ({ x, y, z: 0 })),
    } as BuildingElementOpaque;
    const elements = [
      roof,
      opaque('Wall S', [0, 0], [10, 0], 0, 0), opaque('Wall E', [10, 0], [10, 8], 0, 0),
      opaque('Wall N', [10, 8], [0, 8], 0, 0), opaque('Wall W', [0, 8], [0, 0], 0, 0),
    ];
    const floors = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 0 }];
    expect(getElementEffectiveArea(roof, byId(elements), floors, 0)).toBe(80);
    const proposals = proposeFlatRoofEdgeThermalBridges(elements, floors, 0);
    expect(lengths(proposals, 'E14')).toEqual([8, 8, 10, 10]);
    expect(lengths(proposals, 'E6')).toEqual([]);
  });

  // A house 10 × 8 m with a single-storey extension behind it (x 2..6, y 8..12). The extension's
  // deck at 2.6 m is drawn 0.2 m into the house, so the room's chain ends are inside the deck and
  // must join along the house's rear wall (both storeys, 0 to 5.2 m), which rises through the
  // deck: mid-span when that wall is not split there. The extension's walls end at the deck.
  const deck = {
    id: 'deck', name: 'Flat Roof', type: 'BuildingElementOpaque', zoneId: 'z', pitch: 0, base_height: 2.6,
    coordinates: [[2, 7.8], [6, 7.8], [6, 12], [2, 12]].map(([x, y]) => ({ x, y, z: 0 })),
  } as BuildingElementOpaque;
  const extension = [
    opaque('Ext W', [2, 12], [2, 8], 0, 0), opaque('Ext N', [6, 12], [2, 12], 0, 0), opaque('Ext E', [6, 8], [6, 12], 0, 0),
  ];
  const tall = (e: Element) => ({ ...e, height: 5.2 }) as Element;
  const houseWall: Record<string, Element[]> = {
    unsplit: [tall(opaque('House N', [10, 8], [0, 8], 0, 0))],
    split: [tall(opaque('House N', [10, 8], [4, 8], 0, 0)), tall(opaque('House N 1', [4, 8], [0, 8], 0, 0))],
    party: [tall(opaque('Party N', [10, 8], [0, 8], 0, 0, 'BuildingElementPartyWall'))],
  };
  const room = (depth: number) => [
    opaque('Room W', [2, 8 + depth], [2, 8], 2.6, 1),
    opaque('Room N', [6, 8 + depth], [2, 8 + depth], 2.6, 1),
    opaque('Room E', [6, 8], [6, 8 + depth], 2.6, 1),
  ];

  it.each(['unsplit', 'split', 'party'])('a room on the deck joins along the %s house wall, not the extension walls below', (house) => {
    for (const [depth, cover] of [[3, 12], [4, 16]] as const) {
      const cutout = deriveRoofCutout(deck, [deck, ...extension, ...houseWall[house]!, ...room(depth)], [], 0)!;
      expect(cutout.issues).toEqual([]);
      expect(cutout.planArea).toBeCloseTo(cover, 6);
      expect(cutout.wallNames).toEqual(['Room E', 'Room N', 'Room W']);
    }
  });

  it('an internal partition in a room on the deck neither opens nor blocks the footprint', () => {
    const partition = opaque('Partition', [2, 10], [6, 10], 2.6, 1, 'BuildingElementAdjacentConditionedSpace');
    // The room's side walls split where the partition meets them, and unsplit.
    const split = [
      opaque('Room W', [2, 11], [2, 10], 2.6, 1), opaque('Room W 1', [2, 10], [2, 8], 2.6, 1),
      opaque('Room N', [6, 11], [2, 11], 2.6, 1),
      opaque('Room E', [6, 8], [6, 10], 2.6, 1), opaque('Room E 1', [6, 10], [6, 11], 2.6, 1),
    ];
    for (const walls of [room(3), split]) {
      const cutout = deriveRoofCutout(deck, [deck, ...extension, ...houseWall.unsplit!, ...walls, partition], [], 0)!;
      expect(cutout.issues).toEqual([]);
      expect(cutout.planArea).toBeCloseTo(12, 6);
    }
  });
});

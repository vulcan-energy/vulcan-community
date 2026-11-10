// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { deriveWallEdgeFromRoofs } from '../wallEdgeFromRoofs';
import { deriveRoofCutout, roofFootprintGapMessage } from '../roofCutouts';
import { getElementEffectiveArea, getElementGrossArea } from '../elementArea';
import { proposeSlopedRoofEavesGableThermalBridges } from '../../geometry/thermalBridge/proposeSlopedRoofEavesGable';
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
    expect(cutout.gaps).toEqual([]);
    expect(cutout.planArea).toBeCloseTo(3 * 2.5, 2);
    expect(edges(elements, 'sloped_roof_eaves')).toEqual([[0, 2], [5, 8]]);
  });

  it('names an open footprint: where the gap is and what to do', () => {
    // Cheeks without a front wall: their front ends stand full height on the slope.
    const elements = [roof, wall('Loft wall', [2, 1], [2, 3], 4), wall('Loft wall 1', [5, 1], [5, 3], 4)];
    const cutout = deriveRoofCutout(roof, elements, [], 0)!;
    expect(cutout.wallNames).toEqual([]);
    expect(getElementEffectiveArea(roof, byId(elements), [], 0)).toBe(getElementGrossArea(roof, 0));
    expect(cutout.gaps.map((gap) => roofFootprintGapMessage(roof.name, gap))).toEqual([
      'Walls standing on "Front roof" ("Loft wall", "Loft wall 1") do not close a footprint: the gap is between '
      + '"Loft wall" at (2.00, 1.00) and "Loft wall 1" at (5.00, 1.00). Add a wall there or set their bottoms to Flat.',
    ]);
  });
});

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  rederiveContextShadingFromDrawing,
  contextShadingDistanceDetails,
  contextShadingCentre,
  deriveContextShading,
  generatedNeighbourStoredFields,
  resolveContextShadingCentre,
  CONTEXT_SHADING_PARENT_NOT_FLOOR,
  CONTEXT_SHADING_DEFAULT_CENTRE,
} from '../contextShadingGeometry';

// 10 x 6 m floor drawn on the internal wall faces.
const roundTo2 = (v: number) => Math.round(v * 100) / 100;
const floor = {
  coordinates: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
};
// 2 x 2 m block north of the floor, off-centre: its south face is 4 m from the north wall.
const block = {
  coordinates: [{ x: 2, y: 10 }, { x: 4, y: 10 }, { x: 4, y: 12 }, { x: 2, y: 12 }],
};

describe('context shading distance', () => {
  it('measures from the closest wall to the closest face, perpendicular to the facade', () => {
    expect(contextShadingDistanceDetails(block, floor, [])?.distance).toBe(4);
  });

  it('measures from the outside face when the floor gives a wall thickness', () => {
    expect(contextShadingDistanceDetails(block, { ...floor, thickness_walls: 0.3 }, [])?.distance).toBe(3.7);
  });

  it('picks the facade the object faces, in any direction and winding', () => {
    const clockwise = { coordinates: [...floor.coordinates].reverse() };
    const east = { coordinates: [{ x: 13, y: 1 }, { x: 15, y: 1 }, { x: 15, y: 2 }, { x: 13, y: 2 }] };
    expect(contextShadingDistanceDetails(east, clockwise, [])?.distance).toBe(3);
    expect(contextShadingDistanceDetails({ coordinates: [{ x: 5, y: 23 }] }, floor, [])?.distance).toBe(17);
  });

  it('measures from a party wall or wall to an adjacent space like any other perimeter wall', () => {
    const east = { coordinates: [{ x: 13, y: 1 }, { x: 15, y: 1 }, { x: 15, y: 2 }, { x: 13, y: 2 }] };
    for (const type of ['BuildingElementPartyWall', 'BuildingElementAdjacentConditionedSpace', 'BuildingElementAdjacentUnconditionedSpace_Simple']) {
      const wall = { type, coordinates: [{ x: 10.01, y: 6 }, { x: 10.01, y: 0 }] } as never;
      // An obstacle facing a non-exposed facade is still entered, from that facade.
      expect(contextShadingDistanceDetails(east, floor, [wall])?.distance).toBe(3);
    }
    const external = { type: 'BuildingElementOpaque', coordinates: [{ x: 10, y: 0 }, { x: 10, y: 6 }] } as never;
    expect(contextShadingDistanceDetails(east, floor, [external])?.distance).toBe(3);
  });

  it('ignores a horizontal ceiling to an adjacent space, and walls on another storey', () => {
    const house = { coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 8, y: 8, z: 0 }, { x: 0, y: 8, z: 0 }], thickness_walls: 0.3 };
    const west = { coordinates: [{ x: -10, y: 2 }, { x: -8, y: 2 }, { x: -8, y: 6 }, { x: -10, y: 6 }] };
    expect(contextShadingDistanceDetails(west, house, [])?.distance).toBe(7.7);
    const ceiling = { type: 'BuildingElementAdjacentConditionedSpace', pitch: 0, coordinates: house.coordinates } as never;
    expect(contextShadingDistanceDetails(west, house, [ceiling])?.distance).toBe(7.7);
    const groundFloorPartyWall = { type: 'BuildingElementPartyWall', coordinates: [{ x: 0, y: 8, z: 0 }, { x: 0, y: 0, z: 0 }] } as never;
    const upper = { ...house, coordinates: house.coordinates.map((p) => ({ ...p, z: 1 })) };
    expect(contextShadingDistanceDetails(west, upper, [groundFloorPartyWall])?.distance).toBe(7.7);
  });

  it('takes the face nearest the wall, then measures from its midpoint', () => {
    const square = { coordinates: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], thickness_walls: 0.3 };
    const longBlock = { coordinates: [{ x: 15, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 45 }, { x: 15, y: 45 }] };
    expect(contextShadingDistanceDetails(longBlock, square, [])?.distance).toBe(4.7);
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
    // The drawing's points: the block's south-face midpoint and its foot on the north wall's outside face.
    const layeredDetails = contextShadingDistanceDetails(block, { ...floor, thickness_walls: 0.2 }, [layered]);
    expect(layeredDetails).toMatchObject({
      distance: 3.65,
      thickness: { thicknessM: 0.35, source: 'wall_layers', name: 'North wall' },
      from: { x: 3, y: 6.35 },
      to: { x: 3, y: 10 },
    });
    // The wall's outside face meets the 0.2 m side walls' outside faces at the corners.
    expect(layeredDetails!.wall.flatMap(({ x, y }) => [x, y]).map((v) => roundTo2(v))).toEqual([10.2, 6.35, -0.2, 6.35]);
    expect(contextShadingDistanceDetails(block, { ...floor, thickness_walls: 0.2 }, []))
      .toMatchObject({ distance: 3.8, thickness: { thicknessM: 0.2, source: 'floor' } });
    const upper = { coordinates: floor.coordinates.map((p) => ({ ...p, z: 1 })) };
    expect(contextShadingDistanceDetails(block, upper, [ground]))
      .toMatchObject({ distance: 3.7, thickness: { thicknessM: 0.3, source: 'ground_floor', name: 'Ground' } });
    expect(contextShadingDistanceDetails(block, upper, [])?.thickness).toEqual({ thicknessM: 0, source: 'none' });
  });

  it('keeps the angles at the floor area centroid', () => {
    const derived = deriveContextShading(block, contextShadingCentre([floor]), [], 0) as { start_angle: number; end_angle: number };
    // Corners (2,10) and (4,12) seen from the centroid (5,3).
    expect(derived.start_angle).toBeCloseTo(450 - (Math.atan2(7, -3) * 180) / Math.PI, 2);
    expect(derived.end_angle).toBeCloseTo(450 - (Math.atan2(9, -1) * 180) / Math.PI, 2);
  });

  it('re-derives a stored centroid distance on load', () => {
    const elements = [
      { id: 'f', name: 'Floor', type: 'BuildingElementGround', ...floor },
      { id: 's', name: 'Block', type: 'ContextShading', parent_element: 'Floor', distance: 8.25, ...block },
    ] as unknown as Element[];
    const next = rederiveContextShadingFromDrawing(elements, [], 0);
    expect((next[1] as unknown as { distance: number }).distance).toBe(4);
  });

  it('reads angles a target stores as integers as unchanged on load', () => {
    const shading = { id: 's', name: 'Block', type: 'ContextShading', parent_element: 'Floor', ...block };
    const derived = rederiveContextShadingFromDrawing(
      [{ id: 'f', name: 'Floor', type: 'BuildingElementGround', ...floor }, { ...shading, start_angle: 0, end_angle: 0, distance: 0 }] as unknown as Element[], [], 0,
    )[1] as unknown as { start_angle: number; end_angle: number; distance: number; parts?: unknown };
    const integerAngles = (element: Element) => {
      const record = element as unknown as Record<string, number>;
      return { ...element, start_angle: Math.round(record.start_angle!), end_angle: Math.round(record.end_angle!) } as Element;
    };
    const stored = [
      { id: 'f', name: 'Floor', type: 'BuildingElementGround', ...floor },
      { ...shading, start_angle: Math.round(derived.start_angle), end_angle: Math.round(derived.end_angle), distance: derived.distance, parts: derived.parts },
    ] as unknown as Element[];
    expect(derived.start_angle).not.toBe(Math.round(derived.start_angle));
    expect(rederiveContextShadingFromDrawing(stored, [], 0, integerAngles)).toBe(stored);
    expect(rederiveContextShadingFromDrawing(stored, [], 0)).not.toBe(stored);
  });

  it('never mutates the stored element when the typing coerces in place', () => {
    const extra = { note: 1.5 };
    const elements = [
      { id: 'f', name: 'Floor', type: 'BuildingElementGround', ...floor },
      { id: 's', name: 'Block', type: 'ContextShading', parent_element: 'Floor', distance: 8.25, ...block, extra_json: extra },
    ] as unknown as Element[];
    rederiveContextShadingFromDrawing(elements, [], 0, (element) => {
      (element.extra_json as Record<string, number>).note = 2;
      return element;
    });
    expect(extra.note).toBe(1.5);
  });
});

type P = { x: number; y: number };
const rect = (x0: number, y0: number, x1: number, y1: number): P[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
// 8 x 6 m house at the origin with 0.3 m walls: the centre is (4, 3).
const house = { type: 'BuildingElementGround', name: 'Ground', thickness_walls: 0.3, coordinates: rect(0, 0, 8, 6) } as never;
const parts = (coordinates: P[], floor = house, offset = 0) => {
  const derived = deriveContextShading({ coordinates }, contextShadingCentre([floor]), [floor], offset);
  if (!derived || 'issue' in derived) throw new Error(`no parts: ${JSON.stringify(derived)}`);
  return derived.parts.map(({ start_angle, end_angle, distance }) => [start_angle, end_angle, distance]);
};
const issue = (coordinates: P[]) => {
  const derived = deriveContextShading({ coordinates }, contextShadingCentre([house]), [house], 0);
  return derived && 'issue' in derived ? derived.issue : null;
};
const U: P[] = [
  { x: -10, y: -2 }, { x: -4, y: -2 }, { x: -4, y: 10 }, { x: 12, y: 10 },
  { x: 12, y: -2 }, { x: 18, y: -2 }, { x: 18, y: 16 }, { x: -10, y: 16 },
];

describe('context shading parts: one per face the centre sees', () => {
  it('splits an L-shaped block into its far and near faces', () => {
    const s = 26;
    const plan = (points: number[][]) => points.map(([x, y]) => ({ x: x / s, y: -y / s }));
    const floor = { ...(house as object), coordinates: plan([[315, 47], [445, 47], [445, 220], [480, 220], [480, 547], [385, 547], [385, 287], [315, 287]]) } as never;
    const block = plan([[57, 47], [300, 47], [300, 287], [178, 287], [178, 547], [57, 547]]);
    // The far face is seen past the end of the dwelling's upper west wall (0.17 m past its corner).
    // That wall's joined corner is the nearest point of the dwelling, tied with the south wall of
    // the upper leg; the west wall is parallel to the face, so it is measured from that wall's line:
    // (12.115 - 0.3) - 6.846 = 4.97.
    expect(parts(block, floor)).toEqual([[220, 264, 4.97], [264, 335, 0.28]]);
    const derived = deriveContextShading({ coordinates: block }, contextShadingCentre([floor]), [floor], 0);
    expect(derived).toMatchObject({ distance: 0.28 });
  });

  it('keeps one part for a block seen square-on, and for a long terrace', () => {
    expect(parts(rect(1, 11, 7, 17))).toEqual([[339, 21, 4.7]]);
    expect(parts(rect(-26, 16, 34, 24))).toEqual([[293, 67, 9.7]]);
  });

  it('gives a U block three parts, clockwise from its start, the middle one across north', () => {
    expect(parts(U)).toEqual([[238, 311, 3.7], [311, 49, 3.7], [49, 122, 3.7]]);
  });

  // Owner decision 18 Nov: a corner tie uses the corner itself.
  it('measures a block off the corner in a straight line from the corner', () => {
    // Nearest the joined corner (8.3, 6.3): both parts read |(11, 9) - (8.3, 6.3)| = 3.82 m.
    expect(parts(rect(11, 9, 17, 15))).toEqual([[30, 49, 3.82], [49, 65, 3.82]]);
  });

  it('keeps measuring from the corner as the block moves off it diagonally', () => {
    const distances = (dx: number, dy: number) => parts(rect(11 + dx, 9 + dy, 17 + dx, 15 + dy)).map(([, , d]) => d);
    expect(distances(1, 0)).toEqual([4.58, 4.58]);
    expect(distances(0, 1)).toEqual([4.58, 4.58]);
  });

  it('measures from the wall a block faces when its nearest point is not the corner', () => {
    // Over the north wall (east end x = 8.3): the north wall alone is nearest both faces, so each
    // reads at right angles to it, the west face to its midpoint (12 - 6.3).
    expect(parts(rect(7, 9, 13, 15)).map(([, , d]) => d)).toEqual([5.7, 2.7]);
  });

  it('measures a block off a corner of an L-shaped floor from that corner', () => {
    // Block 5 of the over-limit probe: its 111-114 degree part is nearest the floor's south-east corner.
    const lFloor = {
      type: 'BuildingElementGround', name: 'Floor', thickness_walls: 0.3,
      coordinates: [[12.1154, -1.8077], [17.1154, -1.8077], [17.1154, -8.4615], [18.4615, -8.4615], [18.4615, -21.0385], [14.8077, -21.0385], [14.8077, -11.0385], [12.1154, -11.0385]].map(([x, y]) => ({ x, y })),
    } as never;
    const part = parts(rect(40.789, -26.079, 44.789, -22.079), lFloor).find(([start]) => start === 111);
    expect(part).toEqual([111, 114, 22.04]);
  });

  it('measures a neighbour built against the side wall from that wall: minus its thickness', () => {
    expect(parts(rect(8, 0, 16, 6)).map(([, , d]) => d)).toEqual([-0.3]);
    // A terrace neighbour deeper than the house: its face runs past both corners.
    expect(parts(rect(8, -2, 16, 8)).map(([, , d]) => d)).toEqual([-0.3]);
  });

  it('reads 0 or less for a part that crosses the outside face or lies inside the dwelling', () => {
    // A line from inside the house across the north wall's outside face (y = 6.3): -1.3 m at its inner end.
    expect(parts([{ x: 2, y: 5 }, { x: 2, y: 9 }])).toEqual([[315, 342, -1.3]]);
    // A block straddling the north wall: its east face crosses the outside face too.
    expect(parts(rect(1, 5, 3, 9))).toEqual([[304, 333, -1.3], [333, 351, -1.3]]);
    // A block whose south face is inside the wall (y = 6.2): its east face crosses the outside face.
    expect(parts(rect(0, 6.2, 2, 8))).toEqual([[309, 328, -0.1], [328, 338, -0.1]]);
    // A block inside the west prong of a U: its south face from the nearer west wall, 1.25 - -0.3;
    // its east face from the prong's inner wall, 2 - 3.3.
    const u = { ...(house as object), coordinates: [[0, 0], [10, 0], [10, 8], [7, 8], [7, 2], [3, 2], [3, 8], [0, 8]].map(([x, y]) => ({ x, y })) } as never;
    expect(parts(rect(0.5, 4, 2, 6), u).map(([, , d]) => d)).toEqual([-1.55, -1.3]);
  });

  it('leaves no part of a generated neighbour that overlaps the dwelling for HEM', () => {
    const derived = deriveContextShading({ coordinates: rect(0, 6.2, 2, 8) }, contextShadingCentre([house]), [house], 0);
    expect(generatedNeighbourStoredFields(derived as Exclude<typeof derived, null | { issue: string }>)).toBeNull();
  });

  // 12 x 10 m house with a 4 m wide, 5 m deep recess open to the north, 0.3 m walls: the centre is (6, 4.5).
  const uHouse = { ...(house as object), coordinates: [[0, 0], [12, 0], [12, 10], [8, 10], [8, 5], [4, 5], [4, 10], [0, 10]].map(([x, y]) => ({ x, y })) } as never;

  it('measures an object north of a recess from the nearest corner at its mouth', () => {
    // The nearest points are the joined corners at the recess mouth, (4.3, 10.3) and (7.7, 10.3),
    // each read in a straight line: to (5, 13), 2.79 m, and to (4.5, 12), 1.71 m.
    expect(parts(rect(5, 13, 7, 15), uHouse)).toEqual([[expect.any(Number), expect.any(Number), 2.79]]);
    expect(parts([{ x: 4.5, y: 12 }, { x: 7.5, y: 12 }], uHouse).map(([, , d]) => d)).toEqual([1.71]);
  });

  it('keeps the distance continuous as a block slides across a recess mouth', () => {
    let previous: number | null = null;
    let largest = { jump: 0, x: 0 };
    for (let i = 0; i <= 400; i++) {
      const x = -2 + i * 0.02;
      const derived = parts(rect(x, 13, x + 1.2, 14.2), uHouse);
      const widest = derived.reduce((a, b) => ((b[1] - b[0] + 360) % 360 > (a[1] - a[0] + 360) % 360 ? b : a));
      if (previous !== null && Math.abs(widest[2] - previous) > largest.jump) largest = { jump: Math.abs(widest[2] - previous), x };
      previous = widest[2];
    }
    // The facing rule jumped about 5 m here; the nearest wall changes only where two are equally near.
    expect(largest.jump).toBeLessThan(1.5);
  });

  it('reads a clear object nearest a convex corner from the wall it is in front of, above 0', () => {
    // Its nearest point ties between the west and south walls at the joined corner; the west wall
    // is more nearly parallel, but the object is behind its line. It is clear, so it reads above 0.
    const distances = parts([{ x: -6.21, y: -0.59 }, { x: -10.41, y: 0.28 }]).map(([, , d]) => d);
    expect(distances).toHaveLength(1);
    expect(distances[0]).toBeGreaterThan(0);
  });

  it('gives the same parts for either winding', () => {
    expect(parts([...U].reverse())).toEqual(parts(U));
    expect(parts(rect(11, 9, 17, 15).reverse())).toEqual([[30, 49, 3.82], [49, 65, 3.82]]);
  });

  it('subtracts the north offset from every part and the envelope', () => {
    expect(parts(U, house, 10)).toEqual([[228, 301, 3.7], [301, 39, 3.7], [39, 112, 3.7]]);
    const derived = deriveContextShading({ coordinates: U }, contextShadingCentre([house]), [house], 10);
    expect(derived).toMatchObject({ distance: 3.7 });
    const { start_angle, end_angle } = derived as { start_angle: number; end_angle: number };
    expect(Math.round(start_angle)).toBe(228);
    expect(Math.round(end_angle)).toBe(112);
  });

  it('takes a 2-point line as one face', () => {
    expect(parts([{ x: 1, y: 11 }, { x: 7, y: 11 }])).toEqual([[339, 21, 4.7]]);
  });

  it('refuses an object over the centre, a crossing outline, and one narrower than 1 degree', () => {
    expect(issue(rect(2, 2, 6, 4))).toBe("The object covers the shading centre. Draw it outside the dwelling.");
    expect(issue([{ x: 10, y: 0 }, { x: 14, y: 4 }, { x: 14, y: 0 }, { x: 10, y: 4 }])).toMatch(/crosses itself/);
    // A line, or an outline's edge, through the centre covers it too.
    expect(issue([{ x: 0, y: 1 }, { x: 8, y: 5 }])).toBe("The object covers the shading centre. Draw it outside the dwelling.");
    expect(issue([{ x: 4, y: 3 }, { x: 4, y: 20 }, { x: 6, y: 20 }])).toBe("The object covers the shading centre. Draw it outside the dwelling.");
    const narrow = "This object is narrower than 1° seen from the shading centre, so HEM can't take it.";
    expect(issue([{ x: 4, y: 20 }])).toBe(narrow);
    expect(issue(rect(4, 200, 4.5, 201))).toBe(narrow);
  });
});

describe('context shading centre', () => {
  // Two plates on the ground storey: 8 x 6 main plate, a 4 x 4 wing to the east sharing x = 8, y 0..4.
  const main = { id: 'm', name: 'Main', type: 'BuildingElementGround', thickness_walls: 0.3, coordinates: rect(0, 0, 8, 6).map((p) => ({ ...p, z: 0 })) };
  const wing = { id: 'w', name: 'Wing', type: 'BuildingElementGround', thickness_walls: 0.3, coordinates: rect(8, 0, 12, 4).map((p) => ({ ...p, z: 0 })) };
  const upper = { id: 'u', name: 'Upper', type: 'BuildingElementAdjacentConditionedSpace', pitch: 180, coordinates: rect(0, 0, 8, 6).map((p) => ({ ...p, z: 1 })) };
  const elements = [main, wing, upper] as unknown as Element[];
  const floors = [0, 1].map((zIndex) => ({ id: `f${zIndex}`, name: `F${zIndex}`, zIndex, height: 2.5, heightUserOverride: true })) as never;

  it('defaults to the area-weighted centroid of every plate on the lowest occupied storey', () => {
    const centre = resolveContextShadingCentre(elements, floors, CONTEXT_SHADING_DEFAULT_CENTRE);
    expect(centre && 'point' in centre && centre.plates.map((p) => p.name)).toEqual(['Main', 'Wing']);
    // (48 * (4, 3) + 16 * (10, 2)) / 64
    expect(centre && 'point' in centre && centre.point).toEqual({ x: 5.5, y: 2.75 });
  });

  it('has no centre for a blank parent: the object keeps the values it states', () => {
    expect(resolveContextShadingCentre(elements, floors, null)).toBeNull();
    expect(resolveContextShadingCentre(elements, floors, '')).toBeNull();
    const typed = { id: 's', name: 'Typed', type: 'ContextShading', parent_element: '', start_angle: 300, end_angle: 60, distance: 12, coordinates: [{ x: 2, y: 10, z: 0 }, { x: 4, y: 10, z: 0 }] };
    const stored = [...elements, typed] as unknown as Element[];
    expect(rederiveContextShadingFromDrawing(stored, floors, 0)).toBe(stored);
  });

  it('skips the edge two plates share: it is inside the dwelling', () => {
    const centre = resolveContextShadingCentre(elements, floors, CONTEXT_SHADING_DEFAULT_CENTRE)!;
    if (!('point' in centre)) throw new Error('no centre');
    // A line inside the wing, by the shared line: measured from the wing's south wall
    // (y = -0.3, so -1.8 m: inside), not from the shared edge moved out to x = 8.3 (-0.2 m).
    const inside = [{ x: 8.1, y: 1 }, { x: 8.1, y: 2 }];
    expect(deriveContextShading({ coordinates: inside }, centre, elements, 0)).toMatchObject({ distance: -1.8 });
    // The main plate's east wall above the wing (x = 8.3, y 4..6) still counts.
    const east = [{ x: 9, y: 5.8 }, { x: 9, y: 6.2 }];
    const derived = deriveContextShading({ coordinates: east }, centre, elements, 0);
    expect(derived).toMatchObject({ distance: 0.7 });
  });

  it('measures from a chosen floor alone, and refuses a parent that is not a floor', () => {
    const centre = resolveContextShadingCentre(elements, floors, 'Wing');
    expect(centre && 'point' in centre && centre.point).toEqual({ x: 10, y: 2 });
    const wall = { id: 'x', name: 'Wall', type: 'BuildingElementOpaque', pitch: 90, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }] };
    expect(resolveContextShadingCentre([...elements, wall] as unknown as Element[], floors, 'Wall')).toEqual({ issue: CONTEXT_SHADING_PARENT_NOT_FLOOR });
    expect(resolveContextShadingCentre(elements, floors, 'Missing')).toEqual({ issue: CONTEXT_SHADING_PARENT_NOT_FLOOR });
  });
});

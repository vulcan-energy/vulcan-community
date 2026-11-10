// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { wallFaceProblem, wallFootFromExportedBaseHeight, type ProfilePoint } from '../profileLineFace';
import { deriveWallEdgeFromRoofs, isRoofSnapshotStale } from '../wallEdgeFromRoofs';
import { getAreaBasedElementExportGeometry, getElementGrossArea } from '../elementArea';
import type { BuildingElementOpaque, Element } from '../../geometry/types';

const flat = (h: number): ProfilePoint[] => [{ t: 0, h }, { t: 1, h }];

describe('wallFaceProblem', () => {
  it('names the range where a custom top dips below a roof-sloped bottom', () => {
    const w = 2.3;
    const top = [{ t: 0, h: 2.9 }, { t: 0.8 / w, h: 1.0 }, { t: 2.0 / w, h: 1.2 }, { t: 1, h: 2.9 }];
    const bottom = [{ t: 0, h: 0.9 }, { t: 1, h: 2.0 }];
    expect(wallFaceProblem(top, bottom, w)).toBe('Top must be above bottom (from 0.80 m to 2.00 m).');
  });

  it('rejects points out of order and negative heights', () => {
    expect(wallFaceProblem([{ t: 0, h: 2 }, { t: 0.6, h: 2 }, { t: 0.4, h: 2 }, { t: 1, h: 2 }], flat(0), 4))
      .toBe('Top points must run in order along the wall.');
    expect(wallFaceProblem(flat(2), [{ t: 0, h: -0.1 }, { t: 1, h: 0 }], 4))
      .toBe('Bottom heights cannot be below the base.');
  });

  it('accepts a valid face, including a gable triangle that meets the foot at its ends', () => {
    expect(wallFaceProblem([{ t: 0, h: 2.9 }, { t: 0.5, h: 2 }, { t: 1, h: 2.9 }], [{ t: 0, h: 0 }, { t: 1, h: 1 }], 3)).toBeNull();
    expect(wallFaceProblem([{ t: 0, h: 0 }, { t: 0.5, h: 3 }, { t: 1, h: 0 }], flat(0), 6)).toBeNull();
  });
});

// House 8 m (x) by 6 m (y), eaves at 5 m, ridge along x at y = 3, 45° pitch (ridge at 8 m).
const roof = (id: string, coordinates: Array<[number, number]>): BuildingElementOpaque => ({
  id,
  name: id,
  type: 'BuildingElementOpaque',
  zoneId: 'z',
  pitch: 45,
  base_height: 5,
  width: 0,
  height: 0,
  area: 0,
  coordinates: coordinates.map(([x, y]) => ({ x, y, z: 0 })),
}) as BuildingElementOpaque;
const front = roof('Front roof', [[0, 0], [8, 0], [8, 3], [0, 3]]);
const rear = roof('Rear roof', [[8, 6], [0, 6], [0, 3], [8, 3]]);
const wall = (a: [number, number], b: [number, number], extra?: Record<string, unknown>): BuildingElementOpaque => ({
  id: 'w',
  name: 'Loft wall',
  type: 'BuildingElementOpaque',
  zoneId: 'z',
  pitch: 90,
  base_height: 5,
  width: Math.hypot(b[0] - a[0], b[1] - a[1]),
  height: 2.9,
  area: 0,
  coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  ...(extra ? { extra_json: extra } : {}),
}) as BuildingElementOpaque;
const derive = (w: Element, edge: 'top' | 'bottom', elements: Element[] = [front, rear]) =>
  deriveWallEdgeFromRoofs(w, elements, [], 0, edge);

describe('deriveWallEdgeFromRoofs', () => {
  it('fits a bottom edge to a single slope', () => {
    // Runs up the rear slope from the eaves (y = 6) towards the ridge, stopping at y = 4.
    const fit = derive(wall([2, 6], [2, 4]), 'bottom');
    expect(fit?.roofNames).toEqual(['Rear roof']);
    expect(fit?.profile).toEqual([{ t: 0, h: 0 }, { t: 1, h: 2 }]);
  });

  it('breaks a bottom edge at the ridge when the wall crosses it', () => {
    const fit = derive(wall([2, 1], [2, 5]), 'bottom');
    expect(fit?.roofNames).toEqual(['Front roof', 'Rear roof']);
    expect(fit?.profile).toEqual([{ t: 0, h: 1 }, { t: 0.5, h: 3 }, { t: 1, h: 1 }]);
  });

  it('clamps to the foot past the eaves, with a breakpoint at the roof edge', () => {
    // From y = 4 out past the rear eaves to y = 7.
    const fit = derive(wall([2, 4], [2, 7]), 'bottom');
    expect(fit?.profile).toEqual([{ t: 0, h: 2 }, { t: 2 / 3, h: 0 }, { t: 1, h: 0 }]);
  });

  it('returns null with no roof under the wall', () => {
    expect(derive(wall([20, 0], [20, 4]), 'bottom')).toBeNull();
  });

  it('fits a gable wall top to the gable triangle with a ridge breakpoint', () => {
    const gable = wall([0, 0], [0, 6]);
    const fit = derive(gable, 'top');
    expect(fit?.profile).toEqual([{ t: 0, h: 0 }, { t: 0.5, h: 3 }, { t: 1, h: 0 }]);
    const area = getElementGrossArea(wall([0, 0], [0, 6], {
      geometry_face: { kind: 'profiled-line-face', top_profile: fit!.profile, bottom_profile: flat(0), top_mode: 'roof' },
    }));
    expect(area).toBeCloseTo((6 * 3) / 2);
  });

  it('adds the rectangle below the eaves when the gable wall starts a storey lower', () => {
    const fit = derive({ ...wall([0, 0], [0, 6]), base_height: 2.5 }, 'top');
    expect(fit?.profile).toEqual([{ t: 0, h: 2.5 }, { t: 0.5, h: 5.5 }, { t: 1, h: 2.5 }]);
    const area = getElementGrossArea({ ...wall([0, 0], [0, 6], {
      geometry_face: { kind: 'profiled-line-face', top_profile: fit!.profile, bottom_profile: flat(0) },
    }), base_height: 2.5 });
    expect(area).toBeCloseTo(6 * 2.5 + (6 * 3) / 2);
  });

  it('gives no top fit when part of the wall line has no roof over it', () => {
    expect(derive(wall([0, 4], [0, 8]), 'top')).toBeNull();
  });

  it('marks a snapshot stale after the pitch changes, and fresh after a re-fit', () => {
    const gable = wall([0, 0], [0, 6]);
    const stored = derive(gable, 'top')!.profile;
    const steeper = [{ ...front, pitch: 50 }, { ...rear, pitch: 50 }];
    const refit = derive(gable, 'top', steeper)!.profile;
    expect(isRoofSnapshotStale(stored, refit)).toBe(true);
    expect(isRoofSnapshotStale(refit, derive(gable, 'top', steeper)!.profile)).toBe(false);
    expect(isRoofSnapshotStale(stored, null)).toBe(true);
  });
});

// A loft on one slope: roof eaves at y = 11.35, 0.7 m above the loft floor (roof base 6.3 m,
// wall foot 5.6 m), rising at 40° towards y = 15.22. Walls are 2.6 m tall with a flat top.
describe('deriveWallEdgeFromRoofs on a loft slope', () => {
  const slope = { ...roof('Pitched Roof (S) 1', [[-29.7, 11.35], [-25, 11.35], [-25, 15.22], [-29.7, 15.22]]), pitch: 40, base_height: 6.3 };
  const tan = Math.tan((40 * Math.PI) / 180);
  const loftWall = (y0: number, y1: number) => ({ ...wall([-26.2, y0], [-26.2, y1]), base_height: 5.6, height: 2.6 });
  const fit = (y0: number, y1: number) =>
    deriveWallEdgeFromRoofs(loftWall(y0, y1), [slope], [], 0, 'bottom', flat(2.6));

  it('follows the roof through the top of a wall running up the slope, and says where', () => {
    const bottom = fit(12.0, 14.6)!.profile;
    const through = (11.35 + 1.9 / tan - 12.0) / 2.6; // where the roof reaches the 2.6 m top
    expect(bottom.map((p) => p.h)).toEqual([1.25, 2.6, 3.43]);
    expect(bottom[1]!.t).toBeCloseTo(through, 6);
    expect(wallFaceProblem(flat(2.6), bottom, 2.6)).toBe('Top must be above bottom (from 1.61 m to 2.60 m).');
  });

  it('fits a loft cheek wall that stays under the top', () => {
    const bottom = fit(11.6, 13.0)!.profile;
    expect(bottom).toEqual([
      { t: 0, h: Math.round((0.7 + 0.25 * tan) * 100) / 100 },
      { t: 1, h: Math.round((0.7 + 1.65 * tan) * 100) / 100 },
    ]);
    expect(bottom.map((p) => p.h)).toEqual([0.91, 2.08]);
    expect(wallFaceProblem(flat(2.6), bottom, 1.4)).toBeNull();
  });
});

describe('profiled wall export scalars', () => {
  const profiled = (top: ProfilePoint[], bottom: ProfilePoint[]) =>
    wall([0, 0], [4, 0], { geometry_face: { kind: 'profiled-line-face', top_profile: top, bottom_profile: bottom } });

  it('exports base_height as foot + lowest bottom point, and import undoes it', () => {
    const el = profiled(flat(3), [{ t: 0, h: 0.4 }, { t: 1, h: 1.2 }]);
    const exp = getAreaBasedElementExportGeometry(el);
    expect(exp.baseHeight).toBe(5.4);
    expect(wallFootFromExportedBaseHeight(exp.baseHeight, el.extra_json)).toBe(5);
  });

  it('computes a trapezoid wall area from the polygon', () => {
    const el = profiled([{ t: 0, h: 2 }, { t: 1, h: 3 }], flat(0));
    expect(getElementGrossArea(el)).toBe(10);
    expect(getAreaBasedElementExportGeometry(el)).toEqual({ width: 4, height: 2.5, baseHeight: 5 });
  });

  it('leaves a flat wall without a face unchanged', () => {
    const el = { ...wall([0, 0], [4, 0]), height: 2.5 };
    expect(getAreaBasedElementExportGeometry(el)).toEqual({ width: 4, height: 2.5, baseHeight: 5 });
    expect(getElementGrossArea(el)).toBe(10);
  });

  it('gives an invalid face no area instead of a folded polygon', () => {
    const el = profiled(flat(1), flat(2));
    expect(getElementGrossArea(el)).toBe(0);
  });
});

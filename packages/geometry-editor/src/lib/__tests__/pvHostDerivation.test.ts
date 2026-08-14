// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  alignHostedSlopedPanelToHostOrientation,
  buildHostDerivedPatch,
  deriveFromHostRoof,
  findHostRoofId,
  isPanelFullyOnRoof,
  pointInPolygon2D,
  polygonAreaM2,
} from '../pvHostDerivation';
import { orientation360SlopedFromFirstEdge, polygonPlanCentroid } from '../openingSegmentOutward';
import type {
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
  OnSiteGeneration,
} from '../../geometry/types';

const square = (x0: number, y0: number, side: number, z = 0) => [
  { x: x0, y: y0, z },
  { x: x0 + side, y: y0, z },
  { x: x0 + side, y: y0 + side, z },
  { x: x0, y: y0 + side, z },
];

const makeRoof = (overrides: Partial<BuildingElementOpaque> & { id: string }): BuildingElementOpaque =>
  ({
    id: overrides.id,
    name: overrides.name ?? 'Roof',
    type: 'BuildingElementOpaque',
    parent_element: null,
    coordinates: overrides.coordinates ?? square(0, 0, 10),
    width: 0,
    height: 0,
    pitch: overrides.pitch ?? 30,
    orientation360: overrides.orientation360 ?? 180,
    base_height: overrides.base_height,
    ...overrides,
  }) as BuildingElementOpaque;

const makePanel = (overrides: Partial<OnSiteGeneration> & { id: string }): OnSiteGeneration =>
  ({
    id: overrides.id,
    name: 'Panel',
    type: 'OnSiteGeneration',
    parent_element: null,
    generation_type: 'PhotovoltaicSystem',
    coordinates: overrides.coordinates ?? square(2, 2, 1),
    ...overrides,
  }) as OnSiteGeneration;

const makeOpening = (
  overrides: Partial<BuildingElementTransparent> & { id: string },
): BuildingElementTransparent =>
  ({
    id: overrides.id,
    name: 'Rooflight',
    type: 'BuildingElementTransparent',
    parent_element: null,
    coordinates: overrides.coordinates ?? square(2, 2, 1),
    width: 1,
    height: 1,
    area: 1,
    pitch: 30,
    orientation360: 180,
    base_height: 0,
    frame_area_fraction: 0.25,
    free_area_height: 0.5,
    mid_height: 0.5,
    max_window_open_area: 1,
    ...overrides,
  }) as BuildingElementTransparent;

describe('pvHostDerivation – primitives', () => {
  it('pointInPolygon2D handles inside/outside/edge cases', () => {
    const ring = square(0, 0, 10).map(({ x, y }) => ({ x, y }));
    expect(pointInPolygon2D({ x: 5, y: 5 }, ring)).toBe(true);
    expect(pointInPolygon2D({ x: -1, y: 5 }, ring)).toBe(false);
    expect(pointInPolygon2D({ x: 5, y: 5 }, [])).toBe(false);
  });

  it('polygonAreaM2 returns absolute area independent of winding', () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    const cw = [...ccw].reverse();
    expect(polygonAreaM2(ccw)).toBeCloseTo(12, 6);
    expect(polygonAreaM2(cw)).toBeCloseTo(12, 6);
  });
});

describe('pvHostDerivation – findHostRoofId', () => {
  it('returns null when no roof contains the panel centroid', () => {
    const elementsById: Record<string, Element> = {
      r1: makeRoof({ id: 'r1', coordinates: square(100, 100, 5) }),
    };
    const panel = makePanel({ id: 'p1', coordinates: square(0, 0, 1) });
    expect(findHostRoofId(panel, elementsById)).toBeNull();
  });

  it('picks the smallest containing roof when nested (dormer over main)', () => {
    const main = makeRoof({ id: 'main', coordinates: square(0, 0, 20), name: 'Main Roof' });
    const dormer = makeRoof({ id: 'dormer', coordinates: square(8, 8, 4), name: 'Dormer Roof' });
    const panel = makePanel({ id: 'p1', coordinates: square(9, 9, 1) });
    expect(findHostRoofId(panel, { main, dormer })).toBe('dormer');
  });

  it('ignores vertical opaques (walls) even when the centroid would lie on them in plan', () => {
    const wall = makeRoof({
      id: 'wall',
      pitch: 90,
      name: 'External Wall',
      coordinates: square(0, 0, 10),
    });
    const panel = makePanel({ id: 'p1', coordinates: square(2, 2, 1) });
    expect(findHostRoofId(panel, { wall })).toBeNull();
  });

  it('matches a flat roof-like element identified by name', () => {
    const flat = makeRoof({
      id: 'flat',
      pitch: 0,
      name: 'Flat Roof',
      coordinates: square(0, 0, 10),
    });
    const panel = makePanel({ id: 'p1', coordinates: square(2, 2, 1) });
    expect(findHostRoofId(panel, { flat })).toBe('flat');
  });

  it('accepts transparent polygon openings as roof-host candidates', () => {
    const roof = makeRoof({ id: 'roof', coordinates: square(0, 0, 10), name: 'Main Roof' });
    const opening = makeOpening({ id: 'rooflight', coordinates: square(2, 2, 1) });
    expect(findHostRoofId(opening, { roof, rooflight: opening })).toBe('roof');
  });
});

describe('pvHostDerivation – isPanelFullyOnRoof', () => {
  it('true when every panel vertex is inside the roof polygon', () => {
    const roof = makeRoof({ id: 'r1', coordinates: square(0, 0, 10) });
    const panel = makePanel({ id: 'p1', coordinates: square(2, 2, 4) });
    expect(isPanelFullyOnRoof(panel, roof)).toBe(true);
  });

  it('false when one panel vertex is outside the roof polygon', () => {
    const roof = makeRoof({ id: 'r1', coordinates: square(0, 0, 10) });
    const panel = makePanel({ id: 'p1', coordinates: square(8, 8, 4) }); // overhangs +x and +y
    expect(isPanelFullyOnRoof(panel, roof)).toBe(false);
  });
});

describe('pvHostDerivation – deriveFromHostRoof', () => {
  it('passes through an Orientation-axis host bearing and aligns the panel to it', () => {
    const roof = makeRoof({
      id: 'orientation-roof',
      orientation360: 90,
      extra_json: { _slope_pitch_axis: 'orientation' },
    });
    const panel = makePanel({ id: 'panel', coordinates: square(2, 2, 1) });
    const panelCentroid = polygonPlanCentroid(panel.coordinates);

    expect(deriveFromHostRoof(panel, roof, undefined, 0).orientation360).toBe(90);
    const aligned = alignHostedSlopedPanelToHostOrientation(panel, roof, 0);
    expect(aligned).not.toBeNull();
    expect(polygonPlanCentroid(aligned!)?.x).toBeCloseTo(panelCentroid!.x, 12);
    expect(polygonPlanCentroid(aligned!)?.y).toBeCloseTo(panelCentroid!.y, 12);
    expect(orientation360SlopedFromFirstEdge(
      aligned![0]!.x,
      aligned![0]!.y,
      aligned![1]!.x,
      aligned![1]!.y,
      0,
    )).toBeCloseTo(90, 6);
  });

  it('inherits pitch and orientation360 from a sloped roof', () => {
    const roof = makeRoof({
      id: 'r1',
      pitch: 35,
      orientation360: 90,
      base_height: 2.5,
      coordinates: square(0, 0, 10),
    });
    const panel = makePanel({ id: 'p1', coordinates: square(2, 2, 1) });
    const derived = deriveFromHostRoof(panel, roof, undefined);
    expect(derived.pitch).toBe(35);
    expect(derived.orientation360).toBe(90);
    expect(typeof derived.base_height).toBe('number');
  });

  it('takes the lowest 3D elevation across panel vertices on a sloped roof', () => {
    // 10x10 roof, pitch 30°, base 2.5m. Sloped roof rises away from coords[0]→coords[1] edge
    // (the inward normal). Panels closer to the eave (low side) should get a smaller base_height
    // than panels closer to the ridge.
    const roof = makeRoof({
      id: 'r1',
      pitch: 30,
      orientation360: 180,
      base_height: 2.5,
      coordinates: square(0, 0, 10),
    });

    const lowPanel = makePanel({ id: 'low', coordinates: square(1, 1, 1) });
    const highPanel = makePanel({ id: 'high', coordinates: square(1, 8, 1) });

    const lowDerived = deriveFromHostRoof(lowPanel, roof, undefined);
    const highDerived = deriveFromHostRoof(highPanel, roof, undefined);

    expect(lowDerived.base_height).toBeDefined();
    expect(highDerived.base_height).toBeDefined();
    // The panel further up the slope should have a higher derived base_height than the one
    // near the eave — the only behaviour that matters here.
    expect(highDerived.base_height!).toBeGreaterThan(lowDerived.base_height!);
  });

  it('uses the roof base_height directly for a flat roof', () => {
    const flat = makeRoof({
      id: 'flat',
      pitch: 0,
      name: 'Flat Roof',
      base_height: 6.2,
      coordinates: square(0, 0, 10),
    });
    const panel = makePanel({ id: 'p1', coordinates: square(2, 2, 1) });
    const derived = deriveFromHostRoof(panel, flat, undefined);
    expect(derived.base_height).toBeCloseTo(6.2, 5);
    expect(derived.pitch).toBe(0);
  });
});

describe('pvHostDerivation – buildHostDerivedPatch', () => {
  it('omits fields that have user-override flags set', () => {
    const panel = makePanel({
      id: 'p1',
      _baseHeightUserOverride: true,
      _pitchUserOverride: false,
      _orientationUserOverride: true,
    });
    const patch = buildHostDerivedPatch(panel, {
      base_height: 5,
      pitch: 35,
      orientation360: 180,
    });
    expect(patch).toEqual({ pitch: 35 });
  });

  it('returns an empty patch when every field is overridden', () => {
    const panel = makePanel({
      id: 'p1',
      _baseHeightUserOverride: true,
      _pitchUserOverride: true,
      _orientationUserOverride: true,
    });
    const patch = buildHostDerivedPatch(panel, {
      base_height: 5,
      pitch: 35,
      orientation360: 180,
    });
    expect(patch).toEqual({});
  });

  it('applies all derived values when no overrides are set', () => {
    const panel = makePanel({ id: 'p1' });
    const patch = buildHostDerivedPatch(panel, {
      base_height: 5,
      pitch: 35,
      orientation360: 180,
    });
    expect(patch).toEqual({ base_height: 5, pitch: 35, orientation360: 180 });
  });
});
